/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";

import {
  readTasksFile,
  writeTasksFile,
  createTicket,
  decodeTicketOutput,
  makeFixtureOpenTicket,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm dependencies", () => {
  it.effect("creates a Ticket with one dependency in JSON mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const dependency = yield* createTicket(directory, "Create data model");

        const created = yield* createTicket(directory, "Add API endpoint", {
          blockedBy: [dependency.id],
        });

        assert.deepStrictEqual(created.blockedBy, [dependency.id]);
        const content = yield* readTasksFile(directory);
        assert.isTrue(content.includes('"blockedBy"'));
      }),
    ),
  );

  it.effect("creates a Ticket with repeatable dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstDependency = yield* createTicket(directory, "Create data model");
        const secondDependency = yield* createTicket(directory, "Prepare fixtures");
        const orderedDependencies =
          firstDependency.id.localeCompare(secondDependency.id) < 0
            ? { smaller: firstDependency, larger: secondDependency }
            : { smaller: secondDependency, larger: firstDependency };

        const created = yield* createTicket(directory, "Add reporting endpoint", {
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
        const dependency = yield* createTicket(directory, "Prepare reports");

        const created = yield* createTicket(directory, "Render reports", {
          blockedBy: [dependency.id.slice(0, 5)],
        });

        assert.deepStrictEqual(created.blockedBy, [dependency.id]);
      }),
    ),
  );

  it.effect("creates cross-hierarchy dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const firstEpic = yield* createTicket(directory, "Build backend", { level: "epic" });
        const secondEpic = yield* createTicket(directory, "Build frontend", { level: "epic" });
        const backendTask = yield* createTicket(directory, "Design schema", {
          parent: firstEpic.id,
        });
        const frontendTask = yield* createTicket(directory, "Create UI shell", {
          parent: secondEpic.id,
        });

        const subtask = yield* createTicket(directory, "Wire UI data", {
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

        const created = yield* createTicket(directory, "Add standalone work");

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
        yield* createTicket(directory, "Prepare existing work");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "Add dependent work",
          "--level",
          "task",
          "--blocked-by",
          "missing-dependency",
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
        const firstDependency = makeFixtureOpenTicket({
          id: "amb001",
          subject: "Prepare alpha",
          createdAt,
        });
        const secondDependency = makeFixtureOpenTicket({
          id: "amb002",
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
          "amb",
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
        const dependency = yield* createTicket(directory, "Prepare shared work");
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
          dependency.id.slice(0, 5),
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
        const target = yield* createTicket(directory, "Add API endpoint");
        const firstDependency = yield* createTicket(directory, "Create data model");
        const secondDependency = yield* createTicket(directory, "Prepare fixtures");
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
        const firstBlocked = decodeTicketOutput(String(firstBlockResult.logs[0]));
        assert.deepStrictEqual(firstBlocked.ticket.blockedBy, [orderedDependencies.larger.id]);

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
        const secondBlocked = decodeTicketOutput(String(secondBlockResult.logs[0]));
        assert.deepStrictEqual(secondBlocked.ticket.blockedBy, [
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
        const firstEpic = yield* createTicket(directory, "Build backend", { level: "epic" });
        const secondEpic = yield* createTicket(directory, "Build frontend", { level: "epic" });
        const backendTask = yield* createTicket(directory, "Design schema", {
          parent: firstEpic.id,
        });
        const frontendTask = yield* createTicket(directory, "Create UI shell", {
          parent: secondEpic.id,
        });
        const subtask = yield* createTicket(directory, "Wire UI data", {
          level: "subtask",
          parent: backendTask.id,
        });

        const blockResult = yield* run([
          "--cwd",
          directory,
          "block",
          subtask.id.slice(0, 5),
          "--by",
          frontendTask.id.slice(0, 5),
        ]);
        assert.strictEqual(blockResult.exit._tag, "Success");
        assert.isTrue(String(blockResult.logs[0]).includes("Blocked"));
        assert.isTrue(String(blockResult.logs[0]).includes(subtask.id));
        assert.isTrue(String(blockResult.logs[0]).includes(frontendTask.id));

        const showResult = yield* run(["--cwd", directory, "show", subtask.id, "--json"]);
        assert.strictEqual(showResult.exit._tag, "Success");
        const shown = decodeTicketOutput(String(showResult.logs[0]));
        assert.deepStrictEqual(shown.ticket.blockedBy, [frontendTask.id]);
      }),
    ),
  );

  it.effect("removes dependencies in JSON and human modes and omits empty blockedBy", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Add reporting");
        const dependency = yield* createTicket(directory, "Collect metrics");

        yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);
        const blockedContent = yield* readTasksFile(directory);
        assert.isTrue(blockedContent.includes('"blockedBy"'));

        const jsonUnblockResult = yield* run([
          "--cwd",
          directory,
          "unblock",
          ticket.id.slice(0, 5),
          "--by",
          dependency.id.slice(0, 5),
          "--json",
        ]);
        assert.strictEqual(jsonUnblockResult.exit._tag, "Success");
        const jsonUnblocked = decodeTicketOutput(String(jsonUnblockResult.logs[0]));
        assert.strictEqual(jsonUnblocked.ticket.blockedBy, undefined);

        yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);
        const humanUnblockResult = yield* run([
          "--cwd",
          directory,
          "unblock",
          ticket.id,
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
        const ticket = yield* createTicket(directory, "Implement gated path");
        const dependency = yield* createTicket(directory, "Approve gated path", {
          executor: "human",
        });
        yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);

        const rejected = yield* run([
          "--cwd",
          directory,
          "unblock",
          ticket.id,
          "--by",
          dependency.id,
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "unblock",
          ticket.id,
          "--by",
          dependency.id,
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const unblocked = decodeTicketOutput(String(allowed.logs[0])).ticket;
        assert.strictEqual(unblocked.blockedBy, undefined);
      }),
    ),
  );

  it.effect("rejects missing Ticket ids without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Add search");
        const before = yield* readTasksFile(directory);

        const missingTicketResult = yield* run([
          "--cwd",
          directory,
          "block",
          "missing-ticket",
          "--by",
          ticket.id,
        ]);
        assert.strictEqual(missingTicketResult.exit._tag, "Failure");
        assert.isTrue(String(missingTicketResult.errors[0]).includes("was not found"));

        const missingDependencyResult = yield* run([
          "--cwd",
          directory,
          "block",
          ticket.id,
          "--by",
          "missing-dependency",
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
        const ticket = yield* createTicket(directory, "Add audit log");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "block", ticket.id, "--by", ticket.id]);
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
        const ticket = yield* createTicket(directory, "Add alerts");
        const dependency = yield* createTicket(directory, "Add polling");
        yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);
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
        const firstTicket = yield* createTicket(directory, "Add importer");
        const secondTicket = yield* createTicket(directory, "Add parser");
        yield* run(["--cwd", directory, "block", secondTicket.id, "--by", firstTicket.id]);
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "block",
          firstTicket.id,
          "--by",
          secondTicket.id,
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Dependency cycle detected"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );
});
