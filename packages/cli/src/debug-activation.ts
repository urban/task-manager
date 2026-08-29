import { Effect, Layer, Option } from "effect";

import { DebugEnvironment, DebugEnvironmentLive } from "./debug-environment";
import { DebugInputRejected, invalidTmDebug } from "./debug-input-rejected";
import { DebugTelemetryLifecycle } from "./debug-telemetry-lifecycle";
import {
  DebugTelemetrySessionFactory,
  DebugTelemetrySessionFactoryLive,
} from "./debug-telemetry-session";

export { DebugEnvironment } from "./debug-environment";
export { DebugInputRejected } from "./debug-input-rejected";
export { DebugTelemetryLifecycle } from "./debug-telemetry-lifecycle";
export { DebugTelemetrySessionFactory } from "./debug-telemetry-session";

export const DebugActivationLive: Layer.Layer<DebugEnvironment | DebugTelemetrySessionFactory> =
  Layer.merge(DebugEnvironmentLive, DebugTelemetrySessionFactoryLive);

const resolveEnvironmentValue = (
  ...[value]: readonly [string | undefined]
): Effect.Effect<boolean, DebugInputRejected> =>
  Effect.suspend(() => {
    switch (value) {
      case undefined:
      case "false":
      case "0":
        return Effect.succeed(false);
      case "true":
      case "1":
        return Effect.succeed(true);
      default:
        return Effect.fail(invalidTmDebug);
    }
  });

const resolveEnvironmentActivation = Effect.fnUntraced(function* () {
  const environment = yield* DebugEnvironment;
  const value = yield* environment.readTmDebug;
  return yield* resolveEnvironmentValue(Option.getOrUndefined(value));
});

export const runSelectedCommand = <E, R>(
  ...[options]: readonly [
    Readonly<{
      readonly explicit: ReadonlyArray<boolean>;
      readonly selected: () => Effect.Effect<void, E, R>;
    }>,
  ]
): Effect.Effect<void, E | DebugInputRejected, R | DebugEnvironment | DebugTelemetryLifecycle> =>
  Effect.gen(function* () {
    const explicitValue = options.explicit[0];
    const enabled = explicitValue ?? (yield* resolveEnvironmentActivation());
    if (enabled) {
      const lifecycle = yield* DebugTelemetryLifecycle;
      const session = yield* lifecycle.activate;
      return yield* Effect.scoped(session.observe(options.selected));
    }
    return yield* Effect.scoped(Effect.suspend(options.selected));
  });
