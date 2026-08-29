import { Context, Effect, Layer, Scope } from "effect";

type DebugTelemetrySessionFactoryShape = {
  readonly acquire: Effect.Effect<void, never, Scope.Scope>;
};

const DebugTelemetrySessionFactoryBase: Context.ServiceClass<
  DebugTelemetrySessionFactory,
  "@urban/task-manager-cli/debug-activation/DebugTelemetrySessionFactory",
  DebugTelemetrySessionFactoryShape
> = Context.Service<DebugTelemetrySessionFactory, DebugTelemetrySessionFactoryShape>()(
  "@urban/task-manager-cli/debug-activation/DebugTelemetrySessionFactory",
);

export class DebugTelemetrySessionFactory extends DebugTelemetrySessionFactoryBase {}

export const DebugTelemetrySessionFactoryLive: Layer.Layer<DebugTelemetrySessionFactory> =
  Layer.succeed(
    DebugTelemetrySessionFactory,
    DebugTelemetrySessionFactory.of({ acquire: Effect.void }),
  );
