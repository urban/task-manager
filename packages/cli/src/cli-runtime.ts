import { Console, Context, Effect, Exit, Layer, MutableRef, Option } from "effect";

import { ExpectedProcessExit } from "./expected-process-exit";
import { ProcessOutput, SimultaneousFrameworkAndProductOutput } from "./process-output";

type StagedFrameworkOutput = {
  readonly bytes: {
    readonly byteLength: number;
    readonly length: number;
    readonly [index: number]: number;
  };
  readonly destination: "stderr" | "stdout";
};

type StagedFrameworkState =
  | { readonly kind: "empty" }
  | { readonly kind: "output"; readonly output: StagedFrameworkOutput }
  | { readonly kind: "defect"; readonly defect: unknown };

type FrameworkStage = {
  readonly console: Console.Console;
  readonly read: () => StagedFrameworkState;
};
type FrameworkConsoleDestination = StagedFrameworkOutput["destination"] | "unsupported";

export { ExpectedProcessExit } from "./expected-process-exit";

export const DuplicateFrameworkOutput: globalThis.Error = new globalThis.Error(
  "DuplicateFrameworkOutput",
);
export const UnsupportedFrameworkConsoleCall: globalThis.Error = new globalThis.Error(
  "UnsupportedFrameworkConsoleCall",
);
export const ProductOutputWithFrameworkFailure: globalThis.Error = new globalThis.Error(
  "ProductOutputWithFrameworkFailure",
);

const encoder = new globalThis.TextEncoder();

type StageFrameworkOutput = (
  ...[destination, args]: readonly [FrameworkConsoleDestination, ReadonlyArray<unknown>]
) => void;

const makeStagedConsole = (...[stage]: readonly [StageFrameworkOutput]): Console.Console => {
  const unsupported = (...args: ReadonlyArray<unknown>): void => {
    stage("unsupported", args.length === 0 ? [undefined] : args);
  };
  const error = (...args: ReadonlyArray<unknown>): void => {
    stage("stderr", args);
  };
  const log = (...args: ReadonlyArray<unknown>): void => {
    stage("stdout", args);
  };
  return {
    assert: unsupported,
    clear: unsupported,
    count: unsupported,
    countReset: unsupported,
    debug: unsupported,
    dir: unsupported,
    dirxml: unsupported,
    error,
    group: unsupported,
    groupCollapsed: unsupported,
    groupEnd: unsupported,
    info: unsupported,
    log,
    table: unsupported,
    time: unsupported,
    timeEnd: unsupported,
    timeLog: unsupported,
    trace: unsupported,
    warn: unsupported,
  };
};

const makeFrameworkStage = (): FrameworkStage => {
  const state = MutableRef.make<StagedFrameworkState>({ kind: "empty" });
  const stage = (
    ...[destination, args]: readonly [FrameworkConsoleDestination, ReadonlyArray<unknown>]
  ): void => {
    const current = MutableRef.get(state);
    if (current.kind !== "empty") {
      MutableRef.set(state, { kind: "defect", defect: DuplicateFrameworkOutput });
    } else if (destination === "unsupported" || args.length !== 1 || typeof args[0] !== "string") {
      MutableRef.set(state, {
        kind: "defect",
        defect: UnsupportedFrameworkConsoleCall,
      });
    } else {
      MutableRef.set(state, {
        kind: "output",
        output: { bytes: encoder.encode(`${args[0]}\n`), destination },
      });
    }
  };
  return {
    console: makeStagedConsole(stage),
    read: () => MutableRef.get(state),
  };
};

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

export const CliRuntimeLayer: Layer.Layer<CliRuntime, never, ProcessOutput> = Layer.effect(
  CliRuntime,
  Effect.gen(function* () {
    const processOutput = yield* ProcessOutput;
    const run = <A, E, R>(
      ...[effect]: readonly [() => Effect.Effect<A, E, R>]
    ): Effect.Effect<A, E | ExpectedProcessExit, R> =>
      Effect.gen(function* () {
        const staged = makeFrameworkStage();
        const frameworkExit = yield* Effect.exit(
          effect().pipe(Effect.provideService(Console.Console, staged.console)),
        );
        const frameworkOutput = staged.read();
        if (frameworkOutput.kind === "defect") {
          return yield* Effect.die(frameworkOutput.defect);
        }
        const product = yield* processOutput.poll;
        if (frameworkOutput.kind === "output" && Option.isSome(product)) {
          return yield* Effect.die(SimultaneousFrameworkAndProductOutput);
        }
        if (Option.isSome(product)) {
          if (Exit.isFailure(frameworkExit)) {
            return yield* Effect.die(ProductOutputWithFrameworkFailure);
          }
          yield* processOutput.write(product.value);
          return product.value.exitCode === 0
            ? frameworkExit.value
            : yield* new ExpectedProcessExit();
        }
        if (frameworkOutput.kind === "output") {
          yield* processOutput.write({
            stdoutBytes:
              frameworkOutput.output.destination === "stdout"
                ? frameworkOutput.output.bytes
                : new Uint8Array(),
            stderrBytes:
              frameworkOutput.output.destination === "stderr"
                ? frameworkOutput.output.bytes
                : new Uint8Array(),
            exitCode: 0,
          });
        }
        return Exit.isSuccess(frameworkExit)
          ? frameworkExit.value
          : yield* Effect.failCause(frameworkExit.cause);
      });
    return CliRuntime.of({ run });
  }),
);
