import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Deferred, Effect } from "effect";

const [, , mode, ...args] = globalThis.Bun.argv;

const boundedOutput = Effect.promise(() => {
  const outputSize = 256 * 1_024;
  const stdout = new Uint8Array(outputSize).fill(0xa5);
  const stderr = new Uint8Array(outputSize).fill(0x5a);
  return Promise.all([
    globalThis.Bun.write(globalThis.Bun.stdout, stdout),
    globalThis.Bun.write(globalThis.Bun.stderr, stderr),
  ]);
}).pipe(Effect.asVoid);

const ignoreTerm = Effect.gen(function* () {
  let ignoredTermRequests = 0;
  yield* Effect.sync(() => {
    globalThis.process.removeAllListeners("SIGTERM");
    globalThis.process.on("SIGTERM", () => {
      ignoredTermRequests += 1;
    });
  });
  yield* Effect.promise(() => globalThis.Bun.write(globalThis.Bun.stdout, new Uint8Array([0x01])));
  return yield* Effect.never;
});

const ignoreTermWriter = (writerPath: string): Effect.Effect<never> =>
  Effect.gen(function* () {
    let sequence = 0;
    let ignoredTermRequests = 0;
    yield* Effect.sync(() => {
      globalThis.process.removeAllListeners("SIGTERM");
      globalThis.process.on("SIGTERM", () => {
        ignoredTermRequests += 1;
      });
    });
    yield* Effect.promise(() => globalThis.Bun.write(writerPath, String(sequence)));
    yield* Effect.promise(() =>
      globalThis.Bun.write(globalThis.Bun.stdout, new Uint8Array([0x01])),
    );
    return yield* Effect.forever(
      Effect.gen(function* () {
        sequence += 1;
        yield* Effect.promise(() => globalThis.Bun.write(writerPath, String(sequence)));
        yield* Effect.sleep("1 millis");
      }),
    );
  });

const scopeCleanup = (readyPath: string, cleanupPath: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const cleanupRequested = Deferred.makeUnsafe<void>();
    yield* Effect.sync(() => {
      globalThis.process.removeAllListeners("SIGTERM");
      globalThis.process.on("SIGTERM", () => {
        void globalThis.Bun.write(cleanupPath, "cleaned").then(() =>
          Deferred.doneUnsafe(cleanupRequested, Effect.void),
        );
      });
    });
    yield* Effect.promise(() => globalThis.Bun.write(readyPath, "ready"));
    yield* Effect.promise(() =>
      globalThis.Bun.write(globalThis.Bun.stdout, new Uint8Array([0x01])),
    );
    yield* Deferred.await(cleanupRequested);
  });

const programForMode = (): Effect.Effect<void> => {
  if (mode === "bounded-output") {
    return boundedOutput;
  }
  if (mode === "ignore-term") {
    return ignoreTerm;
  }
  if (mode === "scope-cleanup" && args[0] !== undefined && args[1] !== undefined) {
    return scopeCleanup(args[0], args[1]);
  }
  return Effect.sync(() => {
    globalThis.process.exitCode = 64;
  });
};

if (mode === "ignore-term-writer" && args[0] !== undefined) {
  Effect.runFork(ignoreTermWriter(args[0]));
} else {
  BunRuntime.runMain(programForMode());
}
