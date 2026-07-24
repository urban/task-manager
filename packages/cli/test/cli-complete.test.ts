/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";

import {
  readTasksFile,
  claimTicket,
  createTicket,
  decodeTicketOutput,
  emptyConfigLayer,
  requireDoneTicket,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm complete", () => {
  it.effect("completes Tickets with structured flags and clears same-actor claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Complete structured work");
        const claimed = yield* claimTicket(directory, ticket.id, "codex-session");
        yield* TestClock.adjust("1 minute");

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "Added complete command",
          "--details",
          "Implemented the lifecycle transition and tests.",
          "--decision",
          "Used structured Result storage",
          "--decision",
          "Cleared claims on completion",
          "--verification",
          "bun run test: passed",
          "--verification",
          "bun run typecheck: passed",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(result.logs[0])).ticket);

        assert.strictEqual(completed.status, "done");
        assert.strictEqual(completed.claim, undefined);
        assert.isAbove(
          DateTime.toEpochMillis(completed.updatedAt),
          DateTime.toEpochMillis(claimed.updatedAt),
        );
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Added complete command");
          assert.strictEqual(
            completionResult.details,
            "Implemented the lifecycle transition and tests.",
          );
          assert.deepStrictEqual(completionResult.decisions, [
            "Used structured Result storage",
            "Cleared claims on completion",
          ]);
          assert.deepStrictEqual(completionResult.verification, [
            "bun run test: passed",
            "bun run typecheck: passed",
          ]);
          assert.strictEqual(completionResult.completedBy, "codex-session");
          assert.strictEqual(
            DateTime.toEpochMillis(completionResult.completedAt),
            DateTime.toEpochMillis(completed.updatedAt),
          );
        }
      }),
    ),
  );

  it.effect("requires explicit allowance to complete human-executor work", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Approve release plan", {
          executor: "human",
        });

        const rejected = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "human-urban",
          "--summary",
          "Approved release plan",
          "--verification",
          "Reviewed by human",
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "human-urban",
          "--summary",
          "Approved release plan",
          "--verification",
          "Reviewed by human",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(allowed.logs[0])).ticket);
        assert.strictEqual(completed.status, "done");
        assert.strictEqual(completed.executor, "human");
      }),
    ),
  );

  it.effect("parses Git-style result-message input", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Complete message work");

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--result-message",
          "Add login endpoint\n\nImplemented route and tests.\n\nDecisions:\n- Return generic 401\n\nVerification:\n- bun run check: passed",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(result.logs[0])).ticket);
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected result-message completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Add login endpoint");
          assert.strictEqual(completionResult.details, "Implemented route and tests.");
          assert.deepStrictEqual(completionResult.decisions, ["Return generic 401"]);
          assert.deepStrictEqual(completionResult.verification, ["bun run check: passed"]);
        }
      }),
    ),
  );

  it.effect("completes from --result-message-file and TM_ACTOR", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Complete file work");
        const fs = yield* FileSystem.FileSystem;
        const messageFile = `${directory}/result-message.txt`;
        yield* fs.writeFileString(
          messageFile,
          "Document file result\n\nCompleted using a message file.\n\nVerification:\n- bun run test: passed",
        );

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--result-message-file",
          messageFile,
          "--json",
        ]).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TM_ACTOR: "file-agent",
              }),
            ),
          ),
        );
        assert.strictEqual(result.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(result.logs[0])).ticket);
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected file completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.summary, "Document file result");
          assert.strictEqual(completionResult.details, "Completed using a message file.");
          assert.deepStrictEqual(completionResult.verification, ["bun run test: passed"]);
          assert.strictEqual(completionResult.completedBy, "file-agent");
        }
      }),
    ),
  );

  it.effect("rejects complete without Actor Identity", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Require complete agent");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--summary",
          "Implemented complete work",
          "--verification",
          "bun run test: passed",
        ]).pipe(Effect.provide(emptyConfigLayer));
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Actor Identity is required"));

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("rejects complete without a summary", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Require result summary");
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Result summary is required"));

        const afterMissing = yield* readTasksFile(directory);
        assert.strictEqual(afterMissing, before);

        const vagueResult = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "done",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(vagueResult.exit._tag, "Failure");
        assert.isTrue(String(vagueResult.errors[0]).includes("describe what changed"));

        const afterVague = yield* readTasksFile(directory);
        assert.strictEqual(afterVague, before);
      }),
    ),
  );

  it.effect("requires verification unless --allow-no-verification is used", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Allow missing verification");
        const before = yield* readTasksFile(directory);

        const missingVerification = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed without evidence",
        ]);
        assert.strictEqual(missingVerification.exit._tag, "Failure");
        assert.isTrue(String(missingVerification.errors[0]).includes("Verification evidence"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forcedWithoutVerification = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed without evidence",
          "--force",
        ]);
        assert.strictEqual(forcedWithoutVerification.exit._tag, "Failure");
        assert.isTrue(
          String(forcedWithoutVerification.errors[0]).includes("Verification evidence"),
        );
        assert.strictEqual(yield* readTasksFile(directory), before);

        const allowed = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed with explicit escape hatch",
          "--allow-no-verification",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(allowed.logs[0])).ticket);
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected allow-no-verification to still persist a Result.");
        } else {
          assert.deepStrictEqual(completionResult.verification, []);
        }
      }),
    ),
  );

  it.effect("rejects completing parents with open children", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const parent = yield* createTicket(directory, "Complete parent work");
        yield* createTicket(directory, "Keep child open", {
          level: "subtask",
          parent: parent.id,
        });
        const before = yield* readTasksFile(directory);

        const result = yield* run([
          "--cwd",
          directory,
          "complete",
          parent.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed parent work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("open children"));
        assert.strictEqual(yield* readTasksFile(directory), before);
      }),
    ),
  );

  it.effect("requires force to complete with incomplete dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createTicket(directory, "Complete blocked work");
        const dependency = yield* createTicket(directory, "Leave dependency open");
        yield* run(["--cwd", directory, "block", target.id, "--by", dependency.id]);
        const before = yield* readTasksFile(directory);

        const blocked = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed blocked work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(blocked.exit._tag, "Failure");
        assert.isTrue(String(blocked.errors[0]).includes("incomplete dependencies"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forced = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed blocked work intentionally",
          "--verification",
          "Manual dependency review: obsolete",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(forced.logs[0])).ticket);
        assert.strictEqual(completed.status, "done");
        assert.deepStrictEqual(completed.blockedBy, [dependency.id]);
      }),
    ),
  );

  it.effect("requires explicit allowance to force past human dependencies", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const target = yield* createTicket(directory, "Finish gated work");
        const dependency = yield* createTicket(directory, "Approve gated work", {
          executor: "human",
        });
        yield* run(["--cwd", directory, "block", target.id, "--by", dependency.id]);

        const rejected = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--actor",
          "codex-session",
          "--summary",
          "Finished gated work",
          "--verification",
          "Human approval was bypassed intentionally",
          "--force",
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* run([
          "--cwd",
          directory,
          "complete",
          target.id,
          "--actor",
          "codex-session",
          "--summary",
          "Finished gated work",
          "--verification",
          "Human approval was bypassed intentionally",
          "--force",
          "--allow-human",
          "--json",
        ]);
        assert.strictEqual(allowed.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(allowed.logs[0])).ticket);
        assert.strictEqual(completed.status, "done");
      }),
    ),
  );

  it.effect("requires force to complete another actor's active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Protect complete claim");
        yield* claimTicket(directory, ticket.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const conflict = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "agent-b",
          "--summary",
          "Completed claimed work",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(conflict.exit._tag, "Failure");
        assert.isTrue(String(conflict.errors[0]).includes("actively claimed by agent-a"));
        assert.strictEqual(yield* readTasksFile(directory), before);

        const forced = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "agent-b",
          "--summary",
          "Completed claimed work with takeover",
          "--verification",
          "bun run test: passed",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forced.exit._tag, "Success");
        const completed = requireDoneTicket(decodeTicketOutput(String(forced.logs[0])).ticket);
        assert.strictEqual(completed.claim, undefined);
        const completionResult = completed.result;
        if (completionResult === undefined) {
          assert.fail("Expected forced completion to persist a Result.");
        } else {
          assert.strictEqual(completionResult.completedBy, "agent-b");
        }
      }),
    ),
  );

  it.effect("completed Tickets remain visible by default and render Result in show", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Hide completed work");

        const completeResult = yield* run([
          "--cwd",
          directory,
          "complete",
          ticket.id,
          "--actor",
          "codex-session",
          "--summary",
          "Completed list filtering",
          "--verification",
          "bun run test: passed",
        ]);
        assert.strictEqual(completeResult.exit._tag, "Success");
        assert.isTrue(String(completeResult.logs[0]).includes("Summary: Completed list filtering"));
        assert.isTrue(String(completeResult.logs[0]).includes("- bun run test: passed"));

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Success");
        assert.strictEqual(String(listResult.logs[0]), `[x] ${ticket.id}: ${ticket.subject}`);

        const showResult = yield* run(["--cwd", directory, "show", ticket.id]);
        assert.strictEqual(showResult.exit._tag, "Success");
        const output = String(showResult.logs[0]);
        assert.isTrue(output.includes("Status: done"));
        assert.isTrue(output.includes("Summary: Completed list filtering"));
        assert.isTrue(output.includes("Verification:"));
        assert.isTrue(output.includes("- bun run test: passed"));
      }),
    ),
  );
});
