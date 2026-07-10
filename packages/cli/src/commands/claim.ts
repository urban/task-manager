import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  formatClaimExpiresAt,
  isClaimActive,
  resolveWorkItem,
  updateWorkItemClaim,
  type WorkItem,
} from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { actorFlag } from "./shared/flags";
import { resolveActorIdentity } from "./shared/input";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import {
  activeClaimConflictMessage,
  humanExecutorGuardMessage,
  replaceWorkItem,
} from "./shared/work-items";

const renderClaimedHuman = (item: WorkItem): string => {
  const claim = item.claim;
  return claim === undefined
    ? `Claimed ${item.subject} (${item.id}).`
    : `Claimed ${item.subject} (${item.id}) for ${claim.actor} until ${formatClaimExpiresAt(claim)}.`;
};

export const commandClaim = Command.make("claim", {
  id: Argument.string("id"),
  actor: actorFlag,
  force: Flag.boolean("force").pipe(Flag.withDescription("Replace another active claim")),
  allowHuman: Flag.boolean("allow-human").pipe(
    Flag.withDescription("Allow claiming human-executor Work Items"),
  ),
}).pipe(
  Command.withDescription("Claim an open Work Item for an Actor Identity"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, actor, force, allowHuman }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveActorIdentity(actor);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);

          if (item.status !== "open") {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} is ${item.status} and cannot be claimed.`,
            });
          }

          if (item.executor === "human" && !allowHuman) {
            return yield* new CommandFailure({
              message: humanExecutorGuardMessage(item, "claim it"),
            });
          }

          const now = yield* DateTime.now;
          const currentClaim = item.claim;
          if (
            currentClaim !== undefined &&
            isClaimActive(currentClaim, now) &&
            currentClaim.actor !== identity &&
            !force
          ) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(item, currentClaim, "replace it"),
            });
          }

          const updatedItem = updateWorkItemClaim({
            item,
            actor: identity,
            claimedAt: now,
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : renderClaimedHuman(persistedItem),
          );
        }),
      );
    }),
  ),
);
