import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { CommandFailure, type TmError } from "../../domain/Errors";
import { readTextFile } from "../../storage/TaskStore";

export const resolveAgentIdentity = (
  agent: Option.Option<string>,
): Effect.Effect<string, CommandFailure> =>
  Option.match(agent, {
    onNone: () =>
      Effect.fail(
        new CommandFailure({
          message: "Agent Identity is required. Pass --agent <name> or set TM_AGENT.",
        }),
      ),
    onSome: (value) => {
      const identity = value.trim();
      return identity.length === 0
        ? Effect.fail(
            new CommandFailure({
              message: "Agent Identity must not be empty. Pass --agent <name> or set TM_AGENT.",
            }),
          )
        : Effect.succeed(identity);
    },
  });

export const resolveTextInput = (
  inline: Option.Option<string>,
  file: Option.Option<string>,
  fieldName: string,
): Effect.Effect<Option.Option<string>, TmError, FileSystem.FileSystem> =>
  Option.isSome(inline) && Option.isSome(file)
    ? Effect.fail(
        new CommandFailure({
          message: `Use either --${fieldName} or --${fieldName}-file, not both.`,
        }),
      )
    : Option.isSome(inline)
      ? Effect.succeed(Option.some(inline.value))
      : Option.isSome(file)
        ? readTextFile(file.value).pipe(Effect.map(Option.some))
        : Effect.succeed(Option.none());
