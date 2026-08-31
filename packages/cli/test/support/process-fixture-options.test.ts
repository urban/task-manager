import * as BunServices from "@effect/platform-bun/BunServices";
import * as EffectVitest from "@effect/vitest";
import { Effect } from "effect";
import * as Scope from "effect/Scope";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

import { captureProcess } from "./process-fixture";

const assert: typeof EffectVitest.assert = EffectVitest.assert;
const it: typeof EffectVitest.it = EffectVitest.it;
const repositoryRoot = `${import.meta.dirname}/../../../..`;
type TestRegistration = {
  readonly effect: EffectVitest.Vitest.Test<BunServices.BunServices | Scope.Scope>;
};
type InvalidBoundCase = {
  readonly field:
    | "awaitStdoutBytes"
    | "maxOutputBytes"
    | "terminationGraceMillis"
    | "timeoutMillis";
  readonly value: number;
  readonly options: {
    readonly awaitStdoutBytes?: number;
    readonly maxOutputBytes: number;
    readonly timeoutMillis: number;
    readonly terminationGraceMillis: number;
  };
};

const invalidBounds: ReadonlyArray<InvalidBoundCase> = [
  {
    field: "awaitStdoutBytes",
    value: -1,
    options: {
      awaitStdoutBytes: -1,
      maxOutputBytes: 1,
      timeoutMillis: 1,
      terminationGraceMillis: 1,
    },
  },
  {
    field: "awaitStdoutBytes",
    value: Number.POSITIVE_INFINITY,
    options: {
      awaitStdoutBytes: Number.POSITIVE_INFINITY,
      maxOutputBytes: 1,
      timeoutMillis: 1,
      terminationGraceMillis: 1,
    },
  },
  {
    field: "maxOutputBytes",
    value: -1,
    options: { maxOutputBytes: -1, timeoutMillis: 1, terminationGraceMillis: 1 },
  },
  {
    field: "maxOutputBytes",
    value: Number.NaN,
    options: { maxOutputBytes: Number.NaN, timeoutMillis: 1, terminationGraceMillis: 1 },
  },
  {
    field: "timeoutMillis",
    value: -1,
    options: { maxOutputBytes: 1, timeoutMillis: -1, terminationGraceMillis: 1 },
  },
  {
    field: "timeoutMillis",
    value: Number.NEGATIVE_INFINITY,
    options: {
      maxOutputBytes: 1,
      timeoutMillis: Number.NEGATIVE_INFINITY,
      terminationGraceMillis: 1,
    },
  },
  {
    field: "terminationGraceMillis",
    value: -1,
    options: { maxOutputBytes: 1, timeoutMillis: 1, terminationGraceMillis: -1 },
  },
  {
    field: "terminationGraceMillis",
    value: Number.POSITIVE_INFINITY,
    options: {
      maxOutputBytes: 1,
      timeoutMillis: 1,
      terminationGraceMillis: Number.POSITIVE_INFINITY,
    },
  },
];

const invalidBoundsCase = Effect.gen(function* () {
  for (const invalid of invalidBounds) {
    let makeCommandCalls = 0;
    const failure = yield* captureProcess({
      makeCommand: () => {
        makeCommandCalls += 1;
        return ChildProcess.make("bun", ["packages/cli/src/bin.ts", "--version"], {
          cwd: repositoryRoot,
          stdin: "ignore",
        });
      },
      options: invalid.options,
    }).pipe(Effect.flip);
    assert.deepStrictEqual(failure, {
      _tag: "InvalidProcessFixtureBound",
      field: invalid.field,
      value: invalid.value,
    });
    assert.strictEqual(makeCommandCalls, 0);
  }
});

it.layer(BunServices.layer, { excludeTestServices: true })(
  "process fixture options",
  ({ effect }: TestRegistration) => {
    effect(
      "rejects negative and non-finite bounds before constructing a command",
      () => invalidBoundsCase,
    );
  },
);
