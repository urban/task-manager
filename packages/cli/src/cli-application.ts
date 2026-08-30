import { Clock, Effect, Tracer } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";

import PackageJson from "../package.json" with { type: "json" };
import { CliRuntime, ExpectedProcessExit } from "./cli-runtime";
import {
  DebugEnvironment,
  DebugInputRejected,
  DebugTelemetrySessionFactory,
  DebugTelemetryLifecycle,
  runCommandWithDebugActivation,
} from "./debug-activation";
import { makeDebugTelemetryLifecycle } from "./debug-telemetry-lifecycle";

const debug = Flag.boolean("debug").pipe(
  Flag.atMost(1),
  Flag.withDescription("Enable privileged local debug telemetry"),
);

const commandTree = Command.make("tm").pipe(
  Command.withSharedFlags({ debug }),
  Command.withDescription("Local-first agent task manager"),
);

export const commandTreeWithSelected = <E, R>(
  ...[selected]: readonly [() => Effect.Effect<void, E, R>]
): Command.Command<
  "tm",
  { readonly debug: ReadonlyArray<boolean> },
  { readonly debug: ReadonlyArray<boolean> },
  E | DebugInputRejected,
  R | DebugEnvironment | DebugTelemetryLifecycle
> =>
  commandTree.pipe(
    Command.withHandler(({ debug: debugOccurrences }) =>
      runCommandWithDebugActivation({ explicit: debugOccurrences, selected }),
    ),
  );

const commandProgram: Effect.Effect<void, CliError.CliError, Command.Environment> = Command.run(
  commandTree,
  {
    version: PackageJson.version,
  },
);

export const runCliApplication = <A, E, R>(
  ...[program]: readonly [() => Effect.Effect<A, E, R | DebugTelemetryLifecycle>]
): Effect.Effect<A, E | ExpectedProcessExit, R | CliRuntime | DebugTelemetrySessionFactory> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const factory = yield* DebugTelemetrySessionFactory;
    const lifecycle = makeDebugTelemetryLifecycle(factory);
    const span = yield* Effect.makeSpan("CliApplication.run");
    const originalExit = yield* runtime
      .run(() => program().pipe(Effect.provideService(DebugTelemetryLifecycle, lifecycle)))
      .pipe(Effect.provideService(Tracer.ParentSpan, span), Effect.exit);
    const endTime = yield* Clock.currentTimeNanos;
    yield* Effect.sync(() => {
      span.end(endTime, originalExit);
    }).pipe(Effect.ignoreCause, Effect.withTracerEnabled(false));
    yield* lifecycle.finalize;
    return originalExit;
  }).pipe(Effect.flatten);

export const run: Effect.Effect<
  void,
  CliError.CliError | ExpectedProcessExit,
  Command.Environment | CliRuntime | DebugTelemetrySessionFactory
> = runCliApplication(() => commandProgram);

export const runWith = (
  args: ReadonlyArray<string>,
): Effect.Effect<void, CliError.CliError, Command.Environment> =>
  Command.runWith(commandTree, { version: PackageJson.version })(args);
