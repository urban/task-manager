import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveWorkItem, setWorkItemExecutor, type WorkItem } from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import { replaceWorkItem } from "./shared/work-items";

const renderSetExecutorHuman = (item: WorkItem, changed: boolean): string =>
  changed
    ? `Set executor for ${item.subject} (${item.id}) to ${item.executor}.`
    : `Executor for ${item.subject} (${item.id}) is already ${item.executor}.`;

export const commandSetExecutor = Command.make("set-executor", {
  id: Argument.string("id"),
  executor: Argument.choice("executor", ["agent", "human"]),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow changing to or from human executor"),
  ),
}).pipe(
  Command.withDescription("Change a Work Item executor"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, executor, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);

          if (item.executor === executor) {
            yield* Console.log(
              root.json
                ? renderJson({ ok: true, item: encodeItemForOutput(item) })
                : renderSetExecutorHuman(item, false),
            );
            return;
          }

          if ((item.executor === "human" || executor === "human") && !allowHuman) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} involves human executor. Pass --allow-human to change executor.`,
            });
          }

          const now = yield* DateTime.now;
          const updatedItem = setWorkItemExecutor({ item, executor, updatedAt: now });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({ ok: true, item: encodeItemForOutput(persistedItem) })
              : renderSetExecutorHuman(persistedItem, true),
          );
        }),
      );
    }),
  ),
);
