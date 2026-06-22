import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  cancelWorkItem,
  isClaimActive,
  resolveWorkItem,
  sortWorkItems,
  type WorkItem,
  type WorkItemClaim,
} from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { agentFlag } from "./shared/flags";
import { resolveAgentIdentity, resolveTextInput } from "./shared/input";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import { activeClaimConflictMessage } from "./shared/work-items";

interface ClaimConflict {
  readonly item: WorkItem;
  readonly claim: WorkItemClaim;
}

const resolveCancellationReason = Effect.fnUntraced(function* (input: {
  readonly reason: Option.Option<string>;
  readonly reasonFile: Option.Option<string>;
}) {
  const reasonInput = yield* resolveTextInput(input.reason, input.reasonFile, "reason");
  const reason = Option.match(reasonInput, {
    onNone: () => "",
    onSome: (value) => value.trim(),
  });

  if (reason === "") {
    return yield* new CommandFailure({
      message: "Cancellation reason is required. Pass --reason <text> or --reason-file <path>.",
    });
  }

  return reason;
});

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

const openDescendantsOf = (
  item: WorkItem,
  items: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> => {
  const itemsById = new Map(items.map((candidate) => [candidate.id, candidate]));
  return sortWorkItems(items).filter(
    (candidate) =>
      candidate.id !== item.id &&
      candidate.status === "open" &&
      isDescendantOf(candidate, item.id, itemsById),
  );
};

const claimConflictFor = (
  item: WorkItem,
  identity: string,
  now: DateTime.Utc,
): ClaimConflict | undefined => {
  const claim = item.claim;
  return claim !== undefined && isClaimActive(claim, now) && claim.agent !== identity
    ? { item, claim }
    : undefined;
};

const findActiveClaimConflict = (
  items: ReadonlyArray<WorkItem>,
  identity: string,
  now: DateTime.Utc,
): ClaimConflict | undefined => {
  for (const item of items) {
    const conflict = claimConflictFor(item, identity, now);
    if (conflict !== undefined) {
      return conflict;
    }
  }

  return undefined;
};

const replaceCancelledItems = (
  items: ReadonlyArray<WorkItem>,
  cancelledItems: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> => {
  const cancelledById = new Map(cancelledItems.map((item) => [item.id, item]));
  return items.map((item) => cancelledById.get(item.id) ?? item);
};

const renderCascadePreview = (item: WorkItem, descendants: ReadonlyArray<WorkItem>): string =>
  [
    `Work Item ${item.id} has ${descendants.length} open descendant Work Item${
      descendants.length === 1 ? "" : "s"
    } that would also be cancelled:`,
    ...descendants.map((descendant) => `- ${descendant.subject} (${descendant.id})`),
    "Re-run with --yes to confirm cascade cancellation.",
  ].join("\n");

const renderCancelledHuman = (cancelledItems: ReadonlyArray<WorkItem>, reason: string): string => {
  const [firstItem] = cancelledItems;
  if (cancelledItems.length === 1 && firstItem !== undefined) {
    return [`Cancelled ${firstItem.subject} (${firstItem.id}).`, `Reason: ${reason}`].join("\n");
  }

  return [
    `Cancelled ${cancelledItems.length} Work Items.`,
    ...cancelledItems.map((item) => `- ${item.subject} (${item.id})`),
    `Reason: ${reason}`,
  ].join("\n");
};

export const commandCancel = Command.make("cancel", {
  id: Argument.string("id"),
  reason: Flag.string("reason").pipe(Flag.optional),
  reasonFile: Flag.file("reason-file").pipe(Flag.optional),
  agent: agentFlag,
  force: Flag.boolean("force").pipe(
    Flag.withDescription("Cancel despite another agent's active claim"),
  ),
  yes: Flag.boolean("yes").pipe(Flag.withDescription("Confirm cascading cancellation")),
}).pipe(
  Command.withDescription("Cancel open Work Items with a structured Cancellation"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveAgentIdentity(input.agent);
          const reason = yield* resolveCancellationReason(input);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, input.id);

          if (item.status !== "open") {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} is ${item.status} and cannot be cancelled.`,
            });
          }

          const openDescendants = openDescendantsOf(item, items);
          if (openDescendants.length > 0 && !input.yes) {
            return yield* new CommandFailure({
              message: renderCascadePreview(item, openDescendants),
            });
          }

          const targets = [item, ...openDescendants];
          const now = yield* DateTime.now;
          const claimConflict = findActiveClaimConflict(targets, identity, now);
          if (claimConflict !== undefined && !input.force) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(
                claimConflict.item,
                claimConflict.claim,
                "cancel it",
              ),
            });
          }

          const cancelledItems = targets.map((target) =>
            cancelWorkItem({
              item: target,
              reason,
              cancelledAt: now,
              cancelledBy: identity,
            }),
          );
          const persistedItems = yield* writeStore(
            paths,
            replaceCancelledItems(items, cancelledItems),
          );
          const persistedCancelledItems = yield* Effect.forEach(cancelledItems, (cancelledItem) =>
            resolveWorkItem(persistedItems, cancelledItem.id),
          );
          const persistedTarget = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedTarget),
                  cancelledItems: persistedCancelledItems.map(encodeItemForOutput),
                })
              : renderCancelledHuman(persistedCancelledItems, reason),
          );
        }),
      );
    }),
  ),
);
