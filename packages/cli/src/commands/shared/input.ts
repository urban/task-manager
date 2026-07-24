import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import { CommandFailure } from "../../domain/Errors";

type TmError = import("../../domain/Errors").TmError;
import { readTextFile } from "../../storage/TaskStore";

export const resolveActorIdentity = (
  actor: Option.Option<string>,
): Effect.Effect<string, CommandFailure> =>
  Option.match(actor, {
    onNone: () =>
      Effect.fail(
        new CommandFailure({
          message: "Actor Identity is required. Pass --actor <name> or set TM_ACTOR.",
        }),
      ),
    onSome: (value) => {
      const identity = value.trim();
      return identity.length === 0
        ? Effect.fail(
            new CommandFailure({
              message: "Actor Identity must not be empty. Pass --actor <name> or set TM_ACTOR.",
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
