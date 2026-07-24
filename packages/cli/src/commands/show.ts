import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";

import { resolveTicket } from "../domain/Ticket";
import { loadStore, resolveStorePaths } from "../storage/TaskStore";
import { commandRoot } from "./root";
import {
  encodeTicketForOutput,
  executeCommand,
  renderJson,
  renderTicketHuman,
} from "./shared/output";

export const commandShow = Command.make("show", {
  id: Argument.string("id"),
}).pipe(
  Command.withDescription("Show one Ticket"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const root = yield* commandRoot;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const tickets = yield* loadStore(paths);
          const ticket = yield* resolveTicket(tickets, id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  ticket: encodeTicketForOutput(ticket),
                })
              : renderTicketHuman(ticket),
          );
        }),
      );
    }),
  ),
);
