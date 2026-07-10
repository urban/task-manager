import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveWorkItem, updateWorkItemDependencies } from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import {
  firstHumanExecutorWorkItem,
  humanExecutorGuardMessage,
  replaceWorkItem,
} from "./shared/work-items";

export const commandUnblock = Command.make("unblock", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(
    Flag.withDescription("Current dependency Work Item id or unique prefix"),
  ),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow removing human-executor dependency gates"),
  ),
}).pipe(
  Command.withDescription("Remove a dependency from a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const dependency = yield* resolveWorkItem(items, by);
          const currentDependencies = item.blockedBy ?? [];

          if (!currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} does not depend on ${dependency.id}.`,
            });
          }

          const humanItem = firstHumanExecutorWorkItem([item, dependency]);
          if (humanItem !== undefined && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanItem, "unblock it"),
            });
          }

          const updatedItem = yield* updateWorkItemDependencies({
            item,
            blockedBy: currentDependencies.filter((dependencyId) => dependencyId !== dependency.id),
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : `Unblocked ${persistedItem.subject} (${persistedItem.id}) from ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);
