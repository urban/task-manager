import * as BunServices from "@effect/platform-bun/BunServices";
import * as EffectVitest from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Option, Schedule } from "effect";
import * as Scope from "effect/Scope";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { captureProcess, decodeUtf8Strict } from "./process-fixture";

const assert: typeof EffectVitest.assert = EffectVitest.assert;
const it: typeof EffectVitest.it = EffectVitest.it;
const repositoryRoot = `${import.meta.dirname}/../../../..`;
const lifecycleFixture = "packages/cli/test/fixtures/process-lifecycle.ts";
type TestRegistration = {
  readonly effect: EffectVitest.Vitest.Test<BunServices.BunServices | Scope.Scope>;
};
type IsRunning = () => ChildProcessSpawner.ChildProcessHandle["isRunning"];

const cliCommand = (...args: ReadonlyArray<string>) =>
  ChildProcess.make("bun", ["packages/cli/src/bin.ts", ...args], {
    cwd: repositoryRoot,
    stdin: "ignore",
  });

it.layer(BunServices.layer, { excludeTestServices: true })(
  "CLI process capture",
  ({ effect }: TestRegistration) => {
    effect("captures exact CLI stdout, stderr, and successful exit status", () =>
      Effect.gen(function* () {
        const result = yield* captureProcess({
          makeCommand: () => cliCommand("--version"),
          options: {
            maxOutputBytes: 1_024,
            timeoutMillis: 5_000,
            terminationGraceMillis: 1_000,
          },
        });
        assert.deepStrictEqual(
          result.stdout.bytes,
          new globalThis.TextEncoder().encode("tm v0.1.0\n"),
        );
        assert.strictEqual(result.stdout.totalBytes, 10);
        assert.isFalse(result.stdout.truncated);
        assert.deepStrictEqual(result.stderr.bytes, new Uint8Array());
        assert.strictEqual(result.stderr.totalBytes, 0);
        assert.isFalse(result.stderr.truncated);
        assert.deepStrictEqual(result.status, { _tag: "Exited", code: 0 });
        assert.isFalse(result.timedOut);
        assert.deepStrictEqual(result.requestedSignals, []);
      }),
    );

    effect("returns a short-lived CLI result when stdout ends below readiness", () =>
      Effect.gen(function* () {
        const result = yield* captureProcess({
          makeCommand: () => cliCommand("--version"),
          options: {
            awaitStdoutBytes: 11,
            maxOutputBytes: 1_024,
            timeoutMillis: 50,
            terminationGraceMillis: 1_000,
          },
        }).pipe(Effect.timeout("1 second"));
        assert.deepStrictEqual(
          result.stdout.bytes,
          new globalThis.TextEncoder().encode("tm v0.1.0\n"),
        );
        assert.deepStrictEqual(result.stderr.bytes, new Uint8Array());
        assert.deepStrictEqual(result.status, { _tag: "Exited", code: 0 });
        assert.isFalse(result.timedOut);
        assert.deepStrictEqual(result.requestedSignals, []);
      }),
    );
  },
);

it.layer(BunServices.layer, { excludeTestServices: true })(
  "bounded process capture",
  ({ effect }: TestRegistration) => {
    effect("drains stdout and stderr concurrently while retaining bounded bytes", () =>
      Effect.gen(function* () {
        const result = yield* captureProcess({
          makeCommand: () =>
            ChildProcess.make("bun", [lifecycleFixture, "bounded-output"], {
              cwd: repositoryRoot,
              stdin: "ignore",
            }),
          options: { maxOutputBytes: 257, timeoutMillis: 5_000, terminationGraceMillis: 1_000 },
        });
        assert.deepStrictEqual(result.stdout.bytes, new Uint8Array(257).fill(0xa5));
        assert.strictEqual(result.stdout.totalBytes, 256 * 1_024);
        assert.isTrue(result.stdout.truncated);
        assert.deepStrictEqual(result.stderr.bytes, new Uint8Array(257).fill(0x5a));
        assert.strictEqual(result.stderr.totalBytes, 256 * 1_024);
        assert.isTrue(result.stderr.truncated);
        assert.deepStrictEqual(result.status, { _tag: "Exited", code: 0 });
      }),
    );

    effect("decodes complete UTF-8 strictly without corrupting captured bytes", () =>
      Effect.gen(function* () {
        const valid = new Uint8Array([0x00, 0x68, 0xc3, 0xa9, 0xf0, 0x9f, 0xa7, 0xaa]);
        assert.strictEqual(yield* decodeUtf8Strict(valid), "\u0000hé🧪");
        assert.deepStrictEqual(
          valid,
          new Uint8Array([0x00, 0x68, 0xc3, 0xa9, 0xf0, 0x9f, 0xa7, 0xaa]),
        );
        const failure = yield* decodeUtf8Strict(new Uint8Array([0xc3, 0x28])).pipe(Effect.flip);
        assert.deepStrictEqual(failure, { _tag: "InvalidUtf8" });
      }),
    );
  },
);

const zeroReadinessCase = Effect.gen(function* () {
  let readyCalls = 0;
  const result = yield* captureProcess({
    makeCommand: () =>
      ChildProcess.make("bun", [lifecycleFixture, "ignore-term-silent"], {
        cwd: repositoryRoot,
        stdin: "ignore",
      }),
    options: {
      awaitStdoutBytes: 0,
      maxOutputBytes: 1_024,
      onReady: () =>
        Effect.sync(() => {
          readyCalls += 1;
        }),
      timeoutMillis: 1,
      terminationGraceMillis: 0,
    },
  }).pipe(Effect.timeout("1 second"));
  assert.strictEqual(readyCalls, 1);
  assert.strictEqual(result.stdout.totalBytes, 0);
  assert.isTrue(result.timedOut);
  assert.deepStrictEqual(result.status, { _tag: "Signaled" });
  assert.isTrue(result.requestedSignals.length === 1 || result.requestedSignals.length === 2);
  assert.strictEqual(result.requestedSignals[0], "SIGTERM");
  if (result.requestedSignals.length === 2) {
    assert.strictEqual(result.requestedSignals[1], "SIGKILL");
  }
});

it.layer(BunServices.layer, { excludeTestServices: true })(
  "process timeout",
  ({ effect }: TestRegistration) => {
    effect(
      "starts timeout immediately when zero stdout bytes are required",
      () => zeroReadinessCase,
    );
    effect("starts timeout after readiness and escalates a non-terminating child", () =>
      Effect.gen(function* () {
        const actualSignals: Array<ChildProcess.Signal> = [];
        const result = yield* captureProcess({
          makeCommand: () =>
            ChildProcess.make("bun", [lifecycleFixture, "ignore-term"], {
              cwd: repositoryRoot,
              stdin: "ignore",
            }),
          options: {
            awaitStdoutBytes: 1,
            maxOutputBytes: 1_024,
            timeoutMillis: 1,
            terminationGraceMillis: 0,
          },
          onKillRequested: (signal) =>
            Effect.sync(() => {
              actualSignals.push(signal);
            }),
        });
        assert.isTrue(result.timedOut);
        assert.deepStrictEqual(result.status, { _tag: "Signaled" });
        assert.deepStrictEqual(result.requestedSignals, ["SIGTERM", "SIGKILL"]);
        assert.deepStrictEqual(actualSignals, result.requestedSignals);
      }),
    );
  },
);

const cooperativeCleanupCase = Effect.scoped(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const readyPath = `${directory}/ready`;
    const cleanupPath = `${directory}/cleaned`;
    const ready = yield* Deferred.make<void>();
    const fiber = yield* Effect.forkScoped(
      captureProcess({
        makeCommand: () =>
          ChildProcess.make("bun", [lifecycleFixture, "scope-cleanup", readyPath, cleanupPath], {
            cwd: repositoryRoot,
            stdin: "ignore",
          }),
        options: {
          awaitStdoutBytes: 1,
          maxOutputBytes: 1_024,
          onReady: () => Deferred.completeWith(ready, Effect.void).pipe(Effect.asVoid),
          timeoutMillis: 30_000,
          terminationGraceMillis: 1_000,
        },
      }),
    );
    yield* Deferred.await(ready);
    assert.isTrue(yield* fileSystem.exists(readyPath));
    yield* Fiber.interrupt(fiber);
    const cleaned = yield* Effect.repeat(fileSystem.exists(cleanupPath), {
      schedule: Schedule.spaced("1 millis"),
      until: (exists) => exists,
    }).pipe(Effect.timeout("2 seconds"));
    assert.isTrue(cleaned);
  }),
);

const boundedInterruptionCase = Effect.scoped(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const writerPath = `${directory}/writer`;
    const ready = yield* Deferred.make<void>();
    const isRunning = yield* Deferred.make<IsRunning>();
    const terminationPolicy =
      yield* Deferred.make<readonly [ChildProcess.Signal | undefined, number | undefined]>();
    const fiber = yield* Effect.forkScoped(
      captureProcess({
        makeCommand: () =>
          ChildProcess.make("bun", [lifecycleFixture, "ignore-term-writer", writerPath], {
            cwd: repositoryRoot,
            stdin: "ignore",
          }),
        options: {
          awaitStdoutBytes: 1,
          maxOutputBytes: 1_024,
          onReady: () => Deferred.completeWith(ready, Effect.void).pipe(Effect.asVoid),
          timeoutMillis: 30_000,
          terminationGraceMillis: 50,
        },
        onSpawned: (running, killSignal, forceKillAfterMillis) =>
          Effect.all([
            Deferred.succeed(isRunning, running),
            Deferred.succeed(terminationPolicy, [killSignal, forceKillAfterMillis]),
          ]).pipe(Effect.asVoid),
      }),
    );
    const running = yield* Deferred.await(isRunning);
    yield* Deferred.await(ready);
    assert.isTrue(yield* fileSystem.exists(writerPath));
    const interrupted = yield* Effect.timeoutOption(Fiber.interrupt(fiber), "500 millis");
    assert.isTrue(Option.isSome(interrupted));
    if (Option.isNone(interrupted)) {
      return;
    }
    assert.isFalse(yield* running());
    assert.deepStrictEqual(yield* Deferred.await(terminationPolicy), ["SIGTERM", 50]);
  }),
);

it.layer(BunServices.layer, { excludeTestServices: true })(
  "process cleanup",
  ({ effect }: TestRegistration) => {
    effect("interrupting the owning scope leaves no surviving child", () => cooperativeCleanupCase);
    effect("bounds interruption of a TERM-ignoring child writer", () => boundedInterruptionCase);
  },
);
