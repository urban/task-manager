/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";

import {
  readTasksFile,
  writeTasksFile,
  createWorkItem,
  decodeItemOutput,
  makeFixtureOpenWorkItem,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm dependencies", () => {
  it.effect("creates a Work Item with one dependency in JSON mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const dependency = yield* createWorkItem(directory, "Create data model");

        const created = yield* createWorkItem(directory, "Add API endpoint", {
          blockedBy: [dependency.id],
        });

        assert.deepStrictEqual(created.blockedBy, [dependency.id]);
        const content = yield* readTasksFile(directory);
        assert.isTrue(content.includes('"blockedBy"'));
      }),
    ),
  );

  it.effect("creates a Work Item with repeatable dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstDependency = yield* createWorkItem(directory, "Create data model");
        const secondDependency = yield* createWorkItem(directory, "Prepare fixtures");
        const orderedDependencies =
          firstDependency.id.localeCompare(secondDependency.id) < 0
            ? { smaller: firstDependency, larger: secondDependency }
            : { smaller: secondDependency, larger: firstDependency };

        const created = yield* createWorkItem(directory, "Add reporting endpoint", {
          blockedBy: [orderedDependencies.larger.id, orderedDependencies.smaller.id],
        });

        assert.deepStrictEqual(created.blockedBy, [
          orderedDependencies.smaller.id,
          orderedDependencies.larger.id,
        ]);
      }),
    ),
  );

  it.effect("resolves dependency prefixes during creation", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const dependency = yield* createWorkItem(directory, "Prepare reports");

        const created = yield* createWorkItem(directory, "Render reports", {
          blockedBy: [dependency.id.slice(0, 12)],
        });

        assert.deepStrictEqual(created.blockedBy, [dependency.id]);
      }),
    ),
  );

  it.effect("creates cross-hierarchy dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstEpic = yield* createWorkItem(directory, "Build backend", { level: "epic" });
        const secondEpic = yield* createWorkItem(directory, "Build frontend", { level: "epic" });
        const backendTask = yield* createWorkItem(directory, "Design schema", {
          parent: firstEpic.id,
        });
        const frontendTask = yield* createWorkItem(directory, "Create UI shell", {
          parent: secondEpic.id,
        });

        const subtask = yield* createWorkItem(directory, "Wire UI data", {
          level: "subtask",
          parent: backendTask.id,
          blockedBy: [frontendTask.id],
        });

        assert.deepStrictEqual(subtask.blockedBy, [frontendTask.id]);
      }),
    ),
  );

  it.effect("omits blockedBy when creation has no dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const created = yield* createWorkItem(directory, "Add standalone work");

        assert.strictEqual(created.blockedBy, undefined);
        const content = yield* readTasksFile(directory);
        assert.isFalse(content.includes('"blockedBy"'));
      }),
    ),
  );

  it.effect("rejects missing creation dependencies without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        yield* createWorkItem(directory, "Prepare existing work");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "Add dependent work",
          "--level",
          "task",
          "--blocked-by",
          "wi_missing_dependency",
          "--description",
          "Should not be created.",
          "--context",
          "Missing dependency should fail creation.",
        ]);

        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("was not found"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects ambiguous creation dependencies without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const createdAt = yield* DateTime.now;
        const firstDependency = makeFixtureOpenWorkItem({
          id: "wi_ambiguous_alpha",
          subject: "Prepare alpha",
          createdAt,
        });
        const secondDependency = makeFixtureOpenWorkItem({
          id: "wi_ambiguous_beta",
          subject: "Prepare beta",
          createdAt: createdAt.pipe(DateTime.add({ seconds: 1 })),
        });
        yield* writeTasksFile(directory, [firstDependency, secondDependency]);
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "Add ambiguous work",
          "--level",
          "task",
          "--blocked-by",
          "wi_ambiguous",
          "--description",
          "Should not be created.",
          "--context",
          "Ambiguous dependency should fail creation.",
        ]);

        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("ambiguous"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects duplicate creation dependencies without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const dependency = yield* createWorkItem(directory, "Prepare shared work");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "Add duplicate work",
          "--level",
          "task",
          "--blocked-by",
          dependency.id,
          "--blocked-by",
          dependency.id.slice(0, 12),
          "--description",
          "Should not be created.",
          "--context",
          "Duplicate dependency should fail creation.",
        ]);

        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Duplicate dependency"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("adds sorted full dependency ids in JSON mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createWorkItem(directory, "Add API endpoint");
        const firstDependency = yield* createWorkItem(directory, "Create data model");
        const secondDependency = yield* createWorkItem(directory, "Prepare fixtures");
        const orderedDependencies =
          firstDependency.id.localeCompare(secondDependency.id) < 0
            ? { smaller: firstDependency, larger: secondDependency }
            : { smaller: secondDependency, larger: firstDependency };

        const firstBlockResult = yield* run([
          "--cwd",
          directory,
          "block",
          target.id,
          "--by",
          orderedDependencies.larger.id,
          "--json",
        ]);
        assert.strictEqual(firstBlockResult.exit._tag, "Success");
        const firstBlocked = decodeItemOutput(String(firstBlockResult.logs[0]));
        assert.deepStrictEqual(firstBlocked.item.blockedBy, [orderedDependencies.larger.id]);

        const secondBlockResult = yield* run([
          "--cwd",
          directory,
          "block",
          target.id,
          "--by",
          orderedDependencies.smaller.id,
          "--json",
        ]);
        assert.strictEqual(secondBlockResult.exit._tag, "Success");
        const secondBlocked = decodeItemOutput(String(secondBlockResult.logs[0]));
        assert.deepStrictEqual(secondBlocked.item.blockedBy, [
          orderedDependencies.smaller.id,
          orderedDependencies.larger.id,
        ]);

        const showResult = yield* run(["--cwd", directory, "show", target.id]);
        assert.strictEqual(showResult.exit._tag, "Success");
        assert.isTrue(String(showResult.logs[0]).includes(orderedDependencies.smaller.id));
        assert.isTrue(String(showResult.logs[0]).includes(orderedDependencies.larger.id));
      }),
    ),
  );

  it.effect("adds a cross-hierarchy dependency by unique prefixes in human mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstEpic = yield* createWorkItem(directory, "Build backend", { level: "epic" });
        const secondEpic = yield* createWorkItem(directory, "Build frontend", { level: "epic" });
        const backendTask = yield* createWorkItem(directory, "Design schema", {
          parent: firstEpic.id,
        });
        const frontendTask = yield* createWorkItem(directory, "Create UI shell", {
          parent: secondEpic.id,
        });
        const subtask = yield* createWorkItem(directory, "Wire UI data", {
          level: "subtask",
          parent: backendTask.id,
        });

        const blockResult = yield* run([
          "--cwd",
          directory,
          "block",
          subtask.id.slice(0, 12),
          "--by",
          frontendTask.id.slice(0, 12),
        ]);
        assert.strictEqual(blockResult.exit._tag, "Success");
        assert.isTrue(String(blockResult.logs[0]).includes("Blocked"));
        assert.isTrue(String(blockResult.logs[0]).includes(subtask.id));
        assert.isTrue(String(blockResult.logs[0]).includes(frontendTask.id));

        const showResult = yield* run(["--cwd", directory, "show", subtask.id, "--json"]);
        assert.strictEqual(showResult.exit._tag, "Success");
        const shown = decodeItemOutput(String(showResult.logs[0]));
        assert.deepStrictEqual(shown.item.blockedBy, [frontendTask.id]);
      }),
    ),
  );

  it.effect("removes dependencies in JSON and human modes and omits empty blockedBy", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add reporting");
        const dependency = yield* createWorkItem(directory, "Collect metrics");

        yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);
        const blockedContent = yield* readTasksFile(directory);
        assert.isTrue(blockedContent.includes('"blockedBy"'));

        const jsonUnblockResult = yield* run([
          "--cwd",
          directory,
          "unblock",
          item.id.slice(0, 12),
          "--by",
          dependency.id.slice(0, 12),
          "--json",
        ]);
        assert.strictEqual(jsonUnblockResult.exit._tag, "Success");
        const jsonUnblocked = decodeItemOutput(String(jsonUnblockResult.logs[0]));
        assert.strictEqual(jsonUnblocked.item.blockedBy, undefined);

        yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);
        const humanUnblockResult = yield* run([
          "--cwd",
          directory,
          "unblock",
          item.id,
          "--by",
          dependency.id,
        ]);
        assert.strictEqual(humanUnblockResult.exit._tag, "Success");
        assert.isTrue(String(humanUnblockResult.logs[0]).includes("Unblocked"));
        const unblockedContent = yield* readTasksFile(directory);
        assert.isFalse(unblockedContent.includes('"blockedBy"'));
      }),
    ),
  );

  it.effect("requires explicit allowance to unblock human-executor gates", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Implement gated path");
        const dependency = yield* createWorkItem(directory, "Approve gated path", {
          executor: "human",
        });
        yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);

        const rejected = yield* run([
          "--cwd",
          directory,
          "unblock",
          item.id,
          "--by",
          dependency.id,
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "unblock",
          item.id,
          "--by",
          dependency.id,
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const unblocked = decodeItemOutput(String(allowed.logs[0])).item;
        assert.strictEqual(unblocked.blockedBy, undefined);
      }),
    ),
  );

  it.effect("rejects missing Work Item ids without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add search");
        const before = yield* readTasksFile(directory);

        const missingItemResult = yield* run([
          "--cwd",
          directory,
          "block",
          "wi_missing_item",
          "--by",
          item.id,
        ]);
        assert.strictEqual(missingItemResult.exit._tag, "Failure");
        assert.isTrue(String(missingItemResult.errors[0]).includes("was not found"));

        const missingDependencyResult = yield* run([
          "--cwd",
          directory,
          "block",
          item.id,
          "--by",
          "wi_missing_dependency",
        ]);
        assert.strictEqual(missingDependencyResult.exit._tag, "Failure");
        assert.isTrue(String(missingDependencyResult.errors[0]).includes("was not found"));

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects self-dependencies without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add audit log");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "block", item.id, "--by", item.id]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("cannot depend on itself"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects duplicate dependencies without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add alerts");
        const dependency = yield* createWorkItem(directory, "Add polling");
        yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("already depends"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects dependency cycles without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstItem = yield* createWorkItem(directory, "Add importer");
        const secondItem = yield* createWorkItem(directory, "Add parser");
        yield* run(["--cwd", directory, "block", secondItem.id, "--by", firstItem.id]);
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "block",
          firstItem.id,
          "--by",
          secondItem.id,
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Dependency cycle detected"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );
});
