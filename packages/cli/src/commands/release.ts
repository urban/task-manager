import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import {
  clearWorkItemClaim,
  formatClaimExpiresAt,
  isClaimActive,
  resolveWorkItem,
  type WorkItem,
  type WorkItemClaim,
} from "../domain/WorkItem";
import { ensureStoreExists, loadStore, resolveStorePaths, writeStore } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { agentFlag } from "./shared/flags";
import { resolveAgentIdentity } from "./shared/input";
import { encodeItemForOutput, executeCommand, renderJson } from "./shared/output";
import { activeClaimConflictMessage, replaceWorkItem } from "./shared/work-items";

const renderReleasedHuman = (item: WorkItem, claim: WorkItemClaim): string =>
  `Released claim on ${item.subject} (${item.id}) held by ${claim.agent} until ${formatClaimExpiresAt(
    claim,
  )}.`;

export const commandRelease = Command.make("release", {
  id: Argument.string("id"),
  agent: agentFlag,
  force: Flag.boolean("force").pipe(Flag.withDescription("Release another active claim")),
}).pipe(
  Command.withDescription("Release an Agent Claim"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, agent, force }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const identity = yield* resolveAgentIdentity(agent);
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const currentClaim = item.claim;

          if (currentClaim === undefined) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} has no claim to release.`,
            });
          }

          const now = yield* DateTime.now;
          if (isClaimActive(currentClaim, now) && currentClaim.agent !== identity && !force) {
            return yield* new CommandFailure({
              message: activeClaimConflictMessage(item, currentClaim, "release it"),
            });
          }

          const updatedItem = clearWorkItemClaim({ item, updatedAt: now });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : renderReleasedHuman(persistedItem, currentClaim),
          );
        }),
      );
    }),
  ),
);
