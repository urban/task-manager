import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  clearTicketClaim,
  formatClaimExpiresAt,
  isClaimActive,
  resolveTicket,
} from "../domain/Ticket";

type Ticket = import("../domain/Ticket").Ticket;
type TicketClaim = import("../domain/Ticket").TicketClaim;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { actorFlag } from "./shared/flags";
import { resolveActorIdentity } from "./shared/input";
import { encodeTicketForOutput, executeCommand, renderJson } from "./shared/output";
import { activeClaimConflictMessage, replaceTicket } from "./shared/tickets";

const renderReleasedHuman = (ticket: Ticket, claim: TicketClaim): string =>
  `Released claim on ${ticket.subject} (${ticket.id}) held by ${claim.actor} until ${formatClaimExpiresAt(
    claim,
  )}.`;

export const commandRelease = Command.make("release", {
  id: Argument.string("id"),
  actor: actorFlag,
  force: Flag.boolean("force").pipe(Flag.withDescription("Release another active claim")),
}).pipe(
  Command.withDescription("Release a Claim"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, actor, force }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveActorIdentity(actor);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);
          const currentClaim = ticket.claim;

          if (currentClaim === undefined) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} has no claim to release.`,
            });
          }

          const now = yield* DateTime.now;
          if (isClaimActive(currentClaim, now) && currentClaim.actor !== identity && !force) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(ticket, currentClaim, "release it"),
            });
          }

          const updatedTicket = clearTicketClaim({ ticket, updatedAt: now });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTicket),
                })
              : renderReleasedHuman(persistedTicket, currentClaim),
          );
        }),
      );
    }),
  ),
);
