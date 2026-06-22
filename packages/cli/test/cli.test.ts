/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import * as PlatformNode from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import { TestClock, TestConsole } from "effect/testing";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  encodeWorkItemJsonLine,
  schemaVersion,
  sortWorkItems,
  WorkItemSchema,
  type WorkItem,
  type WorkItemLevel,
} from "../src/domain/WorkItem";
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

const emptyConfigLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({}));

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

const CancelOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  item: WorkItemSchema,
  cancelledItems: Schema.Array(WorkItemSchema),
});

const decodeValidateOutput = Schema.decodeSync(Schema.fromJsonString(ValidateOutputSchema));
const decodeItemOutput = Schema.decodeSync(Schema.fromJsonString(ItemOutputSchema));
const decodeCancelOutput = Schema.decodeSync(Schema.fromJsonString(CancelOutputSchema));

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

const claimWorkItem = (
  directory: string,
  id: string,
  agent: string,
  options?: {
    readonly force?: boolean;
  },
) =>
  Effect.gen(function* () {
    const forceArgs = options?.force === true ? ["--force"] : [];
    const result = yield* run([
      "--cwd",
      directory,
      "claim",
      id,
      "--agent",
      agent,
      ...forceArgs,
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

const writeTasksFile = (directory: string, items: ReadonlyArray<WorkItem>) =>
  Effect.gen(function* () {
    const encodedLines = yield* Effect.forEach(sortWorkItems(items), (item) =>
      encodeWorkItemJsonLine(item),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${directory}/.tasks/tasks.jsonl`, encodedLines.join("\n"));
  });

const markDone = (item: WorkItem) =>
  Effect.gen(function* () {
    const completedAt = yield* DateTime.now;

    return {
      ...item,
      status: "done",
      result: {
        summary: `${item.subject} done`,
        details: "Completed by a test fixture.",
        decisions: [],
        verification: ["fixture"],
        completedAt,
        completedBy: "test-agent",
      },
      updatedAt: completedAt,
    } satisfies WorkItem;
  });

const markCancelled = (item: WorkItem) =>
  Effect.gen(function* () {
    const cancelledAt = yield* DateTime.now;

    return {
      ...item,
      status: "cancelled",
      cancellation: {
        reason: `${item.subject} cancelled`,
        cancelledAt,
        cancelledBy: "test-agent",
      },
      updatedAt: cancelledAt,
    } satisfies WorkItem;
  });

const makeFixtureOpenWorkItem = (options: {
  readonly id: string;
  readonly subject: string;
  readonly createdAt: WorkItem["createdAt"];
  readonly level?: WorkItemLevel;
  readonly parentId?: string;
}): WorkItem =>
  ({
    schemaVersion,
    id: options.id,
    level: options.level ?? "task",
    status: "open",
    subject: options.subject,
    description: `${options.subject} description.`,
    agentContext: `${options.subject} context.`,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  }) satisfies WorkItem;

const compareWorkItemsForSelection = (left: WorkItem, right: WorkItem): number => {
  const diff = DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt);
  if (diff !== 0) {
    return diff;
  }
  return left.id.localeCompare(right.id);
};

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

  it.effect("updates Work Item Subject by unique prefix in JSON mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Update subject work");
        yield* TestClock.adjust("1 second");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          item.id.slice(0, 12),
          "--subject",
          "Refine update subject",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const updated = decodeItemOutput(String(result.logs[0])).item;

        assert.strictEqual(updated.id, item.id);
        assert.strictEqual(updated.subject, "Refine update subject");
        assert.strictEqual(updated.description, item.description);
        assert.strictEqual(updated.agentContext, item.agentContext);
        assert.strictEqual(updated.status, "open");
        assert.isAbove(
          DateTime.toEpochMillis(updated.updatedAt),
          DateTime.toEpochMillis(item.updatedAt),
        );
      }),
    ),
  );

  it.effect("updates Description, Agent Context, and message fields", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Update text fields");

        const descriptionResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--description",
          "Updated human-facing description.",
          "--json",
        ]);
        assert.strictEqual(descriptionResult.exit._tag, "Success");
        const descriptionUpdated = decodeItemOutput(String(descriptionResult.logs[0])).item;
        assert.strictEqual(descriptionUpdated.description, "Updated human-facing description.");
        assert.strictEqual(descriptionUpdated.agentContext, item.agentContext);

        const contextResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--context",
          "Updated execution context.",
          "--json",
        ]);
        assert.strictEqual(contextResult.exit._tag, "Success");
        const contextUpdated = decodeItemOutput(String(contextResult.logs[0])).item;
        assert.strictEqual(contextUpdated.description, "Updated human-facing description.");
        assert.strictEqual(contextUpdated.agentContext, "Updated execution context.");

        const messageResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--message",
          "Retitle update work\n\nUpdated through message input.",
          "--json",
        ]);
        assert.strictEqual(messageResult.exit._tag, "Success");
        const messageUpdated = decodeItemOutput(String(messageResult.logs[0])).item;
        assert.strictEqual(messageUpdated.subject, "Retitle update work");
        assert.strictEqual(messageUpdated.description, "Updated through message input.");
        assert.strictEqual(messageUpdated.agentContext, "Updated execution context.");
      }),
    ),
  );

  it.effect("updates Work Item text from files", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Update from files");
        const fs = yield* FileSystem.FileSystem;
        const descriptionFile = `${directory}/description.md`;
        const contextFile = `${directory}/context.md`;
        const messageFile = `${directory}/message.md`;
        yield* fs.writeFileString(descriptionFile, "Description loaded from a file.");
        yield* fs.writeFileString(contextFile, "Agent Context loaded from a file.");
        yield* fs.writeFileString(
          messageFile,
          "Retitle from file\n\nDescription loaded through message-file.",
        );

        const descriptionResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--description-file",
          descriptionFile,
          "--json",
        ]);
        assert.strictEqual(descriptionResult.exit._tag, "Success");
        const descriptionUpdated = decodeItemOutput(String(descriptionResult.logs[0])).item;
        assert.strictEqual(descriptionUpdated.description, "Description loaded from a file.");

        const messageResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--message-file",
          messageFile,
          "--context-file",
          contextFile,
          "--json",
        ]);
        assert.strictEqual(messageResult.exit._tag, "Success");
        const messageUpdated = decodeItemOutput(String(messageResult.logs[0])).item;
        assert.strictEqual(messageUpdated.subject, "Retitle from file");
        assert.strictEqual(messageUpdated.description, "Description loaded through message-file.");
        assert.strictEqual(messageUpdated.agentContext, "Agent Context loaded from a file.");
      }),
    ),
  );

  it.effect("allows explicit clearing of Description and Agent Context", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Clear update fields");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--description",
          "",
          "--context",
          "",
          "--allow-empty-description",
          "--allow-empty-context",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const updated = decodeItemOutput(String(result.logs[0])).item;
        assert.strictEqual(updated.subject, item.subject);
        assert.strictEqual(updated.description, "");
        assert.strictEqual(updated.agentContext, "");
      }),
    ),
  );

  it.effect("rejects invalid update inputs without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Reject update inputs");
        const fs = yield* FileSystem.FileSystem;
        const descriptionFile = `${directory}/description.md`;
        const messageFile = `${directory}/message.md`;
        yield* fs.writeFileString(descriptionFile, "Description from file.");
        yield* fs.writeFileString(messageFile, "Retitle from message file\n\nDescription.");
        const before = yield* readTasksFile(directory);
        const failureCases: ReadonlyArray<{
          readonly args: ReadonlyArray<string>;
          readonly expected: string;
        }> = [
          {
            args: ["update", item.id, "--subject", "bad subject."],
            expected: "Subject",
          },
          {
            args: ["update", item.id, "--description", ""],
            expected: "Description is required",
          },
          {
            args: ["update", item.id, "--context", ""],
            expected: "Agent Context is required",
          },
          {
            args: ["update", item.id],
            expected: "At least one update field is required",
          },
          {
            args: [
              "update",
              item.id,
              "--description",
              "Inline description.",
              "--description-file",
              descriptionFile,
            ],
            expected: "Use either --description or --description-file",
          },
          {
            args: [
              "update",
              item.id,
              "--message",
              "Retitle update\n\nDescription.",
              "--subject",
              "Retitle update",
            ],
            expected: "Do not combine",
          },
          {
            args: [
              "update",
              item.id,
              "--message",
              "Retitle update\n\nDescription.",
              "--message-file",
              messageFile,
            ],
            expected: "Use either --message or --message-file",
          },
        ];

        for (const failureCase of failureCases) {
          const result = yield* run(["--cwd", directory, ...failureCase.args]);
          assert.strictEqual(result.exit._tag, "Failure");
          assert.isTrue(String(result.errors[0]).includes(failureCase.expected));
          assert.strictEqual(yield* readTasksFile(directory), before);
        }
      }),
    ),
  );

  it.effect("preserves metadata and updates done or cancelled Work Items", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Preserve update metadata");
        const dependency = yield* createWorkItem(directory, "Prepare metadata dependency");
        yield* run(["--cwd", directory, "block", item.id, "--by", dependency.id]);
        const claimed = yield* claimWorkItem(directory, item.id, "metadata-agent");
        const originalClaim = claimed.claim;
        if (originalClaim === undefined) {
          assert.fail("Expected claimed fixture to include a claim.");
        } else {
          const updateResult = yield* run([
            "--cwd",
            directory,
            "update",
            item.id,
            "--description",
            "Updated while preserving metadata.",
            "--json",
          ]);
          assert.strictEqual(updateResult.exit._tag, "Success");
          const updatedOpen = decodeItemOutput(String(updateResult.logs[0])).item;
          const updatedClaim = updatedOpen.claim;
          if (updatedClaim === undefined) {
            assert.fail("Expected update to preserve the existing claim.");
          } else {
            assert.deepStrictEqual(updatedOpen.blockedBy, [dependency.id]);
            assert.strictEqual(updatedClaim.agent, originalClaim.agent);
            assert.strictEqual(
              DateTime.toEpochMillis(updatedClaim.claimedAt),
              DateTime.toEpochMillis(originalClaim.claimedAt),
            );
            assert.strictEqual(
              DateTime.toEpochMillis(updatedClaim.expiresAt),
              DateTime.toEpochMillis(originalClaim.expiresAt),
            );
            assert.strictEqual(updatedOpen.status, "open");
            assert.strictEqual(updatedOpen.result, undefined);
            assert.strictEqual(updatedOpen.cancellation, undefined);

            const doneBase = yield* createWorkItem(directory, "Update done item");
            const cancelledBase = yield* createWorkItem(directory, "Update cancelled item");
            const doneItem = yield* markDone(doneBase);
            const cancelledItem = yield* markCancelled(cancelledBase);
            yield* writeTasksFile(directory, [updatedOpen, dependency, doneItem, cancelledItem]);

            const doneResult = yield* run([
              "--cwd",
              directory,
              "update",
              doneItem.id,
              "--subject",
              "Refine done item",
              "--json",
            ]);
            assert.strictEqual(doneResult.exit._tag, "Success");
            const updatedDone = decodeItemOutput(String(doneResult.logs[0])).item;
            assert.strictEqual(updatedDone.status, "done");
            assert.strictEqual(updatedDone.subject, "Refine done item");
            const originalResult = doneItem.result;
            const preservedResult = updatedDone.result;
            if (originalResult === undefined || preservedResult === undefined) {
              assert.fail("Expected done update to preserve Result metadata.");
            } else {
              assert.strictEqual(preservedResult.summary, originalResult.summary);
              assert.strictEqual(preservedResult.completedBy, originalResult.completedBy);
              assert.strictEqual(
                DateTime.toEpochMillis(preservedResult.completedAt),
                DateTime.toEpochMillis(originalResult.completedAt),
              );
            }

            const cancellationResult = yield* run([
              "--cwd",
              directory,
              "update",
              cancelledItem.id,
              "--context",
              "Corrected cancellation context.",
              "--json",
            ]);
            assert.strictEqual(cancellationResult.exit._tag, "Success");
            const updatedCancelled = decodeItemOutput(String(cancellationResult.logs[0])).item;
            assert.strictEqual(updatedCancelled.status, "cancelled");
            assert.strictEqual(updatedCancelled.agentContext, "Corrected cancellation context.");
            const originalCancellation = cancelledItem.cancellation;
            const preservedCancellation = updatedCancelled.cancellation;
            if (originalCancellation === undefined || preservedCancellation === undefined) {
              assert.fail("Expected cancelled update to preserve Cancellation metadata.");
            } else {
              assert.strictEqual(preservedCancellation.reason, originalCancellation.reason);
              assert.strictEqual(
                preservedCancellation.cancelledBy,
                originalCancellation.cancelledBy,
              );
              assert.strictEqual(
                DateTime.toEpochMillis(preservedCancellation.cancelledAt),
                DateTime.toEpochMillis(originalCancellation.cancelledAt),
              );
            }
          }
        }
      }),
    ),
  );

  it.effect("renders human output for updates", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Render update output");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--description",
          "Human output description.",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        assert.isTrue(String(result.logs[0]).includes("Updated Render update output"));
        assert.isTrue(String(result.logs[0]).includes(item.id));
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
        const orderedTasks = [storageTask.item, createTask.item].toSorted(
          compareWorkItemsForSelection,
        );
        assert.deepStrictEqual(String(listResult.logs[0]).split("\n"), [
          "└─ Ship MVP CLI (" + epic.item.id + ")",
          ...orderedTasks.map(
            (item, index) =>
              `${index === orderedTasks.length - 1 ? "   └─" : "   ├─"} ${item.subject} (${item.id})`,
          ),
        ]);
      }),
    ),
  );

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

  it.effect("claims Work Items with agent flag in human and JSON modes", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Claim flag work");

        const humanResult = yield* run([
          "--cwd",
          directory,
          "claim",
          item.id,
          "--agent",
          "codex-session",
        ]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        assert.isTrue(String(humanResult.logs[0]).includes("codex-session"));
        assert.isTrue(String(humanResult.logs[0]).includes("until"));

        yield* TestClock.adjust("10 minutes");
        const jsonResult = yield* run([
          "--cwd",
          directory,
          "claim",
          item.id,
          "--agent",
          "codex-session",
          "--json",
        ]);
        assert.strictEqual(jsonResult.exit._tag, "Success");
        const claimed = decodeItemOutput(String(jsonResult.logs[0])).item;
        const claim = claimed.claim;
        if (claim === undefined) {
          assert.fail("Expected JSON claim output to include the persisted claim.");
        } else {
          assert.strictEqual(claim.agent, "codex-session");
          assert.strictEqual(
            DateTime.toEpochMillis(claim.expiresAt) - DateTime.toEpochMillis(claim.claimedAt),
            3_600_000,
          );
          assert.strictEqual(
            DateTime.toEpochMillis(claimed.updatedAt),
            DateTime.toEpochMillis(claim.claimedAt),
          );
        }
      }),
    ),
  );

  it.effect("claims Work Items with TM_AGENT fallback", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Claim env work");
        const result = yield* run(["--cwd", directory, "claim", item.id, "--json"]).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TM_AGENT: "env-agent",
              }),
            ),
          ),
        );

        assert.strictEqual(result.exit._tag, "Success");
        const claimed = decodeItemOutput(String(result.logs[0])).item;
        const claim = claimed.claim;
        if (claim === undefined) {
          assert.fail("Expected TM_AGENT claim output to include the persisted claim.");
        } else {
          assert.strictEqual(claim.agent, "env-agent");
        }
      }),
    ),
  );

  it.effect("rejects missing and blank Agent Identity", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Require claim agent");
        const before = yield* readTasksFile(directory);

        const missingResult = yield* run(["--cwd", directory, "claim", item.id]).pipe(
          Effect.provide(emptyConfigLayer),
        );
        assert.strictEqual(missingResult.exit._tag, "Failure");
        assert.isTrue(String(missingResult.errors[0]).includes("Agent Identity is required"));

        const blankResult = yield* run(["--cwd", directory, "claim", item.id, "--agent", "   "]);
        assert.strictEqual(blankResult.exit._tag, "Failure");
        assert.isTrue(String(blankResult.errors[0]).includes("must not be empty"));

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("refreshes same-agent claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Refresh claim work");
        const firstClaimed = yield* claimWorkItem(directory, item.id, "codex-session");
        yield* TestClock.adjust("10 minutes");
        const refreshed = yield* claimWorkItem(directory, item.id, "codex-session");

        const firstClaim = firstClaimed.claim;
        const refreshedClaim = refreshed.claim;
        if (firstClaim === undefined || refreshedClaim === undefined) {
          assert.fail("Expected both claim writes to include claims.");
        } else {
          assert.strictEqual(refreshedClaim.agent, "codex-session");
          assert.isAbove(
            DateTime.toEpochMillis(refreshedClaim.claimedAt),
            DateTime.toEpochMillis(firstClaim.claimedAt),
          );
          assert.isAbove(
            DateTime.toEpochMillis(refreshedClaim.expiresAt),
            DateTime.toEpochMillis(firstClaim.expiresAt),
          );
          assert.strictEqual(
            DateTime.toEpochMillis(refreshed.updatedAt),
            DateTime.toEpochMillis(refreshedClaim.claimedAt),
          );
        }
      }),
    ),
  );

  it.effect("rejects other-agent active claim replacement without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Protect active claim");
        yield* claimWorkItem(directory, item.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "claim", item.id, "--agent", "agent-b"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("actively claimed by agent-a"));
        assert.isTrue(String(result.errors[0]).includes("--force"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("force replaces another active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Force claim work");
        yield* claimWorkItem(directory, item.id, "agent-a");
        yield* TestClock.adjust("1 minute");

        const replaced = yield* claimWorkItem(directory, item.id, "agent-b", { force: true });
        const claim = replaced.claim;
        if (claim === undefined) {
          assert.fail("Expected force replacement to persist a claim.");
        } else {
          assert.strictEqual(claim.agent, "agent-b");
        }
      }),
    ),
  );

  it.effect("replaces expired claims without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Replace expired claim");
        yield* claimWorkItem(directory, item.id, "agent-a");
        yield* TestClock.adjust("1 hour");

        const replaced = yield* claimWorkItem(directory, item.id, "agent-b");
        const claim = replaced.claim;
        if (claim === undefined) {
          assert.fail("Expected expired claim replacement to persist a claim.");
        } else {
          assert.strictEqual(claim.agent, "agent-b");
        }
      }),
    ),
  );

  it.effect("releases own claims and fails clearly when no claim exists", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Release own claim");
        const claimed = yield* claimWorkItem(directory, item.id, "agent-a");

        const missingAgentResult = yield* run(["--cwd", directory, "release", item.id]).pipe(
          Effect.provide(emptyConfigLayer),
        );
        assert.strictEqual(missingAgentResult.exit._tag, "Failure");
        assert.isTrue(String(missingAgentResult.errors[0]).includes("Agent Identity is required"));

        yield* TestClock.adjust("1 minute");
        const releaseResult = yield* run([
          "--cwd",
          directory,
          "release",
          item.id,
          "--agent",
          "agent-a",
          "--json",
        ]);
        assert.strictEqual(releaseResult.exit._tag, "Success");
        const released = decodeItemOutput(String(releaseResult.logs[0])).item;
        assert.strictEqual(released.claim, undefined);
        assert.isAbove(
          DateTime.toEpochMillis(released.updatedAt),
          DateTime.toEpochMillis(claimed.updatedAt),
        );

        const duplicateReleaseResult = yield* run([
          "--cwd",
          directory,
          "release",
          item.id,
          "--agent",
          "agent-a",
        ]);
        assert.strictEqual(duplicateReleaseResult.exit._tag, "Failure");
        assert.isTrue(String(duplicateReleaseResult.errors[0]).includes("has no claim to release"));
      }),
    ),
  );

  it.effect("requires force to release another active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Protect release claim");
        yield* claimWorkItem(directory, item.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "release", item.id, "--agent", "agent-b"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("actively claimed by agent-a"));
        assert.isTrue(String(result.errors[0]).includes("--force"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);

        const forcedResult = yield* run([
          "--cwd",
          directory,
          "release",
          item.id,
          "--agent",
          "agent-b",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forcedResult.exit._tag, "Success");
        const released = decodeItemOutput(String(forcedResult.logs[0])).item;
        assert.strictEqual(released.claim, undefined);
      }),
    ),
  );

  it.effect("lets another agent release expired claims without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Release expired claim");
        yield* claimWorkItem(directory, item.id, "agent-a");
        yield* TestClock.adjust("1 hour");

        const result = yield* run([
          "--cwd",
          directory,
          "release",
          item.id,
          "--agent",
          "agent-b",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const released = decodeItemOutput(String(result.logs[0])).item;
        assert.strictEqual(released.claim, undefined);
      }),
    ),
  );

  it.effect("completes Work Items with structured flags and clears same-agent claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Complete structured work");
        const claimed = yield* claimWorkItem(directory, item.id, "codex-session");
        yield* TestClock.adjust("1 minute");

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "Added complete command",
          "--details",
          "Implemented the lifecycle transition and tests.",
          "--decision",
          "Used structured Result storage",
          "--decision",
          "Cleared claims on completion",
          "--verification",
          "bun run test: passed",
          "--verification",
          "bun run typecheck: passed",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const completed = decodeItemOutput(String(result.logs[0])).item;

        assert.strictEqual(completed.status, "done");
        assert.strictEqual(completed.claim, undefined);
        assert.isAbove(
          DateTime.toEpochMillis(completed.updatedAt),
          DateTime.toEpochMillis(claimed.updatedAt),
        );
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Added complete command");
          assert.strictEqual(
            completionResult.details,
            "Implemented the lifecycle transition and tests.",
          );
          assert.deepStrictEqual(completionResult.decisions, [
            "Used structured Result storage",
            "Cleared claims on completion",
          ]);
          assert.deepStrictEqual(completionResult.verification, [
            "bun run test: passed",
            "bun run typecheck: passed",
          ]);
          assert.strictEqual(completionResult.completedBy, "codex-session");
          assert.strictEqual(
            DateTime.toEpochMillis(completionResult.completedAt),
            DateTime.toEpochMillis(completed.updatedAt),
          );
        }
      }),
    ),
  );

  it.effect("parses Git-style result-message input", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Complete message work");

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--result-message",
          "Add login endpoint\n\nImplemented route and tests.\n\nDecisions:\n- Return generic 401\n\nVerification:\n- bun run check: passed",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const completed = decodeItemOutput(String(result.logs[0])).item;
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected result-message completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Add login endpoint");
          assert.strictEqual(completionResult.details, "Implemented route and tests.");
          assert.deepStrictEqual(completionResult.decisions, ["Return generic 401"]);
          assert.deepStrictEqual(completionResult.verification, ["bun run check: passed"]);
        }
      }),
    ),
  );

  it.effect("completes from --result-message-file and TM_AGENT", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Complete file work");
        const fs = yield* FileSystem.FileSystem;
        const messageFile = `${directory}/result-message.txt`;
        yield* fs.writeFileString(
          messageFile,
          "Document file result\n\nCompleted using a message file.\n\nVerification:\n- bun run test: passed",
        );

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--result-message-file",
          messageFile,
          "--json",
        ]).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TM_AGENT: "file-agent",
              }),
            ),
          ),
        );
        assert.strictEqual(result.exit._tag, "Success");
        const completed = decodeItemOutput(String(result.logs[0])).item;
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected file completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Document file result");
          assert.strictEqual(completionResult.details, "Completed using a message file.");
          assert.deepStrictEqual(completionResult.verification, ["bun run test: passed"]);
          assert.strictEqual(completionResult.completedBy, "file-agent");
        }
      }),
    ),
  );

  it.effect("rejects complete without Agent Identity", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Require complete agent");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--summary",
          "Implemented complete work",
          "--verification",
          "bun run test: passed",
        ]).pipe(Effect.provide(emptyConfigLayer));
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Agent Identity is required"));

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects complete without a summary", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Require result summary");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Result summary is required"));

        const afterMissing = yield* readTasksFile(directory);
        assert.strictEqual(afterMissing, before);

        const vagueResult = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "done",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(vagueResult.exit._tag, "Failure");
        assert.isTrue(String(vagueResult.errors[0]).includes("describe what changed"));

        const afterVague = yield* readTasksFile(directory);
        assert.strictEqual(afterVague, before);
      }),
    ),
  );

  it.effect("requires verification unless --allow-no-verification is used", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Allow missing verification");
        const before = yield* readTasksFile(directory);

        const missingVerification = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed without evidence",
        ]);
        assert.strictEqual(missingVerification.exit._tag, "Failure");
        assert.isTrue(String(missingVerification.errors[0]).includes("Verification evidence"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forcedWithoutVerification = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed without evidence",
          "--force",
        ]);
        assert.strictEqual(forcedWithoutVerification.exit._tag, "Failure");
        assert.isTrue(
          String(forcedWithoutVerification.errors[0]).includes("Verification evidence"),
        );
        assert.strictEqual(yield* readTasksFile(directory), before);

        const allowed = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed with explicit escape hatch",
          "--allow-no-verification",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const completed = decodeItemOutput(String(allowed.logs[0])).item;
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected allow-no-verification to still persist a Result.");
        } else {
          assert.deepStrictEqual(completionResult.verification, []);
        }
      }),
    ),
  );

  it.effect("rejects completing parents with open children", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createWorkItem(directory, "Complete parent work");
        yield* createWorkItem(directory, "Keep child open", {
          level: "subtask",
          parent: parent.id,
        });
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          parent.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed parent work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("open children"));
        assert.strictEqual(yield* readTasksFile(directory), before);
      }),
    ),
  );

  it.effect("requires force to complete with incomplete dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createWorkItem(directory, "Complete blocked work");
        const dependency = yield* createWorkItem(directory, "Leave dependency open");
        yield* run(["--cwd", directory, "block", target.id, "--by", dependency.id]);
        const before = yield* readTasksFile(directory);

        const blocked = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed blocked work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(blocked.exit._tag, "Failure");
        assert.isTrue(String(blocked.errors[0]).includes("incomplete dependencies"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forced = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed blocked work intentionally",
          "--verification",
          "Manual dependency review: obsolete",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const completed = decodeItemOutput(String(forced.logs[0])).item;
        assert.strictEqual(completed.status, "done");
        assert.deepStrictEqual(completed.blockedBy, [dependency.id]);
      }),
    ),
  );

  it.effect("requires force to complete another agent's active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Protect complete claim");
        yield* claimWorkItem(directory, item.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const conflict = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "agent-b",
          "--summary",
          "Completed claimed work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(conflict.exit._tag, "Failure");
        assert.isTrue(String(conflict.errors[0]).includes("actively claimed by agent-a"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forced = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "agent-b",
          "--summary",
          "Completed claimed work with takeover",
          "--verification",
          "bun run test: passed",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const completed = decodeItemOutput(String(forced.logs[0])).item;
        assert.strictEqual(completed.claim, undefined);
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected forced completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.completedBy, "agent-b");
        }
      }),
    ),
  );

  it.effect("completed Work Items leave the default list and render Result in show", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Hide completed work");

        const completeResult = yield* run([
          "--cwd",
          directory,
          "complete",
          item.id,
          "--agent",
          "codex-session",
          "--summary",
          "Completed list filtering",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(completeResult.exit._tag, "Success");
        assert.isTrue(String(completeResult.logs[0]).includes("Summary: Completed list filtering"));
        assert.isTrue(String(completeResult.logs[0]).includes("- bun run test: passed"));

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Success");
        assert.strictEqual(String(listResult.logs[0]), "No open Work Items.");

        const showResult = yield* run(["--cwd", directory, "show", item.id]);
        assert.strictEqual(showResult.exit._tag, "Success");
        const output = String(showResult.logs[0]);
        assert.isTrue(output.includes("Status: done"));
        assert.isTrue(output.includes("Summary: Completed list filtering"));
        assert.isTrue(output.includes("Verification:"));
        assert.isTrue(output.includes("- bun run test: passed"));
      }),
    ),
  );

  it.effect("cancels leaf Work Items and exposes lifecycle filters", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const cancelTarget = yield* createWorkItem(directory, "Cancel obsolete work");
        const doneBase = yield* createWorkItem(directory, "Keep done work");
        const openItem = yield* createWorkItem(directory, "Keep open work");
        const doneItem = yield* markDone(doneBase);
        yield* writeTasksFile(directory, [cancelTarget, doneItem, openItem]);

        const humanCancel = yield* run([
          "--cwd",
          directory,
          "cancel",
          cancelTarget.id,
          "--agent",
          "codex-session",
          "--reason",
          "No longer needed",
        ]);
        assert.strictEqual(humanCancel.exit._tag, "Success");
        assert.isTrue(String(humanCancel.logs[0]).includes("Cancelled Cancel obsolete work"));
        assert.isTrue(String(humanCancel.logs[0]).includes("Reason: No longer needed"));

        const showResult = yield* run(["--cwd", directory, "show", cancelTarget.id]);
        assert.strictEqual(showResult.exit._tag, "Success");
        const showOutput = String(showResult.logs[0]);
        assert.isTrue(showOutput.includes("Status: cancelled"));
        assert.isTrue(showOutput.includes("Cancellation:"));
        assert.isTrue(showOutput.includes("Reason: No longer needed"));
        assert.isTrue(showOutput.includes("Cancelled:"));

        const defaultList = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(defaultList.exit._tag, "Success");
        assert.isTrue(String(defaultList.logs[0]).includes(openItem.subject));
        assert.isFalse(String(defaultList.logs[0]).includes(cancelTarget.subject));
        assert.isFalse(String(defaultList.logs[0]).includes(doneItem.subject));

        const cancelledList = yield* run(["--cwd", directory, "list", "--status", "cancelled"]);
        assert.strictEqual(cancelledList.exit._tag, "Success");
        assert.isTrue(String(cancelledList.logs[0]).includes(cancelTarget.subject));
        assert.isFalse(String(cancelledList.logs[0]).includes(openItem.subject));
        assert.isFalse(String(cancelledList.logs[0]).includes(doneItem.subject));

        const doneList = yield* run(["--cwd", directory, "list", "--status", "done"]);
        assert.strictEqual(doneList.exit._tag, "Success");
        assert.isTrue(String(doneList.logs[0]).includes(doneItem.subject));
        assert.isFalse(String(doneList.logs[0]).includes(cancelTarget.subject));
        assert.isFalse(String(doneList.logs[0]).includes(openItem.subject));

        const allList = yield* run(["--cwd", directory, "list", "--all"]);
        assert.strictEqual(allList.exit._tag, "Success");
        assert.isTrue(String(allList.logs[0]).includes(cancelTarget.subject));
        assert.isTrue(String(allList.logs[0]).includes(doneItem.subject));
        assert.isTrue(String(allList.logs[0]).includes(openItem.subject));

        const fileTarget = yield* createWorkItem(directory, "Cancel from file");
        const fs = yield* FileSystem.FileSystem;
        const reasonFile = `${directory}/cancel-reason.txt`;
        yield* fs.writeFileString(reasonFile, "Loaded cancellation reason.\n");

        const jsonCancel = yield* run([
          "--cwd",
          directory,
          "cancel",
          fileTarget.id,
          "--agent",
          "file-agent",
          "--reason-file",
          reasonFile,
          "--json",
        ]);
        assert.strictEqual(jsonCancel.exit._tag, "Success");
        const decoded = decodeCancelOutput(String(jsonCancel.logs[0]));
        assert.strictEqual(decoded.item.id, fileTarget.id);
        assert.strictEqual(decoded.item.status, "cancelled");
        assert.strictEqual(decoded.item.claim, undefined);
        const cancellation = decoded.item.cancellation;
        if (cancellation === undefined) {
          assert.fail("Expected cancellation output to include Cancellation metadata.");
        } else {
          assert.strictEqual(cancellation.reason, "Loaded cancellation reason.");
          assert.strictEqual(cancellation.cancelledBy, "file-agent");
        }
        const [cancelledOutputItem] = decoded.cancelledItems;
        if (cancelledOutputItem === undefined) {
          assert.fail("Expected JSON cancellation output to include cancelledItems.");
        } else {
          assert.strictEqual(decoded.cancelledItems.length, 1);
          assert.strictEqual(cancelledOutputItem.id, fileTarget.id);
        }
      }),
    ),
  );

  it.effect("rejects invalid cancellation inputs without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Reject cancellation inputs");
        const fs = yield* FileSystem.FileSystem;
        const reasonFile = `${directory}/cancel-reason.txt`;
        yield* fs.writeFileString(reasonFile, "Reason from file.");
        const before = yield* readTasksFile(directory);

        const missingAgent = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
          "--reason",
          "No agent supplied",
        ]).pipe(Effect.provide(emptyConfigLayer));
        assert.strictEqual(missingAgent.exit._tag, "Failure");
        assert.isTrue(String(missingAgent.errors[0]).includes("Agent Identity is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const missingReason = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
          "--agent",
          "codex-session",
        ]);
        assert.strictEqual(missingReason.exit._tag, "Failure");
        assert.isTrue(String(missingReason.errors[0]).includes("Cancellation reason is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const blankReason = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
          "--agent",
          "codex-session",
          "--reason",
          "   ",
        ]);
        assert.strictEqual(blankReason.exit._tag, "Failure");
        assert.isTrue(String(blankReason.errors[0]).includes("Cancellation reason is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const conflictingReasonInputs = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
          "--agent",
          "codex-session",
          "--reason",
          "Inline reason",
          "--reason-file",
          reasonFile,
        ]);
        assert.strictEqual(conflictingReasonInputs.exit._tag, "Failure");
        assert.isTrue(
          String(conflictingReasonInputs.errors[0]).includes(
            "Use either --reason or --reason-file",
          ),
        );
        assert.strictEqual(yield* readTasksFile(directory), before);
      }),
    ),
  );

  it.effect("previews parent cancellation and cascades only open descendants", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createWorkItem(directory, "Cancel parent work");
        const firstOpenChild = yield* createWorkItem(directory, "Cancel first child", {
          level: "subtask",
          parent: parent.id,
        });
        const secondOpenChild = yield* createWorkItem(directory, "Cancel second child", {
          level: "subtask",
          parent: parent.id,
        });
        const doneChildBase = yield* createWorkItem(directory, "Keep done child", {
          level: "subtask",
          parent: parent.id,
        });
        const cancelledChildBase = yield* createWorkItem(directory, "Keep cancelled child", {
          level: "subtask",
          parent: parent.id,
        });
        const doneChild = yield* markDone(doneChildBase);
        const cancelledChild = yield* markCancelled(cancelledChildBase);
        yield* writeTasksFile(directory, [
          parent,
          firstOpenChild,
          secondOpenChild,
          doneChild,
          cancelledChild,
        ]);
        const before = yield* readTasksFile(directory);

        const preview = yield* run([
          "--cwd",
          directory,
          "cancel",
          parent.id,
          "--agent",
          "codex-session",
          "--reason",
          "Parent obsolete",
        ]);
        assert.strictEqual(preview.exit._tag, "Failure");
        const previewOutput = String(preview.errors[0]);
        assert.isTrue(previewOutput.includes("would also be cancelled"));
        assert.isTrue(previewOutput.includes(firstOpenChild.subject));
        assert.isTrue(previewOutput.includes(secondOpenChild.subject));
        assert.isTrue(previewOutput.includes("--yes"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const cascade = yield* run([
          "--cwd",
          directory,
          "cancel",
          parent.id,
          "--agent",
          "codex-session",
          "--reason",
          "Parent obsolete",
          "--yes",
          "--json",
        ]);
        assert.strictEqual(cascade.exit._tag, "Success");
        const decoded = decodeCancelOutput(String(cascade.logs[0]));
        assert.deepStrictEqual(
          decoded.cancelledItems.map((cancelledItem) => cancelledItem.id).toSorted(),
          [parent.id, firstOpenChild.id, secondOpenChild.id].toSorted(),
        );
        for (const cancelledItem of decoded.cancelledItems) {
          assert.strictEqual(cancelledItem.status, "cancelled");
          assert.strictEqual(cancelledItem.claim, undefined);
          const cancellation = cancelledItem.cancellation;
          if (cancellation === undefined) {
            assert.fail("Expected cascaded Work Item to include Cancellation metadata.");
          } else {
            assert.strictEqual(cancellation.reason, "Parent obsolete");
            assert.strictEqual(cancellation.cancelledBy, "codex-session");
          }
        }

        const doneShow = yield* run(["--cwd", directory, "show", doneChild.id, "--json"]);
        assert.strictEqual(doneShow.exit._tag, "Success");
        const persistedDoneChild = decodeItemOutput(String(doneShow.logs[0])).item;
        assert.strictEqual(persistedDoneChild.status, "done");
        assert.strictEqual(
          DateTime.toEpochMillis(persistedDoneChild.updatedAt),
          DateTime.toEpochMillis(doneChild.updatedAt),
        );

        const cancelledShow = yield* run(["--cwd", directory, "show", cancelledChild.id, "--json"]);
        assert.strictEqual(cancelledShow.exit._tag, "Success");
        const persistedCancelledChild = decodeItemOutput(String(cancelledShow.logs[0])).item;
        assert.strictEqual(persistedCancelledChild.status, "cancelled");
        const originalCancellation = cancelledChild.cancellation;
        const persistedCancellation = persistedCancelledChild.cancellation;
        if (originalCancellation === undefined || persistedCancellation === undefined) {
          assert.fail("Expected existing cancelled child to preserve Cancellation metadata.");
        } else {
          assert.strictEqual(persistedCancellation.reason, originalCancellation.reason);
          assert.strictEqual(persistedCancellation.cancelledBy, originalCancellation.cancelledBy);
          assert.strictEqual(
            DateTime.toEpochMillis(persistedCancellation.cancelledAt),
            DateTime.toEpochMillis(originalCancellation.cancelledAt),
          );
        }
      }),
    ),
  );

  it.effect("enforces cancellation claim conflicts and clears claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createWorkItem(directory, "Cancel claimed parent");
        const child = yield* createWorkItem(directory, "Cancel claimed child", {
          level: "subtask",
          parent: parent.id,
        });
        yield* claimWorkItem(directory, child.id, "agent-a");
        const beforeConflict = yield* readTasksFile(directory);

        const conflict = yield* run([
          "--cwd",
          directory,
          "cancel",
          parent.id,
          "--agent",
          "agent-b",
          "--reason",
          "Claimed child obsolete",
          "--yes",
        ]);
        assert.strictEqual(conflict.exit._tag, "Failure");
        assert.isTrue(String(conflict.errors[0]).includes("actively claimed by agent-a"));
        assert.strictEqual(yield* readTasksFile(directory), beforeConflict);

        const forced = yield* run([
          "--cwd",
          directory,
          "cancel",
          parent.id,
          "--agent",
          "agent-b",
          "--reason",
          "Claimed child obsolete",
          "--yes",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const forcedOutput = decodeCancelOutput(String(forced.logs[0]));
        const forcedChild = forcedOutput.cancelledItems.find(
          (cancelledItem) => cancelledItem.id === child.id,
        );
        if (forcedChild === undefined) {
          assert.fail("Expected forced cascade to cancel the claimed child.");
        } else {
          assert.strictEqual(forcedChild.claim, undefined);
          const cancellation = forcedChild.cancellation;
          if (cancellation === undefined) {
            assert.fail("Expected forced cancellation to persist Cancellation metadata.");
          } else {
            assert.strictEqual(cancellation.cancelledBy, "agent-b");
          }
        }

        const expiredItem = yield* createWorkItem(directory, "Cancel expired claim");
        yield* claimWorkItem(directory, expiredItem.id, "agent-a");
        yield* TestClock.adjust("1 hour");
        const expiredResult = yield* run([
          "--cwd",
          directory,
          "cancel",
          expiredItem.id,
          "--agent",
          "agent-b",
          "--reason",
          "Expired claim is stale",
          "--json",
        ]);
        assert.strictEqual(expiredResult.exit._tag, "Success");
        const expiredCancelled = decodeCancelOutput(String(expiredResult.logs[0])).item;
        assert.strictEqual(expiredCancelled.status, "cancelled");
        assert.strictEqual(expiredCancelled.claim, undefined);

        const ownClaimItem = yield* createWorkItem(directory, "Cancel own claim");
        yield* claimWorkItem(directory, ownClaimItem.id, "agent-c");
        const ownClaimResult = yield* run([
          "--cwd",
          directory,
          "cancel",
          ownClaimItem.id,
          "--agent",
          "agent-c",
          "--reason",
          "Owner stopped work",
          "--json",
        ]);
        assert.strictEqual(ownClaimResult.exit._tag, "Success");
        const ownCancelled = decodeCancelOutput(String(ownClaimResult.logs[0])).item;
        assert.strictEqual(ownCancelled.claim, undefined);
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
