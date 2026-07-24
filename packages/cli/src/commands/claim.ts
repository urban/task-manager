import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  formatClaimExpiresAt,
  isClaimActive,
  resolveTicket,
  updateTicketClaim,
} from "../domain/Ticket";

type Ticket = import("../domain/Ticket").Ticket;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { actorFlag } from "./shared/flags";
import { resolveActorIdentity } from "./shared/input";
import { encodeTicketForOutput, executeCommand, renderJson } from "./shared/output";
import {
  activeClaimConflictMessage,
  humanExecutorGuardMessage,
  replaceTicket,
} from "./shared/tickets";

const renderClaimedHuman = (ticket: Ticket): string => {
  const claim = ticket.claim;
  return claim === undefined
    ? `Claimed ${ticket.subject} (${ticket.id}).`
    : `Claimed ${ticket.subject} (${ticket.id}) for ${claim.actor} until ${formatClaimExpiresAt(claim)}.`;
};

export const commandClaim = Command.make("claim", {
  id: Argument.string("id"),
  actor: actorFlag,
  force: Flag.boolean("force").pipe(Flag.withDescription("Replace another active claim")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow claiming human-executor Tickets"),
  ),
}).pipe(
  Command.withDescription("Claim an open Ticket for an Actor Identity"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, actor, force, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveActorIdentity(actor);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);

          if (ticket.status !== "open") {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} is ${ticket.status} and cannot be claimed.`,
            });
          }

          if (ticket.executor === "human" && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(ticket, "claim it"),
            });
          }

          const now = yield* DateTime.now;
          const currentClaim = ticket.claim;
          if (
            currentClaim !== undefined &&
            isClaimActive(currentClaim, now) &&
            currentClaim.actor !== identity &&
            !force
          ) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(ticket, currentClaim, "replace it"),
            });
          }

          const updatedTicket = updateTicketClaim({
            ticket,
            actor: identity,
            claimedAt: now,
          });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTicket),
                })
              : renderClaimedHuman(persistedTicket),
          );
        }),
      );
    }),
  ),
);
