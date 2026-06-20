/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import * as PlatformNode from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import { TestConsole } from "effect/testing";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { encodeWorkItemJsonLine, WorkItemSchema, type WorkItemLevel } from "../src/domain/WorkItem";
import { runTmCli } from "../src/main";

const cliOutputLayer = CliOutput.layer(
  CliOutput.defaultFormatter({
    colors: false,
  }),
);

const childProcessLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die("Not implemented")),
);

const baseLayer = Layer.mergeAll(
  TestConsole.layer,
  PlatformNode.NodeFileSystem.layer,
  PlatformNode.NodePath.layer,
  PlatformNode.NodeTerminal.layer,
  cliOutputLayer,
  childProcessLayer,
  Stdio.layerTest({}),
);

const run = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const previousLogs = yield* TestConsole.logLines;
    const previousErrors = yield* TestConsole.errorLines;
    const exit = yield* Effect.exit(runTmCli(args));
    const logs = (yield* TestConsole.logLines).slice(previousLogs.length);
    const errors = (yield* TestConsole.errorLines).slice(previousErrors.length);

    return {
      exit,
      logs,
      errors,
    };
  });

const ValidateOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  workItemCount: Schema.Number,
  tasksFile: Schema.String,
});

const ItemOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  item: WorkItemSchema,
});

const decodeValidateOutput = Schema.decodeSync(Schema.fromJsonString(ValidateOutputSchema));
const decodeItemOutput = Schema.decodeSync(Schema.fromJsonString(ItemOutputSchema));

const withTempDirectory = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "tm-cli-" });
    return yield* f(directory);
  }).pipe(Effect.provide(baseLayer));

const createWorkItem = (
  directory: string,
  subject: string,
  options?: {
    readonly level?: WorkItemLevel;
    readonly parent?: string;
  },
) =>
  Effect.gen(function* () {
    const parentArgs = options?.parent === undefined ? [] : ["--parent", options.parent];
    const result = yield* run([
      "--cwd",
      directory,
      "create",
      subject,
      "--level",
      options?.level ?? "task",
      ...parentArgs,
      "--description",
      `${subject} description.`,
      "--context",
      `${subject} context.`,
      "--json",
    ]);
    assert.strictEqual(result.exit._tag, "Success");
    return decodeItemOutput(String(result.logs[0])).item;
  });

const readTasksFile = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(`${directory}/.tasks/tasks.jsonl`);
  });

describe("tm cli", () => {
  it.effect("initializes and validates an empty store", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        const initResult = yield* run(["--cwd", directory, "init"]);
        assert.strictEqual(initResult.exit._tag, "Success");
        assert.isTrue(String(initResult.logs[0]).includes(".tasks/tasks.jsonl"));

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

  it.effect("keeps the lock file cleaned up after a successful init", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const fs = yield* FileSystem.FileSystem;
        const exists = yield* fs.exists(`${directory}/.tasks/lock`);
        assert.isFalse(exists);
      }),
    ),
  );

  it.effect("creates a standalone Task and shows it by unique prefix", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const createResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Add CLI bootstrap",
          "--level",
          "task",
          "--description",
          "Create the first vertical slice.",
          "--context",
          "Need init, validate, create, and show commands.",
          "--json",
        ]);
        assert.strictEqual(createResult.exit._tag, "Success");

        const created = decodeItemOutput(String(createResult.logs[0]));
        const prefix = created.item.id.slice(0, 12);

        const showResult = yield* run(["--cwd", directory, "show", prefix]);
        assert.strictEqual(showResult.exit._tag, "Success");
        assert.isTrue(String(showResult.logs[0]).includes("Add CLI bootstrap"));
        assert.isTrue(String(showResult.logs[0]).includes("Agent Context"));
      }),
    ),
  );

  it.effect("parses Git-style --message input", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const createResult = yield* run([
          "--cwd",
          directory,
          "create",
          "--message",
          "Plan backlog tree\n\nCreate the initial Epic and Tasks.",
          "--context",
          "Backlog should reflect the approved MVP slices.",
          "--json",
        ]);
        assert.strictEqual(createResult.exit._tag, "Success");

        const created = decodeItemOutput(String(createResult.logs[0]));
        assert.strictEqual(created.item.subject, "Plan backlog tree");
        assert.strictEqual(created.item.description, "Create the initial Epic and Tasks.");
      }),
    ),
  );

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
        assert.deepStrictEqual(String(listResult.logs[0]).split("\n"), [
          "└─ Ship MVP CLI (" + epic.item.id + ")",
          "   ├─ Bootstrap storage (" + storageTask.item.id + ")",
          "   └─ Create first task (" + createTask.item.id + ")",
        ]);
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

  it.effect("validate rejects duplicate dependency ids", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Add exporter");
        const dependency = yield* createWorkItem(directory, "Add serializer");
        const duplicateDependencyLine = yield* encodeWorkItemJsonLine({
          ...item,
          blockedBy: [dependency.id, dependency.id],
        });
        const dependencyLine = yield* encodeWorkItemJsonLine(dependency);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${directory}/.tasks/tasks.jsonl`,
          [duplicateDependencyLine, dependencyLine].join("\n"),
        );

        const result = yield* run(["--cwd", directory, "validate"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Duplicate dependency"));
      }),
    ),
  );

  it.effect("rejects invalid subject formatting", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "bad subject.",
          "--level",
          "task",
          "--description",
          "Still trying to create it.",
          "--context",
          "This should fail.",
        ]);

        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Subject validation failed"));
      }),
    ),
  );
});
