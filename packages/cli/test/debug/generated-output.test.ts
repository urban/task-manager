import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
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

describe("generated debug output", () => {
  it.effect("renders the inherited flag in help with RC112 spacing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(TestLive);
        const help = yield* Effect.provideContext(outputFor(["--help"]), context);
        assert.include(help, "  --debug    Enable privileged local debug telemetry");
        assert.include(help, "  --completions <bash|zsh|fish|sh>    Print shell completion script");
        assert.notInclude(help, "--log-level");
      }),
    ),
  );

  it.effect("generates canonical positive and negative forms for every shell", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(TestLive);
        const outputs = yield* Effect.forEach(["bash", "fish", "zsh"], (shell) =>
          Effect.provideContext(outputFor(["--completions", shell]), context),
        );
        assert.include(outputs[0], "--debug --no-debug");
        assert.include(outputs[1], "-l debug -d 'Enable privileged local debug telemetry'");
        assert.include(outputs[1], "-l no-debug -d 'Disable debug'");
        assert.include(outputs[2], "(--debug --no-debug)--debug");
        assert.include(outputs[2], "(--debug --no-debug)--no-debug");
      }),
    ),
  );
});
