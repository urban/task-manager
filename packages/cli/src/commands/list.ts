import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  allExecutorsFilter,
  allWorkItemStatuses,
  buildFilteredTree,
  resolveWorkItem,
  specificExecutorFilter,
  type WorkItemExecutor,
  type WorkItemExecutorFilter,
  type WorkItemStatus,
} from "../domain/WorkItem";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson, renderTreeJson, renderTreeLines } from "./shared/output";

const renderEmptyListMessage = (options: {
  readonly all: boolean;
  readonly status: WorkItemStatus | undefined;
  readonly executorFilter: WorkItemExecutorFilter;
}): string => {
  const executor =
    options.executorFilter._tag === "SpecificExecutor" ? `${options.executorFilter.executor} ` : "";
  return options.all
    ? `No ${executor}Work Items.`
    : options.status === undefined || options.status === "open"
      ? `No open ${executor}Work Items.`
      : `No ${options.status} ${executor}Work Items.`;
};

const visibleStatuses = (options: {
  readonly all: boolean;
  readonly status: Option.Option<WorkItemStatus>;
}): ReadonlySet<WorkItemStatus> =>
  new Set(
    options.all
      ? allWorkItemStatuses
      : [
          Option.match(options.status, {
            onNone: () => "open",
            onSome: (status) => status,
          }),
        ],
  );

const resolveExecutorFilter = (
  executor: Option.Option<WorkItemExecutor>,
  allExecutors: boolean,
): WorkItemExecutorFilter =>
  allExecutors
    ? allExecutorsFilter
    : specificExecutorFilter(
        Option.match(executor, {
          onNone: () => "agent",
          onSome: (value) => value,
        }),
      );

export const commandList = Command.make("list", {
  root: Flag.string("root").pipe(Flag.withDescription("Render only a subtree"), Flag.optional),
  status: Flag.choice("status", ["open", "done", "cancelled"]).pipe(
    Flag.withDescription("Render only Work Items with this lifecycle status"),
    Flag.optional,
  ),
  all: Flag.boolean("all").pipe(
    Flag.withDescription("Render open, done, and cancelled Work Items"),
  ),
  executor: Flag.choice("executor", ["agent", "human"]).pipe(
    Flag.withDescription("Render only Work Items with this executor"),
    Flag.optional,
  ),
  allExecutors: Flag.boolean("all-executors").pipe(
    Flag.withDescription("Render Work Items for both executors"),
  ),
}).pipe(
  Command.withDescription("List Work Items in a deterministic tree view"),
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
          const items = yield* loadStore(paths);
          const subtreeRoot = yield* Option.match(requestedRoot, {
            onNone: () => Effect.void,
            onSome: (value) => resolveWorkItem(items, value),
          });
          const statusFilter = visibleStatuses({ all, status });
          const executorFilter = resolveExecutorFilter(executor, allExecutors);
          const tree = buildFilteredTree(items, {
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
                  items: renderTreeJson(tree),
                })
              : tree.length === 0
                ? renderEmptyListMessage({ all, status: selectedStatus, executorFilter })
                : renderTreeLines(tree).join("\n"),
          );
        }),
      );
    }),
  ),
);
