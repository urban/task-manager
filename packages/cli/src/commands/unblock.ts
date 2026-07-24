import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveTicket, updateTicketDependencies } from "../domain/Ticket";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { encodeTicketForOutput, executeCommand, renderJson } from "./shared/output";
import {
  firstHumanExecutorTicket,
  humanExecutorGuardMessage,
  replaceTicket,
} from "./shared/tickets";

export const commandUnblock = Command.make("unblock", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(Flag.withDescription("Current dependency Ticket id or unique prefix")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow removing human-executor dependency gates"),
  ),
}).pipe(
  Command.withDescription("Remove a dependency from a Ticket"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);
          const dependency = yield* resolveTicket(tickets, by);
          const currentDependencies = ticket.blockedBy ?? [];

          if (!currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} does not depend on ${dependency.id}.`,
            });
          }

          const humanTicket = firstHumanExecutorTicket([ticket, dependency]);
          if (humanTicket !== undefined && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanTicket, "unblock it"),
            });
          }

          const updatedTicket = yield* updateTicketDependencies({
            ticket,
            blockedBy: currentDependencies.filter((dependencyId) => dependencyId !== dependency.id),
          });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTicket),
                })
              : `Unblocked ${persistedTicket.subject} (${persistedTicket.id}) from ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);
