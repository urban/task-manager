import { Effect, Scope } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";

import PackageJson from "../package.json" with { type: "json" };
import { CliRuntime, ExpectedProcessExit } from "./cli-runtime";
import {
  DebugEnvironment,
  DebugInputRejected,
  DebugTelemetrySessionFactory,
  runSelectedCommand,
} from "./debug-activation";

const debug = Flag.boolean("debug").pipe(
  Flag.atMost(1),
  Flag.withDescription("Enable privileged local debug telemetry"),
);

const commandTree = Command.make("tm").pipe(
  Command.withSharedFlags({ debug }),
  Command.withDescription("Local-first agent task manager"),
);

export const commandTreeWithSelected = <E, R>(
  ...[selected]: readonly [() => Effect.Effect<void, E, R>]
): Command.Command<
  "tm",
  { readonly debug: ReadonlyArray<boolean> },
  { readonly debug: ReadonlyArray<boolean> },
  E | DebugInputRejected,
  R | DebugEnvironment | DebugTelemetrySessionFactory | Scope.Scope
> =>
  commandTree.pipe(
    Command.withHandler(({ debug: debugOccurrences }) =>
      runSelectedCommand({ explicit: debugOccurrences, selected }),
    ),
  );

const commandProgram: Effect.Effect<void, CliError.CliError, Command.Environment> = Command.run(
  commandTree,
  {
    version: PackageJson.version,
    renderErrors: false,
  },
);

export const run: Effect.Effect<
  void,
  CliError.CliError | ExpectedProcessExit,
  Command.Environment | CliRuntime
> = Effect.scoped(Effect.flatMap(CliRuntime, (runtime) => runtime.run(() => commandProgram)));

export const runWith = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, CliError.CliError, Command.Environment> =>
  Command.runWith(commandTree, { version: PackageJson.version })(args);
