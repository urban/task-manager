import { Effect, Layer, Option } from "effect";

import { DebugEnvironment, DebugEnvironmentLive } from "./environment";
import { DebugInputRejected, invalidTmDebug } from "./input-rejected";
import { DebugTelemetry, DebugTelemetryLive } from "./telemetry";

export { DebugEnvironment } from "./environment";
export { DebugInputRejected } from "./input-rejected";
export { DebugTelemetry } from "./telemetry";

export const DebugActivationLive: Layer.Layer<DebugEnvironment | DebugTelemetry> = Layer.merge(
  DebugEnvironmentLive,
  DebugTelemetryLive,
);

const resolveEnvironmentValue = (
  value: string | undefined,
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

export const runCommandWithDebugActivation = <E, R>(
  options: Readonly<{
    readonly explicit: ReadonlyArray<boolean>;
    readonly selected: () => Effect.Effect<void, E, R>;
  }>,
): Effect.Effect<void, E | DebugInputRejected, R | DebugEnvironment | DebugTelemetry> =>
  Effect.gen(function* () {
    const explicitValue = options.explicit[0];
    const enabled = explicitValue ?? (yield* resolveEnvironmentActivation());
    if (enabled) {
      const telemetry = yield* DebugTelemetry;
      return yield* telemetry.observe(options.selected);
    }
    return yield* Effect.suspend(options.selected);
  });
