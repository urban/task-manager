import { describe, expect, it } from "vitest";

import * as TaskManagerCli from "@urban/task-manager-cli";

describe("@urban/task-manager-cli", () => {
  it("loads the public entrypoint", () => {
    expect(TaskManagerCli).toBeDefined();
  });
});
