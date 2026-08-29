import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as TaskManagerCli from "@urban/task-manager-cli";

describe("@urban/task-manager-cli", () => {
  it.effect("loads the public entrypoint through Effect test integration", () =>
    Effect.sync(() => {
      assert.isDefined(TaskManagerCli);
    }),
  );
});
