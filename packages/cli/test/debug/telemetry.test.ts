import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";

import { makeDebugTelemetry } from "../../src/debug/telemetry";

describe("debug telemetry", () => {
  it.effect("runs the command when observability layer construction defects", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const telemetry = makeDebugTelemetry(() =>
        Layer.effectDiscard(Effect.die("telemetry setup defect")),
      );

      const result = yield* telemetry.observe(() =>
        Effect.sync(() => {
          calls.push("selected");
          return "completed";
        }),
      );

      assert.strictEqual(result, "completed");
      assert.deepStrictEqual(calls, ["selected"]);
    }),
  );

  it.effect("preserves the selected command failure cause", () =>
    Effect.gen(function* () {
      const failure = { identity: "selected failure" };
      const expected = Exit.failCause(Cause.fail(failure));
      const telemetry = makeDebugTelemetry(() => Layer.empty);
      const actual = yield* Effect.exit(telemetry.observe(() => expected));

      assert.strictEqual(actual, expected);
      if (Exit.isFailure(actual) && Exit.isFailure(expected)) {
        assert.strictEqual(actual.cause, expected.cause);
      }
    }),
  );
});
