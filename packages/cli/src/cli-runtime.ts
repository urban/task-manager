import { Context, Effect, Layer, Logger } from "effect";

type CliRuntimeShape = {
  readonly run: <A, E, R>(effect: () => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

const CliRuntimeBase: Context.ServiceClass<
  CliRuntime,
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
  CliRuntimeShape
> = Context.Service<CliRuntime, CliRuntimeShape>()(
  "@urban/task-manager-cli/cli-runtime/CliRuntime",
);

export class CliRuntime extends CliRuntimeBase {}

const makeRun: CliRuntimeShape["run"] = function <A, E, R>(
  effect: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return effect().pipe(Effect.provideService(Logger.LogToStderr, true));
};

export const CliRuntimeLayer: Layer.Layer<CliRuntime> = Layer.succeed(
  CliRuntime,
  CliRuntime.of({ run: makeRun }),
);
