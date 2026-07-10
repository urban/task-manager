import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { resolveWorkItem, sortWorkItems, type WorkItem } from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson } from "./shared/output";
import { firstHumanExecutorWorkItem, humanExecutorGuardMessage } from "./shared/work-items";

interface DeletedWorkItemOutput {
  readonly id: string;
  readonly subject: string;
  readonly executor: string;
}

interface DanglingDependencyRisk {
  readonly item: WorkItem;
  readonly dependencyId: string;
}

const deletionWarning =
  "Deletion is destructive. Prefer tm cancel for real work; use delete only for accidental records.";

const isDescendantOf = (
  candidate: WorkItem,
  ancestorId: string,
  itemsById: ReadonlyMap<string, WorkItem>,
): boolean => {
  let currentParentId = candidate.parentId;

  while (currentParentId !== undefined) {
    if (currentParentId === ancestorId) {
      return true;
    }

    const parent = itemsById.get(currentParentId);
    if (parent === undefined) {
      return false;
    }
    currentParentId = parent.parentId;
  }

  return false;
};

const deletedSubtreeOf = (
  item: WorkItem,
  items: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> => {
  const itemsById = new Map(items.map((candidate) => [candidate.id, candidate]));
  return sortWorkItems(items).filter(
    (candidate) => candidate.id === item.id || isDescendantOf(candidate, item.id, itemsById),
  );
};

const findDanglingDependencyRisks = (
  items: ReadonlyArray<WorkItem>,
  deletedIds: ReadonlySet<string>,
): ReadonlyArray<DanglingDependencyRisk> =>
  sortWorkItems(items).flatMap((item) => {
    if (deletedIds.has(item.id)) {
      return [];
    }

    return (item.blockedBy ?? [])
      .filter((dependencyId) => deletedIds.has(dependencyId))
      .map((dependencyId) => ({ item, dependencyId }));
  });

const toDeletedWorkItemOutput = (item: WorkItem): DeletedWorkItemOutput => ({
  id: item.id,
  subject: item.subject,
  executor: item.executor,
});

const renderWorkItemBullet = (item: WorkItem): string => `- ${item.subject} (${item.id})`;

const renderDeletePreview = (items: ReadonlyArray<WorkItem>): string =>
  [
    deletionWarning,
    `The following ${items.length} Work Item${
      items.length === 1 ? "" : "s"
    } would be permanently deleted:`,
    ...items.map(renderWorkItemBullet),
    "Re-run with --yes to confirm destructive deletion.",
  ].join("\n");

const renderDanglingDependencyRisks = (risks: ReadonlyArray<DanglingDependencyRisk>): string =>
  [
    "Deletion would leave dangling dependencies.",
    "Please unblock, cancel, or delete dependent Work Items first.",
    ...risks.map(
      (risk) =>
        `- ${risk.item.subject} (${risk.item.id}) depends on deleted Work Item ${risk.dependencyId}`,
    ),
  ].join("\n");

const renderDeletedHuman = (items: ReadonlyArray<WorkItem>): string => {
  const [firstItem] = items;
  const deletionSummary =
    items.length === 1 && firstItem !== undefined
      ? `Deleted ${firstItem.subject} (${firstItem.id}).`
      : [`Deleted ${items.length} Work Items.`, ...items.map(renderWorkItemBullet)].join("\n");

  return [deletionWarning, deletionSummary].join("\n");
};

export const commandDelete = Command.make("delete", {
  id: Argument.string("id"),
  yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm destructive deletion")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow deleting human-executor Work Items"),
  ),
}).pipe(
  Command.withDescription("Delete accidental Work Items and descendants"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, yes, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const deletedItems = deletedSubtreeOf(item, items);

          if (!yes) {
            return yield* new CommandFailure({
              message: renderDeletePreview(deletedItems),
            });
          }

          const humanDeletedItem = firstHumanExecutorWorkItem(deletedItems);
          if (humanDeletedItem !== undefined && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(humanDeletedItem, "delete it"),
            });
          }

          const deletedIds = new Set(deletedItems.map((deletedItem) => deletedItem.id));
          const danglingDependencyRisks = findDanglingDependencyRisks(items, deletedIds);
          if (danglingDependencyRisks.length > 0) {
            return yield* new CommandFailure({
              message: renderDanglingDependencyRisks(danglingDependencyRisks),
            });
          }

          yield* writeStore(
            paths,
            items.filter((candidate) => !deletedIds.has(candidate.id)),
          );

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  deleted: deletedItems.map(toDeletedWorkItemOutput),
                })
              : renderDeletedHuman(deletedItems),
          );
        }),
      );
    }),
  ),
);
