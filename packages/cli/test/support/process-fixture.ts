import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import * as Duration from "effect/Duration";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

import * as ProcessFixtureOptions from "./process-fixture-options";

export type InvalidProcessFixtureBound = ProcessFixtureOptions.InvalidProcessFixtureBound;
export type CaptureProcessOptions = ProcessFixtureOptions.CaptureProcessOptions;
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
type ReadinessOutcome = { readonly ready: true } | { readonly ready: false; readonly code: number };
const readyOutcome: ReadinessOutcome = { ready: true };

const awaitReadinessOrExit = Effect.fnUntraced(function* (
  input: Readonly<{
    readonly awaitReady: () => Effect.Effect<void>;
    readonly exitCode: () => ChildProcessSpawner.ChildProcessHandle["exitCode"];
    readonly onReady: (() => Effect.Effect<void>) | undefined;
  }>,
): Effect.fn.Return<Option.Option<number>, PlatformError.PlatformError> {
  const outcome = yield* Effect.raceFirst(
    input.awaitReady().pipe(Effect.as(readyOutcome)),
    input
      .exitCode()
      .pipe(Effect.map((code): ReadinessOutcome => ({ ready: false, code: Number(code) }))),
  );
  if (outcome.ready) {
    if (input.onReady !== undefined) {
      yield* input.onReady();
    }
    return Option.none();
  }
  return Option.some(outcome.code);
});

const makeStdoutReadiness = (
  ...[byteCount, signal]: readonly [number | undefined, () => Effect.Effect<void>]
): CaptureStreamInput["readiness"] => (byteCount === undefined ? undefined : { byteCount, signal });

const joinCapturedStreams = Effect.fnUntraced(function* (
  input: Readonly<{
    readonly stderr: () => Effect.Effect<CapturedBytes, PlatformError.PlatformError>;
    readonly stdout: () => Effect.Effect<CapturedBytes, PlatformError.PlatformError>;
  }>,
) {
  const stdout = yield* input.stdout();
  const stderr = yield* input.stderr();
  return { stdout, stderr };
});

const forkCaptureStreams = Effect.fnUntraced(function* (
  input: Readonly<{
    readonly maxOutputBytes: number;
    readonly stderr: () => Stream.Stream<Uint8Array, PlatformError.PlatformError>;
    readonly stdout: () => Stream.Stream<Uint8Array, PlatformError.PlatformError>;
    readonly stdoutReadiness: CaptureStreamInput["readiness"];
  }>,
) {
  const stdoutFiber = yield* Effect.forkScoped(
    captureStream({
      stream: input.stdout,
      maxOutputBytes: input.maxOutputBytes,
      readiness: input.stdoutReadiness,
    }),
  );
  const stderrFiber = yield* Effect.forkScoped(
    captureStream({
      stream: input.stderr,
      maxOutputBytes: input.maxOutputBytes,
      readiness: undefined,
    }),
  );
  return { stderrFiber, stdoutFiber };
});

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
    readonly kill: (
      signal: ChildProcess.Signal,
    ) => Effect.Effect<void, PlatformError.PlatformError>;
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
    input.kill("SIGTERM"),
    Duration.millis(input.terminationGraceMillis),
  );
  if (Option.isNone(terminated)) {
    requestedSignals.push("SIGKILL");
    yield* input.kill("SIGKILL");
  }
  return {
    status: { _tag: "Signaled" },
    timedOut: true,
    requestedSignals,
  };
});

export type CaptureProcessInput = {
  readonly makeCommand: () => ChildProcess.StandardCommand;
  readonly onKillRequested?: (signal: ChildProcess.Signal) => Effect.Effect<void>;
  readonly onSpawned?: (
    isRunning: () => ChildProcessSpawner.ChildProcessHandle["isRunning"],
    killSignal: ChildProcess.Signal | undefined,
    forceKillAfterMillis: number | undefined,
  ) => Effect.Effect<void>;
  readonly options: CaptureProcessOptions;
};

const spawnCaptureCommand = Effect.fnUntraced(function* (
  input: Readonly<CaptureProcessInput>,
): Effect.fn.Return<
  ChildProcessSpawner.ChildProcessHandle,
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const requestedCommand = input.makeCommand();
  const command = ChildProcess.make(requestedCommand.command, requestedCommand.args, {
    ...requestedCommand.options,
    killSignal: "SIGTERM",
    forceKillAfter: Duration.millis(input.options.terminationGraceMillis),
  });
  const handle = yield* spawner.spawn(command);
  if (input.onSpawned !== undefined) {
    const grace = command.options.forceKillAfter;
    yield* input.onSpawned(
      () => handle.isRunning,
      command.options.killSignal,
      grace === undefined ? undefined : Duration.toMillis(grace),
    );
  }
  return handle;
});

const captureInScope = Effect.fnUntraced(function* (input: Readonly<CaptureProcessInput>) {
  const handle = yield* spawnCaptureCommand(input);
  const stdoutReady = yield* Deferred.make<void>();
  const stdoutReadiness = makeStdoutReadiness(input.options.awaitStdoutBytes, () =>
    Deferred.completeWith(stdoutReady, Effect.void).pipe(Effect.asVoid),
  );
  if (stdoutReadiness?.byteCount === 0) {
    yield* stdoutReadiness.signal();
  }
  const { stderrFiber, stdoutFiber } = yield* forkCaptureStreams({
    maxOutputBytes: input.options.maxOutputBytes,
    stderr: () => handle.stderr,
    stdout: () => handle.stdout,
    stdoutReadiness,
  });
  if (stdoutReadiness !== undefined) {
    const earlyExitCode = yield* awaitReadinessOrExit({
      awaitReady: () => Deferred.await(stdoutReady),
      exitCode: () => handle.exitCode,
      onReady: input.options.onReady,
    });
    if (Option.isSome(earlyExitCode)) {
      const captured = yield* joinCapturedStreams({
        stderr: () => Fiber.join(stderrFiber),
        stdout: () => Fiber.join(stdoutFiber),
      });
      return {
        ...captured,
        status: { _tag: "Exited", code: earlyExitCode.value } satisfies ProcessStatus,
        timedOut: false,
        requestedSignals: [],
      };
    }
  }
  const outcome = yield* awaitProcessStatus({
    exitCode: () => handle.exitCode,
    kill: (signal) =>
      input.onKillRequested === undefined
        ? handle.kill({ killSignal: signal })
        : input.onKillRequested(signal).pipe(Effect.andThen(handle.kill({ killSignal: signal }))),
    terminationGraceMillis: input.options.terminationGraceMillis,
    timeoutMillis: input.options.timeoutMillis,
  });
  const captured = yield* joinCapturedStreams({
    stderr: () => Fiber.join(stderrFiber),
    stdout: () => Fiber.join(stdoutFiber),
  });
  return { ...captured, ...outcome };
});

export const captureProcess = Effect.fn("ProcessFixture.captureProcess")(function* (
  input: Readonly<CaptureProcessInput>,
): Effect.fn.Return<
  ProcessCapture,
  InvalidProcessFixtureBound | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  yield* ProcessFixtureOptions.validateProcessFixtureOptions(input.options);
  return yield* Effect.scoped(captureInScope(input));
});
