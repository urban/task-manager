import { Effect } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";

import PackageJson from "../package.json" with { type: "json" };
import { CliRuntime } from "./cli-runtime";
import {
  DebugEnvironment,
  DebugInputRejected,
  DebugTelemetry,
  runCommandWithDebugActivation,
} from "./debug/activation";

const debug = Flag.boolean("debug").pipe(
  Flag.atMost(1),
  Flag.withDescription("Enable privileged local debug telemetry"),
);

const commandTree = Command.make("tm").pipe(
  Command.withSharedFlags({ debug }),
  Command.withDescription("Local-first agent task manager"),
);

export const commandTreeWithSelected = <E, R>(
  selected: () => Effect.Effect<void, E, R>,
): Command.Command<
  "tm",
  { readonly debug: ReadonlyArray<boolean> },
  { readonly debug: ReadonlyArray<boolean> },
  E | DebugInputRejected,
  R | DebugEnvironment | DebugTelemetry
> =>
  commandTree.pipe(
    Command.withHandler(({ debug: debugOccurrences }) =>
      runCommandWithDebugActivation({ explicit: debugOccurrences, selected }),
    ),
  );

const commandProgram: Effect.Effect<void, CliError.CliError, Command.Environment> = Command.run(
  commandTree,
  {
    version: PackageJson.version,
  },
);

export const runCliApplication = <A, E, R>(
  program: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | CliRuntime> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    return yield* runtime.run(program);
  });

export const run: Effect.Effect<
  void,
  CliError.CliError,
  Command.Environment | CliRuntime | DebugTelemetry
> = runCliApplication(() => commandProgram);

export const runWith = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, CliError.CliError, Command.Environment> =>
  Command.runWith(commandTree, { version: PackageJson.version })(args);
