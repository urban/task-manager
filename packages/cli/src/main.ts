import * as Command from "effect/unstable/cli/Command";

import { commandBlock } from "./commands/block";
import { commandCancel } from "./commands/cancel";
import { commandClaim } from "./commands/claim";
import { commandComplete } from "./commands/complete";
import { commandCreate } from "./commands/create";
import { commandDelete } from "./commands/delete";
import { commandInit } from "./commands/init";
import { commandList } from "./commands/list";
import { commandNext } from "./commands/next";
import { commandRelease } from "./commands/release";
import { commandRoot } from "./commands/root";
import { commandSetExecutor } from "./commands/set-executor";
import { commandShow } from "./commands/show";
import { commandUnblock } from "./commands/unblock";
import { commandUpdate } from "./commands/update";
import { commandValidate } from "./commands/validate";

const version = "0.1.0";

const tmCommand = commandRoot.pipe(
  Command.withSubcommands([
    commandInit,
    commandValidate,
    commandCreate,
    commandUpdate,
    commandSetExecutor,
    commandShow,
    commandList,
    commandNext,
    commandClaim,
    commandRelease,
    commandComplete,
    commandCancel,
    commandDelete,
    commandBlock,
    commandUnblock,
  ]),
);

export const runTmCli = Command.runWith(tmCommand, { version });

export const run = Command.run(tmCommand, { version });

export { isTmError as isKnownTmError } from "./domain/Errors";
export { isLeafTicket, orderedOpenChildren } from "./domain/Validation";
export { encodeTicketForOutput as encodeOutputTicket } from "./commands/shared/output";
