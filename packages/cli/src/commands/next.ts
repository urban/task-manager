import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  allExecutorsFilter,
  resolveWorkItem,
  specificExecutorFilter,
  type WorkItemExecutor,
  type WorkItemExecutorFilter,
} from "../domain/WorkItem";
import { findNextActionableWorkItem } from "../domain/Validation";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import {
  encodeItemForOutput,
  executeCommand,
  renderJson,
  renderWorkItemHuman,
} from "./shared/output";

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

export const commandNext = Command.make("next", {
  root: Flag.string("root").pipe(
    Flag.withDescription("Select only within a Work Item subtree"),
    Flag.optional,
  ),
  includeClaimed: Flag.boolean("include-claimed").pipe(
    Flag.withDescription("Include actively claimed Work Items"),
  ),
  executor: Flag.choice("executor", ["agent", "human"]).pipe(
    Flag.withDescription("Select Work Items with this executor"),
    Flag.optional,
  ),
  allExecutors: Flag.boolean("all-executors").pipe(
    Flag.withDescription("Select across both executors"),
  ),
}).pipe(
  Command.withDescription("Select the next actionable Work Item"),
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
          const items = yield* loadStore(paths);
          const subtreeRoot = yield* Option.match(requestedRoot, {
            onNone: () => Effect.void,
            onSome: (value) => resolveWorkItem(items, value),
          });

          if (subtreeRoot !== undefined && subtreeRoot.status !== "open") {
            return yield* new CommandFailure({
              message: `Work Item ${subtreeRoot.id} is not open and cannot be used as the next root.`,
            });
          }

          const now = yield* DateTime.now;
          const nextItem = findNextActionableWorkItem(items, {
            ...(subtreeRoot === undefined ? {} : { root: subtreeRoot }),
            now,
            includeClaimed,
            executorFilter: resolveExecutorFilter(executor, allExecutors),
          });

          yield* Console.log(
            nextItem === undefined
              ? root.json
                ? renderJson({
                    ok: true,
                    reason: "no-actionable-work",
                  })
                : "No actionable Work Items."
              : root.json
                ? renderJson({
                    ok: true,
                    item: encodeItemForOutput(nextItem),
                  })
                : renderWorkItemHuman(nextItem),
          );
        }),
      );
    }),
  ),
);
