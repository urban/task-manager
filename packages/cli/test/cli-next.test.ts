/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import { TestClock } from "effect/testing";

type Ticket = import("../src/domain/Ticket").Ticket;
import {
  readTasksFile,
  writeTasksFile,
  createTicket,
  decodeTicketOutput,
  makeFixtureOpenTicket,
  markDone,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm next", () => {
  it.effect("selects a standalone open Task", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Add next command");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeTicketOutput(String(result.logs[0]));
        assert.strictEqual(selected.ticket.id, ticket.id);

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("filters next selection by executor", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const humanTicket = yield* createTicket(directory, "Review import plan", {
          executor: "human",
        });
        yield* TestClock.adjust("1 second");
        const agentTicket = yield* createTicket(directory, "Implement import plan");

        const defaultResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(defaultResult.exit._tag, "Success");
        const defaultSelection = decodeTicketOutput(String(defaultResult.logs[0])).ticket;
        assert.strictEqual(defaultSelection.id, agentTicket.id);

        const humanResult = yield* run([
          "--cwd",
          directory,
          "next",
          "--executor",
          "human",
          "--json",
        ]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        const humanSelection = decodeTicketOutput(String(humanResult.logs[0])).ticket;
        assert.strictEqual(humanSelection.id, humanTicket.id);

        const anyResult = yield* run(["--cwd", directory, "next", "--all-executors", "--json"]);
        assert.strictEqual(anyResult.exit._tag, "Success");
        const anySelection = decodeTicketOutput(String(anyResult.logs[0])).ticket;
        assert.strictEqual(anySelection.id, humanTicket.id);
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
        const task = yield* createTicket(directory, "Build execution loop");
        const firstSubtask = yield* createTicket(directory, "Write selector tests", {
          level: "subtask",
          parent: task.id,
        });
        const secondSubtask = yield* createTicket(directory, "Implement selector", {
          level: "subtask",
          parent: task.id,
        });
        const laterSecondSubtask = {
          ...secondSubtask,
          createdAt: firstSubtask.createdAt.pipe(DateTime.add({ seconds: 1 })),
          updatedAt: firstSubtask.updatedAt.pipe(DateTime.add({ seconds: 1 })),
        } satisfies Ticket;
        yield* writeTasksFile(directory, [task, firstSubtask, laterSecondSubtask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeTicketOutput(String(result.logs[0]));
        assert.strictEqual(selected.ticket.id, firstSubtask.id);
      }),
    ),
  );

  it.effect("returns a parent once it has no open children", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const task = yield* createTicket(directory, "Build command handler");
        const firstSubtask = yield* createTicket(directory, "Add handler test", {
          level: "subtask",
          parent: task.id,
        });
        const secondSubtask = yield* createTicket(directory, "Wire handler", {
          level: "subtask",
          parent: task.id,
        });
        const doneFirstSubtask = yield* markDone(firstSubtask);
        const doneSecondSubtask = yield* markDone(secondSubtask);
        yield* writeTasksFile(directory, [task, doneFirstSubtask, doneSecondSubtask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeTicketOutput(String(result.logs[0]));
        assert.strictEqual(selected.ticket.id, task.id);
      }),
    ),
  );

  it.effect("skips blocked Tickets until dependencies are done", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createTicket(directory, "Implement report export");
        const dependency = yield* createTicket(directory, "Prepare report data");
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
        const blockedTarget = decodeTicketOutput(String(blockResult.logs[0])).ticket;

        const blockedSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(blockedSelection.exit._tag, "Success");
        const selectedWhileBlocked = decodeTicketOutput(String(blockedSelection.logs[0]));
        assert.strictEqual(selectedWhileBlocked.ticket.id, dependency.id);

        const doneDependency = yield* markDone(dependency);
        yield* writeTasksFile(directory, [blockedTarget, doneDependency]);

        const unblockedSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(unblockedSelection.exit._tag, "Success");
        const selectedAfterDependency = decodeTicketOutput(String(unblockedSelection.logs[0]));
        assert.strictEqual(selectedAfterDependency.ticket.id, target.id);
      }),
    ),
  );

  it.effect("orders Epics before root Tasks and siblings by creation", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const standaloneTask = yield* createTicket(directory, "Add standalone task");
        const epic = yield* createTicket(directory, "Ship selection flow", { level: "epic" });
        const firstChild = yield* createTicket(directory, "Design selector", {
          parent: epic.id,
        });
        const secondChild = yield* createTicket(directory, "Wire selector CLI", {
          parent: epic.id,
        });
        const laterSecondChild = {
          ...secondChild,
          createdAt: firstChild.createdAt.pipe(DateTime.add({ seconds: 1 })),
          updatedAt: firstChild.updatedAt.pipe(DateTime.add({ seconds: 1 })),
        } satisfies Ticket;
        yield* writeTasksFile(directory, [standaloneTask, epic, firstChild, laterSecondChild]);

        const firstSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(firstSelection.exit._tag, "Success");
        const selectedFirst = decodeTicketOutput(String(firstSelection.logs[0]));
        assert.strictEqual(selectedFirst.ticket.id, firstChild.id);

        const doneFirstChild = yield* markDone(firstChild);
        yield* writeTasksFile(directory, [standaloneTask, doneFirstChild, laterSecondChild, epic]);

        const secondSelection = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(secondSelection.exit._tag, "Success");
        const selectedSecond = decodeTicketOutput(String(secondSelection.logs[0]));
        assert.strictEqual(selectedSecond.ticket.id, secondChild.id);
      }),
    ),
  );

  it.effect("uses Ticket id as the creation-time tie-breaker", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const createdAt = yield* DateTime.now;
        const laterIdTask = makeFixtureOpenTicket({
          id: "tie00b",
          subject: "Add second tie ticket",
          createdAt,
        });
        const earlierIdTask = makeFixtureOpenTicket({
          id: "tie00a",
          subject: "Add first tie ticket",
          createdAt,
        });
        yield* writeTasksFile(directory, [laterIdTask, earlierIdTask]);

        const result = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeTicketOutput(String(result.logs[0]));
        assert.strictEqual(selected.ticket.id, earlierIdTask.id);
      }),
    ),
  );

  it.effect("scopes next selection to the requested root subtree", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstEpic = yield* createTicket(directory, "Build first area", { level: "epic" });
        yield* createTicket(directory, "Implement first area", { parent: firstEpic.id });
        const secondEpic = yield* createTicket(directory, "Build second area", { level: "epic" });
        const secondChild = yield* createTicket(directory, "Implement second area", {
          parent: secondEpic.id,
        });

        const result = yield* run(["--cwd", directory, "next", "--root", secondEpic.id, "--json"]);
        assert.strictEqual(result.exit._tag, "Success");
        const selected = decodeTicketOutput(String(result.logs[0]));
        assert.strictEqual(selected.ticket.id, secondChild.id);
      }),
    ),
  );

  it.effect("prints stable no-work output in human and JSON modes", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const humanResult = yield* run(["--cwd", directory, "next"]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        assert.strictEqual(String(humanResult.logs[0]), "No actionable Tickets.");

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

        const missingRootResult = yield* run([
          "--cwd",
          directory,
          "next",
          "--root",
          "missing-root",
        ]);
        assert.strictEqual(missingRootResult.exit._tag, "Failure");
        assert.isTrue(String(missingRootResult.errors[0]).includes("was not found"));

        const ticket = yield* createTicket(directory, "Close root ticket");
        const doneTicket = yield* markDone(ticket);
        yield* writeTasksFile(directory, [doneTicket]);

        const doneRootResult = yield* run(["--cwd", directory, "next", "--root", ticket.id]);
        assert.strictEqual(doneRootResult.exit._tag, "Failure");
        assert.isTrue(String(doneRootResult.errors[0]).includes("is not open"));
      }),
    ),
  );
});
