import { Context, Deferred, Effect, Layer, Option, Stdio, Stream } from "effect";

export type ProcessExitCode = 0 | 1;

export type ReadonlyBytes = {
  readonly byteLength: number;
  readonly length: number;
  readonly [index: number]: number;
};

export type RenderedProcessOutput = {
  readonly stdoutBytes: ReadonlyBytes;
  readonly stderrBytes: ReadonlyBytes;
  readonly exitCode: ProcessExitCode;
};

export const DuplicateProcessOutputPublication: globalThis.Error = new globalThis.Error(
  "DuplicateProcessOutputPublication",
);
export const SimultaneousFrameworkAndProductOutput: globalThis.Error = new globalThis.Error(
  "SimultaneousFrameworkAndProductOutput",
);
export const AmbiguousProcessOutputDestination: globalThis.Error = new globalThis.Error(
  "AmbiguousProcessOutputDestination",
);

type ProcessOutputShape = {
  readonly poll: Effect.Effect<Option.Option<RenderedProcessOutput>>;
  readonly publish: (...[output]: readonly [RenderedProcessOutput]) => Effect.Effect<void>;
  readonly write: (...[output]: readonly [RenderedProcessOutput]) => Effect.Effect<void>;
};

const ProcessOutputBase: Context.ServiceClass<
  ProcessOutput,
  "@urban/task-manager-cli/process-output/ProcessOutput",
  ProcessOutputShape
> = Context.Service<ProcessOutput, ProcessOutputShape>()(
  "@urban/task-manager-cli/process-output/ProcessOutput",
);

export class ProcessOutput extends ProcessOutputBase {}

export const ProcessOutputLayer: Layer.Layer<ProcessOutput, never, Stdio.Stdio> = Layer.effect(
  ProcessOutput,
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const cell = yield* Deferred.make<RenderedProcessOutput>();
    const writeBytes = (
      ...[bytes, destination]: readonly [ReadonlyBytes, "stderr" | "stdout"]
    ): Effect.Effect<void> =>
      bytes.byteLength === 0
        ? Effect.void
        : Stream.succeed<string | Uint8Array>(Uint8Array.from(bytes)).pipe(
            Stream.run(destination === "stdout" ? stdio.stdout() : stdio.stderr()),
            Effect.orDie,
          );
    const publish = Effect.fn("ProcessOutput.publish")(function* (
      ...[output]: readonly [RenderedProcessOutput]
    ) {
      const published = yield* Deferred.succeed(cell, output);
      return published ? undefined : yield* Effect.die(DuplicateProcessOutputPublication);
    });
    const poll = Deferred.poll(cell).pipe(Effect.flatMap(Effect.transposeOption));
    const write = Effect.fnUntraced(function* (...[output]: readonly [RenderedProcessOutput]) {
      if (output.stdoutBytes.byteLength > 0 && output.stderrBytes.byteLength > 0) {
        return yield* Effect.die(AmbiguousProcessOutputDestination);
      }
      return yield* writeBytes(output.stdoutBytes, "stdout").pipe(
        Effect.andThen(writeBytes(output.stderrBytes, "stderr")),
      );
    });
    return ProcessOutput.of({ poll, publish, write });
  }),
);
