import * as EffectVitest from "@effect/vitest";
import { Cause, Console, Effect, Exit, Layer, Runtime, Sink, Stdio } from "effect";
import { CliError } from "effect/unstable/cli";

import {
  CliRuntime,
  CliRuntimeLayer,
  DuplicateFrameworkOutput,
  ExpectedProcessExit,
  UnsupportedFrameworkConsoleCall,
} from "../src/cli-runtime";
import {
  DuplicateProcessOutputPublication,
  ProcessOutput,
  ProcessOutputLayer,
  SimultaneousFrameworkAndProductOutput,
} from "../src/process-output";

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

const runtimeLayer = (...[captured]: readonly [CapturedStdio]) => {
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
  const processOutput = ProcessOutputLayer.pipe(Layer.provide(stdio));
  return CliRuntimeLayer.pipe(Layer.provideMerge(processOutput));
};

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

const withRuntime = <A, E>(
  ...[captured, effect]: readonly [
    CapturedStdio,
    () => Effect.Effect<A, E, CliRuntime | ProcessOutput>,
  ]
): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(runtimeLayer(captured));
      return yield* Effect.provideContext(effect(), context);
    }),
  );

describe("successful product output", () => {
  it.effect("publishes successful product bytes once to stdout with exact framing", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const output = yield* ProcessOutput;
        const runtime = yield* CliRuntime;
        yield* runtime.run(() =>
          output.publish({
            stdoutBytes: encoder.encode("Created Ticket abc123.\n"),
            stderrBytes: new Uint8Array(),
            exitCode: 0,
          }),
        );
        assert.deepStrictEqual(
          collectBytes(captured.stdout()),
          encoder.encode("Created Ticket abc123.\n"),
        );
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });
});

describe("human expected failure output", () => {
  it.effect("publishes bytes to stderr and selects status one", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const output = yield* ProcessOutput;
        const runtime = yield* CliRuntime;
        const exit = yield* Effect.exit(
          runtime.run(() =>
            output.publish({
              stdoutBytes: new Uint8Array(),
              stderrBytes: encoder.encode("Error: Ticket abc123 was not found.\n"),
              exitCode: 1,
            }),
          ),
        );
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
        assert.deepStrictEqual(
          collectBytes(captured.stderr()),
          encoder.encode("Error: Ticket abc123 was not found.\n"),
        );
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

describe("JSON expected failure output", () => {
  it.effect("publishes bytes to stdout with stderr isolated", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const output = yield* ProcessOutput;
        const runtime = yield* CliRuntime;
        yield* Effect.exit(
          runtime.run(() =>
            output.publish({
              stdoutBytes: encoder.encode('{"ok":false,"type":"TicketNotFound"}\n'),
              stderrBytes: new Uint8Array(),
              exitCode: 1,
            }),
          ),
        );
        assert.deepStrictEqual(
          collectBytes(captured.stdout()),
          encoder.encode('{"ok":false,"type":"TicketNotFound"}\n'),
        );
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });
});

describe("output arbitration defects", () => {
  it.effect("defects when a handler publishes twice", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const output = yield* ProcessOutput;
        const value: {
          readonly stdoutBytes: Uint8Array;
          readonly stderrBytes: Uint8Array;
          readonly exitCode: 0;
        } = {
          stdoutBytes: encoder.encode("one\n"),
          stderrBytes: new Uint8Array(),
          exitCode: 0,
        };
        yield* output.publish(value);
        const exit = yield* Effect.exit(output.publish(value));
        const defects = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason) : [];
        assert.strictEqual(defects[0]?.defect, DuplicateProcessOutputPublication);
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
      }),
    );
  });
});

describe("framework and product arbitration", () => {
  it.effect("defects instead of mixing staged framework and product output", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const output = yield* ProcessOutput;
        const runtime = yield* CliRuntime;
        const exit = yield* Effect.exit(
          runtime.run(() =>
            output
              .publish({
                stdoutBytes: encoder.encode("product\n"),
                stderrBytes: new Uint8Array(),
                exitCode: 0,
              })
              .pipe(Effect.andThen(Console.log("framework"))),
          ),
        );
        const defects = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason) : [];
        assert.strictEqual(defects[0]?.defect, SimultaneousFrameworkAndProductOutput);
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });
});

describe("structured framework parse failures", () => {
  it.effect("discards staged help and publishes one expected failure", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* Effect.exit(
          runtime.run(() =>
            Console.log("staged help").pipe(
              Effect.andThen(
                Effect.fail(
                  CliError.ShowHelp.make({
                    commandPath: ["tm"],
                    errors: [
                      CliError.UnknownSubcommand.make({
                        parent: ["tm"],
                        suggestions: [],
                        subcommand: "unknown",
                      }),
                    ],
                  }),
                ),
              ),
            ),
          ),
        );
        const stderr = encoder.encode('Error: Unknown subcommand "unknown" for "tm"\n');
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
        assert.deepStrictEqual(collectBytes(captured.stderr()), stderr);
      }),
    );
  });
});
describe("framework staging defects", () => {
  it.effect("defects when the framework publishes twice concurrently", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const exit = yield* Effect.exit(
          runtime.run(() =>
            Effect.all([Console.log("first"), Console.log("second")], { concurrency: "unbounded" }),
          ),
        );
        const defects = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason) : [];
        assert.strictEqual(defects[0]?.defect, DuplicateFrameworkOutput);
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });

  it.effect("defects on unsupported staged Console methods", () => {
    const captured = makeCapturedStdio();
    return withRuntime(captured, () =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        const exit = yield* Effect.exit(runtime.run(() => Console.info("unsupported")));
        const defects = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isDieReason) : [];
        assert.strictEqual(defects[0]?.defect, UnsupportedFrameworkConsoleCall);
        assert.deepStrictEqual(collectBytes(captured.stdout()), new Uint8Array());
        assert.deepStrictEqual(collectBytes(captured.stderr()), new Uint8Array());
      }),
    );
  });
});
