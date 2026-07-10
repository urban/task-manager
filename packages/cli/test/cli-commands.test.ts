/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";

import {
  readTasksFile,
  writeTasksFile,
  claimWorkItem,
  createWorkItem,
  decodeItemOutput,
  decodeValidateOutput,
  markCancelled,
  markDone,
  requireCancelledWorkItem,
  requireDoneWorkItem,
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
        assert.strictEqual(created.item.schemaVersion, 3);
        assert.strictEqual(created.item.executor, "agent");
        const prefix = created.item.id.slice(0, 12);

        const showResult = yield* run(["--cwd", directory, "show", prefix]);
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
        assert.strictEqual(updated.context, item.context);
        assert.strictEqual(updated.status, "open");
        assert.isAbove(
          DateTime.toEpochMillis(updated.updatedAt),
          DateTime.toEpochMillis(item.updatedAt),
        );
      }),
    ),
  );

  it.effect("changes executor only through set-executor", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Change executor field");

        const updateResult = yield* run([
          "--cwd",
          directory,
          "update",
          item.id,
          "--executor",
          "human",
        ]);
        assert.strictEqual(updateResult.exit._tag, "Failure");

        const guardedResult = yield* run(["--cwd", directory, "set-executor", item.id, "human"]);
        assert.strictEqual(guardedResult.exit._tag, "Failure");
        assert.isTrue(String(guardedResult.errors[0]).includes("--allow-human"));

        yield* TestClock.adjust("1 second");
        const changedResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          item.id,
          "human",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(changedResult.exit._tag, "Success");
        const changed = decodeItemOutput(String(changedResult.logs[0])).item;
        assert.strictEqual(changed.executor, "human");
        assert.strictEqual(changed.subject, item.subject);
        assert.strictEqual(changed.description, item.description);
        assert.strictEqual(changed.context, item.context);
        assert.isAbove(
          DateTime.toEpochMillis(changed.updatedAt),
          DateTime.toEpochMillis(item.updatedAt),
        );

        yield* TestClock.adjust("1 second");
        const noOpResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          item.id,
          "human",
          "--json",
        ]);
        assert.strictEqual(noOpResult.exit._tag, "Success");
        const noOp = decodeItemOutput(String(noOpResult.logs[0])).item;
        assert.strictEqual(
          DateTime.toEpochMillis(noOp.updatedAt),
          DateTime.toEpochMillis(changed.updatedAt),
        );

        const agentResult = yield* run([
          "--cwd",
          directory,
          "set-executor",
          item.id,
          "agent",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(agentResult.exit._tag, "Success");
        assert.strictEqual(decodeItemOutput(String(agentResult.logs[0])).item.executor, "agent");

        const nextResult = yield* run(["--cwd", directory, "next", "--json"]);
        assert.strictEqual(nextResult.exit._tag, "Success");
        assert.strictEqual(decodeItemOutput(String(nextResult.logs[0])).item.id, item.id);
      }),
    ),
  );

  it.effect("updates Description, Context, and message fields", () =>
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
        assert.strictEqual(descriptionUpdated.context, item.context);

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
        assert.strictEqual(contextUpdated.context, "Updated execution context.");

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
        assert.strictEqual(messageUpdated.context, "Updated execution context.");
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
        yield* fs.writeFileString(contextFile, "Context loaded from a file.");
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
        assert.strictEqual(messageUpdated.context, "Context loaded from a file.");
      }),
    ),
  );

  it.effect("allows explicit clearing of Description and Context", () =>
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
        assert.strictEqual(updated.context, "");
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
            expected: "Context is required",
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
            const updatedDone = requireDoneWorkItem(
              decodeItemOutput(String(doneResult.logs[0])).item,
            );
            assert.strictEqual(updatedDone.subject, "Refine done item");
            assert.strictEqual(updatedDone.result.summary, doneItem.result.summary);
            assert.strictEqual(updatedDone.result.completedBy, doneItem.result.completedBy);
            assert.strictEqual(
              DateTime.toEpochMillis(updatedDone.result.completedAt),
              DateTime.toEpochMillis(doneItem.result.completedAt),
            );

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
            const updatedCancelled = requireCancelledWorkItem(
              decodeItemOutput(String(cancellationResult.logs[0])).item,
            );
            assert.strictEqual(updatedCancelled.context, "Corrected cancellation context.");
            assert.strictEqual(
              updatedCancelled.cancellation.reason,
              cancelledItem.cancellation.reason,
            );
            assert.strictEqual(
              updatedCancelled.cancellation.cancelledBy,
              cancelledItem.cancellation.cancelledBy,
            );
            assert.strictEqual(
              DateTime.toEpochMillis(updatedCancelled.cancellation.cancelledAt),
              DateTime.toEpochMillis(cancelledItem.cancellation.cancelledAt),
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
});
