import { Effect } from "effect";
import { CliError, Command } from "effect/unstable/cli";

import PackageJson from "../package.json" with { type: "json" };

const commandTree = Command.make("tm").pipe(
  Command.withDescription("Local-first agent task manager"),
);

export const run: Effect.Effect<void, CliError.CliError, Command.Environment> = Command.run(
  commandTree,
  {
    version: PackageJson.version,
  },
);

export const runWith = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, CliError.CliError, Command.Environment> =>
  Command.runWith(commandTree, { version: PackageJson.version })(args);
