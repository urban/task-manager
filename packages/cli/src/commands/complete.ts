import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { hasOpenChildren } from "../domain/Validation";
import {
  completeWorkItem,
  isClaimActive,
  resolveWorkItem,
  type WorkItem,
} from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { resolveCompletionResultInput } from "./complete-input";
import { commandRoot } from "./root";
import { agentFlag } from "./shared/flags";
import { resolveAgentIdentity } from "./shared/input";
import { encodeItemForOutput, executeCommand, renderBullets, renderJson } from "./shared/output";
import { activeClaimConflictMessage, replaceWorkItem } from "./shared/work-items";

const incompleteDependenciesForCompletion = (
  item: WorkItem,
  items: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> => {
  const itemsById = new Map(items.map((candidate) => [candidate.id, candidate]));
  return (item.blockedBy ?? []).flatMap((dependencyId) => {
    const dependency = itemsById.get(dependencyId);
    return dependency === undefined || dependency.status === "done" ? [] : [dependency];
  });
};

const renderIncompleteDependencies = (dependencies: ReadonlyArray<WorkItem>): string =>
  dependencies.map((dependency) => `${dependency.id} (${dependency.status})`).join(", ");

const renderCompletedHuman = (item: WorkItem): string => {
  const encoded = encodeItemForOutput(item);
  const result = encoded.result;
  if (result === undefined) {
    return `Completed ${encoded.subject} (${encoded.id}).`;
  }

  return [
    `Completed ${encoded.subject} (${encoded.id}).`,
    `Summary: ${result.summary}`,
    "Verification:",
    ...renderBullets(result.verification),
  ].join("\n");
};

export const commandComplete = Command.make("complete", {
  id: Argument.string("id"),
  agent: agentFlag,
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
}).pipe(
  Command.withDescription("Complete an open Work Item with a structured Result"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveAgentIdentity(input.agent);
          const resultInput = yield* resolveCompletionResultInput(input);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, input.id);

          if (item.status !== "open") {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} is ${item.status} and cannot be completed.`,
            });
          }

          if (hasOpenChildren(item, items)) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} has open children and cannot be completed.`,
            });
          }

          const incompleteDependencies = incompleteDependenciesForCompletion(item, items);
          if (incompleteDependencies.length > 0 && !input.force) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} has incomplete dependencies: ${renderIncompleteDependencies(
                incompleteDependencies,
              )}. Use --force to complete anyway.`,
            });
          }

          const now = yield* DateTime.now;
          const currentClaim = item.claim;
          if (
            currentClaim !== undefined &&
            isClaimActive(currentClaim, now) &&
            currentClaim.agent !== identity &&
            !input.force
          ) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(item, currentClaim, "complete it"),
            });
          }

          const updatedItem = completeWorkItem({
            item,
            summary: resultInput.summary,
            details: resultInput.details,
            decisions: resultInput.decisions,
            verification: resultInput.verification,
            completedAt: now,
            completedBy: identity,
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : renderCompletedHuman(persistedItem),
          );
        }),
      );
    }),
  ),
);
