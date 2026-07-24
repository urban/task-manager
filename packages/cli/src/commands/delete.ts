import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveTicket, sortTickets } from "../domain/Ticket";

type Ticket = import("../domain/Ticket").Ticket;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson } from "./shared/output";
import { firstHumanExecutorTicket, humanExecutorGuardMessage } from "./shared/tickets";

interface DeletedTicketOutput {
  readonly id: string;
  readonly subject: string;
  readonly executor: string;
}

interface DanglingDependencyRisk {
  readonly ticket: Ticket;
  readonly dependencyId: string;
}

const deletionWarning =
  "Deletion is destructive. Prefer tm cancel for real work; use delete only for accidental records.";

const isDescendantOf = (
  candidate: Ticket,
  ancestorId: string,
  ticketsById: ReadonlyMap<string, Ticket>,
): boolean => {
  let currentParentId = candidate.parentId;

  while (currentParentId !== undefined) {
    if (currentParentId === ancestorId) {
      return true;
    }

    const parent = ticketsById.get(currentParentId);
    if (parent === undefined) {
      return false;
    }
    currentParentId = parent.parentId;
  }

  return false;
};

const deletedSubtreeOf = (
  ticket: Ticket,
  tickets: ReadonlyArray<Ticket>,
): ReadonlyArray<Ticket> => {
  const ticketsById = new Map(tickets.map((candidate) => [candidate.id, candidate]));
  return sortTickets(tickets).filter(
    (candidate) => candidate.id === ticket.id || isDescendantOf(candidate, ticket.id, ticketsById),
  );
};

const findDanglingDependencyRisks = (
  tickets: ReadonlyArray<Ticket>,
  deletedIds: ReadonlySet<string>,
): ReadonlyArray<DanglingDependencyRisk> =>
  sortTickets(tickets).flatMap((ticket) => {
    if (deletedIds.has(ticket.id)) {
      return [];
    }

    return (ticket.blockedBy ?? [])
      .filter((dependencyId) => deletedIds.has(dependencyId))
      .map((dependencyId) => ({ ticket, dependencyId }));
  });

const toDeletedTicketOutput = (ticket: Ticket): DeletedTicketOutput => ({
  id: ticket.id,
  subject: ticket.subject,
  executor: ticket.executor,
});

const renderTicketBullet = (ticket: Ticket): string => `- ${ticket.subject} (${ticket.id})`;

const renderDeletePreview = (tickets: ReadonlyArray<Ticket>): string =>
  [
    deletionWarning,
    `The following ${tickets.length} Ticket${
      tickets.length === 1 ? "" : "s"
    } would be permanently deleted:`,
    ...tickets.map(renderTicketBullet),
    "Re-run with --yes to confirm destructive deletion.",
  ].join("\n");

const renderDanglingDependencyRisks = (risks: ReadonlyArray<DanglingDependencyRisk>): string =>
  [
    "Deletion would leave dangling dependencies.",
    "Please unblock, cancel, or delete dependent Tickets first.",
    ...risks.map(
      (risk) =>
        `- ${risk.ticket.subject} (${risk.ticket.id}) depends on deleted Ticket ${risk.dependencyId}`,
    ),
  ].join("\n");

const renderDeletedHuman = (tickets: ReadonlyArray<Ticket>): string => {
  const [firstTicket] = tickets;
  const deletionSummary =
    tickets.length === 1 && firstTicket !== undefined
      ? `Deleted ${firstTicket.subject} (${firstTicket.id}).`
      : [`Deleted ${tickets.length} Tickets.`, ...tickets.map(renderTicketBullet)].join("\n");

  return [deletionWarning, deletionSummary].join("\n");
};

export const commandDelete = Command.make("delete", {
  id: Argument.string("id"),
  yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm destructive deletion")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow deleting human-executor Tickets"),
  ),
}).pipe(
  Command.withDescription("Delete accidental Tickets and descendants"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, yes, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);
          const deletedTickets = deletedSubtreeOf(ticket, tickets);

          if (!yes) {
            return yield* new CommandFailure({
              message: renderDeletePreview(deletedTickets),
            });
          }

          const humanDeletedTicket = firstHumanExecutorTicket(deletedTickets);
          if (humanDeletedTicket !== undefined && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanDeletedTicket, "delete it"),
            });
          }

          const deletedIds = new Set(deletedTickets.map((deletedTicket) => deletedTicket.id));
          const danglingDependencyRisks = findDanglingDependencyRisks(tickets, deletedIds);
          if (danglingDependencyRisks.length > 0) {
            return yield* new CommandFailure({
              message: renderDanglingDependencyRisks(danglingDependencyRisks),
            });
          }

          yield* writeStore(
            paths,
            tickets.filter((candidate) => !deletedIds.has(candidate.id)),
          );

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  deleted: deletedTickets.map(toDeletedTicketOutput),
                })
              : renderDeletedHuman(deletedTickets),
          );
        }),
      );
    }),
  ),
);
