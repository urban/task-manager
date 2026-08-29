import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Ref } from "effect";

import { DebugTelemetrySessionFactory } from "../../src/debug-activation";
import { makeDebugTelemetryLifecycle } from "../../src/debug-telemetry-lifecycle";
import { observeWithDebugTelemetry } from "../../src/debug-telemetry-session";

const ignoreExit = (...[exit]: readonly [unknown]): void => {
  void exit;
};

const concurrentActivationCase = Effect.gen(function* () {
  const acquisitionStarted = yield* Deferred.make<void>();
  const allowAcquisition = yield* Deferred.make<void>();
  const acquisitions = yield* Ref.make(0);
  const shutdowns = yield* Ref.make(0);
  const session = {
    observe: observeWithDebugTelemetry(ignoreExit),
    forceFlushAndShutdown: Ref.update(shutdowns, (count) => count + 1),
  };
  const lifecycle = makeDebugTelemetryLifecycle(
    DebugTelemetrySessionFactory.of({
      acquire: Ref.update(acquisitions, (count) => count + 1).pipe(
        Effect.andThen(Deferred.completeWith(acquisitionStarted, Effect.void)),
        Effect.andThen(Deferred.await(allowAcquisition)),
        Effect.as(session),
      ),
    }),
  );
  const first = yield* lifecycle.activate.pipe(Effect.forkChild);
  yield* Deferred.await(acquisitionStarted);
  const second = yield* lifecycle.activate.pipe(Effect.forkChild);
  yield* Effect.yieldNow;
  assert.strictEqual(yield* Ref.get(acquisitions), 1);
  yield* Deferred.completeWith(allowAcquisition, Effect.void);
  assert.strictEqual(yield* Fiber.join(first), session);
  assert.strictEqual(yield* Fiber.join(second), session);
  yield* Effect.all([lifecycle.finalize, lifecycle.finalize], { concurrency: "unbounded" });
  assert.strictEqual(yield* Ref.get(shutdowns), 1);
});

const terminalFinalizationCase = Effect.gen(function* () {
  const acquisitions = yield* Ref.make(0);
  const shutdowns = yield* Ref.make(0);
  const lifecycle = makeDebugTelemetryLifecycle(
    DebugTelemetrySessionFactory.of({
      acquire: Ref.update(acquisitions, (count) => count + 1).pipe(
        Effect.as({
          observe: observeWithDebugTelemetry(ignoreExit),
          forceFlushAndShutdown: Ref.update(shutdowns, (count) => count + 1),
        }),
      ),
    }),
  );
  yield* lifecycle.activate;
  yield* lifecycle.finalize;
  yield* lifecycle.activate;
  yield* lifecycle.finalize;
  assert.strictEqual(yield* Ref.get(acquisitions), 1);
  assert.strictEqual(yield* Ref.get(shutdowns), 1);
});

describe("debug telemetry lifecycle", () => {
  it.effect("shares one session across concurrent activation", () => concurrentActivationCase);
  it.effect("does not reopen after finalization", () => terminalFinalizationCase);
});
