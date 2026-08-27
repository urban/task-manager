import { describe, expect, it } from "vitest";

import * as TaskManager from "@urban/task-manager";

describe("@urban/task-manager", () => {
  it("loads the public entrypoint", () => {
    expect(TaskManager).toBeDefined();
  });
});
