/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import { makeWorkItemId } from "../src/domain/WorkItem";

describe("Work Item IDs", () => {
  it.effect("moves to an unused canonical ID when the random candidate collides", () =>
    Effect.gen(function* () {
      const id = yield* makeWorkItemId(new Set(["000000"])).pipe(
        Effect.provideService(Random.Random, {
          nextIntUnsafe: () => 0,
          nextDoubleUnsafe: () => 0,
        }),
      );

      assert.strictEqual(id, "000001");
    }),
  );
});
