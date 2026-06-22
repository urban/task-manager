import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { ensureCanCreateItem } from "../domain/Validation";
import { ensureValidSubject, makeOpenWorkItem, makeWorkItemId } from "../domain/WorkItem";
import { CommandFailure } from "../domain/Errors";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { resolveWorkItem } from "../domain/WorkItem";
import { commandRoot } from "./root";
import { resolveTextInput } from "./shared/input";
import { parseMessage } from "./shared/message";
import {
  encodeItemForOutput,
  executeCommand,
  renderJson,
  renderWorkItemHuman,
} from "./shared/output";

export const commandCreate = Command.make("create", {
  subject: Argument.string("subject").pipe(Argument.optional),
  level: Flag.choice("level", ["epic", "task", "subtask"]).pipe(
    Flag.withDescription("Create an Epic, Task, or Subtask"),
    Flag.withDefault("task"),
  ),
  parent: Flag.string("parent").pipe(
    Flag.withDescription("Parent Work Item id or unique prefix"),
    Flag.optional,
  ),
  description: Flag.string("description").pipe(Flag.optional),
  descriptionFile: Flag.file("description-file").pipe(Flag.optional),
  context: Flag.string("context").pipe(Flag.optional),
  contextFile: Flag.file("context-file").pipe(Flag.optional),
  message: Flag.string("message").pipe(Flag.optional),
  messageFile: Flag.file("message-file").pipe(Flag.optional),
  allowEmptyDescription: Flag.boolean("allow-empty-description"),
  allowEmptyContext: Flag.boolean("allow-empty-context"),
}).pipe(
  Command.withDescription("Create a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          if (Option.isSome(input.message) && Option.isSome(input.messageFile)) {
            return yield* new CommandFailure({
              message: "Use either --message or --message-file, not both.",
            });
          }

          const descriptionInput = yield* resolveTextInput(
            input.description,
            input.descriptionFile,
            "description",
          );
          const contextInput = yield* resolveTextInput(input.context, input.contextFile, "context");
          const messageInput = yield* resolveTextInput(input.message, input.messageFile, "message");

          if (
            Option.isSome(messageInput) &&
            (Option.isSome(input.subject) || Option.isSome(descriptionInput))
          ) {
            return yield* new CommandFailure({
              message: "Do not combine <subject> or --description with --message/--message-file.",
            });
          }

          const messageParts = Option.match(messageInput, {
            onNone: () => undefined,
            onSome: parseMessage,
          });

          const subject = Option.match(input.subject, {
            onNone: () => messageParts?.subject ?? "",
            onSome: (value) => value,
          });
          const description = Option.match(descriptionInput, {
            onNone: () => messageParts?.description ?? "",
            onSome: (value) => value,
          });
          const agentContext = Option.match(contextInput, {
            onNone: () => "",
            onSome: (value) => value,
          });

          yield* ensureValidSubject(subject);

          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const parent = yield* Option.match(input.parent, {
            onNone: () => Effect.void,
            onSome: (value) => resolveWorkItem(items, value),
          });

          const createValidation = ensureCanCreateItem({
            level: input.level,
            ...(parent === undefined ? {} : { parent }),
            subject,
            description,
            agentContext,
            allowEmptyDescription: input.allowEmptyDescription,
            allowEmptyContext: input.allowEmptyContext,
          });
          if (createValidation !== undefined) {
            return yield* createValidation;
          }

          const id = yield* makeWorkItemId();
          const workItem = yield* makeOpenWorkItem({
            id,
            level: input.level,
            subject,
            description,
            agentContext,
            ...(parent === undefined ? {} : { parentId: parent.id }),
          });

          const nextItems = [...items, workItem];
          const persistedItems = yield* writeStore(paths, nextItems);
          const createdItem = yield* resolveWorkItem(persistedItems, id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(createdItem),
                })
              : renderWorkItemHuman(createdItem),
          );
        }),
      );
    }),
  ),
);
