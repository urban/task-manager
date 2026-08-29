import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Option } from "effect";

import { DebugEnvironment } from "../../src/debug-activation";
import {
  makeDebugTelemetrySessionFactory,
  observeWithDebugTelemetry,
} from "../../src/debug-telemetry-session";
import { runSelectedWith } from "../support/selected-command";

type ExitObserver = (...[exit]: readonly [unknown]) => void;

class TestAnnotation extends Context.Service<TestAnnotation, string>()(
  "@urban/task-manager-cli/test/debug/transparency.test/TestAnnotation",
) {}

const disabledEnvironment = DebugEnvironment.of({
  readTmDebug: Effect.succeed(Option.none()),
});

const throwingDelegate: ExitObserver = () => {
  throw new Error("throwing delegate");
};

const delegateDefect = { identity: "delegate defect" };

const defectingDelegate: ExitObserver = () => {
  Effect.runSync(Effect.die(delegateDefect));
};

const compositeDelegate: ExitObserver = () => {
  Effect.runSync(
    Effect.failCause(
      Cause.fromReasons([
        Cause.makeFailReason({ identity: "delegate failure" }),
        Cause.makeDieReason(delegateDefect),
        Cause.makeInterruptReason(2718),
      ]),
    ),
  );
};

const ignoredSuspendingDelegate: ExitObserver = () => {
  void Effect.never;
};

const captureExit = () => {
  const exits: Array<unknown> = [];
  const observer: ExitObserver = (exit) => {
    exits.push(exit);
  };
  return {
    observer,
    observed: () => (exits.length === 0 ? Option.none() : Option.some(exits[0])),
  };
};

const assertPreserved = Effect.fnUntraced(function* <A, E>(
  ...[sourceExit]: readonly [() => Exit.Exit<A, E>]
) {
  const capture = captureExit();
  const expected = sourceExit();
  const actual = yield* Effect.exit(observeWithDebugTelemetry(capture.observer)(() => expected));
  const observed = capture.observed();

  assert.strictEqual(actual, expected);
  assert.isTrue(Option.isSome(observed));
  if (Option.isSome(observed)) {
    assert.strictEqual(observed.value, expected);
    if (Exit.isFailure(expected) && Exit.isFailure(actual)) {
      assert.strictEqual(actual.cause, expected.cause);
    }
  }
});

const identityCase = Effect.gen(function* () {
  const success = { identity: "success" };
  const failure = { identity: "failure" };
  const defect = { identity: "defect" };

  yield* assertPreserved(() => Exit.succeed(success));
  yield* assertPreserved(() => Exit.fail(failure));
  yield* assertPreserved(() => Exit.failCause(Cause.die(defect)));
});

const thrownProductDefectCase = Effect.gen(function* () {
  const defect = new Error("thrown product defect");
  const capture = captureExit();
  const product: () => Effect.Effect<never> = () => {
    throw defect;
  };
  const actual = yield* Effect.exit(observeWithDebugTelemetry(capture.observer)(product));
  const observed = capture.observed();

  assert.isTrue(Exit.isFailure(actual));
  assert.isTrue(Option.isSome(observed));
  if (Exit.isFailure(actual) && Option.isSome(observed)) {
    assert.strictEqual(observed.value, actual);
    const defects = actual.cause.reasons.filter(Cause.isDieReason);
    assert.lengthOf(defects, 1);
    assert.strictEqual(defects[0]?.defect, defect);
  }
});

const compositeCase = Effect.gen(function* () {
  const failure = { identity: "annotated failure" };
  const defect = { identity: "annotated defect" };
  const reasons = [
    Cause.makeFailReason(failure).annotate(Context.make(TestAnnotation, "failure-value")),
    Cause.makeDieReason(defect).annotate(Context.make(TestAnnotation, "defect-value")),
    Cause.makeInterruptReason(1729).annotate(Context.make(TestAnnotation, "interrupt-value")),
  ];
  const sourceExit = Exit.failCause(Cause.fromReasons(reasons));

  yield* assertPreserved(() => sourceExit);
  if (Exit.isFailure(sourceExit)) {
    assert.strictEqual(sourceExit.cause.reasons, reasons);
    assert.strictEqual(sourceExit.cause.reasons[0], reasons[0]);
    assert.strictEqual(sourceExit.cause.reasons[1], reasons[1]);
    assert.strictEqual(sourceExit.cause.reasons[2], reasons[2]);
  }
});

const interruptionCase = Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  const capture = captureExit();
  const interruptedSource = Deferred.completeWith(started, Effect.void).pipe(
    Effect.asVoid,
    Effect.andThen(Effect.never),
  );
  const fiber = yield* observeWithDebugTelemetry(capture.observer)(() => interruptedSource).pipe(
    Effect.forkChild,
  );

  yield* Deferred.await(started);
  yield* Fiber.interrupt(fiber);
  const actual = yield* Fiber.await(fiber);
  const observed = capture.observed();

  assert.isTrue(Exit.isFailure(actual));
  assert.isTrue(Option.isSome(observed));
  if (
    Exit.isFailure(actual) &&
    Option.isSome(observed) &&
    Exit.isExit(observed.value) &&
    Exit.isFailure(observed.value)
  ) {
    assert.strictEqual(observed.value, actual);
    assert.strictEqual(observed.value.cause, actual.cause);
    assert.isTrue(Cause.hasInterrupts(actual.cause));
  }
});

const delegateContainmentCase = Effect.gen(function* () {
  const productExit = Exit.fail({ identity: "product failure" });
  const delegates: ReadonlyArray<ExitObserver> = [
    throwingDelegate,
    defectingDelegate,
    compositeDelegate,
    ignoredSuspendingDelegate,
  ];

  for (const delegate of delegates) {
    const actual = yield* Effect.exit(observeWithDebugTelemetry(delegate)(() => productExit));
    assert.strictEqual(actual, productExit);
    if (Exit.isFailure(actual) && Exit.isFailure(productExit)) {
      assert.strictEqual(actual.cause, productExit.cause);
    }
  }
});

const enabledLifecycleCase = Effect.gen(function* () {
  const productError = { identity: "selected failure" };
  const selectedExit = Exit.fail(productError);
  const capture = captureExit();
  const factory = makeDebugTelemetrySessionFactory(capture.observer);
  const actual = yield* Effect.exit(
    runSelectedWith({
      args: ["--debug"],
      selected: () => selectedExit,
      environment: () => disabledEnvironment,
      factory: () => factory,
    }),
  );
  const observed = capture.observed();

  assert.isTrue(Option.isSome(observed));
  if (Exit.isFailure(actual) && Option.isSome(observed)) {
    assert.strictEqual(observed.value, selectedExit);
    const failures = actual.cause.reasons.filter(Cause.isFailReason);
    assert.lengthOf(failures, 1);
    assert.strictEqual(failures[0]?.error, productError);
  }
});

const disabledLifecycleCase = Effect.gen(function* () {
  const observations: Array<unknown> = [];
  const factory = makeDebugTelemetrySessionFactory((exit) => {
    observations.push(exit);
  });

  yield* runSelectedWith({
    args: [],
    selected: () => Effect.void,
    environment: () => disabledEnvironment,
    factory: () => factory,
  });

  assert.lengthOf(observations, 0);
});

describe("debug observer transparency", () => {
  it.effect("preserves exact success, failure, and defect identity", () => identityCase);
  it.effect("preserves a product callback's thrown defect", () => thrownProductDefectCase);
  it.effect("preserves flat reason order, annotations, and interruptor IDs", () => compositeCase);
  it.effect("preserves live interruption through the observer", () => interruptionCase);
  it.effect(
    "contains throwing, defecting, composite, and suspending delegates",
    () => delegateContainmentCase,
  );
});

describe("CLI debug lifecycle transparency", () => {
  it.effect(
    "observes the selected command only inside an enabled scoped session",
    () => enabledLifecycleCase,
  );
  it.effect("does not invoke the observer when debug is disabled", () => disabledLifecycleCase);
});
