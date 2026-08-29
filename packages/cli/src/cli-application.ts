import { Effect } from "effect";
import { CliError, Command } from "effect/unstable/cli";

import PackageJson from "../package.json" with { type: "json" };
import { CliRuntime, ExpectedProcessExit } from "./cli-runtime";

const commandTree = Command.make("tm").pipe(
  Command.withDescription("Local-first agent task manager"),
);

const commandProgram: Effect.Effect<void, CliError.CliError, Command.Environment> = Command.run(
  commandTree,
  {
    version: PackageJson.version,
  },
);

export const run: Effect.Effect<
  void,
  CliError.CliError | ExpectedProcessExit,
  Command.Environment | CliRuntime
> = Effect.flatMap(CliRuntime, (runtime) => runtime.run(() => commandProgram));

export const runWith = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, CliError.CliError, Command.Environment> =>
  Command.runWith(commandTree, { version: PackageJson.version })(args);
