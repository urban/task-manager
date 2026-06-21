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
import { replaceWorkItem } from "./shared/work-items";

export const commandBlock = Command.make("block", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(
    Flag.withDescription("Work Item id or unique prefix that blocks this item"),
  ),
}).pipe(
  Command.withDescription("Add a dependency to a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const dependency = yield* resolveWorkItem(items, by);

          if (item.id === dependency.id) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} cannot depend on itself.`,
            });
          }

          const currentDependencies = item.blockedBy ?? [];
          if (currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} already depends on ${dependency.id}.`,
            });
          }

          const updatedItem = yield* updateWorkItemDependencies({
            item,
            blockedBy: [...currentDependencies, dependency.id],
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : `Blocked ${persistedItem.subject} (${persistedItem.id}) by ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);
