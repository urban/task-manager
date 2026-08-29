import { Cause, Data } from "effect";

type DebugInputRejectedFields = {
  readonly input: {
    readonly source: "environment";
    readonly name: "TM_DEBUG";
  };
  readonly issues: readonly [
    {
      readonly path: readonly [];
      readonly code: "invalid-value";
      readonly expected: "true, false, 1, or 0";
    },
  ];
};

const DebugInputRejectedBase: new (fields: DebugInputRejectedFields) => Cause.YieldableError &
  DebugInputRejectedFields & {
    readonly _tag: "InputRejected";
  } = Data.TaggedError("InputRejected")<DebugInputRejectedFields>;

export class DebugInputRejected extends DebugInputRejectedBase {}

export const invalidTmDebug: DebugInputRejected = new DebugInputRejected({
  input: { source: "environment", name: "TM_DEBUG" },
  issues: [
    {
      path: [],
      code: "invalid-value",
      expected: "true, false, 1, or 0",
    },
  ],
});
