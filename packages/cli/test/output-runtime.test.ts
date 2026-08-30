import * as EffectVitest from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, Runtime, Sink, Stdio } from "effect";
import { TestConsole } from "effect/testing";

import {
  CliRuntime,
  CliRuntimeLayer,
  ExpectedProcessExit,
  writeCommandResult,
} from "../src/cli-runtime";

const encoder = new globalThis.TextEncoder();
const assert: typeof EffectVitest.assert = EffectVitest.assert;
const describe: typeof EffectVitest.describe = EffectVitest.describe;
const it: typeof EffectVitest.it = EffectVitest.it;

type CapturedStdio = {
  readonly appendStderr: (...[bytes]: readonly [ReadonlyBytes]) => void;
  readonly appendStdout: (...[bytes]: readonly [ReadonlyBytes]) => void;
  readonly stderr: () => ReadonlyArray<ReadonlyBytes>;
  readonly stdout: () => ReadonlyArray<ReadonlyBytes>;
};
type ReadonlyBytes = {
  readonly byteLength: number;
  readonly length: number;
  readonly [index: number]: number;
};

const copyBytes = (...[chunk]: readonly [string | ReadonlyBytes]): Uint8Array =>
  typeof chunk === "string" ? encoder.encode(chunk) : Uint8Array.from(chunk);

const makeCapturedStdio = (): CapturedStdio => {
  const stderr: Array<Uint8Array> = [];
  const stdout: Array<Uint8Array> = [];
  return {
    appendStderr: (...[bytes]: readonly [ReadonlyBytes]) => {
      stderr.push(Uint8Array.from(bytes));
    },
    appendStdout: (...[bytes]: readonly [ReadonlyBytes]) => {
      stdout.push(Uint8Array.from(bytes));
    },
    stderr: () => stderr,
    stdout: () => stdout,
  };
};

const collectBytes = (...[chunks]: readonly [ReadonlyArray<ReadonlyBytes>]): Uint8Array => {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    result.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return result;
};

const runtimeLayer = (captured: CapturedStdio) => {
  const stdio = Stdio.layerTest({
    stderr: () =>
      Sink.forEach((...[chunk]: readonly [string | ReadonlyBytes]) =>
        Effect.sync(() => {
          captured.appendStderr(copyBytes(chunk));
        }),
      ),
    stdout: () =>
      Sink.forEach((...[chunk]: readonly [string | ReadonlyBytes]) =>
        Effect.sync(() => {
          captured.appendStdout(copyBytes(chunk));
        }),
      ),
  });
  return Layer.mergeAll(CliRuntimeLayer, stdio, TestConsole.layer);
};

const withRuntime = <A, E>(
  ...[captured, effect]: readonly [
    CapturedStdio,
    () => Effect.Effect<A, E, CliRuntime | Stdio.Stdio>,
  ]
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(runtimeLayer(captured));
      return yield* Effect.provideContext(effect(), context);
    }),
  );

describe("structured command results", () => {
  it.effect("writes a successful result only to stdout", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        yield* writeCommandResult({
          stdoutBytes: encoder.encode('{"ok":true}\n'),
          exitCode: 0,
        });
        assert.deepStrictEqual(collectBytes(captured.stdout()), encoder.encode('{"ok":true}\n'));
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });

  it.effect("writes a failed result to stdout before selecting status one", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          writeCommandResult({
            stdoutBytes: encoder.encode('{"ok":false,"type":"TicketNotFound"}\n'),
            exitCode: 1,
          }),
        );
        assert.deepStrictEqual(
          collectBytes(captured.stdout()),
          encoder.encode('{"ok":false,"type":"TicketNotFound"}\n'),
        );
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const failures = exit.cause.reasons.filter(Cause.isFailReason);
          assert.lengthOf(failures, 1);
          const failure = failures[0]?.error;
          assert.instanceOf(failure, ExpectedProcessExit);
          if (failure instanceof ExpectedProcessExit) {
            assert.strictEqual(failure[Runtime.errorExitCode], 1);
            assert.isFalse(failure[Runtime.errorReported]);
          }
        }
      }),
    );
  });
});

describe("framework diagnostic output", () => {
  it.effect("routes repeated framework output directly to stderr", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* runtime.run(() =>
          Effect.all([Console.log("first"), Console.log("second")], {
            concurrency: "unbounded",
          }),
        );
        assert.deepStrictEqual(yield* TestConsole.logLines, []);
        assert.sameMembers([...(yield* TestConsole.errorLines)], ["first", "second"]);
      }),
    );
  });

  it.effect("keeps framework diagnostics separate from a structured result", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* runtime.run(() =>
          Console.log("progress").pipe(
            Effect.andThen(
              writeCommandResult({
                stdoutBytes: encoder.encode('{"ok":true}\n'),
                exitCode: 0,
              }),
            ),
          ),
        );
        assert.deepStrictEqual(collectBytes(captured.stdout()), encoder.encode('{"ok":true}\n'));
        assert.deepStrictEqual(yield* TestConsole.logLines, []);
        assert.deepStrictEqual(yield* TestConsole.errorLines, ["progress"]);
      }),
    );
  });
});

describe("Effect diagnostic output", () => {
  it.effect("routes Effect logging to stderr", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* runtime.run(() => Effect.logInfo("progress"));
        const errors = yield* TestConsole.errorLines;
        assert.deepStrictEqual(yield* TestConsole.logLines, []);
        assert.isTrue(errors.some((value) => String(value).includes("progress")));
      }),
    );
  });
});
