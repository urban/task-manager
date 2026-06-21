import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

import { CommandFailure } from "../domain/Errors";
import { buildTree, resolveWorkItem } from "../domain/WorkItem";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson, renderTreeJson, renderTreeLines } from "./shared/output";

export const commandList = Command.make("list", {
  root: Flag.string("root").pipe(Flag.withDescription("Render only a subtree"), Flag.optional),
}).pipe(
  Command.withDescription("List the open backlog tree"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ root: requestedRoot }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const items = yield* loadStore(paths);
          const subtreeRoot = yield* Option.match(requestedRoot, {
            onNone: () => Effect.void,
            onSome: (value) => resolveWorkItem(items, value),
          });

          if (subtreeRoot !== undefined && subtreeRoot.status !== "open") {
            return yield* new CommandFailure({
              message: `Work Item ${subtreeRoot.id} is not open and cannot be listed in the backlog view.`,
            });
          }

          const tree = buildTree(items, {
            ...(subtreeRoot === undefined ? {} : { root: subtreeRoot }),
            openOnly: true,
          });

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  items: renderTreeJson(tree),
                })
              : tree.length === 0
                ? "No open Work Items."
                : renderTreeLines(tree).join("\n"),
          );
        }),
      );
    }),
  ),
);
