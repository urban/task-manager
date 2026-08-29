import { Effect } from "effect";

export type InvalidProcessFixtureBound = {
  readonly _tag: "InvalidProcessFixtureBound";
  readonly field:
    | "awaitStdoutBytes"
    | "maxOutputBytes"
    | "terminationGraceMillis"
    | "timeoutMillis";
  readonly value: number;
};

export type CaptureProcessOptions = {
  readonly awaitStdoutBytes?: number;
  readonly maxOutputBytes: number;
  readonly onReady?: () => Effect.Effect<void>;
  readonly timeoutMillis: number;
  readonly terminationGraceMillis: number;
};

type ProcessFixtureBound = InvalidProcessFixtureBound["field"];

const validateBound = (
  field: ProcessFixtureBound,
  value: number,
): Effect.Effect<void, InvalidProcessFixtureBound> =>
  Number.isFinite(value) && value >= 0
    ? Effect.void
    : Effect.fail({ _tag: "InvalidProcessFixtureBound", field, value });

export const validateProcessFixtureOptions = Effect.fnUntraced(function* (
  options: CaptureProcessOptions,
) {
  if (options.awaitStdoutBytes !== undefined) {
    yield* validateBound("awaitStdoutBytes", options.awaitStdoutBytes);
  }
  yield* validateBound("maxOutputBytes", options.maxOutputBytes);
  yield* validateBound("timeoutMillis", options.timeoutMillis);
  yield* validateBound("terminationGraceMillis", options.terminationGraceMillis);
});
