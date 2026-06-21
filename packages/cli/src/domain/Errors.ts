import * as Schema from "effect/Schema";

export const ValidationIssueSchema = Schema.Struct({
  message: Schema.String,
  path: Schema.String.pipe(Schema.optional),
  line: Schema.Number.pipe(Schema.optional),
});

export type ValidationIssue = typeof ValidationIssueSchema.Type;

export class ValidationFailure extends Schema.TaggedErrorClass<ValidationFailure>()(
  "ValidationFailure",
  {
    summary: Schema.String,
    issues: Schema.Array(ValidationIssueSchema),
  },
) {}

export class StorageFailure extends Schema.TaggedErrorClass<StorageFailure>()("StorageFailure", {
  message: Schema.String,
}) {}

export class StorageNotInitialized extends Schema.TaggedErrorClass<StorageNotInitialized>()(
  "StorageNotInitialized",
  {
    tasksFile: Schema.String,
  },
) {}

export class WorkItemNotFound extends Schema.TaggedErrorClass<WorkItemNotFound>()(
  "WorkItemNotFound",
  {
    query: Schema.String,
  },
) {}

export class WorkItemAmbiguous extends Schema.TaggedErrorClass<WorkItemAmbiguous>()(
  "WorkItemAmbiguous",
  {
    query: Schema.String,
    matches: Schema.Array(Schema.String),
  },
) {}

export class LockUnavailable extends Schema.TaggedErrorClass<LockUnavailable>()("LockUnavailable", {
  lockFile: Schema.String,
}) {}

export class CommandFailure extends Schema.TaggedErrorClass<CommandFailure>()("CommandFailure", {
  message: Schema.String,
}) {}

export type TmError =
  | ValidationFailure
  | StorageFailure
  | StorageNotInitialized
  | WorkItemNotFound
  | WorkItemAmbiguous
  | LockUnavailable
  | CommandFailure;

const isValidationFailure = Schema.is(ValidationFailure);
const isStorageFailure = Schema.is(StorageFailure);
const isStorageNotInitialized = Schema.is(StorageNotInitialized);
const isWorkItemNotFound = Schema.is(WorkItemNotFound);
const isWorkItemAmbiguous = Schema.is(WorkItemAmbiguous);
const isLockUnavailable = Schema.is(LockUnavailable);
const isCommandFailure = Schema.is(CommandFailure);

export const isTmError = (error: unknown): error is TmError =>
  isValidationFailure(error) ||
  isStorageFailure(error) ||
  isStorageNotInitialized(error) ||
  isWorkItemNotFound(error) ||
  isWorkItemAmbiguous(error) ||
  isLockUnavailable(error) ||
  isCommandFailure(error);
