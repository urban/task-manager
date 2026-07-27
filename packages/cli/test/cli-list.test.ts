/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  compareTicketsForSelection,
  createTicket,
  decodeListOutput,
  markCancelled,
  markDone,
  run,
  withTempDirectory,
  writeTasksFile,
} from "./cli-test-support";

describe("tm list", () => {
  it.effect("renders exact nested checkbox output in deterministic tree order", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const epic = yield* createTicket(directory, "Ship MVP CLI", { level: "epic" });
        const storageTask = yield* createTicket(directory, "Bootstrap storage", {
          parent: epic.id,
        });
        const createTask = yield* createTicket(directory, "Create first task", {
          parent: epic.id,
        });
        const storageSubtask = yield* createTicket(directory, "Write storage atomically", {
          level: "subtask",
          parent: storageTask.id,
        });

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Success");
        const orderedTasks = [storageTask, createTask].toSorted(compareTicketsForSelection);
        const expectedChildren = orderedTasks.flatMap((ticket, index) => {
          const isLast = index === orderedTasks.length - 1;
          const line = `    ${isLast ? "└──" : "├──"} [ ] ${ticket.id}: ${ticket.subject}`;
          return ticket.id === storageTask.id
            ? [
                line,
                `${isLast ? "        " : "    │   "}└── [ ] ${storageSubtask.id}: ${storageSubtask.subject}`,
              ]
            : [line];
        });

        assert.deepStrictEqual(String(listResult.logs[0]).split("\n"), [
          `[ ] ${epic.id}: ${epic.subject}`,
          ...expectedChildren,
        ]);
      }),
    ),
  );

  it.effect("defaults to every status and executor while preserving explicit filters", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const epic = yield* createTicket(directory, "Coordinate import work", {
          level: "epic",
          executor: "human",
        });
        const humanTask = yield* createTicket(directory, "Review import UX", {
          parent: epic.id,
          executor: "human",
        });
        const agentTask = yield* createTicket(directory, "Implement import UX", {
          parent: epic.id,
        });
        const doneBase = yield* createTicket(directory, "Document import UX", {
          parent: epic.id,
        });
        const cancelledBase = yield* createTicket(directory, "Discard import mockup", {
          parent: epic.id,
          executor: "human",
        });
        const doneTask = yield* markDone(doneBase);
        const cancelledTask = yield* markCancelled(cancelledBase);
        yield* writeTasksFile(directory, [epic, humanTask, agentTask, doneTask, cancelledTask]);

        const defaultList = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(defaultList.exit._tag, "Success");
        const defaultOutput = String(defaultList.logs[0]);
        for (const ticket of [epic, humanTask, cancelledTask]) {
          assert.isTrue(defaultOutput.includes(`${ticket.id}: (H) ${ticket.subject}`));
        }
        for (const ticket of [agentTask, doneTask]) {
          assert.isTrue(defaultOutput.includes(`${ticket.id}: ${ticket.subject}`));
        }

        const defaultJson = yield* run(["--cwd", directory, "list", "--json"]);
        assert.strictEqual(defaultJson.exit._tag, "Success");
        const decodedDefault = decodeListOutput(String(defaultJson.logs[0]));
        const [defaultRoot] = decodedDefault.tickets;
        if (defaultRoot === undefined) {
          assert.fail("Expected the default JSON list to include the root.");
        }
        assert.deepStrictEqual(
          new Set(defaultRoot.children.map((child) => `${child.status}:${child.executor}`)),
          new Set(["open:human", "open:agent", "done:agent", "cancelled:human"]),
        );
        assert.isTrue(defaultRoot.children.every((child) => child.matchesFilter));

        const humanList = yield* run(["--cwd", directory, "list", "--executor", "human"]);
        assert.strictEqual(humanList.exit._tag, "Success");
        const humanOutput = String(humanList.logs[0]);
        assert.isTrue(humanOutput.includes(`${epic.id}: ${epic.subject}`));
        assert.isTrue(humanOutput.includes(`${humanTask.id}: ${humanTask.subject}`));
        assert.isTrue(humanOutput.includes(`[-] ${cancelledTask.id}: ${cancelledTask.subject}`));
        assert.isFalse(humanOutput.includes("(H)"));
        assert.isFalse(humanOutput.includes(agentTask.id));
        assert.isFalse(humanOutput.includes(doneTask.id));

        const agentList = yield* run(["--cwd", directory, "list", "--executor", "agent"]);
        assert.strictEqual(agentList.exit._tag, "Success");
        const agentOutput = String(agentList.logs[0]);
        assert.isTrue(agentOutput.includes(`${epic.id}: (H) ${epic.subject}`));
        assert.isTrue(agentOutput.includes(`${agentTask.id}: ${agentTask.subject}`));
        assert.isTrue(agentOutput.includes(`[x] ${doneTask.id}: ${doneTask.subject}`));
        assert.isFalse(agentOutput.includes(humanTask.id));
        assert.isFalse(agentOutput.includes(cancelledTask.id));

        const doneList = yield* run(["--cwd", directory, "list", "--status", "done"]);
        assert.strictEqual(doneList.exit._tag, "Success");
        assert.strictEqual(
          String(doneList.logs[0]),
          `[/] ${epic.id}: (H) ${epic.subject}\n    └── [x] ${doneTask.id}: ${doneTask.subject}`,
        );

        const openList = yield* run(["--cwd", directory, "list", "--status", "open"]);
        assert.strictEqual(openList.exit._tag, "Success");
        const openOutput = String(openList.logs[0]);
        assert.isTrue(openOutput.includes(humanTask.id));
        assert.isTrue(openOutput.includes(agentTask.id));
        assert.isFalse(openOutput.includes(doneTask.id));
        assert.isFalse(openOutput.includes(cancelledTask.id));

        for (const args of [["--all"], ["--all-executors"]]) {
          const explicitAll = yield* run(["--cwd", directory, "list", ...args]);
          assert.strictEqual(explicitAll.exit._tag, "Success");
          assert.isTrue(String(explicitAll.logs[0]).includes(doneTask.id));
          assert.isTrue(String(explicitAll.logs[0]).includes(cancelledTask.id));
        }
      }),
    ),
  );

  it.effect("derives partial parent markers from completed descendants", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const epic = yield* createTicket(directory, "Deliver task manager", { level: "epic" });
        const task = yield* createTicket(directory, "Build list command", { parent: epic.id });
        const doneBase = yield* createTicket(directory, "Render completed marker", {
          level: "subtask",
          parent: task.id,
        });
        const openSubtask = yield* createTicket(directory, "Render open marker", {
          level: "subtask",
          parent: task.id,
        });
        const cancelledBase = yield* createTicket(directory, "Render obsolete marker", {
          level: "subtask",
          parent: task.id,
        });
        const doneSubtask = yield* markDone(doneBase);
        const cancelledSubtask = yield* markCancelled(cancelledBase);
        yield* writeTasksFile(directory, [epic, task, doneSubtask, openSubtask, cancelledSubtask]);

        const result = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(result.exit._tag, "Success");
        const orderedSubtasks = [doneSubtask, openSubtask, cancelledSubtask].toSorted(
          compareTicketsForSelection,
        );
        const markerFor = (status: "open" | "done" | "cancelled"): string => {
          switch (status) {
            case "open":
              return "[ ]";
            case "done":
              return "[x]";
            case "cancelled":
              return "[-]";
          }
        };

        assert.deepStrictEqual(String(result.logs[0]).split("\n"), [
          `[/] ${epic.id}: ${epic.subject}`,
          `    └── [/] ${task.id}: ${task.subject}`,
          ...orderedSubtasks.map(
            (ticket, index) =>
              `        ${index === orderedSubtasks.length - 1 ? "└──" : "├──"} ${markerFor(ticket.status)} ${ticket.id}: ${ticket.subject}`,
          ),
        ]);
      }),
    ),
  );
});
