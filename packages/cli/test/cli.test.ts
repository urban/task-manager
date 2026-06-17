/** @effect-diagnostics anyUnknownInErrorContext:skip-file strictEffectProvide:skip-file */
import * as PlatformNode from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import { TestConsole } from "effect/testing";
import * as CliOutput from "effect/unstable/cli/CliOutput";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { WorkItemSchema } from "../src/domain/WorkItem";
import { runTmCli } from "../src/main";

const cliOutputLayer = CliOutput.layer(
  CliOutput.defaultFormatter({
    colors: false,
  }),
);

const childProcessLayer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make(() => Effect.die("Not implemented")),
);

const baseLayer = Layer.mergeAll(
  TestConsole.layer,
  PlatformNode.NodeFileSystem.layer,
  PlatformNode.NodePath.layer,
  PlatformNode.NodeTerminal.layer,
  cliOutputLayer,
  childProcessLayer,
  Stdio.layerTest({}),
);

const run = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const previousLogs = yield* TestConsole.logLines;
    const previousErrors = yield* TestConsole.errorLines;
    const exit = yield* Effect.exit(runTmCli(args));
    const logs = (yield* TestConsole.logLines).slice(previousLogs.length);
    const errors = (yield* TestConsole.errorLines).slice(previousErrors.length);

    return {
      exit,
      logs,
      errors,
    };
  });

const ValidateOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  workItemCount: Schema.Number,
  tasksFile: Schema.String,
});

const ItemOutputSchema = Schema.Struct({
  ok: Schema.Literal(true),
  item: WorkItemSchema,
});

const decodeValidateOutput = Schema.decodeSync(Schema.fromJsonString(ValidateOutputSchema));
const decodeItemOutput = Schema.decodeSync(Schema.fromJsonString(ItemOutputSchema));

const withTempDirectory = <A, E, R>(f: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "tm-cli-" });
    return yield* f(directory);
  }).pipe(Effect.provide(baseLayer));

describe("tm cli", () => {
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
        const prefix = created.item.id.slice(0, 12);

        const showResult = yield* run(["--cwd", directory, "show", prefix]);
        assert.strictEqual(showResult.exit._tag, "Success");
        assert.isTrue(String(showResult.logs[0]).includes("Add CLI bootstrap"));
        assert.isTrue(String(showResult.logs[0]).includes("Agent Context"));
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

  it.effect("renders hierarchy in deterministic tree order", () =>
    withTempDirectory((directory) =>
      Effect.gen(function* () {
        yield* run(["--cwd", directory, "init"]);

        const epicResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Ship MVP CLI",
          "--level",
          "epic",
          "--description",
          "Deliver the first offline CLI.",
          "--context",
          "Root planning item.",
          "--json",
        ]);
        const epic = decodeItemOutput(String(epicResult.logs[0]));

        const storageTaskResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Bootstrap storage",
          "--level",
          "task",
          "--parent",
          epic.item.id,
          "--description",
          "Implement init and validate.",
          "--context",
          "Needs atomic writes.",
          "--json",
        ]);
        const storageTask = decodeItemOutput(String(storageTaskResult.logs[0]));

        const createTaskResult = yield* run([
          "--cwd",
          directory,
          "create",
          "Create first task",
          "--level",
          "task",
          "--parent",
          epic.item.id,
          "--description",
          "Implement create and show.",
          "--context",
          "Need JSONL persistence.",
          "--json",
        ]);
        const createTask = decodeItemOutput(String(createTaskResult.logs[0]));

        const listResult = yield* run(["--cwd", directory, "list"]);
        assert.strictEqual(listResult.exit._tag, "Success");
        assert.deepStrictEqual(String(listResult.logs[0]).split("\n"), [
          "└─ Ship MVP CLI (" + epic.item.id + ")",
          "   ├─ Bootstrap storage (" + storageTask.item.id + ")",
          "   └─ Create first task (" + createTask.item.id + ")",
        ]);
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
