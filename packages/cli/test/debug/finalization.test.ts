import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { HttpBody, HttpClient } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  DebugEnvironment,
  DebugTelemetrySessionFactory,
  runSelectedCommand,
} from "../../src/debug-activation";
import { runCliApplication } from "../../src/cli-application";
import { CliRuntime } from "../../src/cli-runtime";
import {
  makeDebugTelemetrySession,
  observeWithDebugTelemetry,
} from "../../src/debug-telemetry-session";
import { runSelectedWith } from "../support/selected-command";

type Serialization = OtlpSerialization.OtlpSerialization["Service"];

const disabledEnvironment = DebugEnvironment.of({
  readTmDebug: Effect.succeed(Option.none()),
});
const protobufBody = () => HttpBody.uint8Array(new Uint8Array([1, 2, 3]), "application/x-protobuf");
const ignoreExit = (...[exit]: readonly [unknown]): void => {
  void exit;
};
const expectedOrdering = [
  "debug acquired",
  "selected resource acquired",
  "selected resource released",
  "selected exit preserved",
  "debug flushed",
  "debug released",
];

const orderingCase = Effect.gen(function* () {
  const events: Array<string> = [];
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.sync(() => {
      events.push("debug acquired");
      return {
        observe: observeWithDebugTelemetry(() => {
          events.push("selected exit preserved");
        }),
        forceFlushAndShutdown: Effect.sync(() => {
          events.push("debug flushed", "debug released");
        }),
      };
    }),
  });
  const selected = () =>
    Effect.scoped(
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("selected resource acquired");
        }),
        () =>
          Effect.sync(() => {
            events.push("selected resource released");
          }),
      ),
    );
  const exit = yield* Effect.exit(
    runSelectedWith({
      args: ["--debug"],
      selected,
      environment: () => disabledEnvironment,
      factory: () => factory,
    }),
  );
  assert.isTrue(Exit.isSuccess(exit));
  assert.deepStrictEqual(events, expectedOrdering);
});

const deadlineCase = Effect.gen(function* () {
  const requestStarted = yield* Deferred.make<"started">();
  const events: Array<string> = [];
  let requests = 0;
  const client = HttpClient.make(() => {
    requests += 1;
    return Deferred.succeed(requestStarted, "started").pipe(Effect.andThen(Effect.never));
  });
  const serialization: Serialization = {
    traces: protobufBody,
    logs: protobufBody,
    metrics: protobufBody,
  };
  const telemetry = makeDebugTelemetrySession({ client, serialization });
  telemetry.recordTrace({ name: "CliApplication.run", outcome: "success" });
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.succeed({
      observe: observeWithDebugTelemetry(ignoreExit),
      forceFlushAndShutdown: telemetry.publish,
    }),
  });
  const fiber = yield* runSelectedWith({
    args: ["--debug"],
    selected: () => Effect.void,
    environment: () => disabledEnvironment,
    factory: () => factory,
  }).pipe(Effect.forkChild);
  yield* Deferred.await(requestStarted);
  yield* TestClock.adjust("249 millis");
  assert.strictEqual(fiber.pollUnsafe(), undefined);
  yield* TestClock.adjust("1 milli");
  const exit = yield* Fiber.await(fiber);
  assert.isTrue(Exit.isSuccess(exit));
  assert.strictEqual(requests, 1);
  assert.deepStrictEqual(events, []);
});

const defectContainmentCase = Effect.gen(function* () {
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.succeed({
      observe: observeWithDebugTelemetry(ignoreExit),
      forceFlushAndShutdown: Effect.die({ identity: "flush defect" }),
    }),
  });
  const exit = yield* Effect.exit(
    runSelectedWith({
      args: ["--debug"],
      selected: () => Effect.void,
      environment: () => disabledEnvironment,
      factory: () => factory,
    }),
  );
  assert.isTrue(Exit.isSuccess(exit));
});

const acquisitionDefectCase = Effect.gen(function* () {
  const sourceExit = Exit.failCause(Cause.die({ identity: "selected defect" }));
  let selections = 0;
  const actual = yield* Effect.exit(
    runSelectedWith({
      args: ["--debug"],
      selected: () => {
        selections += 1;
        return sourceExit;
      },
      environment: () => disabledEnvironment,
      factory: () =>
        DebugTelemetrySessionFactory.of({
          acquire: Effect.die({ identity: "acquisition defect" }),
        }),
    }),
  );
  assert.strictEqual(selections, 1);
  assert.isTrue(Exit.isFailure(actual));
  if (Exit.isFailure(actual) && Exit.isFailure(sourceExit)) {
    assert.strictEqual(actual.cause, sourceExit.cause);
  }
});

const hangingShutdownCase = Effect.gen(function* () {
  const shutdownStarted = yield* Deferred.make<void>();
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.succeed({
      observe: observeWithDebugTelemetry(ignoreExit),
      forceFlushAndShutdown: Deferred.completeWith(shutdownStarted, Effect.void).pipe(
        Effect.asVoid,
        Effect.andThen(Effect.never),
      ),
    }),
  });
  const fiber = yield* runSelectedWith({
    args: ["--debug"],
    selected: () => Effect.void,
    environment: () => disabledEnvironment,
    factory: () => factory,
  }).pipe(Effect.forkChild);
  yield* Deferred.await(shutdownStarted);
  yield* TestClock.adjust("249 millis");
  assert.strictEqual(fiber.pollUnsafe(), undefined);
  yield* TestClock.adjust("1 milli");
  assert.isTrue(Exit.isSuccess(yield* Fiber.await(fiber)));
});

const exitPreservationCase = Effect.gen(function* () {
  const failure = { identity: "failure" };
  const defect = { identity: "defect" };
  const sourceExits = [Exit.void, Exit.fail(failure), Exit.failCause(Cause.die(defect))];
  for (const sourceExit of sourceExits) {
    const observed: Array<unknown> = [];
    const factory = DebugTelemetrySessionFactory.of({
      acquire: Effect.succeed({
        observe: observeWithDebugTelemetry((...[exit]: readonly [unknown]) => {
          observed.push(exit);
        }),
        forceFlushAndShutdown: Effect.die({ identity: "finalization defect" }),
      }),
    });
    const actual = yield* Effect.exit(
      runSelectedWith({
        args: ["--debug"],
        selected: () => sourceExit,
        environment: () => disabledEnvironment,
        factory: () => factory,
      }),
    );
    assert.strictEqual(observed[0], sourceExit);
    if (Exit.isSuccess(actual) && Exit.isSuccess(sourceExit)) {
      assert.strictEqual(actual.value, sourceExit.value);
    }
    if (Exit.isFailure(actual) && Exit.isFailure(sourceExit)) {
      assert.strictEqual(actual.cause, sourceExit.cause);
    }
  }
});

const interruptionCase = Effect.gen(function* () {
  const events: Array<string> = [];
  const interruptExit = Exit.failCause(Cause.interrupt(1729));
  const observed: Array<unknown> = [];
  const applicationExits: Array<unknown> = [];
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.succeed({
      observe: observeWithDebugTelemetry((...[exit]: readonly [unknown]) => {
        observed.push(exit);
      }),
      forceFlushAndShutdown: Effect.sync(() => {
        events.push("debug finalized");
      }),
    }),
  });
  const runtime = CliRuntime.of({
    run<A, E, R>(...[effect]: readonly [() => Effect.Effect<A, E, R>]): Effect.Effect<A, E, R> {
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(effect());
        applicationExits.push(exit);
        events.push("product output published");
        return yield* exit;
      });
    },
  });
  const actual = yield* Effect.exit(
    runCliApplication(() =>
      runSelectedCommand({ explicit: [true], selected: () => interruptExit }),
    ).pipe(
      Effect.provideService(CliRuntime, runtime),
      Effect.provideService(DebugTelemetrySessionFactory, factory),
      Effect.provideService(DebugEnvironment, disabledEnvironment),
    ),
  );
  assert.isTrue(Exit.isExit(observed[0]));
  assert.isTrue(Exit.isExit(applicationExits[0]));
  assert.strictEqual(observed[0], interruptExit);
  if (Exit.isFailure(actual) && Exit.isExit(applicationExits[0])) {
    assert.isTrue(Exit.isFailure(applicationExits[0]));
    if (Exit.isFailure(applicationExits[0])) {
      assert.strictEqual(actual.cause, applicationExits[0].cause);
    }
  }
  assert.deepStrictEqual(events, ["product output published", "debug finalized"]);
});

describe("post-output debug finalization", () => {
  it.effect(
    "closes selected resources before flushing and releasing the session",
    () => orderingCase,
  );
  it.effect("uses one total 250 ms deadline and interrupts a hanging request", () => deadlineCase);
  it.effect("contains flush and shutdown defects", () => defectContainmentCase);
  it.effect(
    "runs the selected command when debug acquisition defects",
    () => acquisitionDefectCase,
  );
  it.effect("bounds a hanging shutdown by the same total deadline", () => hangingShutdownCase);
  it.effect(
    "preserves success, failure, and defect identity through finalization",
    () => exitPreservationCase,
  );
  it.effect(
    "publishes once before finalization and preserves interruption",
    () => interruptionCase,
  );
});
