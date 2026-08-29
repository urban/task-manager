import * as BunServices from "@effect/platform-bun/BunServices";
import { Layer } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";

export const AppLive: Layer.Layer<Command.Environment> = Layer.mergeAll(
  BunServices.layer,
  CliConfig.layer({
    builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
  }),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
);
