import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as TaskManager from "@urban/task-manager";

describe("Lean V1 foundation", () => {
  it.effect("keeps the core public package entrypoint behavior-free", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(Object.keys(TaskManager), []);
    }),
  );
});
