import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";

import { resolveWorkItem } from "../domain/WorkItem";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import {
  encodeItemForOutput,
  executeCommand,
  renderJson,
  renderWorkItemHuman,
} from "./shared/output";

export const commandShow = Command.make("show", {
  id: Argument.string("id"),
}).pipe(
  Command.withDescription("Show one Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(item),
                })
              : renderWorkItemHuman(item),
          );
        }),
      );
    }),
  ),
);
