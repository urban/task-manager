import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { hasOpenChildren } from "../domain/Validation";
import { completeTicket, isClaimActive, resolveTicket } from "../domain/Ticket";

type Ticket = import("../domain/Ticket").Ticket;
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { resolveCompletionResultInput } from "./complete-input";
import { commandRoot } from "./root";
import { actorFlag } from "./shared/flags";
import { resolveActorIdentity } from "./shared/input";
import { encodeTicketForOutput, executeCommand, renderBullets, renderJson } from "./shared/output";
import {
  activeClaimConflictMessage,
  firstHumanExecutorTicket,
  humanExecutorGuardMessage,
  replaceTicket,
} from "./shared/tickets";

const incompleteDependenciesForCompletion = (
  ticket: Ticket,
  tickets: ReadonlyArray<Ticket>,
): ReadonlyArray<Ticket> => {
  const ticketsById = new Map(tickets.map((candidate) => [candidate.id, candidate]));
  return (ticket.blockedBy ?? []).flatMap((dependencyId) => {
    const dependency = ticketsById.get(dependencyId);
    return dependency === undefined || dependency.status === "done" ? [] : [dependency];
  });
};

const renderIncompleteDependencies = (dependencies: ReadonlyArray<Ticket>): string =>
  dependencies.map((dependency) => `${dependency.id} (${dependency.status})`).join(", ");

const renderCompletedHuman = (ticket: Ticket): string => {
  const encoded = encodeTicketForOutput(ticket);
  if (encoded.status !== "done") {
    return `Completed ${encoded.subject} (${encoded.id}).`;
  }
  const result = encoded.result;

  return [
    `Completed ${encoded.subject} (${encoded.id}).`,
    `Summary: ${result.summary}`,
    "Verification:",
    ...renderBullets(result.verification),
  ].join("\n");
};

export const commandComplete = Command.make("complete", {
  id: Argument.string("id"),
  actor: actorFlag,
  summary: Flag.string("summary").pipe(Flag.optional),
  details: Flag.string("details").pipe(Flag.optional),
  decision: Flag.string("decision").pipe(
    Flag.withDescription("Decision made during completion; may be repeated"),
    Flag.atMost(Number.MAX_SAFE_INTEGER),
  ),
  verification: Flag.string("verification").pipe(
    Flag.withDescription("Verification evidence; may be repeated"),
    Flag.atMost(Number.MAX_SAFE_INTEGER),
  ),
  resultMessage: Flag.string("result-message").pipe(Flag.optional),
  resultMessageFile: Flag.file("result-message-file").pipe(Flag.optional),
  allowNoVerification: Flag.boolean("allow-no-verification").pipe(
    Flag.withDescription("Allow completion without verification evidence"),
  ),
  force: Flag.boolean("force").pipe(
    Flag.withDescription("Complete despite incomplete dependencies or another active claim"),
  ),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow completing human-executor Tickets or bypassing human gates"),
  ),
}).pipe(
  Command.withDescription("Complete an open Ticket with a structured Result"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveActorIdentity(input.actor);
          const resultInput = yield* resolveCompletionResultInput(input);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, input.id);

          if (ticket.status !== "open") {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} is ${ticket.status} and cannot be completed.`,
            });
          }

          if (hasOpenChildren(ticket, tickets)) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} has open children and cannot be completed.`,
            });
          }

          if (ticket.executor === "human" && !input.allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(ticket, "complete it"),
            });
          }

          const incompleteDependencies = incompleteDependenciesForCompletion(ticket, tickets);
          if (incompleteDependencies.length > 0 && !input.force) {
            return yield* new CommandFailure({
              message: `Ticket ${ticket.id} has incomplete dependencies: ${renderIncompleteDependencies(
                incompleteDependencies,
              )}. Use --force to complete anyway.`,
            });
          }

          const humanDependency = firstHumanExecutorTicket(incompleteDependencies);
          if (humanDependency !== undefined && input.force && !input.allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanDependency, "bypass it"),
            });
          }

          const now = yield* DateTime.now;
          const currentClaim = ticket.claim;
          if (
            currentClaim !== undefined &&
            isClaimActive(currentClaim, now) &&
            currentClaim.actor !== identity &&
            !input.force
          ) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(ticket, currentClaim, "complete it"),
            });
          }

          const updatedTicket = completeTicket({
            ticket,
            summary: resultInput.summary,
            details: resultInput.details,
            decisions: resultInput.decisions,
            verification: resultInput.verification,
            completedAt: now,
            completedBy: identity,
          });
          const persistedTickets = yield* writeStore(paths, replaceTicket(tickets, updatedTicket));
          const persistedTicket = yield* resolveTicket(persistedTickets, ticket.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(persistedTicket),
                })
              : renderCompletedHuman(persistedTicket),
          );
        }),
      );
    }),
  ),
);
