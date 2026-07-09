import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

import {
  ValidationFailure,
  type ValidationIssue,
  WorkItemAmbiguous,
  WorkItemNotFound,
} from "./Errors";

export const schemaVersion = 2;

export const WorkItemLevelSchema = Schema.Literals(["epic", "task", "subtask"] as const);
export type WorkItemLevel = typeof WorkItemLevelSchema.Type;

export const WorkItemStatusSchema = Schema.Literals(["open", "done", "cancelled"] as const);
export type WorkItemStatus = typeof WorkItemStatusSchema.Type;
export const allWorkItemStatuses: ReadonlyArray<WorkItemStatus> = ["open", "done", "cancelled"];

export const WorkItemExecutionModeSchema = Schema.Literals(["agent", "human"]);
export type WorkItemExecutionMode = typeof WorkItemExecutionModeSchema.Type;
export type WorkItemModeFilter = WorkItemExecutionMode | "any";
export const allWorkItemExecutionModes: ReadonlyArray<WorkItemExecutionMode> = ["agent", "human"];

export const ClaimSchema = Schema.Struct({
  agent: Schema.String,
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

export const CancellationSchema = Schema.Struct({
  reason: Schema.String,
  cancelledAt: Schema.DateTimeUtcFromString,
  cancelledBy: Schema.String,
});
export type WorkItemCancellation = typeof CancellationSchema.Type;

export const WorkItemSchema = Schema.Struct({
  schemaVersion: Schema.Literal(schemaVersion),
  id: Schema.String,
  level: WorkItemLevelSchema,
  status: WorkItemStatusSchema,
  executionMode: WorkItemExecutionModeSchema,
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
  readonly matchesFilter: boolean;
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
  if (diff !== 0) {
    return diff;
  }
  return left.id.localeCompare(right.id);
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

  return { item, matchesFilter: true, children };
};

const flattenFromRoot = (
  root: WorkItem,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<WorkItem>>,
): ReadonlyArray<WorkItem> => {
  const ordered: Array<WorkItem> = [];

  const visit = (item: WorkItem): void => {
    ordered.push(item);
    const children = childrenByParent.get(item.id) ?? [];
    for (const child of children) {
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

export const matchesExecutionModeFilter = (item: WorkItem, mode: WorkItemModeFilter): boolean =>
  mode === "any" || item.executionMode === mode;

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
      const parent = scopedItemsById.get(currentParentId);
      currentParentId = parent?.parentId;
    }
  }

  return includedIds;
};

export const buildFilteredTree = (
  items: ReadonlyArray<WorkItem>,
  options?: {
    readonly root?: WorkItem;
    readonly statuses?: ReadonlySet<WorkItemStatus>;
    readonly mode?: WorkItemModeFilter;
  },
): ReadonlyArray<WorkItemTreeNode> => {
  const scopedItems =
    options?.root === undefined
      ? sortWorkItems(items)
      : flattenFromRoot(options.root, buildChildrenByParent(items));
  const mode = options?.mode ?? "any";
  const matchingItems = scopedItems.filter(
    (item) =>
      matchesStatusFilter(item, options?.statuses) && matchesExecutionModeFilter(item, mode),
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
  readonly executionMode: WorkItemExecutionMode;
  readonly parentId?: string;
  readonly blockedBy?: ReadonlyArray<string>;
}) {
  const timestamp = yield* DateTime.now;
  const blockedBy = options.blockedBy?.toSorted((left, right) => left.localeCompare(right));
  const workItem = {
    schemaVersion,
    id: options.id,
    level: options.level,
    status: "open",
    executionMode: options.executionMode,
    subject: options.subject,
    description: options.description,
    agentContext: options.agentContext,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
    ...(blockedBy === undefined || blockedBy.length === 0 ? {} : { blockedBy }),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies WorkItem;

  return workItem;
});

export interface WorkItemUpdates {
  readonly subject?: string;
  readonly description?: string;
  readonly agentContext?: string;
  readonly executionMode?: WorkItemExecutionMode;
}

export const updateWorkItem = (options: {
  readonly item: WorkItem;
  readonly updates: WorkItemUpdates;
  readonly updatedAt: DateTime.Utc;
}): WorkItem =>
  ({
    schemaVersion: options.item.schemaVersion,
    id: options.item.id,
    level: options.item.level,
    status: options.item.status,
    executionMode: options.updates.executionMode ?? options.item.executionMode,
    subject: options.updates.subject ?? options.item.subject,
    description: options.updates.description ?? options.item.description,
    agentContext: options.updates.agentContext ?? options.item.agentContext,
    ...(options.item.parentId === undefined ? {} : { parentId: options.item.parentId }),
    ...(options.item.blockedBy === undefined ? {} : { blockedBy: options.item.blockedBy }),
    ...(options.item.claim === undefined ? {} : { claim: options.item.claim }),
    ...(options.item.result === undefined ? {} : { result: options.item.result }),
    ...(options.item.cancellation === undefined ? {} : { cancellation: options.item.cancellation }),
    createdAt: options.item.createdAt,
    updatedAt: options.updatedAt,
  }) satisfies WorkItem;

export const updateWorkItemClaim = (options: {
  readonly item: WorkItem;
  readonly agent: string;
  readonly claimedAt: DateTime.Utc;
}): WorkItem =>
  ({
    ...options.item,
    claim: {
      agent: options.agent,
      claimedAt: options.claimedAt,
      expiresAt: claimExpiresAt(options.claimedAt),
    },
    updatedAt: options.claimedAt,
  }) satisfies WorkItem;

export const clearWorkItemClaim = (options: {
  readonly item: WorkItem;
  readonly updatedAt: DateTime.Utc;
}): WorkItem =>
  ({
    schemaVersion: options.item.schemaVersion,
    id: options.item.id,
    level: options.item.level,
    status: options.item.status,
    executionMode: options.item.executionMode,
    subject: options.item.subject,
    description: options.item.description,
    agentContext: options.item.agentContext,
    ...(options.item.parentId === undefined ? {} : { parentId: options.item.parentId }),
    ...(options.item.blockedBy === undefined ? {} : { blockedBy: options.item.blockedBy }),
    ...(options.item.result === undefined ? {} : { result: options.item.result }),
    ...(options.item.cancellation === undefined ? {} : { cancellation: options.item.cancellation }),
    createdAt: options.item.createdAt,
    updatedAt: options.updatedAt,
  }) satisfies WorkItem;

export const completeWorkItem = (options: {
  readonly item: WorkItem;
  readonly summary: string;
  readonly details: string;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
  readonly completedAt: DateTime.Utc;
  readonly completedBy: string;
}): WorkItem =>
  ({
    schemaVersion: options.item.schemaVersion,
    id: options.item.id,
    level: options.item.level,
    status: "done",
    executionMode: options.item.executionMode,
    subject: options.item.subject,
    description: options.item.description,
    agentContext: options.item.agentContext,
    ...(options.item.parentId === undefined ? {} : { parentId: options.item.parentId }),
    ...(options.item.blockedBy === undefined ? {} : { blockedBy: options.item.blockedBy }),
    result: {
      summary: options.summary,
      details: options.details,
      decisions: [...options.decisions],
      verification: [...options.verification],
      completedAt: options.completedAt,
      completedBy: options.completedBy,
    },
    createdAt: options.item.createdAt,
    updatedAt: options.completedAt,
  }) satisfies WorkItem;

export const cancelWorkItem = (options: {
  readonly item: WorkItem;
  readonly reason: string;
  readonly cancelledAt: DateTime.Utc;
  readonly cancelledBy: string;
}): WorkItem =>
  ({
    schemaVersion: options.item.schemaVersion,
    id: options.item.id,
    level: options.item.level,
    status: "cancelled",
    executionMode: options.item.executionMode,
    subject: options.item.subject,
    description: options.item.description,
    agentContext: options.item.agentContext,
    ...(options.item.parentId === undefined ? {} : { parentId: options.item.parentId }),
    ...(options.item.blockedBy === undefined ? {} : { blockedBy: options.item.blockedBy }),
    cancellation: {
      reason: options.reason,
      cancelledAt: options.cancelledAt,
      cancelledBy: options.cancelledBy,
    },
    createdAt: options.item.createdAt,
    updatedAt: options.cancelledAt,
  }) satisfies WorkItem;

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
    executionMode: options.item.executionMode,
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
