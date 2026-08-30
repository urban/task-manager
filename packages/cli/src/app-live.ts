import * as BunServices from "@effect/platform-bun/BunServices";
import { Layer } from "effect";
import { CliConfig, CliOutput, Command, GlobalFlag } from "effect/unstable/cli";

import { CliRuntime, CliRuntimeLayer } from "./cli-runtime";
import {
  DebugActivationLive,
  DebugEnvironment,
  DebugTelemetrySessionFactory,
} from "./debug-activation";

const ProcessRuntimeLive = CliRuntimeLayer.pipe(Layer.provideMerge(BunServices.layer));

export const CliFrameworkLive: Layer.Layer<Command.Environment | CliRuntime> = Layer.mergeAll(
  ProcessRuntimeLive,
  CliConfig.layer({
    builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
  }),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
);

export const AppLive: Layer.Layer<
  Command.Environment | CliRuntime | DebugEnvironment | DebugTelemetrySessionFactory
> = Layer.merge(CliFrameworkLive, DebugActivationLive);
