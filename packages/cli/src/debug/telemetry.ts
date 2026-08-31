import { Clock, Context, Effect, Layer, Tracer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import PackageJson from "../../package.json" with { type: "json" };

export const debugFinalizationDeadline = "250 millis";

const resource = {
  serviceName: "task-manager",
  serviceVersion: PackageJson.version,
  attributes: {
    "telemetry.mode": "privileged-debug",
  },
};

const DebugObservabilityLive = Layer.merge(
  OtlpTracer.layer({
    url: "http://127.0.0.1:4318/v1/traces",
    resource,
    shutdownTimeout: debugFinalizationDeadline,
  }),
  OtlpLogger.layer({
    url: "http://127.0.0.1:4318/v1/logs",
    resource,
    shutdownTimeout: debugFinalizationDeadline,
    mergeWithExisting: true,
  }),
).pipe(Layer.provide(OtlpSerialization.layerProtobuf), Layer.provide(FetchHttpClient.layer));

type DebugTelemetryShape = {
  readonly observe: <A, E, R>(effect: () => Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
};

const DebugTelemetryBase: Context.ServiceClass<
  DebugTelemetry,
  "@urban/task-manager-cli/debug/telemetry/DebugTelemetry",
  DebugTelemetryShape
> = Context.Service<DebugTelemetry, DebugTelemetryShape>()(
  "@urban/task-manager-cli/debug/telemetry/DebugTelemetry",
);

export class DebugTelemetry extends DebugTelemetryBase {}

export const makeDebugTelemetry = (
  observability: () => Layer.Layer<never>,
): DebugTelemetry["Service"] =>
  DebugTelemetry.of({
    observe: <A, E, R>(effect: () => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const span = yield* Effect.makeSpan("CliApplication.run");
        const exit = yield* Effect.suspend(effect).pipe(
          Effect.provideService(Tracer.ParentSpan, span),
          Effect.exit,
        );
        const endTime = yield* Clock.currentTimeNanos;
        yield* Effect.sync(() => {
          span.end(endTime, exit);
        }).pipe(Effect.ignoreCause, Effect.withTracerEnabled(false));
        return yield* exit;
      }).pipe(
        // The dynamically enabled CLI debug boundary is an application entry point.
        // @effect-diagnostics-next-line strictEffectProvide:off
        Effect.provide(observability().pipe(Layer.catchCause(() => Layer.empty))),
      ),
  });

export const DebugTelemetryLive: Layer.Layer<DebugTelemetry> = Layer.succeed(
  DebugTelemetry,
  makeDebugTelemetry(() => DebugObservabilityLive),
);
