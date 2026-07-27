import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  allExecutorsFilter,
  allTicketStatuses,
  buildFilteredTree,
  resolveTicket,
  specificExecutorFilter,
} from "../domain/Ticket";

type TicketExecutor = import("../domain/Ticket").TicketExecutor;
type TicketExecutorFilter = import("../domain/Ticket").TicketExecutorFilter;
type TicketStatus = import("../domain/Ticket").TicketStatus;
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson, renderTreeJson, renderTreeLines } from "./shared/output";

const renderEmptyListMessage = (options: {
  readonly status: TicketStatus | undefined;
  readonly executorFilter: TicketExecutorFilter;
}): string => {
  const executor =
    options.executorFilter._tag === "SpecificExecutor" ? `${options.executorFilter.executor} ` : "";
  return options.status === undefined
    ? `No ${executor}Tickets.`
    : `No ${options.status} ${executor}Tickets.`;
};

const visibleStatuses = (status: Option.Option<TicketStatus>): ReadonlySet<TicketStatus> =>
  new Set(
    Option.match(status, {
      onNone: () => allTicketStatuses,
      onSome: (value) => [value],
    }),
  );

const resolveExecutorFilter = (
  executor: Option.Option<TicketExecutor>,
  allExecutors: boolean,
): TicketExecutorFilter =>
  allExecutors
    ? allExecutorsFilter
    : Option.match(executor, {
        onNone: () => allExecutorsFilter,
        onSome: specificExecutorFilter,
      });

export const commandList = Command.make("list", {
  root: Flag.string("root").pipe(Flag.withDescription("Render only a subtree"), Flag.optional),
  status: Flag.choice("status", ["open", "done", "cancelled"]).pipe(
    Flag.withDescription("Render only Tickets with this lifecycle status"),
    Flag.optional,
  ),
  all: Flag.boolean("all").pipe(Flag.withDescription("Render open, done, and cancelled Tickets")),
  executor: Flag.choice("executor", ["agent", "human"]).pipe(
    Flag.withDescription("Render only Tickets with this executor"),
    Flag.optional,
  ),
  allExecutors: Flag.boolean("all-executors").pipe(
    Flag.withDescription("Render Tickets for both executors"),
  ),
}).pipe(
  Command.withDescription("List Tickets in a deterministic tree view"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ root: requestedRoot, status, all, executor, allExecutors }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          if (all && Option.isSome(status)) {
            return yield* new CommandFailure({
              message: "Use either --all or --status, not both.",
            });
          }
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
          const statusFilter = visibleStatuses(status);
          const executorFilter = resolveExecutorFilter(executor, allExecutors);
          const tree = buildFilteredTree(tickets, {
            ...(subtreeRoot === undefined ? {} : { root: subtreeRoot }),
            statuses: statusFilter,
            executorFilter,
          });
          const selectedStatus = Option.match(status, {
            onNone: () => undefined,
            onSome: (value) => value,
          });

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  tickets: renderTreeJson(tree),
                })
              : tree.length === 0
                ? renderEmptyListMessage({ status: selectedStatus, executorFilter })
                : renderTreeLines(tree, executorFilter).join("\n"),
          );
        }),
      );
    }),
  ),
);
