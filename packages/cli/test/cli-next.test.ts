/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import { TestClock } from "effect/testing";

type WorkItem = import("../src/domain/WorkItem").WorkItem;
import {
  readTasksFile,
  writeTasksFile,
  createWorkItem,
  decodeItemOutput,
  makeFixtureOpenWorkItem,
  markDone,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm next", () => {
  it.effect("selects a standalone open Task", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add next command");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeItemOutput(String(result.logs[0]));
        assert.strictEqual(selected.item.id, item.id);

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("filters next selection by executor", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const humanItem = yield* createWorkItem(directory, "Review import plan", {
          executor: "human",
        });
        yield* TestClock.adjust("1 second");
        const agentItem = yield* createWorkItem(directory, "Implement import plan");

        const defaultResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(defaultResult.exit._tag, "Success");
        const defaultSelection = decodeItemOutput(String(defaultResult.logs[0])).item;
        assert.strictEqual(defaultSelection.id, agentItem.id);

        const humanResult = yield* run([
          "--cwd",
          directory,
          "next",
          "--executor",
          "human",
          "--json",
        ]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        const humanSelection = decodeItemOutput(String(humanResult.logs[0])).item;
        assert.strictEqual(humanSelection.id, humanItem.id);

        const anyResult = yield* run(["--cwd", directory, "next", "--all-executors", "--json"]);
        assert.strictEqual(anyResult.exit._tag, "Success");
        const anySelection = decodeItemOutput(String(anyResult.logs[0])).item;
        assert.strictEqual(anySelection.id, humanItem.id);
      }),
    ),
  );

  it.effect("rejects conflicting executor filters", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        for (const command of ["list", "next"]) {
          const result = yield* run([
            "--cwd",
            directory,
            command,
            "--executor",
            "human",
            "--all-executors",
          ]);
          assert.strictEqual(result.exit._tag, "Failure");
          assert.isTrue(String(result.errors[0]).includes("either --executor or --all-executors"));
        }
      }),
    ),
  );

  it.effect("skips a parent with open children and selects the first Subtask", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const task = yield* createWorkItem(directory, "Build execution loop");
        const firstSubtask = yield* createWorkItem(directory, "Write selector tests", {
          level: "subtask",
          parent: task.id,
        });
        const secondSubtask = yield* createWorkItem(directory, "Implement selector", {
          level: "subtask",
          parent: task.id,
        });
        const laterSecondSubtask = {
          ...secondSubtask,
          createdAt: firstSubtask.createdAt.pipe(DateTime.add({ seconds: 1 })),
          updatedAt: firstSubtask.updatedAt.pipe(DateTime.add({ seconds: 1 })),
        } satisfies WorkItem;
        yield* writeTasksFile(directory, [task, firstSubtask, laterSecondSubtask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeItemOutput(String(result.logs[0]));
        assert.strictEqual(selected.item.id, firstSubtask.id);
      }),
    ),
  );

  it.effect("returns a parent once it has no open children", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const task = yield* createWorkItem(directory, "Build command handler");
        const firstSubtask = yield* createWorkItem(directory, "Add handler test", {
          level: "subtask",
          parent: task.id,
        });
        const secondSubtask = yield* createWorkItem(directory, "Wire handler", {
          level: "subtask",
          parent: task.id,
        });
        const doneFirstSubtask = yield* markDone(firstSubtask);
        const doneSecondSubtask = yield* markDone(secondSubtask);
        yield* writeTasksFile(directory, [task, doneFirstSubtask, doneSecondSubtask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeItemOutput(String(result.logs[0]));
        assert.strictEqual(selected.item.id, task.id);
      }),
    ),
  );

  it.effect("skips blocked Work Items until dependencies are done", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createWorkItem(directory, "Implement report export");
        const dependency = yield* createWorkItem(directory, "Prepare report data");
        const blockResult = yield* run([
          "--cwd",
          directory,
          "block",
          target.id,
          "--by",
          dependency.id,
          "--json",
        ]);
        assert.strictEqual(blockResult.exit._tag, "Success");
        const blockedTarget = decodeItemOutput(String(blockResult.logs[0])).item;

        const blockedSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(blockedSelection.exit._tag, "Success");
        const selectedWhileBlocked = decodeItemOutput(String(blockedSelection.logs[0]));
        assert.strictEqual(selectedWhileBlocked.item.id, dependency.id);

        const doneDependency = yield* markDone(dependency);
        yield* writeTasksFile(directory, [blockedTarget, doneDependency]);

        const unblockedSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(unblockedSelection.exit._tag, "Success");
        const selectedAfterDependency = decodeItemOutput(String(unblockedSelection.logs[0]));
        assert.strictEqual(selectedAfterDependency.item.id, target.id);
      }),
    ),
  );

  it.effect("orders Epics before root Tasks and siblings by creation", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const standaloneTask = yield* createWorkItem(directory, "Add standalone task");
        const epic = yield* createWorkItem(directory, "Ship selection flow", { level: "epic" });
        const firstChild = yield* createWorkItem(directory, "Design selector", {
          parent: epic.id,
        });
        const secondChild = yield* createWorkItem(directory, "Wire selector CLI", {
          parent: epic.id,
        });
        const laterSecondChild = {
          ...secondChild,
          createdAt: firstChild.createdAt.pipe(DateTime.add({ seconds: 1 })),
          updatedAt: firstChild.updatedAt.pipe(DateTime.add({ seconds: 1 })),
        } satisfies WorkItem;
        yield* writeTasksFile(directory, [standaloneTask, epic, firstChild, laterSecondChild]);

        const firstSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(firstSelection.exit._tag, "Success");
        const selectedFirst = decodeItemOutput(String(firstSelection.logs[0]));
        assert.strictEqual(selectedFirst.item.id, firstChild.id);

        const doneFirstChild = yield* markDone(firstChild);
        yield* writeTasksFile(directory, [standaloneTask, doneFirstChild, laterSecondChild, epic]);

        const secondSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(secondSelection.exit._tag, "Success");
        const selectedSecond = decodeItemOutput(String(secondSelection.logs[0]));
        assert.strictEqual(selectedSecond.item.id, secondChild.id);
      }),
    ),
  );

  it.effect("uses Work Item id as the creation-time tie-breaker", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const createdAt = yield* DateTime.now;
        const laterIdTask = makeFixtureOpenWorkItem({
          id: "wi_tie_b",
          subject: "Add second tie item",
          createdAt,
        });
        const earlierIdTask = makeFixtureOpenWorkItem({
          id: "wi_tie_a",
          subject: "Add first tie item",
          createdAt,
        });
        yield* writeTasksFile(directory, [laterIdTask, earlierIdTask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeItemOutput(String(result.logs[0]));
        assert.strictEqual(selected.item.id, earlierIdTask.id);
      }),
    ),
  );

  it.effect("scopes next selection to the requested root subtree", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstEpic = yield* createWorkItem(directory, "Build first area", { level: "epic" });
        yield* createWorkItem(directory, "Implement first area", { parent: firstEpic.id });
        const secondEpic = yield* createWorkItem(directory, "Build second area", { level: "epic" });
        const secondChild = yield* createWorkItem(directory, "Implement second area", {
          parent: secondEpic.id,
        });

        const result = yield* run(["--cwd", directory, "next", "--root", secondEpic.id, "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeItemOutput(String(result.logs[0]));
        assert.strictEqual(selected.item.id, secondChild.id);
      }),
    ),
  );

  it.effect("prints stable no-work output in human and JSON modes", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const humanResult = yield* run(["--cwd", directory, "next"]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        assert.strictEqual(String(humanResult.logs[0]), "No actionable Work Items.");

        const jsonResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(jsonResult.exit._tag, "Success");
        assert.strictEqual(String(jsonResult.logs[0]), '{"ok":true,"reason":"no-actionable-work"}');
      }),
    ),
  );

  it.effect("rejects invalid and non-open next roots", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const missingRootResult = yield* run(["--cwd", directory, "next", "--root", "wi_missing"]);
        assert.strictEqual(missingRootResult.exit._tag, "Failure");
        assert.isTrue(String(missingRootResult.errors[0]).includes("was not found"));

        const item = yield* createWorkItem(directory, "Close root item");
        const doneItem = yield* markDone(item);
        yield* writeTasksFile(directory, [doneItem]);

        const doneRootResult = yield* run(["--cwd", directory, "next", "--root", item.id]);
        assert.strictEqual(doneRootResult.exit._tag, "Failure");
        assert.isTrue(String(doneRootResult.errors[0]).includes("is not open"));
      }),
    ),
  );
});
