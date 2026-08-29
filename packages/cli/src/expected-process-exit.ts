import { Cause, Data, Runtime } from "effect";

type ExpectedProcessExitFields = {
  readonly [Runtime.errorExitCode]: number;
  readonly [Runtime.errorReported]: boolean;
};

const ExpectedProcessExitBase: new (fields: ExpectedProcessExitFields) => Cause.YieldableError &
  ExpectedProcessExitFields & {
    readonly _tag: "ExpectedProcessExit";
  } = Data.TaggedError("ExpectedProcessExit")<ExpectedProcessExitFields>;

export class ExpectedProcessExit extends ExpectedProcessExitBase {
  constructor() {
    super({
      [Runtime.errorExitCode]: 1,
      [Runtime.errorReported]: false,
    });
  }
}
