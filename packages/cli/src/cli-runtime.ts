import { Console, Context, Effect, Layer, Logger, Stdio, Stream } from "effect";

import { ExpectedProcessExit } from "./expected-process-exit";

export { ExpectedProcessExit } from "./expected-process-exit";

export type ProcessExitCode = 0 | 1;

export type ReadonlyBytes = {
  readonly byteLength: number;
  readonly length: number;
  readonly [index: number]: number;
};

export type RenderedCommandResult = {
  readonly stdoutBytes: ReadonlyBytes;
  readonly exitCode: ProcessExitCode;
};

const directFrameworkOutputToStderr = (console: Readonly<Console.Console>): Console.Console => ({
  ...console,
  log: (...args: ReadonlyArray<unknown>) => {
    console.error(...args);
  },
});

type CliRuntimeShape = {
  readonly run: <A, E, R>(
    ...[effect]: readonly [() => Effect.Effect<A, E, R>]
  ) => Effect.Effect<A, E | ExpectedProcessExit, R>;
};

const CliRuntimeBase: Context.ServiceClass<
  CliRuntime,
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
  CliRuntimeShape
> = Context.Service<CliRuntime, CliRuntimeShape>()(
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
);

export class CliRuntime extends CliRuntimeBase {}

export const writeCommandResult = (
  result: RenderedCommandResult,
): Effect.Effect<void, ExpectedProcessExit, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    if (result.stdoutBytes.byteLength > 0) {
      yield* Stream.succeed<string | Uint8Array>(Uint8Array.from(result.stdoutBytes)).pipe(
        Stream.run(stdio.stdout()),
        Effect.orDie,
      );
    }
    if (result.exitCode === 1) {
      return yield* new ExpectedProcessExit();
    }
    return yield* Effect.void;
  });

const makeRun: CliRuntimeShape["run"] = function <A, E, R>(
  ...[effect]: readonly [() => Effect.Effect<A, E, R>]
): Effect.Effect<A, E | ExpectedProcessExit, R> {
  return Console.consoleWith((console: Readonly<Console.Console>) =>
    effect().pipe(
      Effect.provideService(Console.Console, directFrameworkOutputToStderr(console)),
      Effect.provideService(Logger.LogToStderr, true),
    ),
  );
};

export const CliRuntimeLayer: Layer.Layer<CliRuntime> = Layer.succeed(
  CliRuntime,
  CliRuntime.of({ run: makeRun }),
);
