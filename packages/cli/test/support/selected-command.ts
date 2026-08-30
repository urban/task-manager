import { Effect, Layer } from "effect";
import { CliError, Command } from "effect/unstable/cli";

import { CliFrameworkLive } from "../../src/app-live";
import { commandTreeWithSelected } from "../../src/cli-application";
import {
  DebugEnvironment,
  DebugInputRejected,
  DebugTelemetrySessionFactory,
  DebugTelemetryLifecycle,
} from "../../src/debug-activation";
import { makeDebugTelemetryLifecycle } from "../../src/debug-telemetry-lifecycle";

import PackageJson from "../../package.json" with { type: "json" };

export const runSelectedWith = <E>(
  options: Readonly<{
    readonly args: ReadonlyArray<string>;
    readonly selected: () => Effect.Effect<void, E>;
    readonly environment: () => DebugEnvironment["Service"];
    readonly factory: () => DebugTelemetrySessionFactory["Service"];
  }>,
): Effect.Effect<void, E | DebugInputRejected | CliError.CliError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        Layer.mergeAll(
          CliFrameworkLive,
          Layer.succeed(DebugEnvironment, options.environment()),
          Layer.succeed(DebugTelemetrySessionFactory, options.factory()),
        ),
      );
      const lifecycle = makeDebugTelemetryLifecycle(options.factory());
      const exit = yield* Effect.provideContext(
        Command.runWith(commandTreeWithSelected<E, never>(options.selected), {
          version: PackageJson.version,
          renderErrors: false,
        })(options.args).pipe(Effect.provideService(DebugTelemetryLifecycle, lifecycle)),
        context,
      ).pipe(Effect.exit);
      yield* lifecycle.finalize;
      return yield* exit;
    }),
  );
