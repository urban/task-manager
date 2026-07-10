/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  compareWorkItemsForSelection,
  createWorkItem,
  decodeItemOutput,
  decodeListOutput,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm list", () => {
  it.effect("renders hierarchy in deterministic tree order", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const epicResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Ship MVP CLI",
          "--level",
          "epic",
          "--description",
          "Deliver the first offline CLI.",
          "--context",
          "Root planning item.",
          "--json",
        ]);
        const epic = decodeItemOutput(String(epicResult.logs[0]));

        const storageTaskResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Bootstrap storage",
          "--level",
          "task",
          "--parent",
          epic.item.id,
          "--description",
          "Implement init and validate.",
          "--context",
          "Needs atomic writes.",
          "--json",
        ]);
        const storageTask = decodeItemOutput(String(storageTaskResult.logs[0]));

        const createTaskResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Create first task",
          "--level",
          "task",
          "--parent",
          epic.item.id,
          "--description",
          "Implement create and show.",
          "--context",
          "Need JSONL persistence.",
          "--json",
        ]);
        const createTask = decodeItemOutput(String(createTaskResult.logs[0]));

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Success");
        const orderedTasks = [storageTask.item, createTask.item].toSorted(
          compareWorkItemsForSelection,
        );
        assert.deepStrictEqual(String(listResult.logs[0]).split("\n"), [
          "└─ Ship MVP CLI [open] [agent] (" + epic.item.id + ")",
          ...orderedTasks.map(
            (item, index) =>
              `${index === orderedTasks.length - 1 ? "   └─" : "   ├─"} ${item.subject} [open] [agent] (${item.id})`,
          ),
        ]);
      }),
    ),
  );

  it.effect("filters list by executor while preserving ancestors", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const epic = yield* createWorkItem(directory, "Coordinate import work", { level: "epic" });
        const humanTask = yield* createWorkItem(directory, "Review import UX", {
          parent: epic.id,
          executor: "human",
        });
        const agentTask = yield* createWorkItem(directory, "Implement import UX", {
          parent: epic.id,
        });

        const defaultList = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(defaultList.exit._tag, "Success");
        assert.isTrue(String(defaultList.logs[0]).includes(agentTask.id));
        assert.isFalse(String(defaultList.logs[0]).includes(humanTask.id));

        const allExecutorsList = yield* run(["--cwd", directory, "list", "--all-executors"]);
        assert.strictEqual(allExecutorsList.exit._tag, "Success");
        assert.isTrue(String(allExecutorsList.logs[0]).includes(agentTask.id));
        assert.isTrue(String(allExecutorsList.logs[0]).includes(humanTask.id));

        const humanList = yield* run(["--cwd", directory, "list", "--executor", "human"]);
        assert.strictEqual(humanList.exit._tag, "Success");
        const humanOutput = String(humanList.logs[0]);
        assert.isTrue(humanOutput.includes(`Coordinate import work [open] [agent] (${epic.id})`));
        assert.isTrue(humanOutput.includes(`Review import UX [open] [human] (${humanTask.id})`));
        assert.isFalse(humanOutput.includes(agentTask.id));

        const jsonList = yield* run(["--cwd", directory, "list", "--executor", "human", "--json"]);
        assert.strictEqual(jsonList.exit._tag, "Success");
        const decoded = decodeListOutput(String(jsonList.logs[0]));
        const [rootNode] = decoded.items;
        if (rootNode === undefined) {
          assert.fail("Expected filtered list to include the context ancestor.");
        }
        const [childNode] = rootNode.children;
        if (childNode === undefined) {
          assert.fail("Expected filtered list to include the matching child.");
        }
        assert.strictEqual(rootNode.id, epic.id);
        assert.strictEqual(rootNode.executor, "agent");
        assert.isFalse(rootNode.matchesFilter);
        assert.strictEqual(childNode.id, humanTask.id);
        assert.strictEqual(childNode.executor, "human");
        assert.isTrue(childNode.matchesFilter);
      }),
    ),
  );
});
