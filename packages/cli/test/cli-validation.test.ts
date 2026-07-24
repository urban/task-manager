/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ConfigProvider from "effect/ConfigProvider";
import * as FileSystem from "effect/FileSystem";

import { encodeTicketJsonLine } from "../src/domain/Ticket";
import { createTicket, readTasksFile, run, withTempDirectory } from "./cli-test-support";

describe("tm validation and compatibility", () => {
  it.effect("rejects removed mode and agent compatibility inputs", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const modeResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Reject legacy mode",
          "--mode",
          "agent",
          "--description",
          "Legacy input must fail.",
          "--context",
          "No compatibility aliases are supported.",
        ]);
        assert.strictEqual(modeResult.exit._tag, "Failure");

        const ticket = yield* createTicket(directory, "Reject legacy actor");
        const agentResult = yield* run([
          "--cwd",
          directory,
          "claim",
          ticket.id,
          "--agent",
          "legacy-agent",
        ]);
        assert.strictEqual(agentResult.exit._tag, "Failure");

        const environmentResult = yield* run(["--cwd", directory, "claim", ticket.id]).pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown({ TM_AGENT: "legacy-agent" })),
          ),
        );
        assert.strictEqual(environmentResult.exit._tag, "Failure");
        assert.isTrue(String(environmentResult.errors[0]).includes("TM_ACTOR"));
      }),
    ),
  );

  it.effect("rejects invalid lifecycle storage variants", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        yield* createTicket(directory, "Validate lifecycle variants");
        const validLine = yield* readTasksFile(directory);
        const result =
          '"result":{"summary":"Invalid","details":"","decisions":[],"verification":[],"completedAt":"2026-01-01T00:00:00.000Z","completedBy":"test"},';
        const invalidLines = [
          validLine.replace('"createdAt"', `${result}"createdAt"`),
          validLine.replace('"status":"open"', '"status":"done"'),
          validLine.replace('"status":"open"', '"status":"cancelled"'),
        ];
        const fs = yield* FileSystem.FileSystem;

        for (const invalidLine of invalidLines) {
          yield* fs.writeFileString(`${directory}/.tasks/tasks.jsonl`, invalidLine);
          const validateResult = yield* run(["--cwd", directory, "validate"]);
          assert.strictEqual(validateResult.exit._tag, "Failure");
        }
      }),
    ),
  );

  it.effect("rejects v2 records with manual-edit guidance", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const fs = yield* FileSystem.FileSystem;
        const v2Line =
          '{"schemaVersion":2,"id":"wi_v2_record","level":"task","status":"open","executionMode":"agent","subject":"Update legacy record","description":"Legacy description.","agentContext":"Legacy context.","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}';
        yield* fs.writeFileString(`${directory}/.tasks/tasks.jsonl`, v2Line);

        const validateResult = yield* run(["--cwd", directory, "validate"]);
        assert.strictEqual(validateResult.exit._tag, "Failure");
        assert.isTrue(String(validateResult.errors[0]).includes("Expected schemaVersion 3"));
        assert.isTrue(String(validateResult.errors[0]).includes("required executor and context"));
        assert.isTrue(String(validateResult.errors[0]).includes("edited manually"));

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Failure");
        assert.isTrue(String(listResult.errors[0]).includes("Expected schemaVersion 3"));
      }),
    ),
  );

  it.effect("rejects legacy prefixed IDs with short-ID guidance", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Reject prefixed ID");
        const content = yield* readTasksFile(directory);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${directory}/.tasks/tasks.jsonl`,
          content.replace(`"id":"${ticket.id}"`, `"id":"wi_${ticket.id}"`),
        );

        const validateResult = yield* run(["--cwd", directory, "validate"]);
        assert.strictEqual(validateResult.exit._tag, "Failure");
        assert.isTrue(String(validateResult.errors[0]).includes("six-character"));
        assert.isTrue(String(validateResult.errors[0]).includes("without a prefix"));
      }),
    ),
  );

  it.effect("validate rejects duplicate dependency ids", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);
        const ticket = yield* createTicket(directory, "Add exporter");
        const dependency = yield* createTicket(directory, "Add serializer");
        const duplicateDependencyLine = yield* encodeTicketJsonLine({
          ...ticket,
          blockedBy: [dependency.id, dependency.id],
        });
        const dependencyLine = yield* encodeTicketJsonLine(dependency);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${directory}/.tasks/tasks.jsonl`,
          [duplicateDependencyLine, dependencyLine].join("\n"),
        );

        const result = yield* run(["--cwd", directory, "validate"]);
        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Duplicate dependency"));
      }),
    ),
  );

  it.effect("rejects invalid subject formatting", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const result = yield* run([
          "--cwd",
          directory,
          "create",
          "bad subject.",
          "--level",
          "task",
          "--description",
          "Still trying to create it.",
          "--context",
          "This should fail.",
        ]);

        assert.strictEqual(result.exit._tag, "Failure");
        assert.isTrue(String(result.errors[0]).includes("Subject validation failed"));
      }),
    ),
  );
});
