import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

import { CommandFailure, ValidationFailure, WorkItemAmbiguous, WorkItemNotFound } from "./Errors";

type ValidationIssue = import("./Errors").ValidationIssue;

export const schemaVersion = 3;

export const WorkItemLevelSchema = Schema.Literals(["epic", "task", "subtask"] as const);
export type WorkItemLevel = typeof WorkItemLevelSchema.Type;

export const WorkItemStatusSchema = Schema.Literals(["open", "done", "cancelled"] as const);
export type WorkItemStatus = typeof WorkItemStatusSchema.Type;
export const allWorkItemStatuses: ReadonlyArray<WorkItemStatus> = ["open", "done", "cancelled"];

export const WorkItemExecutorSchema = Schema.Literals(["agent", "human"] as const);
export type WorkItemExecutor = typeof WorkItemExecutorSchema.Type;

export type WorkItemExecutorFilter =
  | { readonly _tag: "SpecificExecutor"; readonly executor: WorkItemExecutor }
  | { readonly _tag: "AllExecutors" };

export const specificExecutorFilter = (executor: WorkItemExecutor): WorkItemExecutorFilter => ({
  _tag: "SpecificExecutor",
  executor,
});

export const allExecutorsFilter: WorkItemExecutorFilter = { _tag: "AllExecutors" };

export const ClaimSchema = Schema.Struct({
  actor: Schema.String,
  claimedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type WorkItemClaim = typeof ClaimSchema.Type;

export const ResultSchema = Schema.Struct({
  summary: Schema.String,
  details: Schema.String,
  decisions: Schema.Array(Schema.String),
  verification: Schema.Array(Schema.String),
  completedAt: Schema.DateTimeUtcFromString,
  completedBy: Schema.String,
});
export type WorkItemResult = typeof ResultSchema.Type;
export type WorkItemResultEncoded = Schema.Codec.Encoded<typeof ResultSchema>;

export const CancellationSchema = Schema.Struct({
  reason: Schema.String,
  cancelledAt: Schema.DateTimeUtcFromString,
  cancelledBy: Schema.String,
});
export type WorkItemCancellation = typeof CancellationSchema.Type;
export type WorkItemCancellationEncoded = Schema.Codec.Encoded<typeof CancellationSchema>;

export const workItemIdLength = 6;
const workItemIdPattern = /^[a-z0-9]{6}$/;

export const WorkItemIdSchema = Schema.String.check(
  Schema.isPattern(workItemIdPattern, {
    expected: "a six-character lowercase alphanumeric Work Item ID without a prefix",
  }),
).annotate({ identifier: "WorkItemId" });

const WorkItemBaseFields = {
  schemaVersion: Schema.Literal(schemaVersion),
  id: WorkItemIdSchema,
  level: WorkItemLevelSchema,
  executor: WorkItemExecutorSchema,
  subject: Schema.String,
  description: Schema.String,
  context: Schema.String,
  parentId: WorkItemIdSchema.pipe(Schema.optional),
  blockedBy: Schema.Array(WorkItemIdSchema).pipe(Schema.optional),
  claim: ClaimSchema.pipe(Schema.optional),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
};

export const OpenWorkItemSchema = Schema.Struct({
  ...WorkItemBaseFields,
  status: Schema.Literal("open"),
});
export type OpenWorkItem = typeof OpenWorkItemSchema.Type;

export const DoneWorkItemSchema = Schema.Struct({
  ...WorkItemBaseFields,
  status: Schema.Literal("done"),
  result: ResultSchema,
});
export type DoneWorkItem = typeof DoneWorkItemSchema.Type;

export const CancelledWorkItemSchema = Schema.Struct({
  ...WorkItemBaseFields,
  status: Schema.Literal("cancelled"),
  cancellation: CancellationSchema,
});
export type CancelledWorkItem = typeof CancelledWorkItemSchema.Type;

export const WorkItemSchema = Schema.Union([
  OpenWorkItemSchema,
  DoneWorkItemSchema,
  CancelledWorkItemSchema,
]);

export type WorkItem = typeof WorkItemSchema.Type;
export type WorkItemEncoded = Schema.Codec.Encoded<typeof WorkItemSchema>;

export const WorkItemJsonLineSchema = Schema.fromJsonString(WorkItemSchema);

const decodeJsonLine = Schema.decodeUnknownEffect(WorkItemJsonLineSchema);
export const decodeWorkItemJsonLine = (line: unknown) =>
  decodeJsonLine(line, { onExcessProperty: "error" });
export const encodeWorkItemJsonLine = Schema.encodeEffect(WorkItemJsonLineSchema);
export const encodeWorkItem = Schema.encodeSync(WorkItemSchema);

export interface WorkItemTreeNode {
  readonly item: WorkItem;
  readonly matchesFilter: boolean;
  readonly children: ReadonlyArray<WorkItemTreeNode>;
}

export const isOpenWorkItem = (item: WorkItem): item is OpenWorkItem => item.status === "open";

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

const claimTtlHours = 1;

export const claimExpiresAt = (claimedAt: DateTime.Utc): DateTime.Utc =>
  claimedAt.pipe(DateTime.add({ hours: claimTtlHours }));

export const isClaimActive = (claim: WorkItemClaim | undefined, now: DateTime.Utc): boolean =>
  claim !== undefined && DateTime.isGreaterThan(claim.expiresAt, now);

export const formatClaimExpiresAt = (claim: WorkItemClaim): string =>
  DateTime.formatIso(claim.expiresAt);

const toMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const compareByCreatedAt = (left: WorkItem, right: WorkItem): number => {
  const leftMillis = toMillis(left.createdAt);
  const rightMillis = toMillis(right.createdAt);
  const diff = leftMillis - rightMillis;
  return diff !== 0 ? diff : left.id.localeCompare(right.id);
};

const compareRootItems = (left: WorkItem, right: WorkItem): number => {
  const levelDiff = rootLevelOrder(left.level) - rootLevelOrder(right.level);
  return levelDiff !== 0 ? levelDiff : compareByCreatedAt(left, right);
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
    for (const child of childrenByParent.get(item.id) ?? []) {
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
): WorkItemTreeNode => ({
  item,
  matchesFilter: true,
  children: (childrenByParent.get(item.id) ?? [])
    .filter((child) => !openOnly || child.status === "open")
    .map((child) => buildNode(child, childrenByParent, openOnly)),
});

const flattenFromRoot = (
  root: WorkItem,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<WorkItem>>,
): ReadonlyArray<WorkItem> => {
  const ordered: Array<WorkItem> = [];

  const visit = (item: WorkItem): void => {
    ordered.push(item);
    for (const child of childrenByParent.get(item.id) ?? []) {
      visit(child);
    }
  };

  visit(root);
  return ordered;
};

const matchesStatusFilter = (
  item: WorkItem,
  statuses: ReadonlySet<WorkItemStatus> | undefined,
): boolean => statuses === undefined || statuses.has(item.status);

export const matchesExecutorFilter = (item: WorkItem, filter: WorkItemExecutorFilter): boolean =>
  filter._tag === "AllExecutors" || item.executor === filter.executor;

const buildFilteredNode = (
  item: WorkItem,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<WorkItem>>,
  matchingIds: ReadonlySet<string>,
): WorkItemTreeNode => ({
  item,
  matchesFilter: matchingIds.has(item.id),
  children: (childrenByParent.get(item.id) ?? []).map((child) =>
    buildFilteredNode(child, childrenByParent, matchingIds),
  ),
});

const includedItemIdsWithAncestors = (
  matchingItems: ReadonlyArray<WorkItem>,
  scopedItemsById: ReadonlyMap<string, WorkItem>,
): ReadonlySet<string> => {
  const includedIds = new Set<string>();

  for (const item of matchingItems) {
    includedIds.add(item.id);
    let currentParentId = item.parentId;

    while (currentParentId !== undefined) {
      includedIds.add(currentParentId);
      currentParentId = scopedItemsById.get(currentParentId)?.parentId;
    }
  }

  return includedIds;
};

export const buildFilteredTree = (
  items: ReadonlyArray<WorkItem>,
  options?: {
    readonly root?: WorkItem;
    readonly statuses?: ReadonlySet<WorkItemStatus>;
    readonly executorFilter?: WorkItemExecutorFilter;
  },
): ReadonlyArray<WorkItemTreeNode> => {
  const scopedItems =
    options?.root === undefined
      ? sortWorkItems(items)
      : flattenFromRoot(options.root, buildChildrenByParent(items));
  const executorFilter = options?.executorFilter ?? allExecutorsFilter;
  const matchingItems = scopedItems.filter(
    (item) =>
      matchesStatusFilter(item, options?.statuses) && matchesExecutorFilter(item, executorFilter),
  );
  const matchingIds = new Set(matchingItems.map((item) => item.id));
  const scopedItemsById = new Map(scopedItems.map((item) => [item.id, item]));
  const includedIds = includedItemIdsWithAncestors(matchingItems, scopedItemsById);
  const includedItems = scopedItems.filter((item) => includedIds.has(item.id));
  const childrenByParent = buildChildrenByParent(includedItems);
  const rootIds = new Set(
    includedItems
      .filter((item) => item.parentId === undefined || !includedIds.has(item.parentId))
      .map((item) => item.id),
  );

  return includedItems
    .filter((item) => rootIds.has(item.id))
    .map((item) => buildFilteredNode(item, childrenByParent, matchingIds));
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
    return openOnly && options.root.status !== "open"
      ? []
      : [buildNode(options.root, childrenByParent, openOnly)];
  }

  return visibleItems
    .filter((item) => item.parentId === undefined)
    .toSorted(compareRootItems)
    .map((item) => buildNode(item, childrenByParent, openOnly));
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

const workItemIdRadix = 36;
const workItemIdSpaceSize = workItemIdRadix ** workItemIdLength;

const formatWorkItemId = (value: number): string =>
  value.toString(workItemIdRadix).padStart(workItemIdLength, "0");

export const makeWorkItemId = Effect.fnUntraced(function* (existingIds: ReadonlySet<string>) {
  if (existingIds.size >= workItemIdSpaceSize) {
    return yield* new CommandFailure({
      message: "Cannot create a Work Item because the short ID space is exhausted.",
    });
  }

  const randomStart = yield* Random.nextIntBetween(0, workItemIdSpaceSize, { halfOpen: true });
  for (let offset = 0; offset <= existingIds.size; offset += 1) {
    const candidate = formatWorkItemId((randomStart + offset) % workItemIdSpaceSize);
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return yield* new CommandFailure({
    message: "Cannot create a Work Item because no short ID is available.",
  });
});

export const makeOpenWorkItem = Effect.fnUntraced(function* (options: {
  readonly id: string;
  readonly level: WorkItemLevel;
  readonly subject: string;
  readonly description: string;
  readonly context: string;
  readonly executor: WorkItemExecutor;
  readonly parentId?: string;
  readonly blockedBy?: ReadonlyArray<string>;
}) {
  const timestamp = yield* DateTime.now;
  const blockedBy = options.blockedBy?.toSorted((left, right) => left.localeCompare(right));
  return {
    schemaVersion,
    id: options.id,
    level: options.level,
    status: "open",
    executor: options.executor,
    subject: options.subject,
    description: options.description,
    context: options.context,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    ...(blockedBy === undefined || blockedBy.length === 0 ? {} : { blockedBy }),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies OpenWorkItem;
});

export interface WorkItemUpdates {
  readonly subject?: string;
  readonly description?: string;
  readonly context?: string;
}

export const updateWorkItem = (options: {
  readonly item: WorkItem;
  readonly updates: WorkItemUpdates;
  readonly updatedAt: DateTime.Utc;
}): WorkItem =>
  ({
    ...options.item,
    ...options.updates,
    updatedAt: options.updatedAt,
  }) satisfies WorkItem;

export const setWorkItemExecutor = (options: {
  readonly item: WorkItem;
  readonly executor: WorkItemExecutor;
  readonly updatedAt: DateTime.Utc;
}): WorkItem =>
  ({
    ...options.item,
    executor: options.executor,
    updatedAt: options.updatedAt,
  }) satisfies WorkItem;

export const updateWorkItemClaim = (options: {
  readonly item: OpenWorkItem;
  readonly actor: string;
  readonly claimedAt: DateTime.Utc;
}): OpenWorkItem =>
  ({
    ...options.item,
    claim: {
      actor: options.actor,
      claimedAt: options.claimedAt,
      expiresAt: claimExpiresAt(options.claimedAt),
    },
    updatedAt: options.claimedAt,
  }) satisfies OpenWorkItem;

export const clearWorkItemClaim = (options: {
  readonly item: WorkItem;
  readonly updatedAt: DateTime.Utc;
}): WorkItem => {
  const { claim: _claim, ...itemWithoutClaim } = options.item;
  return {
    ...itemWithoutClaim,
    updatedAt: options.updatedAt,
  } satisfies WorkItem;
};

export const completeWorkItem = (options: {
  readonly item: OpenWorkItem;
  readonly summary: string;
  readonly details: string;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
  readonly completedAt: DateTime.Utc;
  readonly completedBy: string;
}): DoneWorkItem => {
  const { status: _status, claim: _claim, ...base } = options.item;
  return {
    ...base,
    status: "done",
    result: {
      summary: options.summary,
      details: options.details,
      decisions: [...options.decisions],
      verification: [...options.verification],
      completedAt: options.completedAt,
      completedBy: options.completedBy,
    },
    updatedAt: options.completedAt,
  } satisfies DoneWorkItem;
};

export const cancelWorkItem = (options: {
  readonly item: OpenWorkItem;
  readonly reason: string;
  readonly cancelledAt: DateTime.Utc;
  readonly cancelledBy: string;
}): CancelledWorkItem => {
  const { status: _status, claim: _claim, ...base } = options.item;
  return {
    ...base,
    status: "cancelled",
    cancellation: {
      reason: options.reason,
      cancelledAt: options.cancelledAt,
      cancelledBy: options.cancelledBy,
    },
    updatedAt: options.cancelledAt,
  } satisfies CancelledWorkItem;
};

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

  const { blockedBy: _blockedBy, ...itemWithoutDependencies } = options.item;
  return {
    ...itemWithoutDependencies,
    updatedAt: timestamp,
  } satisfies WorkItem;
});

export const ensureValidSubject = (subject: string): Effect.Effect<void, ValidationFailure> => {
  const issues = validateSubject(subject);
  return issues.length === 0
    ? Effect.void
    : new ValidationFailure({
        summary: "Subject validation failed.",
        issues,
      });
};
