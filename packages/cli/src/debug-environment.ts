import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect";

import { DebugInputRejected, invalidTmDebug } from "./debug-input-rejected";

type DebugEnvironmentShape = {
  readonly readTmDebug: Effect.Effect<Option.Option<string>, DebugInputRejected>;
};

const TmDebugConfig = Config.string("TM_DEBUG").pipe(Config.option);

const readTmDebug = Effect.suspend(() =>
  TmDebugConfig.parse(ConfigProvider.fromEnv({ preserveEmptyStrings: true })),
).pipe(Effect.mapError(() => invalidTmDebug));

const DebugEnvironmentBase: Context.ServiceClass<
  DebugEnvironment,
  "@urban/task-manager-cli/debug-activation/DebugEnvironment",
  DebugEnvironmentShape
> = Context.Service<DebugEnvironment, DebugEnvironmentShape>()(
  "@urban/task-manager-cli/debug-activation/DebugEnvironment",
);

export class DebugEnvironment extends DebugEnvironmentBase {}

export const DebugEnvironmentLive: Layer.Layer<DebugEnvironment> = Layer.succeed(
  DebugEnvironment,
  DebugEnvironment.of({ readTmDebug }),
);
