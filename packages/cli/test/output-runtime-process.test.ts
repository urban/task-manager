import * as BunServices from "@effect/platform-bun/BunServices";
import * as EffectVitest from "@effect/vitest";
import { Effect } from "effect";
import * as Scope from "effect/Scope";
import { ChildProcess } from "effect/unstable/process";

import { captureProcess } from "./support/process-fixture";

const encoder = new globalThis.TextEncoder();
const decoder = new globalThis.TextDecoder();
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
  "real CLI output discipline",
  ({ effect }: TestRegistration) => {
    effect("writes framework version output to stdout", () =>
      Effect.gen(function* () {
        const result = yield* runCli(["--version"]);
        assert.deepStrictEqual(result.stdout.bytes, encoder.encode("tm v0.1.0\n"));
        assert.deepStrictEqual(result.stderr.bytes, new Uint8Array());
        assert.deepStrictEqual(result.status, { _tag: "Exited", code: 0 });
      }),
    );

    effect("writes framework help to stdout and parse diagnostics to stderr", () =>
      Effect.gen(function* () {
        const result = yield* runCli(["unknown"]);
        const stdout = decoder.decode(result.stdout.bytes);
        assert.include(stdout, "Local-first agent task manager");
        const stderr = decoder.decode(result.stderr.bytes);
        assert.include(stderr, 'Unexpected positional argument: "unknown"');
        assert.deepStrictEqual(result.status, { _tag: "Exited", code: 1 });
      }),
    );

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
