import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import * as Duration from "effect/Duration";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

export type InvalidUtf8 = {
  readonly _tag: "InvalidUtf8";
};

const utf8Decoder = new globalThis.TextDecoder("utf-8", { fatal: true });

export const decodeUtf8Strict = (
  bytes: Readonly<{ readonly length: number; readonly [index: number]: number }>,
): Effect.Effect<string, InvalidUtf8> =>
  Effect.try({
    try: () => utf8Decoder.decode(Uint8Array.from(bytes)),
    catch: () => ({ _tag: "InvalidUtf8" }),
  });

export type CapturedBytes = {
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
  readonly truncated: boolean;
};

export type ProcessStatus =
  | { readonly _tag: "Exited"; readonly code: number }
  | { readonly _tag: "Signaled" };

export type ProcessCapture = {
  readonly stdout: CapturedBytes;
  readonly stderr: CapturedBytes;
  readonly status: ProcessStatus;
  readonly timedOut: boolean;
  readonly requestedSignals: ReadonlyArray<ChildProcess.Signal>;
};

export type CaptureProcessOptions = {
  readonly awaitStdoutBytes?: number;
  readonly maxOutputBytes: number;
  readonly onReady?: () => Effect.Effect<void>;
  readonly timeoutMillis: number;
  readonly terminationGraceMillis: number;
};

type MutableCapture = {
  readonly chunks: Array<Uint8Array>;
  retainedBytes: number;
  totalBytes: number;
};

type CaptureStreamInput = {
  readonly stream: () => Stream.Stream<Uint8Array, PlatformError.PlatformError>;
  readonly maxOutputBytes: number;
  readonly readiness:
    | Readonly<{
        readonly byteCount: number;
        readonly signal: () => Effect.Effect<void>;
      }>
    | undefined;
};

type ReadonlyBytes = {
  readonly byteLength: number;
  readonly length: number;
  readonly [index: number]: number;
};

const captureStream = (
  ...[input]: readonly [CaptureStreamInput]
): Effect.Effect<CapturedBytes, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const capture: MutableCapture = { chunks: [], retainedBytes: 0, totalBytes: 0 };
    yield* Stream.runForEach(input.stream(), (chunk: ReadonlyBytes) =>
      Effect.gen(function* () {
        capture.totalBytes += chunk.byteLength;
        const available = input.maxOutputBytes - capture.retainedBytes;
        if (available > 0) {
          const retained = Uint8Array.from(chunk).slice(0, available);
          capture.chunks.push(retained);
          capture.retainedBytes += retained.byteLength;
        }
        if (input.readiness !== undefined && capture.totalBytes >= input.readiness.byteCount) {
          yield* input.readiness.signal();
        }
      }),
    );

    const bytes = new Uint8Array(capture.retainedBytes);
    let offset = 0;
    for (const chunk of capture.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      bytes,
      totalBytes: capture.totalBytes,
      truncated: capture.totalBytes > capture.retainedBytes,
    };
  });

const awaitProcessStatus = Effect.fnUntraced(function* (
  input: Readonly<{
    readonly exitCode: () => ChildProcessSpawner.ChildProcessHandle["exitCode"];
    readonly kill: ChildProcessSpawner.ChildProcessHandle["kill"];
    readonly terminationGraceMillis: number;
    readonly timeoutMillis: number;
  }>,
): Effect.fn.Return<
  {
    readonly status: ProcessStatus;
    readonly timedOut: boolean;
    readonly requestedSignals: ReadonlyArray<ChildProcess.Signal>;
  },
  PlatformError.PlatformError
> {
  const requestedSignals: Array<ChildProcess.Signal> = [];
  const exitCode = yield* Effect.timeoutOption(
    input.exitCode(),
    Duration.millis(input.timeoutMillis),
  );
  if (Option.isSome(exitCode)) {
    return {
      status: { _tag: "Exited", code: Number(exitCode.value) },
      timedOut: false,
      requestedSignals,
    };
  }

  requestedSignals.push("SIGTERM");
  const terminated = yield* Effect.timeoutOption(
    input.kill({ killSignal: "SIGTERM" }),
    Duration.millis(input.terminationGraceMillis),
  );
  if (Option.isNone(terminated)) {
    requestedSignals.push("SIGKILL");
    yield* input.kill({ killSignal: "SIGKILL" });
  }
  return {
    status: { _tag: "Signaled" },
    timedOut: true,
    requestedSignals,
  };
});

export type CaptureProcessInput = {
  readonly makeCommand: () => ChildProcess.Command;
  readonly options: CaptureProcessOptions;
};

const captureInScope = Effect.fnUntraced(function* (
  input: Readonly<CaptureProcessInput>,
): Effect.fn.Return<
  ProcessCapture,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(input.makeCommand());
  const stdoutReady = yield* Deferred.make<void>();
  const stdoutReadiness =
    input.options.awaitStdoutBytes === undefined
      ? undefined
      : {
          byteCount: input.options.awaitStdoutBytes,
          signal: () => Deferred.completeWith(stdoutReady, Effect.void).pipe(Effect.asVoid),
        };
  const stdoutFiber = yield* Effect.forkScoped(
    captureStream({
      stream: () => handle.stdout,
      maxOutputBytes: input.options.maxOutputBytes,
      readiness: stdoutReadiness,
    }),
  );
  const stderrFiber = yield* Effect.forkScoped(
    captureStream({
      stream: () => handle.stderr,
      maxOutputBytes: input.options.maxOutputBytes,
      readiness: undefined,
    }),
  );
  if (stdoutReadiness !== undefined) {
    yield* Deferred.await(stdoutReady);
    if (input.options.onReady !== undefined) {
      yield* input.options.onReady();
    }
  }
  const outcome = yield* awaitProcessStatus({
    exitCode: () => handle.exitCode,
    kill: handle.kill,
    terminationGraceMillis: input.options.terminationGraceMillis,
    timeoutMillis: input.options.timeoutMillis,
  });
  const stdout = yield* Fiber.join(stdoutFiber);
  const stderr = yield* Fiber.join(stderrFiber);
  return { stdout, stderr, ...outcome };
});

export const captureProcess = Effect.fn("ProcessFixture.captureProcess")(function* (
  input: Readonly<CaptureProcessInput>,
): Effect.fn.Return<
  ProcessCapture,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return yield* Effect.scoped(captureInScope(input));
});
