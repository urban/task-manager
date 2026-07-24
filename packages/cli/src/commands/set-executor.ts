import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveTicket, setTicketExecutor } from "../domain/Ticket";

type Ticket = import("../domain/Ticket").Ticket;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { encodeTicketForOutput, executeCommand, renderJson } from "./shared/output";
import { replaceTicket } from "./shared/tickets";

const renderSetExecutorHuman = (ticket: Ticket, changed: boolean): string =>
  changed
    ? `Set executor for ${ticket.subject} (${ticket.id}) to ${ticket.executor}.`
    : `Executor for ${ticket.subject} (${ticket.id}) is already ${ticket.executor}.`;

export const commandSetExecutor = Command.make("set-executor", {
  id: Argument.string("id"),
  executor: Argument.choice("executor", ["agent", "human"]),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow changing to or from human executor"),
  ),
}).pipe(
  Command.withDescription("Change a Ticket executor"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, executor, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);

          if (ticket.executor === executor) {
            yield* Console.log(
              root.json
                ? renderJson({ ok: true, ticket: encodeTicketForOutput(ticket) })
                : renderSetExecutorHuman(ticket, false),
            );
            return;
          }

          if ((ticket.executor === "human" || executor === "human") && !allowHuman) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} involves human executor. Pass --allow-human to change executor.`,
            });
          }

          const now = yield* DateTime.now;
          const updatedTicket = setTicketExecutor({ ticket, executor, updatedAt: now });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({ ok: true, ticket: encodeTicketForOutput(persistedTicket) })
              : renderSetExecutorHuman(persistedTicket, true),
          );
        }),
      );
    }),
  ),
);
