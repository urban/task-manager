/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import * as PlatformNode from "@effect/platform-node";
import { assert } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import { TestConsole } from "effect/testing";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  encodeWorkItemJsonLine,
  schemaVersion,
  sortWorkItems,
  WorkItemSchema,
} from "../src/domain/WorkItem";
import { runTmCli } from "../src/main";

type CliEnvironment = import("effect/unstable/cli/Command").Environment;
type CancelledWorkItem = import("../src/domain/WorkItem").CancelledWorkItem;
type DoneWorkItem = import("../src/domain/WorkItem").DoneWorkItem;
type OpenWorkItem = import("../src/domain/WorkItem").OpenWorkItem;
type WorkItem = import("../src/domain/WorkItem").WorkItem;
type WorkItemExecutor = import("../src/domain/WorkItem").WorkItemExecutor;
type WorkItemLevel = import("../src/domain/WorkItem").WorkItemLevel;

const cliOutputLayer = CliOutput.layer(
  CliOutput.defaultFormatter({
    colors: false,
  }),
);

const childProcessLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die("Not implemented")),
);

export const emptyConfigLayer = ConfigProvider.layer(ConfigProvider.fromUnknown({}));

const baseLayer = Layer.mergeAll(
  TestConsole.layer,
  PlatformNode.NodeFileSystem.layer,
  PlatformNode.NodePath.layer,
  PlatformNode.NodeTerminal.layer,
  cliOutputLayer,
  childProcessLayer,
  Stdio.layerTest({}),
);

export const run = (args: ReadonlyArray<string>) =>
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

const DeletedItemOutputSchema = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  executor: Schema.String,
});

const DeleteOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  deleted: Schema.Array(DeletedItemOutputSchema),
});

const ListTreeChildNodeSchema = Schema.Struct({
  id: Schema.String,
  level: Schema.String,
  status: Schema.String,
  executor: Schema.String,
  subject: Schema.String,
  matchesFilter: Schema.Boolean,
  children: Schema.Array(Schema.Unknown),
});

const ListTreeNodeSchema = Schema.Struct({
  id: Schema.String,
  level: Schema.String,
  status: Schema.String,
  executor: Schema.String,
  subject: Schema.String,
  matchesFilter: Schema.Boolean,
  children: Schema.Array(ListTreeChildNodeSchema),
});

const ListOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  items: Schema.Array(ListTreeNodeSchema),
});

export const decodeValidateOutput = Schema.decodeSync(Schema.fromJsonString(ValidateOutputSchema));
export const decodeItemOutput = Schema.decodeSync(Schema.fromJsonString(ItemOutputSchema));
export const decodeCancelOutput = Schema.decodeSync(Schema.fromJsonString(CancelOutputSchema));
export const decodeDeleteOutput = Schema.decodeSync(Schema.fromJsonString(DeleteOutputSchema));
export const decodeListOutput = Schema.decodeSync(Schema.fromJsonString(ListOutputSchema));

export const withTempDirectory = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "tm-cli-" });
    return yield* f(directory);
  }).pipe(Effect.provide(baseLayer));

export const createWorkItem = (
  directory: string,
  subject: string,
  options?: {
    readonly level?: WorkItemLevel;
    readonly parent?: string;
    readonly blockedBy?: ReadonlyArray<string>;
    readonly executor?: WorkItemExecutor;
  },
): Effect.Effect<OpenWorkItem, never, CliEnvironment> =>
  Effect.gen(function* () {
    const parentArgs = options?.parent === undefined ? [] : ["--parent", options.parent];
    const blockedByArgs = (options?.blockedBy ?? []).flatMap((id) => ["--blocked-by", id]);
    const executorArgs = options?.executor === undefined ? [] : ["--executor", options.executor];
    const result = yield* run([
      "--cwd",
      directory,
      "create",
      subject,
      "--level",
      options?.level ?? "task",
      ...executorArgs,
      ...parentArgs,
      ...blockedByArgs,
      "--description",
      `${subject} description.`,
      "--context",
      `${subject} context.`,
      "--json",
    ]);
    assert.strictEqual(result.exit._tag, "Success");
    const item = decodeItemOutput(String(result.logs[0])).item;
    if (item.status !== "open") {
      return yield* Effect.die("Expected create to return an open Work Item");
    }
    return item;
  });

export const claimWorkItem = (
  directory: string,
  id: string,
  agent: string,
  options?: {
    readonly force?: boolean;
    readonly allowHuman?: boolean;
  },
): Effect.Effect<OpenWorkItem, never, CliEnvironment> =>
  Effect.gen(function* () {
    const forceArgs = options?.force === true ? ["--force"] : [];
    const allowHumanArgs = options?.allowHuman === true ? ["--allow-human"] : [];
    const result = yield* run([
      "--cwd",
      directory,
      "claim",
      id,
      "--actor",
      agent,
      ...forceArgs,
      ...allowHumanArgs,
      "--json",
    ]);
    assert.strictEqual(result.exit._tag, "Success");
    const item = decodeItemOutput(String(result.logs[0])).item;
    if (item.status !== "open") {
      return yield* Effect.die("Expected claim to return an open Work Item");
    }
    return item;
  });

export const readTasksFile = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(`${directory}/.tasks/tasks.jsonl`);
  });

export const writeTasksFile = (directory: string, items: ReadonlyArray<WorkItem>) =>
  Effect.gen(function* () {
    const encodedLines = yield* Effect.forEach(sortWorkItems(items), (item) =>
      encodeWorkItemJsonLine(item),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${directory}/.tasks/tasks.jsonl`, encodedLines.join("\n"));
  });

export const markDone = (item: OpenWorkItem) =>
  Effect.gen(function* () {
    const completedAt = yield* DateTime.now;

    const { status: _status, claim: _claim, ...base } = item;
    return {
      ...base,
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

export const markCancelled = (item: OpenWorkItem) =>
  Effect.gen(function* () {
    const cancelledAt = yield* DateTime.now;

    const { status: _status, claim: _claim, ...base } = item;
    return {
      ...base,
      status: "cancelled",
      cancellation: {
        reason: `${item.subject} cancelled`,
        cancelledAt,
        cancelledBy: "test-agent",
      },
      updatedAt: cancelledAt,
    } satisfies WorkItem;
  });

export const makeFixtureOpenWorkItem = (options: {
  readonly id: string;
  readonly subject: string;
  readonly createdAt: WorkItem["createdAt"];
  readonly level?: WorkItemLevel;
  readonly parentId?: string;
}): OpenWorkItem =>
  ({
    schemaVersion,
    id: options.id,
    level: options.level ?? "task",
    status: "open",
    subject: options.subject,
    description: `${options.subject} description.`,
    context: `${options.subject} context.`,
    executor: "agent",
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  }) satisfies WorkItem;

export const requireDoneWorkItem = (item: WorkItem): DoneWorkItem => {
  if (item.status !== "done") {
    assert.fail(`Expected done Work Item, received ${item.status}.`);
  }
  return item;
};

export const requireCancelledWorkItem = (item: WorkItem): CancelledWorkItem => {
  if (item.status !== "cancelled") {
    assert.fail(`Expected cancelled Work Item, received ${item.status}.`);
  }
  return item;
};

export const compareWorkItemsForSelection = (left: WorkItem, right: WorkItem): number => {
  const diff = DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt);
  if (diff !== 0) {
    return diff;
  }
  return left.id.localeCompare(right.id);
};
