import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { ensureCanUpdateItem } from "../domain/Validation";
import {
  resolveWorkItem,
  updateWorkItemText,
  type WorkItem,
  type WorkItemTextUpdates,
} from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { resolveTextInput } from "./shared/input";
import { parseMessage } from "./shared/message";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import { replaceWorkItem } from "./shared/work-items";

const hasRawUpdateField = (input: {
  readonly subject: Option.Option<string>;
  readonly description: Option.Option<string>;
  readonly descriptionFile: Option.Option<string>;
  readonly context: Option.Option<string>;
  readonly contextFile: Option.Option<string>;
  readonly message: Option.Option<string>;
  readonly messageFile: Option.Option<string>;
}): boolean =>
  Option.isSome(input.subject) ||
  Option.isSome(input.description) ||
  Option.isSome(input.descriptionFile) ||
  Option.isSome(input.context) ||
  Option.isSome(input.contextFile) ||
  Option.isSome(input.message) ||
  Option.isSome(input.messageFile);

const hasMessageSubjectDescriptionConflict = (input: {
  readonly subject: Option.Option<string>;
  readonly description: Option.Option<string>;
  readonly descriptionFile: Option.Option<string>;
  readonly message: Option.Option<string>;
  readonly messageFile: Option.Option<string>;
}): boolean =>
  (Option.isSome(input.message) || Option.isSome(input.messageFile)) &&
  (Option.isSome(input.subject) ||
    Option.isSome(input.description) ||
    Option.isSome(input.descriptionFile));

const buildTextUpdates = (options: {
  readonly subject: string | undefined;
  readonly description: string | undefined;
  readonly agentContext: string | undefined;
}): WorkItemTextUpdates =>
  ({
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.agentContext === undefined ? {} : { agentContext: options.agentContext }),
  }) satisfies WorkItemTextUpdates;

const renderUpdatedHuman = (item: WorkItem): string => `Updated ${item.subject} (${item.id}).`;

export const commandUpdate = Command.make("update", {
  id: Argument.string("id"),
  subject: Flag.string("subject").pipe(Flag.optional),
  description: Flag.string("description").pipe(Flag.optional),
  descriptionFile: Flag.file("description-file").pipe(Flag.optional),
  context: Flag.string("context").pipe(Flag.optional),
  contextFile: Flag.file("context-file").pipe(Flag.optional),
  message: Flag.string("message").pipe(Flag.optional),
  messageFile: Flag.file("message-file").pipe(Flag.optional),
  allowEmptyDescription: Flag.boolean("allow-empty-description"),
  allowEmptyContext: Flag.boolean("allow-empty-context"),
}).pipe(
  Command.withDescription("Update Work Item Subject, Description, or Agent Context"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          if (!hasRawUpdateField(input)) {
            return yield* new CommandFailure({
              message:
                "At least one update field is required. Pass --subject, --description, --description-file, --context, --context-file, --message, or --message-file.",
            });
          }

          if (Option.isSome(input.message) && Option.isSome(input.messageFile)) {
            return yield* new CommandFailure({
              message: "Use either --message or --message-file, not both.",
            });
          }

          if (hasMessageSubjectDescriptionConflict(input)) {
            return yield* new CommandFailure({
              message:
                "Do not combine --subject or --description/--description-file with --message/--message-file.",
            });
          }

          const descriptionInput = yield* resolveTextInput(
            input.description,
            input.descriptionFile,
            "description",
          );
          const contextInput = yield* resolveTextInput(input.context, input.contextFile, "context");
          const messageInput = yield* resolveTextInput(input.message, input.messageFile, "message");

          const messageParts = Option.match(messageInput, {
            onNone: () => undefined,
            onSome: parseMessage,
          });
          const subject = Option.match(input.subject, {
            onNone: () => messageParts?.subject,
            onSome: (value) => value,
          });
          const description = Option.match(descriptionInput, {
            onNone: () => messageParts?.description,
            onSome: (value) => value,
          });
          const agentContext = Option.match(contextInput, {
            onNone: () => undefined,
            onSome: (value) => value,
          });
          const updates = buildTextUpdates({ subject, description, agentContext });
          const validation = ensureCanUpdateItem({
            ...updates,
            allowEmptyDescription: input.allowEmptyDescription,
            allowEmptyContext: input.allowEmptyContext,
          });
          if (validation !== undefined) {
            return yield* validation;
          }

          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, input.id);
          const now = yield* DateTime.now;
          const updatedItem = updateWorkItemText({ item, updates, updatedAt: now });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : renderUpdatedHuman(persistedItem),
          );
        }),
      );
    }),
  ),
);
