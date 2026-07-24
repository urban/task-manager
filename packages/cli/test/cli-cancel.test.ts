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
  decodeCancelOutput,
  decodeTicketOutput,
  emptyConfigLayer,
  markCancelled,
  markDone,
  requireCancelledTicket,
  requireDoneTicket,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm cancel", () => {
  it.effect("cancels leaf Tickets and exposes lifecycle filters", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const cancelTarget = yield* createTicket(directory, "Cancel obsolete work");
        const doneBase = yield* createTicket(directory, "Keep done work");
        const openTicket = yield* createTicket(directory, "Keep open work");
        const doneTicket = yield* markDone(doneBase);
        yield* writeTasksFile(directory, [cancelTarget, doneTicket, openTicket]);

        const humanCancel = yield* run([
          "--cwd",
          directory,
          "cancel",
          cancelTarget.id,
          "--actor",
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
        assert.isTrue(String(defaultList.logs[0]).includes(openTicket.subject));
        assert.isTrue(String(defaultList.logs[0]).includes(cancelTarget.subject));
        assert.isTrue(String(defaultList.logs[0]).includes(doneTicket.subject));

        const cancelledList = yield* run(["--cwd", directory, "list", "--status", "cancelled"]);
        assert.strictEqual(cancelledList.exit._tag, "Success");
        assert.isTrue(String(cancelledList.logs[0]).includes(cancelTarget.subject));
        assert.isFalse(String(cancelledList.logs[0]).includes(openTicket.subject));
        assert.isFalse(String(cancelledList.logs[0]).includes(doneTicket.subject));

        const doneList = yield* run(["--cwd", directory, "list", "--status", "done"]);
        assert.strictEqual(doneList.exit._tag, "Success");
        assert.isTrue(String(doneList.logs[0]).includes(doneTicket.subject));
        assert.isFalse(String(doneList.logs[0]).includes(cancelTarget.subject));
        assert.isFalse(String(doneList.logs[0]).includes(openTicket.subject));

        const allList = yield* run(["--cwd", directory, "list", "--all"]);
        assert.strictEqual(allList.exit._tag, "Success");
        assert.isTrue(String(allList.logs[0]).includes(cancelTarget.subject));
        assert.isTrue(String(allList.logs[0]).includes(doneTicket.subject));
        assert.isTrue(String(allList.logs[0]).includes(openTicket.subject));

        const fileTarget = yield* createTicket(directory, "Cancel from file");
        const fs = yield* FileSystem.FileSystem;
        const reasonFile = `${directory}/cancel-reason.txt`;
        yield* fs.writeFileString(reasonFile, "Loaded cancellation reason.\n");

        const jsonCancel = yield* run([
          "--cwd",
          directory,
          "cancel",
          fileTarget.id,
          "--actor",
          "file-agent",
          "--reason-file",
          reasonFile,
          "--json",
        ]);
        assert.strictEqual(jsonCancel.exit._tag, "Success");
        const decoded = decodeCancelOutput(String(jsonCancel.logs[0]));
        const cancelled = requireCancelledTicket(decoded.ticket);
        assert.strictEqual(cancelled.id, fileTarget.id);
        assert.strictEqual(cancelled.claim, undefined);
        assert.strictEqual(cancelled.cancellation.reason, "Loaded cancellation reason.");
        assert.strictEqual(cancelled.cancellation.cancelledBy, "file-agent");
        const [cancelledOutputTicket] = decoded.cancelledTickets;
        if (cancelledOutputTicket === undefined) {
          assert.fail("Expected JSON cancellation output to include cancelledTickets.");
        } else {
          assert.strictEqual(decoded.cancelledTickets.length, 1);
          assert.strictEqual(cancelledOutputTicket.id, fileTarget.id);
        }
      }),
    ),
  );

  it.effect("requires explicit allowance to cancel human-executor work", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Cancel human review", {
          executor: "human",
        });

        const rejected = yield* run([
          "--cwd",
          directory,
          "cancel",
          ticket.id,
          "--actor",
          "human-urban",
          "--reason",
          "No longer needed",
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "cancel",
          ticket.id,
          "--actor",
          "human-urban",
          "--reason",
          "No longer needed",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const cancelled = decodeCancelOutput(String(allowed.logs[0])).ticket;
        assert.strictEqual(cancelled.status, "cancelled");
        assert.strictEqual(cancelled.executor, "human");
      }),
    ),
  );

  it.effect("rejects invalid cancellation inputs without changing storage", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Reject cancellation inputs");
        const fs = yield* FileSystem.FileSystem;
        const reasonFile = `${directory}/cancel-reason.txt`;
        yield* fs.writeFileString(reasonFile, "Reason from file.");
        const before = yield* readTasksFile(directory);

        const missingAgent = yield* run([
          "--cwd",
          directory,
          "cancel",
          ticket.id,
          "--reason",
          "No agent supplied",
        ]).pipe(Effect.provide(emptyConfigLayer));
        assert.strictEqual(missingAgent.exit._tag, "Failure");
        assert.isTrue(String(missingAgent.errors[0]).includes("Actor Identity is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const missingReason = yield* run([
          "--cwd",
          directory,
          "cancel",
          ticket.id,
          "--actor",
          "codex-session",
        ]);
        assert.strictEqual(missingReason.exit._tag, "Failure");
        assert.isTrue(String(missingReason.errors[0]).includes("Cancellation reason is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const blankReason = yield* run([
          "--cwd",
          directory,
          "cancel",
          ticket.id,
          "--actor",
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
          ticket.id,
          "--actor",
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
        const parent = yield* createTicket(directory, "Cancel parent work");
        const firstOpenChild = yield* createTicket(directory, "Cancel first child", {
          level: "subtask",
          parent: parent.id,
        });
        const secondOpenChild = yield* createTicket(directory, "Cancel second child", {
          level: "subtask",
          parent: parent.id,
        });
        const doneChildBase = yield* createTicket(directory, "Keep done child", {
          level: "subtask",
          parent: parent.id,
        });
        const cancelledChildBase = yield* createTicket(directory, "Keep cancelled child", {
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
          "--actor",
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
          "--actor",
          "codex-session",
          "--reason",
          "Parent obsolete",
          "--yes",
          "--json",
        ]);
        assert.strictEqual(cascade.exit._tag, "Success");
        const decoded = decodeCancelOutput(String(cascade.logs[0]));
        assert.deepStrictEqual(
          decoded.cancelledTickets.map((cancelledTicket) => cancelledTicket.id).toSorted(),
          [parent.id, firstOpenChild.id, secondOpenChild.id].toSorted(),
        );
        for (const cancelledTicket of decoded.cancelledTickets) {
          const cancelled = requireCancelledTicket(cancelledTicket);
          assert.strictEqual(cancelled.claim, undefined);
          assert.strictEqual(cancelled.cancellation.reason, "Parent obsolete");
          assert.strictEqual(cancelled.cancellation.cancelledBy, "codex-session");
        }

        const doneShow = yield* run(["--cwd", directory, "show", doneChild.id, "--json"]);
        assert.strictEqual(doneShow.exit._tag, "Success");
        const persistedDoneChild = requireDoneTicket(
          decodeTicketOutput(String(doneShow.logs[0])).ticket,
        );
        assert.strictEqual(
          DateTime.toEpochMillis(persistedDoneChild.updatedAt),
          DateTime.toEpochMillis(doneChild.updatedAt),
        );

        const cancelledShow = yield* run(["--cwd", directory, "show", cancelledChild.id, "--json"]);
        assert.strictEqual(cancelledShow.exit._tag, "Success");
        const persistedCancelledChild = requireCancelledTicket(
          decodeTicketOutput(String(cancelledShow.logs[0])).ticket,
        );
        assert.strictEqual(
          persistedCancelledChild.cancellation.reason,
          cancelledChild.cancellation.reason,
        );
        assert.strictEqual(
          persistedCancelledChild.cancellation.cancelledBy,
          cancelledChild.cancellation.cancelledBy,
        );
        assert.strictEqual(
          DateTime.toEpochMillis(persistedCancelledChild.cancellation.cancelledAt),
          DateTime.toEpochMillis(cancelledChild.cancellation.cancelledAt),
        );
      }),
    ),
  );

  it.effect("enforces cancellation claim conflicts and clears claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createTicket(directory, "Cancel claimed parent");
        const child = yield* createTicket(directory, "Cancel claimed child", {
          level: "subtask",
          parent: parent.id,
        });
        yield* claimTicket(directory, child.id, "agent-a");
        const beforeConflict = yield* readTasksFile(directory);

        const conflict = yield* run([
          "--cwd",
          directory,
          "cancel",
          parent.id,
          "--actor",
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
          "--actor",
          "agent-b",
          "--reason",
          "Claimed child obsolete",
          "--yes",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const forcedOutput = decodeCancelOutput(String(forced.logs[0]));
        const forcedChild = forcedOutput.cancelledTickets.find(
          (cancelledTicket) => cancelledTicket.id === child.id,
        );
        if (forcedChild === undefined) {
          assert.fail("Expected forced cascade to cancel the claimed child.");
        } else {
          const cancelledChild = requireCancelledTicket(forcedChild);
          assert.strictEqual(cancelledChild.claim, undefined);
          assert.strictEqual(cancelledChild.cancellation.cancelledBy, "agent-b");
        }

        const expiredTicket = yield* createTicket(directory, "Cancel expired claim");
        yield* claimTicket(directory, expiredTicket.id, "agent-a");
        yield* TestClock.adjust("1 hour");
        const expiredResult = yield* run([
          "--cwd",
          directory,
          "cancel",
          expiredTicket.id,
          "--actor",
          "agent-b",
          "--reason",
          "Expired claim is stale",
          "--json",
        ]);
        assert.strictEqual(expiredResult.exit._tag, "Success");
        const expiredCancelled = decodeCancelOutput(String(expiredResult.logs[0])).ticket;
        assert.strictEqual(expiredCancelled.status, "cancelled");
        assert.strictEqual(expiredCancelled.claim, undefined);

        const ownClaimTicket = yield* createTicket(directory, "Cancel own claim");
        yield* claimTicket(directory, ownClaimTicket.id, "agent-c");
        const ownClaimResult = yield* run([
          "--cwd",
          directory,
          "cancel",
          ownClaimTicket.id,
          "--actor",
          "agent-c",
          "--reason",
          "Owner stopped work",
          "--json",
        ]);
        assert.strictEqual(ownClaimResult.exit._tag, "Success");
        const ownCancelled = decodeCancelOutput(String(ownClaimResult.logs[0])).ticket;
        assert.strictEqual(ownCancelled.claim, undefined);
      }),
    ),
  );
});
