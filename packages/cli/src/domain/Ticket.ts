import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

import { CommandFailure, ValidationFailure, TicketAmbiguous, TicketNotFound } from "./Errors";

type ValidationIssue = import("./Errors").ValidationIssue;

export const schemaVersion = 3;

export const TicketLevelSchema = Schema.Literals(["epic", "task", "subtask"] as const);
export type TicketLevel = typeof TicketLevelSchema.Type;

export const TicketStatusSchema = Schema.Literals(["open", "done", "cancelled"] as const);
export type TicketStatus = typeof TicketStatusSchema.Type;
export const allTicketStatuses: ReadonlyArray<TicketStatus> = ["open", "done", "cancelled"];

export const TicketExecutorSchema = Schema.Literals(["agent", "human"] as const);
export type TicketExecutor = typeof TicketExecutorSchema.Type;

export type TicketExecutorFilter =
  | { readonly _tag: "SpecificExecutor"; readonly executor: TicketExecutor }
  | { readonly _tag: "AllExecutors" };

export const specificExecutorFilter = (executor: TicketExecutor): TicketExecutorFilter => ({
  _tag: "SpecificExecutor",
  executor,
});

export const allExecutorsFilter: TicketExecutorFilter = { _tag: "AllExecutors" };

export const TicketClaimSchema = Schema.Struct({
  actor: Schema.String,
  claimedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type TicketClaim = typeof TicketClaimSchema.Type;

export const TicketResultSchema = Schema.Struct({
  summary: Schema.String,
  details: Schema.String,
  decisions: Schema.Array(Schema.String),
  verification: Schema.Array(Schema.String),
  completedAt: Schema.DateTimeUtcFromString,
  completedBy: Schema.String,
});
export type TicketResult = typeof TicketResultSchema.Type;
export type TicketResultEncoded = Schema.Codec.Encoded<typeof TicketResultSchema>;

export const TicketCancellationSchema = Schema.Struct({
  reason: Schema.String,
  cancelledAt: Schema.DateTimeUtcFromString,
  cancelledBy: Schema.String,
});
export type TicketCancellation = typeof TicketCancellationSchema.Type;
export type TicketCancellationEncoded = Schema.Codec.Encoded<typeof TicketCancellationSchema>;

export const ticketIdLength = 6;
const ticketIdPattern = /^[a-z0-9]{6}$/;

export const TicketIdSchema = Schema.String.check(
  Schema.isPattern(ticketIdPattern, {
    expected: "a six-character lowercase alphanumeric Ticket ID without a prefix",
  }),
).annotate({ identifier: "TicketId" });

const TicketBaseFields = {
  schemaVersion: Schema.Literal(schemaVersion),
  id: TicketIdSchema,
  level: TicketLevelSchema,
  executor: TicketExecutorSchema,
  subject: Schema.String,
  description: Schema.String,
  context: Schema.String,
  parentId: TicketIdSchema.pipe(Schema.optional),
  blockedBy: Schema.Array(TicketIdSchema).pipe(Schema.optional),
  claim: TicketClaimSchema.pipe(Schema.optional),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
};

export const OpenTicketSchema = Schema.Struct({
  ...TicketBaseFields,
  status: Schema.Literal("open"),
});
export type OpenTicket = typeof OpenTicketSchema.Type;

export const DoneTicketSchema = Schema.Struct({
  ...TicketBaseFields,
  status: Schema.Literal("done"),
  result: TicketResultSchema,
});
export type DoneTicket = typeof DoneTicketSchema.Type;

export const CancelledTicketSchema = Schema.Struct({
  ...TicketBaseFields,
  status: Schema.Literal("cancelled"),
  cancellation: TicketCancellationSchema,
});
export type CancelledTicket = typeof CancelledTicketSchema.Type;

export const TicketSchema = Schema.Union([
  OpenTicketSchema,
  DoneTicketSchema,
  CancelledTicketSchema,
]);

export type Ticket = typeof TicketSchema.Type;
export type TicketEncoded = Schema.Codec.Encoded<typeof TicketSchema>;

export const TicketJsonLineSchema = Schema.fromJsonString(TicketSchema);

const decodeJsonLine = Schema.decodeUnknownEffect(TicketJsonLineSchema);
export const decodeTicketJsonLine = (line: unknown) =>
  decodeJsonLine(line, { onExcessProperty: "error" });
export const encodeTicketJsonLine = Schema.encodeEffect(TicketJsonLineSchema);
export const encodeTicket = Schema.encodeSync(TicketSchema);

export interface TicketTreeNode {
  readonly ticket: Ticket;
  readonly matchesFilter: boolean;
  readonly children: ReadonlyArray<TicketTreeNode>;
}

export const isOpenTicket = (ticket: Ticket): ticket is OpenTicket => ticket.status === "open";

const rootLevelOrder = (level: TicketLevel): number => {
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

export const isClaimActive = (claim: TicketClaim | undefined, now: DateTime.Utc): boolean =>
  claim !== undefined && DateTime.isGreaterThan(claim.expiresAt, now);

export const formatClaimExpiresAt = (claim: TicketClaim): string =>
  DateTime.formatIso(claim.expiresAt);

const toMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const compareByCreatedAt = (left: Ticket, right: Ticket): number => {
  const leftMillis = toMillis(left.createdAt);
  const rightMillis = toMillis(right.createdAt);
  const diff = leftMillis - rightMillis;
  return diff !== 0 ? diff : left.id.localeCompare(right.id);
};

const compareRootTickets = (left: Ticket, right: Ticket): number => {
  const levelDiff = rootLevelOrder(left.level) - rootLevelOrder(right.level);
  return levelDiff !== 0 ? levelDiff : compareByCreatedAt(left, right);
};

const buildChildrenByParent = (
  tickets: ReadonlyArray<Ticket>,
): ReadonlyMap<string, ReadonlyArray<Ticket>> => {
  const grouped = new Map<string, Array<Ticket>>();
  for (const ticket of tickets) {
    if (ticket.parentId === undefined) {
      continue;
    }
    const current = grouped.get(ticket.parentId) ?? [];
    current.push(ticket);
    grouped.set(ticket.parentId, current);
  }
  return new Map(
    Array.from(grouped.entries(), ([parentId, children]) => [
      parentId,
      children.toSorted(compareByCreatedAt),
    ]),
  );
};

export const sortTickets = (tickets: ReadonlyArray<Ticket>): ReadonlyArray<Ticket> => {
  const childrenByParent = buildChildrenByParent(tickets);
  const roots = tickets
    .filter((ticket) => ticket.parentId === undefined)
    .toSorted(compareRootTickets);
  const ordered: Array<Ticket> = [];

  const visit = (ticket: Ticket): void => {
    ordered.push(ticket);
    for (const child of childrenByParent.get(ticket.id) ?? []) {
      visit(child);
    }
  };

  for (const root of roots) {
    visit(root);
  }

  return ordered;
};

const buildNode = (
  ticket: Ticket,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<Ticket>>,
  openOnly: boolean,
): TicketTreeNode => ({
  ticket,
  matchesFilter: true,
  children: (childrenByParent.get(ticket.id) ?? [])
    .filter((child) => !openOnly || child.status === "open")
    .map((child) => buildNode(child, childrenByParent, openOnly)),
});

const flattenFromRoot = (
  root: Ticket,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<Ticket>>,
): ReadonlyArray<Ticket> => {
  const ordered: Array<Ticket> = [];

  const visit = (ticket: Ticket): void => {
    ordered.push(ticket);
    for (const child of childrenByParent.get(ticket.id) ?? []) {
      visit(child);
    }
  };

  visit(root);
  return ordered;
};

const matchesStatusFilter = (
  ticket: Ticket,
  statuses: ReadonlySet<TicketStatus> | undefined,
): boolean => statuses === undefined || statuses.has(ticket.status);

export const matchesExecutorFilter = (ticket: Ticket, filter: TicketExecutorFilter): boolean =>
  filter._tag === "AllExecutors" || ticket.executor === filter.executor;

const buildFilteredNode = (
  ticket: Ticket,
  childrenByParent: ReadonlyMap<string, ReadonlyArray<Ticket>>,
  matchingIds: ReadonlySet<string>,
): TicketTreeNode => ({
  ticket,
  matchesFilter: matchingIds.has(ticket.id),
  children: (childrenByParent.get(ticket.id) ?? []).map((child) =>
    buildFilteredNode(child, childrenByParent, matchingIds),
  ),
});

const includedTicketIdsWithAncestors = (
  matchingTickets: ReadonlyArray<Ticket>,
  scopedTicketsById: ReadonlyMap<string, Ticket>,
): ReadonlySet<string> => {
  const includedIds = new Set<string>();

  for (const ticket of matchingTickets) {
    includedIds.add(ticket.id);
    let currentParentId = ticket.parentId;

    while (currentParentId !== undefined) {
      includedIds.add(currentParentId);
      currentParentId = scopedTicketsById.get(currentParentId)?.parentId;
    }
  }

  return includedIds;
};

export const buildFilteredTree = (
  tickets: ReadonlyArray<Ticket>,
  options?: {
    readonly root?: Ticket;
    readonly statuses?: ReadonlySet<TicketStatus>;
    readonly executorFilter?: TicketExecutorFilter;
  },
): ReadonlyArray<TicketTreeNode> => {
  const scopedTickets =
    options?.root === undefined
      ? sortTickets(tickets)
      : flattenFromRoot(options.root, buildChildrenByParent(tickets));
  const executorFilter = options?.executorFilter ?? allExecutorsFilter;
  const matchingTickets = scopedTickets.filter(
    (ticket) =>
      matchesStatusFilter(ticket, options?.statuses) &&
      matchesExecutorFilter(ticket, executorFilter),
  );
  const matchingIds = new Set(matchingTickets.map((ticket) => ticket.id));
  const scopedTicketsById = new Map(scopedTickets.map((ticket) => [ticket.id, ticket]));
  const includedIds = includedTicketIdsWithAncestors(matchingTickets, scopedTicketsById);
  const includedTickets = scopedTickets.filter((ticket) => includedIds.has(ticket.id));
  const childrenByParent = buildChildrenByParent(includedTickets);
  const rootIds = new Set(
    includedTickets
      .filter((ticket) => ticket.parentId === undefined || !includedIds.has(ticket.parentId))
      .map((ticket) => ticket.id),
  );

  return includedTickets
    .filter((ticket) => rootIds.has(ticket.id))
    .map((ticket) => buildFilteredNode(ticket, childrenByParent, matchingIds));
};

export const buildTree = (
  tickets: ReadonlyArray<Ticket>,
  options?: {
    readonly root?: Ticket;
    readonly openOnly?: boolean;
  },
): ReadonlyArray<TicketTreeNode> => {
  const openOnly = options?.openOnly ?? false;
  const visibleTickets = openOnly
    ? tickets.filter((ticket) => ticket.status === "open")
    : [...tickets];
  const childrenByParent = buildChildrenByParent(visibleTickets);

  if (options?.root !== undefined) {
    return openOnly && options.root.status !== "open"
      ? []
      : [buildNode(options.root, childrenByParent, openOnly)];
  }

  return visibleTickets
    .filter((ticket) => ticket.parentId === undefined)
    .toSorted(compareRootTickets)
    .map((ticket) => buildNode(ticket, childrenByParent, openOnly));
};

export const resolveTicket = (
  tickets: ReadonlyArray<Ticket>,
  query: string,
): Effect.Effect<Ticket, TicketNotFound | TicketAmbiguous> => {
  const exact = tickets.find((ticket) => ticket.id === query);
  if (exact !== undefined) {
    return Effect.succeed(exact);
  }

  const matches = tickets.filter((ticket) => ticket.id.startsWith(query));
  if (matches.length === 0) {
    return new TicketNotFound({ query });
  }
  if (matches.length > 1) {
    return new TicketAmbiguous({
      query,
      matches: matches.map((ticket) => ticket.id).toSorted(),
    });
  }
  const [match] = matches;
  return match === undefined ? new TicketNotFound({ query }) : Effect.succeed(match);
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

const ticketIdRadix = 36;
const ticketIdSpaceSize = ticketIdRadix ** ticketIdLength;

const formatTicketId = (value: number): string =>
  value.toString(ticketIdRadix).padStart(ticketIdLength, "0");

export const makeTicketId = Effect.fnUntraced(function* (existingIds: ReadonlySet<string>) {
  if (existingIds.size >= ticketIdSpaceSize) {
    return yield* new CommandFailure({
      message: "Cannot create a Ticket because the short ID space is exhausted.",
    });
  }

  const randomStart = yield* Random.nextIntBetween(0, ticketIdSpaceSize, { halfOpen: true });
  for (let offset = 0; offset <= existingIds.size; offset += 1) {
    const candidate = formatTicketId((randomStart + offset) % ticketIdSpaceSize);
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return yield* new CommandFailure({
    message: "Cannot create a Ticket because no short ID is available.",
  });
});

export const makeOpenTicket = Effect.fnUntraced(function* (options: {
  readonly id: string;
  readonly level: TicketLevel;
  readonly subject: string;
  readonly description: string;
  readonly context: string;
  readonly executor: TicketExecutor;
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
  } satisfies OpenTicket;
});

export interface TicketUpdates {
  readonly subject?: string;
  readonly description?: string;
  readonly context?: string;
}

export const updateTicket = (options: {
  readonly ticket: Ticket;
  readonly updates: TicketUpdates;
  readonly updatedAt: DateTime.Utc;
}): Ticket =>
  ({
    ...options.ticket,
    ...options.updates,
    updatedAt: options.updatedAt,
  }) satisfies Ticket;

export const setTicketExecutor = (options: {
  readonly ticket: Ticket;
  readonly executor: TicketExecutor;
  readonly updatedAt: DateTime.Utc;
}): Ticket =>
  ({
    ...options.ticket,
    executor: options.executor,
    updatedAt: options.updatedAt,
  }) satisfies Ticket;

export const updateTicketClaim = (options: {
  readonly ticket: OpenTicket;
  readonly actor: string;
  readonly claimedAt: DateTime.Utc;
}): OpenTicket =>
  ({
    ...options.ticket,
    claim: {
      actor: options.actor,
      claimedAt: options.claimedAt,
      expiresAt: claimExpiresAt(options.claimedAt),
    },
    updatedAt: options.claimedAt,
  }) satisfies OpenTicket;

export const clearTicketClaim = (options: {
  readonly ticket: Ticket;
  readonly updatedAt: DateTime.Utc;
}): Ticket => {
  const { claim: _claim, ...ticketWithoutClaim } = options.ticket;
  return {
    ...ticketWithoutClaim,
    updatedAt: options.updatedAt,
  } satisfies Ticket;
};

export const completeTicket = (options: {
  readonly ticket: OpenTicket;
  readonly summary: string;
  readonly details: string;
  readonly decisions: ReadonlyArray<string>;
  readonly verification: ReadonlyArray<string>;
  readonly completedAt: DateTime.Utc;
  readonly completedBy: string;
}): DoneTicket => {
  const { status: _status, claim: _claim, ...base } = options.ticket;
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
  } satisfies DoneTicket;
};

export const cancelTicket = (options: {
  readonly ticket: OpenTicket;
  readonly reason: string;
  readonly cancelledAt: DateTime.Utc;
  readonly cancelledBy: string;
}): CancelledTicket => {
  const { status: _status, claim: _claim, ...base } = options.ticket;
  return {
    ...base,
    status: "cancelled",
    cancellation: {
      reason: options.reason,
      cancelledAt: options.cancelledAt,
      cancelledBy: options.cancelledBy,
    },
    updatedAt: options.cancelledAt,
  } satisfies CancelledTicket;
};

export const updateTicketDependencies = Effect.fnUntraced(function* (options: {
  readonly ticket: Ticket;
  readonly blockedBy: ReadonlyArray<string>;
}) {
  const timestamp = yield* DateTime.now;
  const sortedBlockedBy = options.blockedBy.toSorted((left, right) => left.localeCompare(right));

  if (sortedBlockedBy.length > 0) {
    return {
      ...options.ticket,
      blockedBy: sortedBlockedBy,
      updatedAt: timestamp,
    } satisfies Ticket;
  }

  const { blockedBy: _blockedBy, ...ticketWithoutDependencies } = options.ticket;
  return {
    ...ticketWithoutDependencies,
    updatedAt: timestamp,
  } satisfies Ticket;
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
