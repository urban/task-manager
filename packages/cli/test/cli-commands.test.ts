/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";

import {
  readTasksFile,
  writeTasksFile,
  claimTicket,
  createTicket,
  decodeTicketOutput,
  decodeValidateOutput,
  markCancelled,
  markDone,
  requireCancelledTicket,
  requireDoneTicket,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm cli commands", () => {
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
          ticketCount: 0,
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

  it.effect("creates a standalone Task with a canonical short ID and shows it", () =>
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

        const created = decodeTicketOutput(String(createResult.logs[0]));
        assert.strictEqual(created.ticket.schemaVersion, 3);
        assert.strictEqual(created.ticket.executor, "agent");
        assert.match(created.ticket.id, /^[a-z0-9]{6}$/);
        assert.isFalse(created.ticket.id.startsWith("wi_"));
        assert.isTrue((yield* readTasksFile(directory)).includes(`"id":"${created.ticket.id}"`));

        const showResult = yield* run(["--cwd", directory, "show", created.ticket.id]);
        assert.strictEqual(showResult.exit._tag, "Success");
        assert.isTrue(String(showResult.logs[0]).includes("Add CLI bootstrap"));
        assert.isTrue(String(showResult.logs[0]).includes("Executor: agent"));
        assert.isTrue(String(showResult.logs[0]).includes("Context"));
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

        const created = decodeTicketOutput(String(createResult.logs[0]));
        assert.strictEqual(created.ticket.subject, "Plan backlog tree");
        assert.strictEqual(created.ticket.description, "Create the initial Epic and Tasks.");
      }),
    ),
  );

  it.effect("updates Ticket Subject by unique prefix in JSON mode", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Update subject work");
        yield* TestClock.adjust("1 second");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id.slice(0, 5),
          "--subject",
          "Refine update subject",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const updated = decodeTicketOutput(String(result.logs[0])).ticket;

        assert.strictEqual(updated.id, ticket.id);
        assert.strictEqual(updated.subject, "Refine update subject");
        assert.strictEqual(updated.description, ticket.description);
        assert.strictEqual(updated.context, ticket.context);
        assert.strictEqual(updated.status, "open");
        assert.isAbove(
          DateTime.toEpochMillis(updated.updatedAt),
          DateTime.toEpochMillis(ticket.updatedAt),
        );
      }),
    ),
  );

  it.effect("changes executor only through set-executor", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Change executor field");

        const updateResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--executor",
          "human",
        ]);
        assert.strictEqual(updateResult.exit._tag, "Failure");

        const guardedResult = yield* run(["--cwd", directory, "set-executor", ticket.id, "human"]);
        assert.strictEqual(guardedResult.exit._tag, "Failure");
        assert.isTrue(String(guardedResult.errors[0]).includes("--allow-human"));

        yield* TestClock.adjust("1 second");
        const changedResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          ticket.id,
          "human",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(changedResult.exit._tag, "Success");
        const changed = decodeTicketOutput(String(changedResult.logs[0])).ticket;
        assert.strictEqual(changed.executor, "human");
        assert.strictEqual(changed.subject, ticket.subject);
        assert.strictEqual(changed.description, ticket.description);
        assert.strictEqual(changed.context, ticket.context);
        assert.isAbove(
          DateTime.toEpochMillis(changed.updatedAt),
          DateTime.toEpochMillis(ticket.updatedAt),
        );

        yield* TestClock.adjust("1 second");
        const noOpResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          ticket.id,
          "human",
          "--json",
        ]);
        assert.strictEqual(noOpResult.exit._tag, "Success");
        const noOp = decodeTicketOutput(String(noOpResult.logs[0])).ticket;
        assert.strictEqual(
          DateTime.toEpochMillis(noOp.updatedAt),
          DateTime.toEpochMillis(changed.updatedAt),
        );

        const agentResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          ticket.id,
          "agent",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(agentResult.exit._tag, "Success");
        assert.strictEqual(
          decodeTicketOutput(String(agentResult.logs[0])).ticket.executor,
          "agent",
        );

        const nextResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(nextResult.exit._tag, "Success");
        assert.strictEqual(decodeTicketOutput(String(nextResult.logs[0])).ticket.id, ticket.id);
      }),
    ),
  );

  it.effect("updates Description, Context, and message fields", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Update text fields");

        const descriptionResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--description",
          "Updated human-facing description.",
          "--json",
        ]);
        assert.strictEqual(descriptionResult.exit._tag, "Success");
        const descriptionUpdated = decodeTicketOutput(String(descriptionResult.logs[0])).ticket;
        assert.strictEqual(descriptionUpdated.description, "Updated human-facing description.");
        assert.strictEqual(descriptionUpdated.context, ticket.context);

        const contextResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--context",
          "Updated execution context.",
          "--json",
        ]);
        assert.strictEqual(contextResult.exit._tag, "Success");
        const contextUpdated = decodeTicketOutput(String(contextResult.logs[0])).ticket;
        assert.strictEqual(contextUpdated.description, "Updated human-facing description.");
        assert.strictEqual(contextUpdated.context, "Updated execution context.");

        const messageResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--message",
          "Retitle update work\n\nUpdated through message input.",
          "--json",
        ]);
        assert.strictEqual(messageResult.exit._tag, "Success");
        const messageUpdated = decodeTicketOutput(String(messageResult.logs[0])).ticket;
        assert.strictEqual(messageUpdated.subject, "Retitle update work");
        assert.strictEqual(messageUpdated.description, "Updated through message input.");
        assert.strictEqual(messageUpdated.context, "Updated execution context.");
      }),
    ),
  );

  it.effect("updates Ticket text from files", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Update from files");
        const fs = yield* FileSystem.FileSystem;
        const descriptionFile = `${directory}/description.md`;
        const contextFile = `${directory}/context.md`;
        const messageFile = `${directory}/message.md`;
        yield* fs.writeFileString(descriptionFile, "Description loaded from a file.");
        yield* fs.writeFileString(contextFile, "Context loaded from a file.");
        yield* fs.writeFileString(
          messageFile,
          "Retitle from file\n\nDescription loaded through message-file.",
        );

        const descriptionResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--description-file",
          descriptionFile,
          "--json",
        ]);
        assert.strictEqual(descriptionResult.exit._tag, "Success");
        const descriptionUpdated = decodeTicketOutput(String(descriptionResult.logs[0])).ticket;
        assert.strictEqual(descriptionUpdated.description, "Description loaded from a file.");

        const messageResult = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--message-file",
          messageFile,
          "--context-file",
          contextFile,
          "--json",
        ]);
        assert.strictEqual(messageResult.exit._tag, "Success");
        const messageUpdated = decodeTicketOutput(String(messageResult.logs[0])).ticket;
        assert.strictEqual(messageUpdated.subject, "Retitle from file");
        assert.strictEqual(messageUpdated.description, "Description loaded through message-file.");
        assert.strictEqual(messageUpdated.context, "Context loaded from a file.");
      }),
    ),
  );

  it.effect("allows explicit clearing of Description and Context", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Clear update fields");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--description",
          "",
          "--context",
          "",
          "--allow-empty-description",
          "--allow-empty-context",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const updated = decodeTicketOutput(String(result.logs[0])).ticket;
        assert.strictEqual(updated.subject, ticket.subject);
        assert.strictEqual(updated.description, "");
        assert.strictEqual(updated.context, "");
      }),
    ),
  );

  it.effect("rejects invalid update inputs without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Reject update inputs");
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
            args: ["update", ticket.id, "--subject", "bad subject."],
            expected: "Subject",
          },
          {
            args: ["update", ticket.id, "--description", ""],
            expected: "Description is required",
          },
          {
            args: ["update", ticket.id, "--context", ""],
            expected: "Context is required",
          },
          {
            args: ["update", ticket.id],
            expected: "At least one update field is required",
          },
          {
            args: [
              "update",
              ticket.id,
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
              ticket.id,
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
              ticket.id,
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

  it.effect("preserves metadata and updates done or cancelled Tickets", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Preserve update metadata");
        const dependency = yield* createTicket(directory, "Prepare metadata dependency");
        yield* run(["--cwd", directory, "block", ticket.id, "--by", dependency.id]);
        const claimed = yield* claimTicket(directory, ticket.id, "metadata-agent");
        const originalClaim = claimed.claim;
        if (originalClaim === undefined) {
          assert.fail("Expected claimed fixture to include a claim.");
        } else {
          const updateResult = yield* run([
            "--cwd",
            directory,
            "update",
            ticket.id,
            "--description",
            "Updated while preserving metadata.",
            "--json",
          ]);
          assert.strictEqual(updateResult.exit._tag, "Success");
          const updatedOpen = decodeTicketOutput(String(updateResult.logs[0])).ticket;
          const updatedClaim = updatedOpen.claim;
          if (updatedClaim === undefined) {
            assert.fail("Expected update to preserve the existing claim.");
          } else {
            assert.deepStrictEqual(updatedOpen.blockedBy, [dependency.id]);
            assert.strictEqual(updatedClaim.actor, originalClaim.actor);
            assert.strictEqual(
              DateTime.toEpochMillis(updatedClaim.claimedAt),
              DateTime.toEpochMillis(originalClaim.claimedAt),
            );
            assert.strictEqual(
              DateTime.toEpochMillis(updatedClaim.expiresAt),
              DateTime.toEpochMillis(originalClaim.expiresAt),
            );
            assert.strictEqual(updatedOpen.status, "open");

            const doneBase = yield* createTicket(directory, "Update done ticket");
            const cancelledBase = yield* createTicket(directory, "Update cancelled ticket");
            const doneTicket = yield* markDone(doneBase);
            const cancelledTicket = yield* markCancelled(cancelledBase);
            yield* writeTasksFile(directory, [
              updatedOpen,
              dependency,
              doneTicket,
              cancelledTicket,
            ]);

            const doneResult = yield* run([
              "--cwd",
              directory,
              "update",
              doneTicket.id,
              "--subject",
              "Refine done ticket",
              "--json",
            ]);
            assert.strictEqual(doneResult.exit._tag, "Success");
            const updatedDone = requireDoneTicket(
              decodeTicketOutput(String(doneResult.logs[0])).ticket,
            );
            assert.strictEqual(updatedDone.subject, "Refine done ticket");
            assert.strictEqual(updatedDone.result.summary, doneTicket.result.summary);
            assert.strictEqual(updatedDone.result.completedBy, doneTicket.result.completedBy);
            assert.strictEqual(
              DateTime.toEpochMillis(updatedDone.result.completedAt),
              DateTime.toEpochMillis(doneTicket.result.completedAt),
            );

            const cancellationResult = yield* run([
              "--cwd",
              directory,
              "update",
              cancelledTicket.id,
              "--context",
              "Corrected cancellation context.",
              "--json",
            ]);
            assert.strictEqual(cancellationResult.exit._tag, "Success");
            const updatedCancelled = requireCancelledTicket(
              decodeTicketOutput(String(cancellationResult.logs[0])).ticket,
            );
            assert.strictEqual(updatedCancelled.context, "Corrected cancellation context.");
            assert.strictEqual(
              updatedCancelled.cancellation.reason,
              cancelledTicket.cancellation.reason,
            );
            assert.strictEqual(
              updatedCancelled.cancellation.cancelledBy,
              cancelledTicket.cancellation.cancelledBy,
            );
            assert.strictEqual(
              DateTime.toEpochMillis(updatedCancelled.cancellation.cancelledAt),
              DateTime.toEpochMillis(cancelledTicket.cancellation.cancelledAt),
            );
          }
        }
      }),
    ),
  );

  it.effect("renders human output for updates", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Render update output");

        const result = yield* run([
          "--cwd",
          directory,
          "update",
          ticket.id,
          "--description",
          "Human output description.",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        assert.isTrue(String(result.logs[0]).includes("Updated Render update output"));
        assert.isTrue(String(result.logs[0]).includes(ticket.id));
      }),
    ),
  );
});
