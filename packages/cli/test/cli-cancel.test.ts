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
  decodeCancelOutput,
  decodeItemOutput,
  emptyConfigLayer,
  markCancelled,
  markDone,
  requireCancelledWorkItem,
  requireDoneWorkItem,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm cancel", () => {
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
          "--actor",
          "file-agent",
          "--reason-file",
          reasonFile,
          "--json",
        ]);
        assert.strictEqual(jsonCancel.exit._tag, "Success");
        const decoded = decodeCancelOutput(String(jsonCancel.logs[0]));
        const cancelled = requireCancelledWorkItem(decoded.item);
        assert.strictEqual(cancelled.id, fileTarget.id);
        assert.strictEqual(cancelled.claim, undefined);
        assert.strictEqual(cancelled.cancellation.reason, "Loaded cancellation reason.");
        assert.strictEqual(cancelled.cancellation.cancelledBy, "file-agent");
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

  it.effect("requires explicit allowance to cancel human-executor work", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const item = yield* createWorkItem(directory, "Cancel human review", {
          executor: "human",
        });

        const rejected = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
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
          item.id,
          "--actor",
          "human-urban",
          "--reason",
          "No longer needed",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const cancelled = decodeCancelOutput(String(allowed.logs[0])).item;
        assert.strictEqual(cancelled.status, "cancelled");
        assert.strictEqual(cancelled.executor, "human");
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
        assert.isTrue(String(missingAgent.errors[0]).includes("Actor Identity is required"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const missingReason = yield* run([
          "--cwd",
          directory,
          "cancel",
          item.id,
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
          item.id,
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
          item.id,
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
          decoded.cancelledItems.map((cancelledItem) => cancelledItem.id).toSorted(),
          [parent.id, firstOpenChild.id, secondOpenChild.id].toSorted(),
        );
        for (const cancelledItem of decoded.cancelledItems) {
          const cancelled = requireCancelledWorkItem(cancelledItem);
          assert.strictEqual(cancelled.claim, undefined);
          assert.strictEqual(cancelled.cancellation.reason, "Parent obsolete");
          assert.strictEqual(cancelled.cancellation.cancelledBy, "codex-session");
        }

        const doneShow = yield* run(["--cwd", directory, "show", doneChild.id, "--json"]);
        assert.strictEqual(doneShow.exit._tag, "Success");
        const persistedDoneChild = requireDoneWorkItem(
          decodeItemOutput(String(doneShow.logs[0])).item,
        );
        assert.strictEqual(
          DateTime.toEpochMillis(persistedDoneChild.updatedAt),
          DateTime.toEpochMillis(doneChild.updatedAt),
        );

        const cancelledShow = yield* run(["--cwd", directory, "show", cancelledChild.id, "--json"]);
        assert.strictEqual(cancelledShow.exit._tag, "Success");
        const persistedCancelledChild = requireCancelledWorkItem(
          decodeItemOutput(String(cancelledShow.logs[0])).item,
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
        const forcedChild = forcedOutput.cancelledItems.find(
          (cancelledItem) => cancelledItem.id === child.id,
        );
        if (forcedChild === undefined) {
          assert.fail("Expected forced cascade to cancel the claimed child.");
        } else {
          const cancelledChild = requireCancelledWorkItem(forcedChild);
          assert.strictEqual(cancelledChild.claim, undefined);
          assert.strictEqual(cancelledChild.cancellation.cancelledBy, "agent-b");
        }

        const expiredItem = yield* createWorkItem(directory, "Cancel expired claim");
        yield* claimWorkItem(directory, expiredItem.id, "agent-a");
        yield* TestClock.adjust("1 hour");
        const expiredResult = yield* run([
          "--cwd",
          directory,
          "cancel",
          expiredItem.id,
          "--actor",
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
          "--actor",
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
});
