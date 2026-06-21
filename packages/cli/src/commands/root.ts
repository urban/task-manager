import * as Config from "effect/Config";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";

const storagePathFlag = Flag.string("storage-path").pipe(
  Flag.withDescription("Use a custom .tasks directory"),
  Flag.withFallbackConfig(Config.string("TM_STORAGE_PATH")),
  Flag.optional,
);

const cwdFlag = Flag.directory("cwd").pipe(
  Flag.withDescription("Resolve storage relative to this directory"),
  Flag.withFallbackConfig(Config.string("TM_CWD")),
  Flag.optional,
);

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Emit machine-readable JSON"));

export const commandRoot = Command.make("tm").pipe(
  Command.withDescription("Local-first agent task manager"),
  Command.withSharedFlags({
    storagePath: storagePathFlag,
    cwd: cwdFlag,
    json: jsonFlag,
  }),
);
