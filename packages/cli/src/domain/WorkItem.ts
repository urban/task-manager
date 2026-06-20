import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

import {
  ValidationFailure,
  type ValidationIssue,
  WorkItemAmbiguous,
  WorkItemNotFound,
} from "../errors/TmErrors";

export const schemaVersion = 1;

export const WorkItemLevelSchema = Schema.Literals(["epic", "task", "subtask"] as const);
export type WorkItemLevel = typeof WorkItemLevelSchema.Type;

export const WorkItemStatusSchema = Schema.Literals(["open", "done", "cancelled"] as const);
export type WorkItemStatus = typeof WorkItemStatusSchema.Type;

export const ClaimSchema = Schema.Struct({
  agent: Schema.String,
  claimedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});

export const ResultSchema = Schema.Struct({
  summary: Schema.String,
  details: Schema.String,
  decisions: Schema.Array(Schema.String),
  verification: Schema.Array(Schema.String),
  completedAt: Schema.DateTimeUtcFromString,
  completedBy: Schema.String,
});

export const CancellationSchema = Schema.Struct({
  reason: Schema.String,
  cancelledAt: Schema.DateTimeUtcFromString,
  cancelledBy: Schema.String,
});

export const WorkItemSchema = Schema.Struct({
  schemaVersion: Schema.Literal(schemaVersion),
  id: Schema.String,
  level: WorkItemLevelSchema,
  status: WorkItemStatusSchema,
  subject: Schema.String,
  description: Schema.String,
  agentContext: Schema.String,
  parentId: Schema.String.pipe(Schema.optional),
  blockedBy: Schema.Array(Schema.String).pipe(Schema.optional),
  claim: ClaimSchema.pipe(Schema.optional),
  result: ResultSchema.pipe(Schema.optional),
  cancellation: CancellationSchema.pipe(Schema.optional),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type WorkItem = typeof WorkItemSchema.Type;
export type WorkItemEncoded = Schema.Codec.Encoded<typeof WorkItemSchema>;

export const WorkItemJsonLineSchema = Schema.fromJsonString(WorkItemSchema);

export const decodeWorkItemJsonLine = Schema.decodeUnknownEffect(WorkItemJsonLineSchema);
export const encodeWorkItemJsonLine = Schema.encodeEffect(WorkItemJsonLineSchema);
export const encodeWorkItem = Schema.encodeSync(WorkItemSchema);

export interface WorkItemTreeNode {
  readonly item: WorkItem;
  readonly children: ReadonlyArray<WorkItemTreeNode>;
}

const rootLevelOrder = (level: WorkItemLevel): number => {
  switch (level) {
    case "epic":
      return 0;
    case "task":
      return 1;
    case "subtask":
      return 2;
  }
};

const toMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const compareByCreatedAt = (left: WorkItem, right: WorkItem): number => {
  const leftMillis = toMillis(left.createdAt);
  const rightMillis = toMillis(right.createdAt);
  return leftMillis - rightMillis;
};

const compareRootItems = (left: WorkItem, right: WorkItem): number => {
  const levelDiff = rootLevelOrder(left.level) - rootLevelOrder(right.level);
  if (levelDiff !== 0) {
    return levelDiff;
  }
  return compareByCreatedAt(left, right);
};

const buildChildrenByParent = (
  items: ReadonlyArray<WorkItem>,
): ReadonlyMap<string, ReadonlyArray<WorkItem>> => {
  const grouped = new Map<string, Array<WorkItem>>();
  for (const item of items) {
    if (item.parentId === undefined) {
      continue;
    }
    const current = grouped.get(item.parentId) ?? [];
    current.push(item);
    grouped.set(item.parentId, current);
  }
  return new Map(
    Array.from(grouped.entries(), ([parentId, children]) => [
      parentId,
      children.toSorted(compareByCreatedAt),
    ]),
  );
};

export const sortWorkItems = (items: ReadonlyArray<WorkItem>): ReadonlyArray<WorkItem> => {
  const childrenByParent = buildChildrenByParent(items);
  const roots = items.filter((item) => item.parentId === undefined).toSorted(compareRootItems);
  const ordered: Array<WorkItem> = [];

  const visit = (item: WorkItem): void => {
    ordered.push(item);
    const children = childrenByParent.get(item.id) ?? [];
    for (const child of children) {
      visit(child);
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return ordered;
};

const buildNode = (
  item: WorkItem,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<WorkItem>>,
  openOnly: boolean,
): WorkItemTreeNode => {
  const allChildren = childrenByParent.get(item.id) ?? [];
  const children = allChildren
    .filter((child) => (openOnly ? child.status === "open" : true))
    .map((child) => buildNode(child, childrenByParent, openOnly));

  return { item, children };
};

export const buildTree = (
  items: ReadonlyArray<WorkItem>,
  options?: {
    readonly root?: WorkItem;
    readonly openOnly?: boolean;
  },
): ReadonlyArray<WorkItemTreeNode> => {
  const openOnly = options?.openOnly ?? false;
  const visibleItems = openOnly ? items.filter((item) => item.status === "open") : [...items];
  const childrenByParent = buildChildrenByParent(visibleItems);

  if (options?.root !== undefined) {
    if (openOnly && options.root.status !== "open") {
      return [];
    }
    return [buildNode(options.root, childrenByParent, openOnly)];
  }

  const roots = visibleItems
    .filter((item) => item.parentId === undefined)
    .toSorted(compareRootItems);
  return roots.map((item) => buildNode(item, childrenByParent, openOnly));
};

export const resolveWorkItem = (
  items: ReadonlyArray<WorkItem>,
  query: string,
): Effect.Effect<WorkItem, WorkItemNotFound | WorkItemAmbiguous> => {
  const exact = items.find((item) => item.id === query);
  if (exact !== undefined) {
    return Effect.succeed(exact);
  }

  const matches = items.filter((item) => item.id.startsWith(query));
  if (matches.length === 0) {
    return new WorkItemNotFound({ query });
  }
  if (matches.length > 1) {
    return new WorkItemAmbiguous({
      query,
      matches: matches.map((item) => item.id).toSorted(),
    });
  }
  const [match] = matches;
  return match === undefined ? new WorkItemNotFound({ query }) : Effect.succeed(match);
};

export const validateSubject = (subject: string): ReadonlyArray<ValidationIssue> => {
  const issues: Array<ValidationIssue> = [];
  const trimmed = subject.trim();

  if (trimmed.length === 0) {
    issues.push({ message: "Subject is required.", path: "subject" });
    return issues;
  }

  if (subject !== trimmed) {
    issues.push({
      message: "Subject must not start or end with whitespace.",
      path: "subject",
    });
  }

  if (subject.length > 50) {
    issues.push({
      message: "Subject must be 50 characters or fewer.",
      path: "subject",
    });
  }

  if (subject.includes("\n")) {
    issues.push({
      message: "Subject must be a single line.",
      path: "subject",
    });
  }

  if (subject.endsWith(".")) {
    issues.push({
      message: "Subject must not end with a period.",
      path: "subject",
    });
  }

  const firstCharacter = subject[0];
  if (firstCharacter !== undefined && firstCharacter.toLowerCase() !== firstCharacter) {
    return issues;
  }

  if (firstCharacter !== undefined && firstCharacter.toUpperCase() !== firstCharacter) {
    issues.push({
      message: "Subject must start with a capital letter.",
      path: "subject",
    });
  }

  if (/[*_`#[\]]/.test(subject)) {
    issues.push({
      message: "Subject must not contain Markdown formatting markers.",
      path: "subject",
    });
  }

  return issues;
};

export const makeWorkItemId = Effect.fnUntraced(function* () {
  const uuid = yield* Random.nextUUIDv4;
  return `wi_${uuid.replaceAll("-", "")}`;
});

export const makeOpenWorkItem = Effect.fnUntraced(function* (options: {
  readonly id: string;
  readonly level: WorkItemLevel;
  readonly subject: string;
  readonly description: string;
  readonly agentContext: string;
  readonly parentId?: string;
}) {
  const timestamp = yield* DateTime.now;
  const workItem = {
    schemaVersion,
    id: options.id,
    level: options.level,
    status: "open",
    subject: options.subject,
    description: options.description,
    agentContext: options.agentContext,
    parentId: options.parentId,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies WorkItem;

  return workItem;
});

export const updateWorkItemDependencies = Effect.fnUntraced(function* (options: {
  readonly item: WorkItem;
  readonly blockedBy: ReadonlyArray<string>;
}) {
  const timestamp = yield* DateTime.now;
  const sortedBlockedBy = options.blockedBy.toSorted((left, right) => left.localeCompare(right));

  if (sortedBlockedBy.length > 0) {
    return {
      ...options.item,
      blockedBy: sortedBlockedBy,
      updatedAt: timestamp,
    } satisfies WorkItem;
  }

  return {
    schemaVersion: options.item.schemaVersion,
    id: options.item.id,
    level: options.item.level,
    status: options.item.status,
    subject: options.item.subject,
    description: options.item.description,
    agentContext: options.item.agentContext,
    ...(options.item.parentId === undefined ? {} : { parentId: options.item.parentId }),
    ...(options.item.claim === undefined ? {} : { claim: options.item.claim }),
    ...(options.item.result === undefined ? {} : { result: options.item.result }),
    ...(options.item.cancellation === undefined ? {} : { cancellation: options.item.cancellation }),
    createdAt: options.item.createdAt,
    updatedAt: timestamp,
  } satisfies WorkItem;
});

export const ensureValidSubject = (subject: string): Effect.Effect<void, ValidationFailure> => {
  const issues = validateSubject(subject);
  if (issues.length > 0) {
    return new ValidationFailure({
      summary: "Subject validation failed.",
      issues,
    });
  }
  return Effect.void;
};
