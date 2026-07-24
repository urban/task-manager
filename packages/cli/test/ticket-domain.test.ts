/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import { TicketNotFound } from "../src/domain/Errors";
import { makeTicketId, resolveTicket } from "../src/domain/Ticket";

describe("Ticket domain", () => {
  it.effect("exposes canonical Ticket ID generation", () =>
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

  it.effect("exposes canonical Ticket lookup errors", () =>
    Effect.gen(function* () {
      const error = yield* resolveTicket([], "abcdef").pipe(Effect.flip);

      assert.instanceOf(error, TicketNotFound);
      assert.strictEqual(error.query, "abcdef");
    }),
  );
});
