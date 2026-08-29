import { Cause, Console, Context, Effect, Exit, Layer, MutableRef, Option, Schema } from "effect";
import { CliError } from "effect/unstable/cli";

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

const renderParseFailure = (
  ...[{ error }]: readonly [Readonly<{ readonly error: Readonly<{ readonly message: string }> }>]
): Uint8Array => encoder.encode(`Error: ${error.message}\n`);

const structuredParseFailure = (
  ...[error]: readonly [unknown]
): Option.Option<CliError.NonShowHelpErrors> => {
  if (!Schema.is(CliError.ShowHelp)(error) || error.errors.length === 0) {
    return Option.none();
  }
  return Option.fromNullishOr(error.errors[0]);
};

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
type PollProcessOutput = () => ProcessOutput["Service"]["poll"];
type WriteProcessOutput = ProcessOutput["Service"]["write"];

const publishParseFailure = (
  ...[write, error]: readonly [WriteProcessOutput, Readonly<{ readonly message: string }>]
): Effect.Effect<void> =>
  write({
    stdoutBytes: new Uint8Array(),
    stderrBytes: renderParseFailure({ error }),
    exitCode: 1,
  });

const publishFrameworkOutput = (
  ...[write, output]: readonly [WriteProcessOutput, StagedFrameworkOutput]
): Effect.Effect<void> =>
  write({
    stdoutBytes: output.destination === "stdout" ? output.bytes : new Uint8Array(),
    stderrBytes: output.destination === "stderr" ? output.bytes : new Uint8Array(),
    exitCode: 0,
  });

const CliRuntimeBase: Context.ServiceClass<
  CliRuntime,
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
  CliRuntimeShape
> = Context.Service<CliRuntime, CliRuntimeShape>()(
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
);

export class CliRuntime extends CliRuntimeBase {}

const makeRun = (
  ...[pollProcessOutput, writeProcessOutput]: readonly [PollProcessOutput, WriteProcessOutput]
): CliRuntimeShape["run"] =>
  function <A, E, R>(
    ...[effect]: readonly [() => Effect.Effect<A, E, R>]
  ): Effect.Effect<A, E | ExpectedProcessExit, R> {
    return Effect.gen(function* () {
      const staged = makeFrameworkStage();
      const frameworkExit = yield* Effect.exit(
        effect().pipe(Effect.provideService(Console.Console, staged.console)),
      );
      const frameworkOutput = staged.read();
      if (frameworkOutput.kind === "defect") {
        return yield* Effect.die(frameworkOutput.defect);
      }
      const product = yield* pollProcessOutput();
      if (frameworkOutput.kind === "output" && Option.isSome(product)) {
        return yield* Effect.die(SimultaneousFrameworkAndProductOutput);
      }
      if (Option.isSome(product)) {
        if (Exit.isFailure(frameworkExit)) {
          return yield* Effect.die(ProductOutputWithFrameworkFailure);
        }
        yield* writeProcessOutput(product.value);
        return product.value.exitCode === 0
          ? frameworkExit.value
          : yield* new ExpectedProcessExit();
      }
      const reason =
        Exit.isFailure(frameworkExit) && frameworkExit.cause.reasons.length === 1
          ? frameworkExit.cause.reasons[0]
          : undefined;
      const parseFailure =
        reason !== undefined && Cause.isFailReason(reason)
          ? structuredParseFailure(reason.error)
          : Option.none();
      if (Option.isSome(parseFailure)) {
        yield* publishParseFailure(writeProcessOutput, parseFailure.value);
        return yield* new ExpectedProcessExit();
      }
      if (frameworkOutput.kind === "output") {
        yield* publishFrameworkOutput(writeProcessOutput, frameworkOutput.output);
      }
      return Exit.isSuccess(frameworkExit)
        ? frameworkExit.value
        : yield* Effect.failCause(frameworkExit.cause);
    });
  };

export const CliRuntimeLayer: Layer.Layer<CliRuntime, never, ProcessOutput> = Layer.effect(
  CliRuntime,
  Effect.gen(function* () {
    const processOutput = yield* ProcessOutput;
    return CliRuntime.of({ run: makeRun(() => processOutput.poll, processOutput.write) });
  }),
);
