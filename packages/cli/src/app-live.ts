import * as BunServices from "@effect/platform-bun/BunServices";
import { Layer } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";

import { CliRuntime, CliRuntimeLayer } from "./cli-runtime";
import { ProcessOutput, ProcessOutputLayer } from "./process-output";

const ProcessRuntimeLive = CliRuntimeLayer.pipe(
  Layer.provideMerge(ProcessOutputLayer),
  Layer.provideMerge(BunServices.layer),
);

export const AppLive: Layer.Layer<Command.Environment | CliRuntime | ProcessOutput> =
  Layer.mergeAll(
    ProcessRuntimeLive,
    CliConfig.layer({
      builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
    }),
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  );
