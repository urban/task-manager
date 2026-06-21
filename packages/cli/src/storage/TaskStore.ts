import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import { ensureValidStore } from "../domain/Validation";
import {
  decodeWorkItemJsonLine,
  encodeWorkItemJsonLine,
  sortWorkItems,
  type WorkItem,
} from "../domain/WorkItem";
import {
  CommandFailure,
  LockUnavailable,
  StorageFailure,
  StorageNotInitialized,
  ValidationFailure,
  type ValidationIssue,
} from "../domain/Errors";

export interface StorePaths {
  readonly baseDirectory: string;
  readonly storageDirectory: string;
  readonly tasksFile: string;
  readonly lockFile: string;
}

const mapPlatformError = (message: string) =>
  Effect.mapError(
    (error: { readonly message: string }) =>
      new StorageFailure({ message: `${message}: ${error.message}` }),
  );

const releaseLock = (lockFile: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(lockFile, { force: true }).pipe(Effect.catch(() => Effect.void));
  });

const withWriteLock = <A, E, R>(
  lockFile: string,
  effect: Effect.Effect<A, E | StorageFailure, R>,
): Effect.Effect<A, E | StorageFailure | LockUnavailable, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const claimedAt = yield* DateTime.now;

      yield* Effect.acquireRelease(
        fs
          .writeFileString(lockFile, DateTime.formatIso(claimedAt), { flag: "wx" })
          .pipe(Effect.mapError(() => new LockUnavailable({ lockFile }))),
        () => releaseLock(lockFile),
      );

      return yield* effect;
    }),
  );

const syncFile = (filePath: string): Effect.Effect<void, StorageFailure, FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(filePath).pipe(mapPlatformError(`Failed to open ${filePath}`));
      yield* file.sync.pipe(mapPlatformError(`Failed to fsync ${filePath}`));
    }),
  );

const trimTrailingEmptyLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }
  return lines.slice(0, end);
};

const decodeStoreContent = (
  content: string,
): Effect.Effect<ReadonlyArray<WorkItem>, ValidationFailure> =>
  decodeLines(trimTrailingEmptyLines(content.split("\n")));

const decodeLines = (
  lines: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<WorkItem>, ValidationFailure> =>
  Effect.gen(function* () {
    const issues: Array<ValidationIssue> = [];
    const items: Array<WorkItem> = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === "") {
        issues.push({
          message: "Blank lines are only allowed at the end of tasks.jsonl.",
          line: index + 1,
        });
        continue;
      }

      const decoded = yield* Effect.result(decodeWorkItemJsonLine(line));
      if (Result.isFailure(decoded)) {
        issues.push({
          message: decoded.failure.message,
          line: index + 1,
        });
        continue;
      }

      items.push(decoded.success);
    }

    const validation = ensureValidStore(items, "Store validation failed.");
    if (validation !== undefined) {
      return yield* new ValidationFailure({
        summary: validation.summary,
        issues: [...issues, ...validation.issues],
      });
    }

    if (issues.length > 0) {
      return yield* new ValidationFailure({
        summary: "Store validation failed.",
        issues,
      });
    }

    return items;
  });

export const resolveStorePaths = Effect.fnUntraced(function* (options: {
  readonly cwd: Option.Option<string>;
  readonly storagePath: Option.Option<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const baseDirectory = Option.getOrElse(options.cwd, () => path.resolve());

  let gitRoot = Option.none<string>();
  let current = path.resolve(baseDirectory);
  let keepSearching = true;

  while (keepSearching) {
    const gitMarker = path.join(current, ".git");
    const exists = yield* fs
      .exists(gitMarker)
      .pipe(mapPlatformError(`Failed to inspect ${gitMarker}`));

    if (exists) {
      gitRoot = Option.some(current);
      keepSearching = false;
      continue;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      keepSearching = false;
      continue;
    }

    current = parent;
  }

  const defaultBase = Option.getOrElse(gitRoot, () => baseDirectory);
  const storageDirectory = Option.match(options.storagePath, {
    onNone: () => path.join(defaultBase, ".tasks"),
    onSome: (value) =>
      path.isAbsolute(value) ? path.normalize(value) : path.resolve(baseDirectory, value),
  });

  return {
    baseDirectory,
    storageDirectory,
    tasksFile: path.join(storageDirectory, "tasks.jsonl"),
    lockFile: path.join(storageDirectory, "lock"),
  } satisfies StorePaths;
});

export const ensureStoreDirectory = (
  paths: StorePaths,
): Effect.Effect<void, StorageFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs
      .makeDirectory(paths.storageDirectory, { recursive: true })
      .pipe(mapPlatformError(`Failed to create ${paths.storageDirectory}`));
  });

export const readTextFile = (
  filePath: string,
): Effect.Effect<string, StorageFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(filePath).pipe(mapPlatformError(`Failed to read ${filePath}`));
  });

export const loadStore = (
  paths: StorePaths,
): Effect.Effect<
  ReadonlyArray<WorkItem>,
  StorageFailure | StorageNotInitialized | ValidationFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs
      .exists(paths.tasksFile)
      .pipe(mapPlatformError(`Failed to inspect ${paths.tasksFile}`));

    if (!exists) {
      return yield* new StorageNotInitialized({ tasksFile: paths.tasksFile });
    }

    const content = yield* fs
      .readFileString(paths.tasksFile)
      .pipe(mapPlatformError(`Failed to read ${paths.tasksFile}`));
    return yield* decodeStoreContent(content);
  });

export const validateStoreOnDisk = (
  paths: StorePaths,
): Effect.Effect<
  ReadonlyArray<WorkItem>,
  StorageFailure | StorageNotInitialized | ValidationFailure,
  FileSystem.FileSystem
> => loadStore(paths);

export const writeStore = (
  paths: StorePaths,
  items: ReadonlyArray<WorkItem>,
): Effect.Effect<
  ReadonlyArray<WorkItem>,
  StorageFailure | ValidationFailure | LockUnavailable,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const validation = ensureValidStore(items, "Store validation failed before write.");
    if (validation !== undefined) {
      return yield* validation;
    }

    yield* ensureStoreDirectory(paths);

    const sortedItems = sortWorkItems(items);
    const encodedLines = yield* Effect.forEach(sortedItems, (item) =>
      encodeWorkItemJsonLine(item).pipe(
        Effect.mapError(
          (error: { readonly message: string }) =>
            new StorageFailure({
              message: `Failed to encode ${item.id}: ${error.message}`,
            }),
        ),
      ),
    );
    const content = encodedLines.join("\n");

    return yield* withWriteLock(
      paths.lockFile,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempFile = yield* fs
          .makeTempFile({
            directory: paths.storageDirectory,
            prefix: "tasks-",
            suffix: ".jsonl",
          })
          .pipe(mapPlatformError(`Failed to create a temporary file in ${paths.storageDirectory}`));

        yield* fs
          .writeFileString(tempFile, content)
          .pipe(
            mapPlatformError(`Failed to write ${tempFile}`),
            Effect.andThen(syncFile(tempFile)),
            Effect.andThen(
              fs
                .rename(tempFile, paths.tasksFile)
                .pipe(mapPlatformError(`Failed to rename ${tempFile} to ${paths.tasksFile}`)),
            ),
            Effect.ensuring(
              fs.remove(tempFile, { force: true }).pipe(Effect.catch(() => Effect.void)),
            ),
          );

        const persistedContent = yield* fs
          .readFileString(paths.tasksFile)
          .pipe(mapPlatformError(`Failed to read ${paths.tasksFile}`));
        const persistedItems = yield* decodeStoreContent(persistedContent);
        const persistedValidation = ensureValidStore(
          persistedItems,
          "Store validation failed after write.",
        );
        if (persistedValidation !== undefined) {
          return yield* persistedValidation;
        }
        return persistedItems;
      }),
    );
  });

export const initStore = (
  paths: StorePaths,
): Effect.Effect<
  {
    readonly created: boolean;
    readonly items: ReadonlyArray<WorkItem>;
  },
  StorageFailure | ValidationFailure | LockUnavailable,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* ensureStoreDirectory(paths);
    const exists = yield* fs
      .exists(paths.tasksFile)
      .pipe(mapPlatformError(`Failed to inspect ${paths.tasksFile}`));

    if (exists) {
      const content = yield* fs
        .readFileString(paths.tasksFile)
        .pipe(mapPlatformError(`Failed to read ${paths.tasksFile}`));
      const items = yield* decodeStoreContent(content);
      return {
        created: false,
        items,
      };
    }

    const items = yield* writeStore(paths, []);
    return {
      created: true,
      items,
    };
  });

export const ensureStoreExists = (
  paths: StorePaths,
): Effect.Effect<void, CommandFailure | StorageFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs
      .exists(paths.tasksFile)
      .pipe(mapPlatformError(`Failed to inspect ${paths.tasksFile}`));
    if (!exists) {
      return yield* new CommandFailure({
        message: `Task store is not initialized at ${paths.tasksFile}. Run tm init first.`,
      });
    }
  });
