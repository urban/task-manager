import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Command from "effect/unstable/cli/Command";

import { resolveStorePaths, validateStoreOnDisk } from "../storage/TaskStore";
import { commandRoot } from "./root";
import { executeCommand, renderJson } from "./shared/output";

export const commandValidate = Command.make("validate").pipe(
  Command.withDescription("Validate tasks.jsonl"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const tickets = yield* validateStoreOnDisk(paths);
          const payload = {
            ok: true,
            ticketCount: tickets.length,
            tasksFile: paths.tasksFile,
          };

          yield* Console.log(
            root.json
              ? renderJson(payload)
              : `Validated ${tickets.length} Ticket${tickets.length === 1 ? "" : "s"} in ${paths.tasksFile}.`,
          );
        }),
      );
    }),
  ),
);
