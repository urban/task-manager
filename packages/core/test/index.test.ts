import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as TaskManager from "@urban/task-manager";

describe("@urban/task-manager", () => {
  it.effect("loads the public entrypoint through Effect test integration", () =>
    Effect.sync(() => {
      assert.isDefined(TaskManager);
    }),
  );
});
