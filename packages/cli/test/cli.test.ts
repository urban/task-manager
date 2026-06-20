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
