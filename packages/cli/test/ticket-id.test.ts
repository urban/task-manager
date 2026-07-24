/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import { makeTicketId } from "../src/domain/Ticket";

describe("Ticket IDs", () => {
  it.effect("moves to an unused canonical ID when the random candidate collides", () =>
    Effect.gen(function* () {
      const id = yield* makeTicketId(new Set(["000000"])).pipe(
        Effect.provideService(Random.Random, {
          nextIntUnsafe: () => 0,
          nextDoubleUnsafe: () => 0,
        }),
      );

      assert.strictEqual(id, "000001");
    }),
  );
});
