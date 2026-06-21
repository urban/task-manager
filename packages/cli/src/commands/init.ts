import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";

import { initStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson } from "./shared/output";

export const commandInit = Command.make("init").pipe(
  Command.withDescription("Initialize the task store"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const result = yield* initStore(paths);
          const payload = {
            ok: true,
            created: result.created,
            storageDirectory: paths.storageDirectory,
            tasksFile: paths.tasksFile,
          };

          yield* Console.log(
            root.json
              ? renderJson(payload)
              : `Initialized ${paths.tasksFile}${result.created ? "" : " (already existed)"}.`,
          );
        }),
      );
    }),
  ),
);
