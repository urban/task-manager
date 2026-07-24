import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { allExecutorsFilter, resolveTicket, specificExecutorFilter } from "../domain/Ticket";

type TicketExecutor = import("../domain/Ticket").TicketExecutor;
type TicketExecutorFilter = import("../domain/Ticket").TicketExecutorFilter;
import { findNextActionableTicket } from "../domain/Validation";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import {
  encodeTicketForOutput,
  executeCommand,
  renderJson,
  renderTicketHuman,
} from "./shared/output";

const resolveExecutorFilter = (
  executor: Option.Option<TicketExecutor>,
  allExecutors: boolean,
): TicketExecutorFilter =>
  allExecutors
    ? allExecutorsFilter
    : specificExecutorFilter(
        Option.match(executor, {
          onNone: () => "agent",
          onSome: (value) => value,
        }),
      );

export const commandNext = Command.make("next", {
  root: Flag.string("root").pipe(
    Flag.withDescription("Select only within a Ticket subtree"),
    Flag.optional,
  ),
  includeClaimed: Flag.boolean("include-claimed").pipe(
    Flag.withDescription("Include actively claimed Tickets"),
  ),
  executor: Flag.choice("executor", ["agent", "human"]).pipe(
    Flag.withDescription("Select Tickets with this executor"),
    Flag.optional,
  ),
  allExecutors: Flag.boolean("all-executors").pipe(
    Flag.withDescription("Select across both executors"),
  ),
}).pipe(
  Command.withDescription("Select the next actionable Ticket"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ root: requestedRoot, includeClaimed, executor, allExecutors }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          if (allExecutors && Option.isSome(executor)) {
            return yield* new CommandFailure({
              message: "Use either --executor or --all-executors, not both.",
            });
          }

          const paths = yield* resolveStorePaths(root);
          const tickets = yield* loadStore(paths);
          const subtreeRoot = yield* Option.match(requestedRoot, {
            onNone: () => Effect.void,
            onSome: (value) => resolveTicket(tickets, value),
          });

          if (subtreeRoot !== undefined && subtreeRoot.status !== "open") {
            return yield* new CommandFailure({
              message: `Ticket ${subtreeRoot.id} is not open and cannot be used as the next root.`,
            });
          }

          const now = yield* DateTime.now;
          const nextTicket = findNextActionableTicket(tickets, {
            ...(subtreeRoot === undefined ? {} : { root: subtreeRoot }),
            now,
            includeClaimed,
            executorFilter: resolveExecutorFilter(executor, allExecutors),
          });

          yield* Console.log(
            nextTicket === undefined
              ? root.json
                ? renderJson({
                    ok: true,
                    reason: "no-actionable-work",
                  })
                : "No actionable Tickets."
              : root.json
                ? renderJson({
                    ok: true,
                    ticket: encodeTicketForOutput(nextTicket),
                  })
                : renderTicketHuman(nextTicket),
          );
        }),
      );
    }),
  ),
);
