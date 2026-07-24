import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { ensureCanCreateTicket } from "../domain/Validation";
import { ensureValidSubject, makeOpenTicket, makeTicketId } from "../domain/Ticket";
import { CommandFailure } from "../domain/Errors";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { resolveTicket } from "../domain/Ticket";
import { commandRoot } from "./root";
import { resolveTextInput } from "./shared/input";
import { parseMessage } from "./shared/message";
import {
  encodeTicketForOutput,
  executeCommand,
  renderJson,
  renderTicketHuman,
} from "./shared/output";

export const commandCreate = Command.make("create", {
  subject: Argument.string("subject").pipe(Argument.optional),
  level: Flag.choice("level", ["epic", "task", "subtask"]).pipe(
    Flag.withDescription("Create an Epic, Task, or Subtask"),
    Flag.withDefault("task"),
  ),
  executor: Flag.choice("executor", ["agent", "human"]).pipe(
    Flag.withDescription("Executor for the Ticket"),
    Flag.withDefault("agent"),
  ),
  parent: Flag.string("parent").pipe(
    Flag.withDescription("Parent Ticket id or unique prefix"),
    Flag.optional,
  ),
  blockedBy: Flag.string("blocked-by").pipe(
    Flag.withDescription("Existing Ticket id or unique prefix that blocks the new Ticket"),
    Flag.atMost(Number.MAX_SAFE_INTEGER),
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
  Command.withDescription("Create a Ticket"),
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
          const context = Option.match(contextInput, {
            onNone: () => "",
            onSome: (value) => value,
          });

          yield* ensureValidSubject(subject);

          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const parent = yield* Option.match(input.parent, {
            onNone: () => Effect.void,
            onSome: (value) => resolveTicket(tickets, value),
          });

          const createValidation = ensureCanCreateTicket({
            level: input.level,
            ...(parent === undefined ? {} : { parent }),
            subject,
            description,
            context,
            allowEmptyDescription: input.allowEmptyDescription,
            allowEmptyContext: input.allowEmptyContext,
          });
          if (createValidation !== undefined) {
            return yield* createValidation;
          }

          const dependencies = yield* Effect.forEach(input.blockedBy, (value) =>
            resolveTicket(tickets, value),
          );
          const duplicateDependency = dependencies.find((dependency, index) =>
            dependencies.some(
              (candidate, candidateIndex) =>
                candidateIndex < index && candidate.id === dependency.id,
            ),
          );
          if (duplicateDependency !== undefined) {
            return yield* new CommandFailure({
              message: `Duplicate dependency ${duplicateDependency.id}.`,
            });
          }
          const blockedBy = dependencies.map((dependency) => dependency.id);

          const id = yield* makeTicketId(new Set(tickets.map((ticket) => ticket.id)));
          if (blockedBy.includes(id)) {
            return yield* new CommandFailure({
              message: `Ticket ${id} cannot depend on itself.`,
            });
          }

          const ticket = yield* makeOpenTicket({
            id,
            level: input.level,
            subject,
            description,
            context,
            executor: input.executor,
            ...(parent === undefined ? {} : { parentId: parent.id }),
            blockedBy,
          });

          const nextTickets = [...tickets, ticket];
          const persistedTickets = yield* writeStore(paths, nextTickets);
          const createdTicket = yield* resolveTicket(persistedTickets, id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(createdTicket),
                })
              : renderTicketHuman(createdTicket),
          );
        }),
      );
    }),
  ),
);
