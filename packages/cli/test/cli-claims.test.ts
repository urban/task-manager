/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import { TestClock } from "effect/testing";

import {
  readTasksFile,
  claimTicket,
  createTicket,
  decodeTicketOutput,
  emptyConfigLayer,
  run,
  withTempDirectory,
} from "./cli-test-support";

describe("tm claim and release", () => {
  it.effect("claims Tickets with actor flag in human and JSON modes", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Claim flag work");

        const humanResult = yield* run([
          "--cwd",
          directory,
          "claim",
          ticket.id,
          "--actor",
          "codex-session",
        ]);
        assert.strictEqual(humanResult.exit._tag, "Success");
        assert.isTrue(String(humanResult.logs[0]).includes("codex-session"));
        assert.isTrue(String(humanResult.logs[0]).includes("until"));

        yield* TestClock.adjust("10 minutes");
        const jsonResult = yield* run([
          "--cwd",
          directory,
          "claim",
          ticket.id,
          "--actor",
          "codex-session",
          "--json",
        ]);
        assert.strictEqual(jsonResult.exit._tag, "Success");
        const claimed = decodeTicketOutput(String(jsonResult.logs[0])).ticket;
        const claim = claimed.claim;
        if (claim === undefined) {
          assert.fail("Expected JSON claim output to include the persisted claim.");
        } else {
          assert.strictEqual(claim.actor, "codex-session");
          assert.strictEqual(
            DateTime.toEpochMillis(claim.expiresAt) - DateTime.toEpochMillis(claim.claimedAt),
            3_600_000,
          );
          assert.strictEqual(
            DateTime.toEpochMillis(claimed.updatedAt),
            DateTime.toEpochMillis(claim.claimedAt),
          );
        }
      }),
    ),
  );

  it.effect("requires explicit allowance to claim human-executor work", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Review claim handoff", {
          executor: "human",
        });

        const rejected = yield* run([
          "--cwd",
          directory,
          "claim",
          ticket.id,
          "--actor",
          "human-urban",
        ]);
        assert.strictEqual(rejected.exit._tag, "Failure");
        assert.isTrue(String(rejected.errors[0]).includes("Pass --allow-human"));

        const allowed = yield* claimTicket(directory, ticket.id, "human-urban", {
          allowHuman: true,
        });
        assert.strictEqual(allowed.claim?.actor, "human-urban");
      }),
    ),
  );

  it.effect("claims Tickets with TM_ACTOR fallback", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Claim env work");
        const result = yield* run(["--cwd", directory, "claim", ticket.id, "--json"]).pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TM_ACTOR: "env-agent",
              }),
            ),
          ),
        );

        assert.strictEqual(result.exit._tag, "Success");
        const claimed = decodeTicketOutput(String(result.logs[0])).ticket;
        const claim = claimed.claim;
        if (claim === undefined) {
          assert.fail("Expected TM_ACTOR claim output to include the persisted claim.");
        } else {
          assert.strictEqual(claim.actor, "env-agent");
        }
      }),
    ),
  );

  it.effect("rejects missing and blank Actor Identity", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Require claim actor");
        const before = yield* readTasksFile(directory);

        const missingResult = yield* run(["--cwd", directory, "claim", ticket.id]).pipe(
          Effect.provide(emptyConfigLayer),
        );
        assert.strictEqual(missingResult.exit._tag, "Failure");
        assert.isTrue(String(missingResult.errors[0]).includes("Actor Identity is required"));

        const blankResult = yield* run(["--cwd", directory, "claim", ticket.id, "--actor", "   "]);
        assert.strictEqual(blankResult.exit._tag, "Failure");
        assert.isTrue(String(blankResult.errors[0]).includes("must not be empty"));

        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("refreshes same-actor claims", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Refresh claim work");
        const firstClaimed = yield* claimTicket(directory, ticket.id, "codex-session");
        yield* TestClock.adjust("10 minutes");
        const refreshed = yield* claimTicket(directory, ticket.id, "codex-session");

        const firstClaim = firstClaimed.claim;
        const refreshedClaim = refreshed.claim;
        if (firstClaim === undefined || refreshedClaim === undefined) {
          assert.fail("Expected both claim writes to include claims.");
        } else {
          assert.strictEqual(refreshedClaim.actor, "codex-session");
          assert.isAbove(
            DateTime.toEpochMillis(refreshedClaim.claimedAt),
            DateTime.toEpochMillis(firstClaim.claimedAt),
          );
          assert.isAbove(
            DateTime.toEpochMillis(refreshedClaim.expiresAt),
            DateTime.toEpochMillis(firstClaim.expiresAt),
          );
          assert.strictEqual(
            DateTime.toEpochMillis(refreshed.updatedAt),
            DateTime.toEpochMillis(refreshedClaim.claimedAt),
          );
        }
      }),
    ),
  );

  it.effect("rejects other-actor active claim replacement without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Protect active claim");
        yield* claimTicket(directory, ticket.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "claim", ticket.id, "--actor", "agent-b"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("actively claimed by agent-a"));
        assert.isTrue(String(result.errors[0]).includes("--force"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);
      }),
    ),
  );

  it.effect("force replaces another active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Force claim work");
        yield* claimTicket(directory, ticket.id, "agent-a");
        yield* TestClock.adjust("1 minute");

        const replaced = yield* claimTicket(directory, ticket.id, "agent-b", { force: true });
        const claim = replaced.claim;
        if (claim === undefined) {
          assert.fail("Expected force replacement to persist a claim.");
        } else {
          assert.strictEqual(claim.actor, "agent-b");
        }
      }),
    ),
  );

  it.effect("replaces expired claims without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Replace expired claim");
        yield* claimTicket(directory, ticket.id, "agent-a");
        yield* TestClock.adjust("1 hour");

        const replaced = yield* claimTicket(directory, ticket.id, "agent-b");
        const claim = replaced.claim;
        if (claim === undefined) {
          assert.fail("Expected expired claim replacement to persist a claim.");
        } else {
          assert.strictEqual(claim.actor, "agent-b");
        }
      }),
    ),
  );

  it.effect("releases own claims and fails clearly when no claim exists", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Release own claim");
        const claimed = yield* claimTicket(directory, ticket.id, "agent-a");

        const missingAgentResult = yield* run(["--cwd", directory, "release", ticket.id]).pipe(
          Effect.provide(emptyConfigLayer),
        );
        assert.strictEqual(missingAgentResult.exit._tag, "Failure");
        assert.isTrue(String(missingAgentResult.errors[0]).includes("Actor Identity is required"));

        yield* TestClock.adjust("1 minute");
        const releaseResult = yield* run([
          "--cwd",
          directory,
          "release",
          ticket.id,
          "--actor",
          "agent-a",
          "--json",
        ]);
        assert.strictEqual(releaseResult.exit._tag, "Success");
        const released = decodeTicketOutput(String(releaseResult.logs[0])).ticket;
        assert.strictEqual(released.claim, undefined);
        assert.isAbove(
          DateTime.toEpochMillis(released.updatedAt),
          DateTime.toEpochMillis(claimed.updatedAt),
        );

        const duplicateReleaseResult = yield* run([
          "--cwd",
          directory,
          "release",
          ticket.id,
          "--actor",
          "agent-a",
        ]);
        assert.strictEqual(duplicateReleaseResult.exit._tag, "Failure");
        assert.isTrue(String(duplicateReleaseResult.errors[0]).includes("has no claim to release"));
      }),
    ),
  );

  it.effect("requires force to release another active claim", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Protect release claim");
        yield* claimTicket(directory, ticket.id, "agent-a");
        const before = yield* readTasksFile(directory);

        const result = yield* run(["--cwd", directory, "release", ticket.id, "--actor", "agent-b"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("actively claimed by agent-a"));
        assert.isTrue(String(result.errors[0]).includes("--force"));
        const after = yield* readTasksFile(directory);
        assert.strictEqual(after, before);

        const forcedResult = yield* run([
          "--cwd",
          directory,
          "release",
          ticket.id,
          "--actor",
          "agent-b",
          "--force",
          "--json",
        ]);
        assert.strictEqual(forcedResult.exit._tag, "Success");
        const released = decodeTicketOutput(String(forcedResult.logs[0])).ticket;
        assert.strictEqual(released.claim, undefined);
      }),
    ),
  );

  it.effect("lets another agent release expired claims without force", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Release expired claim");
        yield* claimTicket(directory, ticket.id, "agent-a");
        yield* TestClock.adjust("1 hour");

        const result = yield* run([
          "--cwd",
          directory,
          "release",
          ticket.id,
          "--actor",
          "agent-b",
          "--json",
        ]);
        assert.strictEqual(result.exit._tag, "Success");
        const released = decodeTicketOutput(String(result.logs[0])).ticket;
        assert.strictEqual(released.claim, undefined);
      }),
    ),
  );
});
