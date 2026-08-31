import * as EffectVitest from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestConsole } from "effect/testing";

import { CliRuntime, CliRuntimeLayer } from "../src/cli-runtime";

const assert: typeof EffectVitest.assert = EffectVitest.assert;
const describe: typeof EffectVitest.describe = EffectVitest.describe;
const it: typeof EffectVitest.it = EffectVitest.it;

const runtimeLayer = Layer.merge(CliRuntimeLayer, TestConsole.layer);

const withRuntime = <A, E>(effect: () => Effect.Effect<A, E, CliRuntime>): Effect.Effect<A, E> =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(runtimeLayer);
      return yield* Effect.provideContext(effect(), context);
    }),
  );

describe("Effect diagnostic output", () => {
  it.effect("routes Effect logging to stderr", () =>
    withRuntime(() =>
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* runtime.run(() => Effect.logInfo("progress"));
        const errors = yield* TestConsole.errorLines;
        assert.deepStrictEqual(yield* TestConsole.logLines, []);
        assert.isTrue(errors.some((value) => String(value).includes("progress")));
      }),
    ),
  );
});
