import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option, Ref, Schema } from "effect";
import { CliError } from "effect/unstable/cli";

import {
  DebugEnvironment,
  DebugInputRejected,
  DebugTelemetrySessionFactory,
} from "../../src/debug-activation";
import { runSelectedWith } from "../support/selected-command";

type Harness = {
  readonly environment: () => DebugEnvironment["Service"];
  readonly factory: () => DebugTelemetrySessionFactory["Service"];
  readonly selected: () => Effect.Effect<void>;
  readonly counts: () => Effect.Effect<ExpectedCounts>;
};

type ExpectedCounts = {
  readonly environmentReads: number;
  readonly acquisitions: number;
  readonly releases: number;
  readonly selectedCalls: number;
};

const environmentCases: ReadonlyArray<readonly [string, boolean]> = [
  ["true", true],
  ["1", true],
  ["false", false],
  ["0", false],
];

const explicitCases: ReadonlyArray<readonly [ReadonlyArray<string>, boolean]> = [
  [["--debug"], true],
  [["--debug", "true"], true],
  [["--debug=1"], true],
  [["--debug", "yes"], true],
  [["--debug=on"], true],
  [["--debug", "y"], true],
  [["--no-debug"], false],
  [["--debug", "false"], false],
  [["--debug=0"], false],
  [["--debug", "no"], false],
  [["--debug=off"], false],
  [["--debug", "n"], false],
];

const duplicateCases: ReadonlyArray<ReadonlyArray<string>> = [
  ["--debug", "--debug"],
  ["--debug", "--no-debug"],
  ["--debug", "--debug=false"],
  ["--no-debug", "--debug=false"],
  ["--debug=true", "--debug=false"],
  ["--debug=false", "--no-debug"],
];

const earlyExitCases: ReadonlyArray<ReadonlyArray<string>> = [
  ["--help"],
  ["--version"],
  ["--completions", "bash"],
  ["--completions", "fish"],
  ["--completions", "zsh"],
  ["unknown"],
];

const makeHarness = Effect.fnUntraced(function* (
  ...[environmentValue]: readonly [environmentValue?: string]
) {
  const environmentReads = yield* Ref.make(0);
  const acquisitions = yield* Ref.make(0);
  const releases = yield* Ref.make(0);
  const selectedCalls = yield* Ref.make(0);
  const optionValue =
    environmentValue === undefined ? Option.none<string>() : Option.some(environmentValue);
  const environment = DebugEnvironment.of({
    readTmDebug: Ref.update(environmentReads, (count) => count + 1).pipe(Effect.as(optionValue)),
  });
  const factory = DebugTelemetrySessionFactory.of({
    acquire: Effect.acquireRelease(
      Ref.update(acquisitions, (count) => count + 1),
      () => Ref.update(releases, (count) => count + 1),
    ),
  });
  const selected = Effect.gen(function* () {
    assert.strictEqual(yield* Ref.get(releases), 0);
    yield* Ref.update(selectedCalls, (count) => count + 1);
  });
  const harness: Harness = {
    environment: () => environment,
    factory: () => factory,
    selected: () => selected,
    counts: () =>
      Effect.all({
        environmentReads: Ref.get(environmentReads),
        acquisitions: Ref.get(acquisitions),
        releases: Ref.get(releases),
        selectedCalls: Ref.get(selectedCalls),
      }),
  };
  return harness;
});

const runHarness = (
  ...[harness, args]: readonly [Readonly<Harness>, ReadonlyArray<string>]
): Effect.Effect<void, CliError.CliError | DebugInputRejected> =>
  runSelectedWith({
    args,
    selected: harness.selected,
    environment: harness.environment,
    factory: harness.factory,
  });

const assertCounts = Effect.fnUntraced(function* (
  ...[harness, expected]: readonly [Readonly<Harness>, Readonly<ExpectedCounts>]
) {
  assert.deepStrictEqual(yield* harness.counts(), expected);
});

describe("TM_DEBUG activation", () => {
  it.effect("uses only the exact values after successful selection", () =>
    Effect.gen(function* () {
      for (const [value, enabled] of environmentCases) {
        const harness = yield* makeHarness(value);
        yield* runHarness(harness, []);
        yield* assertCounts(harness, {
          environmentReads: 1,
          acquisitions: enabled ? 1 : 0,
          releases: enabled ? 1 : 0,
          selectedCalls: 1,
        });
      }
    }),
  );

  it.effect("defaults disabled without acquiring a session", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* runHarness(harness, []);
      yield* assertCounts(harness, {
        environmentReads: 1,
        acquisitions: 0,
        releases: 0,
        selectedCalls: 1,
      });
    }),
  );
});

describe("explicit debug precedence", () => {
  it.effect("lets true, false, negated, and literal forms suppress TM_DEBUG", () =>
    Effect.gen(function* () {
      for (const [args, enabled] of explicitCases) {
        const harness = yield* makeHarness("invalid but suppressed");
        yield* runHarness(harness, args);
        yield* assertCounts(harness, {
          environmentReads: 0,
          acquisitions: enabled ? 1 : 0,
          releases: enabled ? 1 : 0,
          selectedCalls: 1,
        });
      }
    }),
  );
});

describe("invalid debug input", () => {
  it.effect("rejects every other present environment value before acquisition", () =>
    Effect.gen(function* () {
      for (const value of ["", "TRUE", " true", "false ", "yes", "no"]) {
        const harness = yield* makeHarness(value);
        const exit = yield* Effect.exit(runHarness(harness, []));
        const failures = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason) : [];
        const failure = failures[0]?.error;
        assert.lengthOf(failures, 1);
        assert.instanceOf(failure, DebugInputRejected);
        if (failure instanceof DebugInputRejected) {
          assert.deepStrictEqual(failure.input, {
            source: "environment",
            name: "TM_DEBUG",
          });
          assert.deepStrictEqual(failure.issues, [
            { path: [], code: "invalid-value", expected: "true, false, 1, or 0" },
          ]);
        }
        yield* assertCounts(harness, {
          environmentReads: 1,
          acquisitions: 0,
          releases: 0,
          selectedCalls: 0,
        });
      }
    }),
  );
});

describe("parser and built-in bypass", () => {
  it.effect("rejects repeated and mixed occurrences before environment fallback", () =>
    Effect.gen(function* () {
      for (const args of duplicateCases) {
        const harness = yield* makeHarness("true");
        const exit = yield* Effect.exit(runHarness(harness, args));
        const failures = Exit.isFailure(exit) ? exit.cause.reasons.filter(Cause.isFailReason) : [];
        const failure = failures[0]?.error;
        assert.isTrue(Schema.is(CliError.ShowHelp)(failure));
        if (Schema.is(CliError.ShowHelp)(failure)) {
          assert.isTrue(Schema.is(CliError.InvalidValue)(failure.errors[0]));
        }
        yield* assertCounts(harness, {
          environmentReads: 0,
          acquisitions: 0,
          releases: 0,
          selectedCalls: 0,
        });
      }
    }),
  );

  it.effect("bypasses environment and acquisition for built-ins and parse failure", () =>
    Effect.gen(function* () {
      for (const args of earlyExitCases) {
        const harness = yield* makeHarness("true");
        yield* Effect.exit(runHarness(harness, args));
        yield* assertCounts(harness, {
          environmentReads: 0,
          acquisitions: 0,
          releases: 0,
          selectedCalls: 0,
        });
      }
    }),
  );
});
