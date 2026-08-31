import { Data } from "effect";

const DebugInputRejectedBase: ReturnType<typeof Data.TaggedError<"InputRejected">> =
  Data.TaggedError("InputRejected");

export class DebugInputRejected extends DebugInputRejectedBase<{
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
}> {}

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
