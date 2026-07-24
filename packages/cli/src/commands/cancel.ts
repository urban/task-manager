import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  cancelTicket,
  isClaimActive,
  isOpenTicket,
  resolveTicket,
  sortTickets,
} from "../domain/Ticket";

type OpenTicket = import("../domain/Ticket").OpenTicket;
type Ticket = import("../domain/Ticket").Ticket;
type TicketClaim = import("../domain/Ticket").TicketClaim;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { actorFlag } from "./shared/flags";
import { resolveActorIdentity, resolveTextInput } from "./shared/input";
import { encodeTicketForOutput, executeCommand, renderJson } from "./shared/output";
import {
  activeClaimConflictMessage,
  firstHumanExecutorTicket,
  humanExecutorGuardMessage,
} from "./shared/tickets";

interface ClaimConflict {
  readonly ticket: Ticket;
  readonly claim: TicketClaim;
}

const resolveCancellationReason = Effect.fnUntraced(function* (input: {
  readonly reason: Option.Option<string>;
  readonly reasonFile: Option.Option<string>;
}) {
  const reasonInput = yield* resolveTextInput(input.reason, input.reasonFile, "reason");
  const reason = Option.match(reasonInput, {
    onNone: () => "",
    onSome: (value) => value.trim(),
  });

  if (reason === "") {
    return yield* new CommandFailure({
      message: "Cancellation reason is required. Pass --reason <text> or --reason-file <path>.",
    });
  }

  return reason;
});

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

const openDescendantsOf = (
  ticket: Ticket,
  tickets: ReadonlyArray<Ticket>,
): ReadonlyArray<OpenTicket> => {
  const ticketsById = new Map(tickets.map((candidate) => [candidate.id, candidate]));
  return sortTickets(tickets)
    .filter(isOpenTicket)
    .filter(
      (candidate) =>
        candidate.id !== ticket.id && isDescendantOf(candidate, ticket.id, ticketsById),
    );
};

const claimConflictFor = (
  ticket: Ticket,
  identity: string,
  now: DateTime.Utc,
): ClaimConflict | undefined => {
  const claim = ticket.claim;
  return claim !== undefined && isClaimActive(claim, now) && claim.actor !== identity
    ? { ticket, claim }
    : undefined;
};

const findActiveClaimConflict = (
  tickets: ReadonlyArray<Ticket>,
  identity: string,
  now: DateTime.Utc,
): ClaimConflict | undefined => {
  for (const ticket of tickets) {
    const conflict = claimConflictFor(ticket, identity, now);
    if (conflict !== undefined) {
      return conflict;
    }
  }

  return undefined;
};

const replaceCancelledTickets = (
  tickets: ReadonlyArray<Ticket>,
  cancelledTickets: ReadonlyArray<Ticket>,
): ReadonlyArray<Ticket> => {
  const cancelledById = new Map(cancelledTickets.map((ticket) => [ticket.id, ticket]));
  return tickets.map((ticket) => cancelledById.get(ticket.id) ?? ticket);
};

const renderCascadePreview = (ticket: Ticket, descendants: ReadonlyArray<Ticket>): string =>
  [
    `Ticket ${ticket.id} has ${descendants.length} open descendant Ticket${
      descendants.length === 1 ? "" : "s"
    } that would also be cancelled:`,
    ...descendants.map((descendant) => `- ${descendant.subject} (${descendant.id})`),
    "Re-run with --yes to confirm cascade cancellation.",
  ].join("\n");

const renderCancelledHuman = (cancelledTickets: ReadonlyArray<Ticket>, reason: string): string => {
  const [firstTicket] = cancelledTickets;
  if (cancelledTickets.length === 1 && firstTicket !== undefined) {
    return [`Cancelled ${firstTicket.subject} (${firstTicket.id}).`, `Reason: ${reason}`].join(
      "\n",
    );
  }

  return [
    `Cancelled ${cancelledTickets.length} Tickets.`,
    ...cancelledTickets.map((ticket) => `- ${ticket.subject} (${ticket.id})`),
    `Reason: ${reason}`,
  ].join("\n");
};

export const commandCancel = Command.make("cancel", {
  id: Argument.string("id"),
  reason: Flag.string("reason").pipe(Flag.optional),
  reasonFile: Flag.file("reason-file").pipe(Flag.optional),
  actor: actorFlag,
  force: Flag.boolean("force").pipe(
    Flag.withDescription("Cancel despite another actor's active claim"),
  ),
  yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm cascading cancellation")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow cancelling human-executor Tickets"),
  ),
}).pipe(
  Command.withDescription("Cancel open Tickets with a structured Cancellation"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveActorIdentity(input.actor);
          const reason = yield* resolveCancellationReason(input);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, input.id);

          if (ticket.status !== "open") {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} is ${ticket.status} and cannot be cancelled.`,
            });
          }

          const openDescendants = openDescendantsOf(ticket, tickets);
          if (openDescendants.length > 0 && !input.yes) {
            return yield* new CommandFailure({
              message: renderCascadePreview(ticket, openDescendants),
            });
          }

          const targets = [ticket, ...openDescendants];
          const humanTarget = firstHumanExecutorTicket(targets);
          if (humanTarget !== undefined && !input.allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanTarget, "cancel it"),
            });
          }

          const now = yield* DateTime.now;
          const claimConflict = findActiveClaimConflict(targets, identity, now);
          if (claimConflict !== undefined && !input.force) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(
                claimConflict.ticket,
                claimConflict.claim,
                "cancel it",
              ),
            });
          }

          const cancelledTickets = targets.map((target) =>
            cancelTicket({
              ticket: target,
              reason,
              cancelledAt: now,
              cancelledBy: identity,
            }),
          );
          const persistedTickets = yield* writeStore(
            paths,
            replaceCancelledTickets(tickets, cancelledTickets),
          );
          const persistedCancelledTickets = yield* Effect.forEach(
            cancelledTickets,
            (cancelledTicket) => resolveTicket(persistedTickets, cancelledTicket.id),
          );
          const persistedTarget = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTarget),
                  cancelledTickets: persistedCancelledTickets.map(encodeTicketForOutput),
                })
              : renderCancelledHuman(persistedCancelledTickets, reason),
          );
        }),
      );
    }),
  ),
);
