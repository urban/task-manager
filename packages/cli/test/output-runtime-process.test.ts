import * as BunServices from "@effect/platform-bun/BunServices";
import * as EffectVitest from "@effect/vitest";
import { Effect } from "effect";
import * as Scope from "effect/Scope";
import { ChildProcess } from "effect/unstable/process";

import { captureProcess } from "./support/process-fixture";

const repositoryRoot = `${import.meta.dirname}/../../..`;
const assert: typeof EffectVitest.assert = EffectVitest.assert;
const it: typeof EffectVitest.it = EffectVitest.it;

type TestRegistration = {
  readonly effect: EffectVitest.Vitest.Test<BunServices.BunServices | Scope.Scope>;
};

const runCli = (args: ReadonlyArray<string>) =>
  captureProcess({
    makeCommand: () =>
      ChildProcess.make("bun", ["packages/cli/src/bin.ts", ...args], {
        cwd: repositoryRoot,
        stdin: "ignore",
        env: { TM_DEBUG: "false" },
        extendEnv: true,
      }),
    options: {
      maxOutputBytes: 1_024,
      timeoutMillis: 5_000,
      terminationGraceMillis: 1_000,
    },
  });

it.layer(BunServices.layer, { excludeTestServices: true })(
  "debug output transparency",
  ({ effect }: TestRegistration) => {
    effect("preserves built-in and parse output when debug is enabled", () =>
      Effect.gen(function* () {
        for (const args of [["--version"], ["unknown"]]) {
          const disabled = yield* runCli(args);
          const enabled = yield* runCli(["--debug", ...args]);
          assert.deepStrictEqual(enabled.stdout.bytes, disabled.stdout.bytes);
          assert.deepStrictEqual(enabled.stderr.bytes, disabled.stderr.bytes);
          assert.deepStrictEqual(enabled.status, disabled.status);
        }
      }),
    );
  },
);
