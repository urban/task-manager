/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import {
  readTasksFile,
  claimWorkItem,
  createWorkItem,
  decodeDeleteOutput,
  decodeItemOutput,
  decodeValidateOutput,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm delete", () => {
  it.effect("previews delete without yes and leaves storage unchanged", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createWorkItem(directory, "Delete preview parent");
        const child = yield* createWorkItem(directory, "Delete preview child", {
          level: "subtask",
          parent: parent.id,
        });
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "delete", parent.id]);

        assert.strictEqual(result.exit._tag, "Failure");
        const output = String(result.errors[0]);
        assert.isTrue(output.includes("destructive"));
        assert.isTrue(output.includes("Prefer tm cancel"));
        assert.isTrue(output.includes(parent.subject));
        assert.isTrue(output.includes(child.subject));
        assert.isTrue(output.includes("--yes"));
        assert.strictEqual(yield* readTasksFile(directory), before);
      }),
    ),
  );

  it.effect("deletes a leaf Work Item with human output", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createWorkItem(directory, "Delete leaf work");
        const unrelated = yield* createWorkItem(directory, "Keep unrelated work");

        const result = yield* run(["--cwd", directory, "delete", target.id, "--yes"]);

        assert.strictEqual(result.exit._tag, "Success");
        const output = String(result.logs[0]);
        assert.isTrue(output.includes("Deleted Delete leaf work"));
        assert.isTrue(output.includes(target.id));
        assert.isTrue(output.includes("destructive"));
        assert.isTrue(output.includes("Prefer tm cancel"));

        const deletedShow = yield* run(["--cwd", directory, "show", target.id]);
        assert.strictEqual(deletedShow.exit._tag, "Failure");
        assert.isTrue(String(deletedShow.errors[0]).includes("was not found"));

        const unrelatedShow = yield* run(["--cwd", directory, "show", unrelated.id, "--json"]);
        assert.strictEqual(unrelatedShow.exit._tag, "Success");
        const persistedUnrelated = decodeItemOutput(String(unrelatedShow.logs[0])).item;
        assert.strictEqual(persistedUnrelated.id, unrelated.id);
      }),
    ),
  );

  it.effect("requires explicit allowance to delete human-executor work", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createWorkItem(directory, "Delete human review", {
          executor: "human",
        });

        const rejected = yield* run(["--cwd", directory, "delete", target.id, "--yes"]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "delete",
          target.id,
          "--yes",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const decoded = decodeDeleteOutput(String(allowed.logs[0]));
        assert.deepStrictEqual(
          decoded.deleted.map((item) => item.id),
          [target.id],
        );
        assert.deepStrictEqual(
          decoded.deleted.map((item) => item.executor),
          ["human"],
        );
      }),
    ),
  );

  it.effect("deletes a parent subtree in JSON mode and validates storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const epic = yield* createWorkItem(directory, "Delete parent epic", { level: "epic" });
        const task = yield* createWorkItem(directory, "Delete child task", {
          level: "task",
          parent: epic.id,
        });
        const subtask = yield* createWorkItem(directory, "Delete child subtask", {
          level: "subtask",
          parent: task.id,
        });
        const unrelated = yield* createWorkItem(directory, "Keep after subtree delete");

        const result = yield* run([
          "--cwd",
          directory,
          "delete",
          epic.id.slice(0, 12),
          "--yes",
          "--json",
        ]);

        assert.strictEqual(result.exit._tag, "Success");
        const decoded = decodeDeleteOutput(String(result.logs[0]));
        assert.deepStrictEqual(
          decoded.deleted.map((item) => item.id).toSorted(),
          [epic.id, task.id, subtask.id].toSorted(),
        );
        assert.deepStrictEqual(
          decoded.deleted.map((item) => item.subject).toSorted(),
          [epic.subject, task.subject, subtask.subject].toSorted(),
        );

        const deletedShow = yield* run(["--cwd", directory, "show", subtask.id]);
        assert.strictEqual(deletedShow.exit._tag, "Failure");
        assert.isTrue(String(deletedShow.errors[0]).includes("was not found"));

        const unrelatedShow = yield* run(["--cwd", directory, "show", unrelated.id, "--json"]);
        assert.strictEqual(unrelatedShow.exit._tag, "Success");

        const validateResult = yield* run(["--cwd", directory, "validate", "--json"]);
        assert.strictEqual(validateResult.exit._tag, "Success");
        assert.deepStrictEqual(decodeValidateOutput(String(validateResult.logs[0])), {
          ok: true,
          workItemCount: 1,
          tasksFile: `${directory}/.tasks/tasks.jsonl`,
        });
      }),
    ),
  );

  it.effect("refuses delete that would leave dangling dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const dependency = yield* createWorkItem(directory, "Delete dependency target");
        const dependent = yield* createWorkItem(directory, "Keep dependent work", {
          blockedBy: [dependency.id],
        });
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "delete", dependency.id, "--yes"]);

        assert.strictEqual(result.exit._tag, "Failure");
        const output = String(result.errors[0]);
        assert.isTrue(output.includes("dangling dependencies"));
        assert.isTrue(output.includes("unblock, cancel, or delete"));
        assert.isTrue(output.includes(dependent.subject));
        assert.strictEqual(yield* readTasksFile(directory), before);
      }),
    ),
  );

  it.effect("allows delete when dependents are inside the deleted subtree", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const epic = yield* createWorkItem(directory, "Delete internal epic", { level: "epic" });
        const dependency = yield* createWorkItem(directory, "Delete internal dependency", {
          level: "task",
          parent: epic.id,
        });
        const dependent = yield* createWorkItem(directory, "Delete internal dependent", {
          level: "task",
          parent: epic.id,
          blockedBy: [dependency.id],
        });

        const result = yield* run(["--cwd", directory, "delete", epic.id, "--yes", "--json"]);

        assert.strictEqual(result.exit._tag, "Success");
        const decoded = decodeDeleteOutput(String(result.logs[0]));
        assert.deepStrictEqual(
          decoded.deleted.map((item) => item.id).toSorted(),
          [epic.id, dependency.id, dependent.id].toSorted(),
        );

        const validateResult = yield* run(["--cwd", directory, "validate", "--json"]);
        assert.strictEqual(validateResult.exit._tag, "Success");
        assert.deepStrictEqual(decodeValidateOutput(String(validateResult.logs[0])), {
          ok: true,
          workItemCount: 0,
          tasksFile: `${directory}/.tasks/tasks.jsonl`,
        });
      }),
    ),
  );

  it.effect("skips active claims by default and includes them with flag", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const first = yield* createWorkItem(directory, "Claimed next work");
        yield* TestClock.adjust("1 second");
        const second = yield* createWorkItem(directory, "Unclaimed next work");
        yield* claimWorkItem(directory, first.id, "agent-a");

        const defaultResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(defaultResult.exit._tag, "Success");
        const defaultSelection = decodeItemOutput(String(defaultResult.logs[0]));
        assert.strictEqual(defaultSelection.item.id, second.id);

        const includeClaimedResult = yield* run([
          "--cwd",
          directory,
          "next",
          "--include-claimed",
          "--json",
        ]);
        assert.strictEqual(includeClaimedResult.exit._tag, "Success");
        const includeClaimedSelection = decodeItemOutput(String(includeClaimedResult.logs[0]));
        assert.strictEqual(includeClaimedSelection.item.id, first.id);

        yield* TestClock.adjust("1 hour");
        const expiredResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(expiredResult.exit._tag, "Success");
        const expiredSelection = decodeItemOutput(String(expiredResult.logs[0]));
        assert.strictEqual(expiredSelection.item.id, first.id);
      }),
    ),
  );
});
