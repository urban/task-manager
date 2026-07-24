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
  encodeTicketJsonLine,
  schemaVersion,
  sortTickets,
  TicketSchema,
} from "../src/domain/Ticket";
import { runTmCli } from "../src/main";

type CliEnvironment = import("effect/unstable/cli/Command").Environment;
type CancelledTicket = import("../src/domain/Ticket").CancelledTicket;
type DoneTicket = import("../src/domain/Ticket").DoneTicket;
type OpenTicket = import("../src/domain/Ticket").OpenTicket;
type Ticket = import("../src/domain/Ticket").Ticket;
type TicketExecutor = import("../src/domain/Ticket").TicketExecutor;
type TicketLevel = import("../src/domain/Ticket").TicketLevel;

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
  ticketCount: Schema.Number,
  tasksFile: Schema.String,
});

const TicketOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  ticket: TicketSchema,
});

const CancelOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  ticket: TicketSchema,
  cancelledTickets: Schema.Array(TicketSchema),
});

const DeletedTicketOutputSchema = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  executor: Schema.String,
});

const DeleteOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  deleted: Schema.Array(DeletedTicketOutputSchema),
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
  tickets: Schema.Array(ListTreeNodeSchema),
});

export const decodeValidateOutput = Schema.decodeSync(Schema.fromJsonString(ValidateOutputSchema));
export const decodeTicketOutput = Schema.decodeSync(Schema.fromJsonString(TicketOutputSchema));
export const decodeCancelOutput = Schema.decodeSync(Schema.fromJsonString(CancelOutputSchema));
export const decodeDeleteOutput = Schema.decodeSync(Schema.fromJsonString(DeleteOutputSchema));
export const decodeListOutput = Schema.decodeSync(Schema.fromJsonString(ListOutputSchema));

export const withTempDirectory = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "tm-cli-" });
    return yield* f(directory);
  }).pipe(Effect.provide(baseLayer));

export const createTicket = (
  directory: string,
  subject: string,
  options?: {
    readonly level?: TicketLevel;
    readonly parent?: string;
    readonly blockedBy?: ReadonlyArray<string>;
    readonly executor?: TicketExecutor;
  },
): Effect.Effect<OpenTicket, never, CliEnvironment> =>
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
    const ticket = decodeTicketOutput(String(result.logs[0])).ticket;
    if (ticket.status !== "open") {
      return yield* Effect.die("Expected create to return an open Ticket");
    }
    return ticket;
  });

export const claimTicket = (
  directory: string,
  id: string,
  agent: string,
  options?: {
    readonly force?: boolean;
    readonly allowHuman?: boolean;
  },
): Effect.Effect<OpenTicket, never, CliEnvironment> =>
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
    const ticket = decodeTicketOutput(String(result.logs[0])).ticket;
    if (ticket.status !== "open") {
      return yield* Effect.die("Expected claim to return an open Ticket");
    }
    return ticket;
  });

export const readTasksFile = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(`${directory}/.tasks/tasks.jsonl`);
  });

export const writeTasksFile = (directory: string, tickets: ReadonlyArray<Ticket>) =>
  Effect.gen(function* () {
    const encodedLines = yield* Effect.forEach(sortTickets(tickets), (ticket) =>
      encodeTicketJsonLine(ticket),
    );
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(`${directory}/.tasks/tasks.jsonl`, encodedLines.join("\n"));
  });

export const markDone = (ticket: OpenTicket) =>
  Effect.gen(function* () {
    const completedAt = yield* DateTime.now;

    const { status: _status, claim: _claim, ...base } = ticket;
    return {
      ...base,
      status: "done",
      result: {
        summary: `${ticket.subject} done`,
        details: "Completed by a test fixture.",
        decisions: [],
        verification: ["fixture"],
        completedAt,
        completedBy: "test-agent",
      },
      updatedAt: completedAt,
    } satisfies Ticket;
  });

export const markCancelled = (ticket: OpenTicket) =>
  Effect.gen(function* () {
    const cancelledAt = yield* DateTime.now;

    const { status: _status, claim: _claim, ...base } = ticket;
    return {
      ...base,
      status: "cancelled",
      cancellation: {
        reason: `${ticket.subject} cancelled`,
        cancelledAt,
        cancelledBy: "test-agent",
      },
      updatedAt: cancelledAt,
    } satisfies Ticket;
  });

export const makeFixtureOpenTicket = (options: {
  readonly id: string;
  readonly subject: string;
  readonly createdAt: Ticket["createdAt"];
  readonly level?: TicketLevel;
  readonly parentId?: string;
}): OpenTicket =>
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
  }) satisfies Ticket;

export const requireDoneTicket = (ticket: Ticket): DoneTicket => {
  if (ticket.status !== "done") {
    assert.fail(`Expected done Ticket, received ${ticket.status}.`);
  }
  return ticket;
};

export const requireCancelledTicket = (ticket: Ticket): CancelledTicket => {
  if (ticket.status !== "cancelled") {
    assert.fail(`Expected cancelled Ticket, received ${ticket.status}.`);
  }
  return ticket;
};

export const compareTicketsForSelection = (left: Ticket, right: Ticket): number => {
  const diff = DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt);
  if (diff !== 0) {
    return diff;
  }
  return left.id.localeCompare(right.id);
};
