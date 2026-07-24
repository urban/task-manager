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
import { replaceTicket } from "./shared/tickets";

export const commandBlock = Command.make("block", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(
    Flag.withDescription("Ticket id or unique prefix that blocks this ticket"),
  ),
}).pipe(
  Command.withDescription("Add a dependency to a Ticket"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);
          const dependency = yield* resolveTicket(tickets, by);

          if (ticket.id === dependency.id) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} cannot depend on itself.`,
            });
          }

          const currentDependencies = ticket.blockedBy ?? [];
          if (currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} already depends on ${dependency.id}.`,
            });
          }

          const updatedTicket = yield* updateTicketDependencies({
            ticket,
            blockedBy: [...currentDependencies, dependency.id],
          });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTicket),
                })
              : `Blocked ${persistedTicket.subject} (${persistedTicket.id}) by ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);
