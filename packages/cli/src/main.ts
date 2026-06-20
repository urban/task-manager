import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import * as Argument from "effect/unstable/cli/Argument";

import {
  buildTree,
  encodeWorkItem,
  ensureValidSubject,
  makeOpenWorkItem,
  makeWorkItemId,
  resolveWorkItem,
  updateWorkItemDependencies,
  type WorkItemEncoded,
  type WorkItem,
} from "./domain/WorkItem";
import {
  ensureCanCreateItem,
  findNextActionableWorkItem,
  hasOpenChildren,
  sortChildrenForSelection,
} from "./domain/Validation";
import { CommandFailure, isTmError, type TmError, ValidationFailure } from "./errors/TmErrors";
import {
  ensureStoreExists,
  initStore,
  loadStore,
  readTextFile,
  resolveStorePaths,
  validateStoreOnDisk,
  writeStore,
} from "./storage/TaskStore";

const version = "0.1.0";
const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);

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

const tmBase = Command.make("tm").pipe(
  Command.withDescription("Local-first agent task manager"),
  Command.withSharedFlags({
    storagePath: storagePathFlag,
    cwd: cwdFlag,
    json: jsonFlag,
  }),
);

const renderJson = (value: unknown): string => encodeJson(value);

const encodeItemForOutput = (item: WorkItem): WorkItemEncoded => encodeWorkItem(item);
const isValidationFailure = Schema.is(ValidationFailure);

const errorMessage = (error: Exclude<TmError, ValidationFailure>): string => {
  switch (error._tag) {
    case "CommandFailure":
    case "StorageFailure":
      return error.message;
    case "StorageNotInitialized":
      return `Task store is not initialized at ${error.tasksFile}. Run tm init first.`;
    case "WorkItemNotFound":
      return `Work Item ${error.query} was not found.`;
    case "WorkItemAmbiguous":
      return `Work Item prefix ${error.query} is ambiguous. Matches: ${error.matches.join(", ")}.`;
    case "LockUnavailable":
      return `Task store is locked at ${error.lockFile}. Try again after the current write finishes.`;
  }
};

const renderErrorJson = (error: TmError): string => {
  if (isValidationFailure(error)) {
    return renderJson({
      ok: false,
      error: {
        type: error._tag,
        summary: error.summary,
        issues: error.issues,
      },
    });
  }

  return renderJson({
    ok: false,
    error: {
      type: error._tag,
      message: errorMessage(error),
    },
  });
};

const renderErrorHuman = (error: TmError): string => {
  if (isValidationFailure(error)) {
    const lines = [`Error: ${error.summary}`];
    for (const issue of error.issues) {
      const location = issue.line !== undefined ? `line ${issue.line}` : issue.path;
      lines.push(location === undefined ? `- ${issue.message}` : `- ${location}: ${issue.message}`);
    }
    return lines.join("\n");
  }

  return `Error: ${errorMessage(error)}`;
};

const reportError = (json: boolean, error: TmError): Effect.Effect<void> => {
  const message = json ? renderErrorJson(error) : renderErrorHuman(error);
  return json ? Console.log(message) : Console.error(message);
};

const executeCommand = <A, R>(
  json: boolean,
  effect: Effect.Effect<A, TmError, R>,
): Effect.Effect<A, TmError, R> =>
  Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.result);
    if (Result.isFailure(result)) {
      yield* reportError(json, result.failure);
      return yield* result.failure;
    }
    return result.success;
  });

const renderWorkItemHuman = (item: WorkItem): string => {
  const encoded = encodeItemForOutput(item);
  const dependencies = encoded.blockedBy?.length ?? 0;

  return [
    `${encoded.level.toUpperCase()} ${encoded.id}`,
    `Status: ${encoded.status}`,
    `Subject: ${encoded.subject}`,
    `Parent: ${encoded.parentId ?? "-"}`,
    `Dependencies: ${dependencies === 0 ? "-" : (encoded.blockedBy?.join(", ") ?? "-")}`,
    "",
    "Description:",
    encoded.description === "" ? "-" : encoded.description,
    "",
    "Agent Context:",
    encoded.agentContext === "" ? "-" : encoded.agentContext,
    "",
    "Result:",
    encoded.result === undefined ? "-" : renderJson(encoded.result),
  ].join("\n");
};

const renderTreeLines = (
  nodes: ReadonlyArray<ReturnType<typeof buildTree>[number]>,
  prefix = "",
): ReadonlyArray<string> => {
  const lines: Array<string> = [];

  nodes.forEach((node, index) => {
    const branch = index === nodes.length - 1 ? "└─" : "├─";
    lines.push(`${prefix}${branch} ${node.item.subject} (${node.item.id})`);
    const childPrefix = `${prefix}${index === nodes.length - 1 ? "   " : "│  "}`;
    lines.push(...renderTreeLines(node.children, childPrefix));
  });

  return lines;
};

interface RenderTreeJsonNode {
  readonly id: string;
  readonly level: string;
  readonly status: string;
  readonly subject: string;
  readonly children: ReadonlyArray<RenderTreeJsonNode>;
}

const renderTreeJson = (
  nodes: ReadonlyArray<ReturnType<typeof buildTree>[number]>,
): ReadonlyArray<RenderTreeJsonNode> =>
  nodes.map((node) => ({
    id: node.item.id,
    level: node.item.level,
    status: node.item.status,
    subject: node.item.subject,
    children: renderTreeJson(node.children),
  }));

const resolveTextInput = (
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

const parseMessage = (
  message: string,
): {
  readonly subject: string;
  readonly description: string;
} => {
  const normalized = message.replaceAll("\r\n", "\n");
  const [firstLine = "", ...rest] = normalized.split("\n");
  const description = rest.join("\n").replace(/^\n+/, "").trimEnd();

  return {
    subject: firstLine.trim(),
    description,
  };
};

const initCommand = Command.make("init").pipe(
  Command.withDescription("Initialize the task store"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const root = yield* tmBase;
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

const validateCommand = Command.make("validate").pipe(
  Command.withDescription("Validate tasks.jsonl"),
  Command.withHandler(
    Effect.fnUntraced(function* () {
      const root = yield* tmBase;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          const items = yield* validateStoreOnDisk(paths);
          const payload = {
            ok: true,
            workItemCount: items.length,
            tasksFile: paths.tasksFile,
          };

          yield* Console.log(
            root.json
              ? renderJson(payload)
              : `Validated ${items.length} Work Item${items.length === 1 ? "" : "s"} in ${paths.tasksFile}.`,
          );
        }),
      );
    }),
  ),
);

const createCommand = Command.make("create", {
  subject: Argument.string("subject").pipe(Argument.optional),
  level: Flag.choice("level", ["epic", "task", "subtask"]).pipe(
    Flag.withDescription("Create an Epic, Task, or Subtask"),
    Flag.withDefault("task"),
  ),
  parent: Flag.string("parent").pipe(
    Flag.withDescription("Parent Work Item id or unique prefix"),
    Flag.optional,
  ),
  description: Flag.string("description").pipe(Flag.optional),
  descriptionFile: Flag.file("description-file").pipe(Flag.optional),
  context: Flag.string("context").pipe(Flag.optional),
  contextFile: Flag.file("context-file").pipe(Flag.optional),
  message: Flag.string("message").pipe(Flag.optional),
  messageFile: Flag.file("message-file").pipe(Flag.optional),
  allowEmptyDescription: Flag.boolean("allow-empty-description"),
  allowEmptyContext: Flag.boolean("allow-empty-context"),
}).pipe(
  Command.withDescription("Create a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* (input) {
      const root = yield* tmBase;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          if (Option.isSome(input.message) && Option.isSome(input.messageFile)) {
            return yield* new CommandFailure({
              message: "Use either --message or --message-file, not both.",
            });
          }

          const descriptionInput = yield* resolveTextInput(
            input.description,
            input.descriptionFile,
            "description",
          );
          const contextInput = yield* resolveTextInput(input.context, input.contextFile, "context");
          const messageInput = yield* resolveTextInput(input.message, input.messageFile, "message");

          if (
            Option.isSome(messageInput) &&
            (Option.isSome(input.subject) || Option.isSome(descriptionInput))
          ) {
            return yield* new CommandFailure({
              message: "Do not combine <subject> or --description with --message/--message-file.",
            });
          }

          const messageParts = Option.match(messageInput, {
            onNone: () => undefined,
            onSome: parseMessage,
          });

          const subject = Option.match(input.subject, {
            onNone: () => messageParts?.subject ?? "",
            onSome: (value) => value,
          });
          const description = Option.match(descriptionInput, {
            onNone: () => messageParts?.description ?? "",
            onSome: (value) => value,
          });
          const agentContext = Option.match(contextInput, {
            onNone: () => "",
            onSome: (value) => value,
          });

          yield* ensureValidSubject(subject);

          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const parent = yield* Option.match(input.parent, {
            onNone: () => Effect.void,
            onSome: (value) => resolveWorkItem(items, value),
          });

          const createValidation = ensureCanCreateItem({
            level: input.level,
            ...(parent === undefined ? {} : { parent }),
            subject,
            description,
            agentContext,
            allowEmptyDescription: input.allowEmptyDescription,
            allowEmptyContext: input.allowEmptyContext,
          });
          if (createValidation !== undefined) {
            return yield* createValidation;
          }

          const id = yield* makeWorkItemId();
          const workItem = yield* makeOpenWorkItem({
            id,
            level: input.level,
            subject,
            description,
            agentContext,
            ...(parent === undefined ? {} : { parentId: parent.id }),
          });

          const nextItems = [...items, workItem];
          const persistedItems = yield* writeStore(paths, nextItems);
          const createdItem = yield* resolveWorkItem(persistedItems, id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(createdItem),
                })
              : renderWorkItemHuman(createdItem),
          );
        }),
      );
    }),
  ),
);

const showCommand = Command.make("show", {
  id: Argument.string("id"),
}).pipe(
  Command.withDescription("Show one Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id }) {
      const root = yield* tmBase;
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

const listCommand = Command.make("list", {
  root: Flag.string("root").pipe(Flag.withDescription("Render only a subtree"), Flag.optional),
}).pipe(
  Command.withDescription("List the open backlog tree"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ root: requestedRoot }) {
      const root = yield* tmBase;
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

const nextCommand = Command.make("next", {
  root: Flag.string("root").pipe(
    Flag.withDescription("Select only within a Work Item subtree"),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Select the next actionable Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ root: requestedRoot }) {
      const root = yield* tmBase;
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
              message: `Work Item ${subtreeRoot.id} is not open and cannot be used as the next root.`,
            });
          }

          const nextItem = findNextActionableWorkItem(
            items,
            subtreeRoot === undefined ? {} : { root: subtreeRoot },
          );

          yield* Console.log(
            nextItem === undefined
              ? root.json
                ? renderJson({
                    ok: true,
                    reason: "no-actionable-work",
                  })
                : "No actionable Work Items."
              : root.json
                ? renderJson({
                    ok: true,
                    item: encodeItemForOutput(nextItem),
                  })
                : renderWorkItemHuman(nextItem),
          );
        }),
      );
    }),
  ),
);

const replaceWorkItem = (
  items: ReadonlyArray<WorkItem>,
  updatedItem: WorkItem,
): ReadonlyArray<WorkItem> =>
  items.map((item) => (item.id === updatedItem.id ? updatedItem : item));

const blockCommand = Command.make("block", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(
    Flag.withDescription("Work Item id or unique prefix that blocks this item"),
  ),
}).pipe(
  Command.withDescription("Add a dependency to a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by }) {
      const root = yield* tmBase;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const dependency = yield* resolveWorkItem(items, by);

          if (item.id === dependency.id) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} cannot depend on itself.`,
            });
          }

          const currentDependencies = item.blockedBy ?? [];
          if (currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} already depends on ${dependency.id}.`,
            });
          }

          const updatedItem = yield* updateWorkItemDependencies({
            item,
            blockedBy: [...currentDependencies, dependency.id],
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : `Blocked ${persistedItem.subject} (${persistedItem.id}) by ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);

const unblockCommand = Command.make("unblock", {
  id: Argument.string("id"),
  by: Flag.string("by").pipe(
    Flag.withDescription("Current dependency Work Item id or unique prefix"),
  ),
}).pipe(
  Command.withDescription("Remove a dependency from a Work Item"),
  Command.withHandler(
    Effect.fnUntraced(function* ({ id, by }) {
      const root = yield* tmBase;
      yield* executeCommand(
        root.json,
        Effect.gen(function* () {
          const paths = yield* resolveStorePaths(root);
          yield* ensureStoreExists(paths);
          const items = yield* loadStore(paths);
          const item = yield* resolveWorkItem(items, id);
          const dependency = yield* resolveWorkItem(items, by);
          const currentDependencies = item.blockedBy ?? [];

          if (!currentDependencies.includes(dependency.id)) {
            return yield* new CommandFailure({
              message: `Work Item ${item.id} does not depend on ${dependency.id}.`,
            });
          }

          const updatedItem = yield* updateWorkItemDependencies({
            item,
            blockedBy: currentDependencies.filter((dependencyId) => dependencyId !== dependency.id),
          });
          const persistedItems = yield* writeStore(paths, replaceWorkItem(items, updatedItem));
          const persistedItem = yield* resolveWorkItem(persistedItems, item.id);

          yield* Console.log(
            root.json
              ? renderJson({
                  ok: true,
                  item: encodeItemForOutput(persistedItem),
                })
              : `Unblocked ${persistedItem.subject} (${persistedItem.id}) from ${dependency.subject} (${dependency.id}).`,
          );
        }),
      );
    }),
  ),
);

const tmCommand = tmBase.pipe(
  Command.withSubcommands([
    initCommand,
    validateCommand,
    createCommand,
    showCommand,
    listCommand,
    nextCommand,
    blockCommand,
    unblockCommand,
  ]),
);

export const runTmCli = Command.runWith(tmCommand, { version });

export const run = Command.run(tmCommand, { version });

export const isLeafWorkItem = (item: WorkItem, items: ReadonlyArray<WorkItem>): boolean =>
  !hasOpenChildren(item, items);

export const orderedOpenChildren = (
  item: WorkItem,
  items: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> =>
  sortChildrenForSelection(
    items.filter((candidate) => candidate.parentId === item.id && candidate.status === "open"),
  );

export const encodeOutputItem = (item: WorkItem): WorkItemEncoded => encodeItemForOutput(item);

export const isKnownTmError = isTmError;
