import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as TaskManagerCli from "../src/main";

describe("Lean V1 CLI foundation", () => {
  it.effect("keeps the CLI public entrypoint behavior-free", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(Object.keys(TaskManagerCli), []);
    }),
  );
});
