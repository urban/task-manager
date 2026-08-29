import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { TestConsole } from "effect/testing";

import { AppLive } from "../../src/app-live";
import { runWith } from "../../src/cli-application";

const TestLive = Layer.merge(AppLive, TestConsole.layer);

const outputFor = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
  const before = (yield* TestConsole.logLines).length;
  yield* runWith(args);
  const after = yield* TestConsole.logLines;
  return after.slice(before).map(String).join("\n");
});

describe("CLI shell", () => {
  it.effect("keeps the executable boundary to direct Layer provision and runMain", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(AppLive);
        const source = yield* Effect.provideContext(
          Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
            fileSystem.readFileString(`${import.meta.dirname}/../../src/bin.ts`),
          ),
          context,
        );

        assert.include(source, "run.pipe(Effect.provide(AppLive))");
        assert.notInclude(source, "Layer.build");
        assert.notInclude(source, "provideContext");
      }),
    ),
  );

  it.effect("exposes only the configured stock help, version, and completion built-ins", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(TestLive);
        return yield* Effect.provideContext(
          Effect.gen(function* () {
            const help = yield* outputFor(["--help"]);
            const version = yield* outputFor(["--version"]);
            const bash = yield* outputFor(["--completions", "bash"]);
            const fish = yield* outputFor(["--completions", "fish"]);
            const zsh = yield* outputFor(["--completions", "zsh"]);

            assert.include(help, "USAGE\n  tm [flags]");
            assert.include(help, "--help, -h");
            assert.include(help, "--version, -v");
            assert.include(help, "--completions <bash|zsh|fish|sh>");
            assert.notInclude(help, "--wizard");
            assert.notInclude(help, "--log-level");
            assert.strictEqual(version, "tm v0.1.0");
            assert.include(bash, "complete -F _tm tm");
            assert.include(fish, "complete -c tm");
            assert.include(zsh, "#compdef tm");
          }),
          context,
        );
      }),
    ),
  );
});
