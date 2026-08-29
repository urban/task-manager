import { Context, Effect, Layer, Scope } from "effect";

type DebugExitObserver = (...[exit]: readonly [unknown]) => void;

const ignoreExit: DebugExitObserver = (exit) => {
  void exit;
};

type DebugTelemetrySession = {
  readonly observe: <A, E, R>(
    ...[effect]: readonly [() => Effect.Effect<A, E, R>]
  ) => Effect.Effect<A, E, R>;
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
  return DebugTelemetrySessionFactory.of({
    acquire: Effect.succeed(session),
  });
};

export const DebugTelemetrySessionFactoryLive: Layer.Layer<DebugTelemetrySessionFactory> =
  Layer.succeed(DebugTelemetrySessionFactory, makeDebugTelemetrySessionFactory(ignoreExit));
