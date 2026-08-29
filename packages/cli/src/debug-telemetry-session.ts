import { Context, Effect, Layer, Scope } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  debugFetchRequestInit,
  debugLogsEndpoint,
  debugTelemetryResourceAttributes,
  debugTracesEndpoint,
  projectDebugDefect,
} from "./debug-telemetry-model";
import { makeDebugTelemetrySession } from "./debug-telemetry-transport";

export {
  debugFetchRequestInit,
  debugLogsEndpoint,
  debugTelemetryResourceAttributes,
  debugTracesEndpoint,
  makeDebugTelemetrySession,
  projectDebugDefect,
};

type DebugExitObserver = (...[exit]: readonly [unknown]) => void;
type DebugTelemetrySession = {
  readonly observe: <A, E, R>(
    ...[effect]: readonly [() => Effect.Effect<A, E, R>]
  ) => Effect.Effect<A, E, R>;
  readonly telemetry?: ReturnType<typeof makeDebugTelemetrySession>;
};
type DebugTelemetrySessionFactoryShape = {
  readonly acquire: Effect.Effect<DebugTelemetrySession, never, Scope.Scope>;
};

const DebugTelemetrySessionFactoryBase: Context.ServiceClass<
  DebugTelemetrySessionFactory,
  "@urban/task-manager-cli/debug-activation/DebugTelemetrySessionFactory",
  DebugTelemetrySessionFactoryShape
> = Context.Service<DebugTelemetrySessionFactory, DebugTelemetrySessionFactoryShape>()(
  "@urban/task-manager-cli/debug-activation/DebugTelemetrySessionFactory",
);

export class DebugTelemetrySessionFactory extends DebugTelemetrySessionFactoryBase {}

const ignoreExit: DebugExitObserver = (...[exit]: readonly [unknown]) => {
  void exit;
};

const runObserver = (
  ...[observer, exit]: readonly [DebugExitObserver, unknown]
): Effect.Effect<void> =>
  Effect.sync(() => {
    observer(exit);
  }).pipe(Effect.ignoreCause, Effect.withTracerEnabled(false));

export const observeWithDebugTelemetry =
  (...[observer]: readonly [DebugExitObserver]) =>
  <A, E, R>(...[effect]: readonly [() => Effect.Effect<A, E, R>]): Effect.Effect<A, E, R> =>
    Effect.onExit(Effect.suspend(effect), (...[exit]: readonly [unknown]) =>
      runObserver(observer, exit),
    );

export const makeDebugTelemetrySessionFactory = (
  ...[observer]: readonly [DebugExitObserver]
): DebugTelemetrySessionFactory["Service"] => {
  const session: DebugTelemetrySession = {
    observe: observeWithDebugTelemetry(observer),
  };
  return DebugTelemetrySessionFactory.of({ acquire: Effect.succeed(session) });
};

const liveTransportLayer = Layer.merge(
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, debugFetchRequestInit)),
  ),
  OtlpSerialization.layerProtobuf,
);

const liveSession: Effect.Effect<DebugTelemetrySession, never, Scope.Scope> = Effect.gen(
  function* () {
    const services = yield* Layer.build(liveTransportLayer);
    const client = Context.get(services, HttpClient.HttpClient);
    const serialization = Context.get(services, OtlpSerialization.OtlpSerialization);
    const telemetry = makeDebugTelemetrySession({ client, serialization });
    return { observe: observeWithDebugTelemetry(ignoreExit), telemetry };
  },
);

export const DebugTelemetrySessionFactoryLive: Layer.Layer<DebugTelemetrySessionFactory> =
  Layer.succeed(
    DebugTelemetrySessionFactory,
    DebugTelemetrySessionFactory.of({ acquire: liveSession }),
  );
