import * as DateTime from "effect/DateTime";

import { ValidationFailure } from "./Errors";
import {
  buildTree,
  isClaimActive,
  matchesExecutorFilter,
  specificExecutorFilter,
  validateSubject,
} from "./Ticket";

type ValidationIssue = import("./Errors").ValidationIssue;
type Ticket = import("./Ticket").Ticket;
type TicketExecutorFilter = import("./Ticket").TicketExecutorFilter;
type TicketLevel = import("./Ticket").TicketLevel;
type TicketTreeNode = import("./Ticket").TicketTreeNode;

const toMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const parentAllowsChild = (parentLevel: TicketLevel, childLevel: TicketLevel): boolean => {
  if (childLevel === "task") {
    return parentLevel === "epic";
  }
  if (childLevel === "subtask") {
    return parentLevel === "task";
  }
  return false;
};

const detectParentCycles = (
  ticketsById: ReadonlyMap<string, Ticket>,
): ReadonlyArray<ValidationIssue> => {
  const issues: Array<ValidationIssue> = [];

  for (const ticket of ticketsById.values()) {
    const visited = new Set<string>([ticket.id]);
    let currentParentId = ticket.parentId;

    while (currentParentId !== undefined) {
      if (visited.has(currentParentId)) {
        issues.push({
          message: `Hierarchy cycle detected for ${ticket.id}.`,
          path: ticket.id,
        });
        break;
      }

      visited.add(currentParentId);
      const parent = ticketsById.get(currentParentId);
      if (parent === undefined) {
        break;
      }
      currentParentId = parent.parentId;
    }
  }

  return issues;
};

const detectDependencyCycles = (
  ticketsById: ReadonlyMap<string, Ticket>,
): ReadonlyArray<ValidationIssue> => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const issues: Array<ValidationIssue> = [];

  const visit = (id: string, path: ReadonlyArray<string>): void => {
    if (visited.has(id)) {
      return;
    }

    if (visiting.has(id)) {
      const cycle = [...path, id].join(" -> ");
      issues.push({
        message: `Dependency cycle detected: ${cycle}.`,
        path: id,
      });
      return;
    }

    visiting.add(id);
    const ticket = ticketsById.get(id);
    const dependencies = ticket?.blockedBy ?? [];
    for (const dependencyId of dependencies) {
      visit(dependencyId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const ticket of ticketsById.values()) {
    visit(ticket.id, []);
  }

  return issues;
};

export const validateStore = (tickets: ReadonlyArray<Ticket>): ReadonlyArray<ValidationIssue> => {
  const issues: Array<ValidationIssue> = [];
  const ticketsById = new Map<string, Ticket>();
  const lineById = new Map<string, number>();

  tickets.forEach((ticket, index) => {
    const subjectIssues = validateSubject(ticket.subject);
    for (const subjectIssue of subjectIssues) {
      issues.push({
        ...subjectIssue,
        line: index + 1,
      });
    }

    if (ticketsById.has(ticket.id)) {
      const previousLine = lineById.get(ticket.id);
      issues.push({
        message: `Duplicate Ticket id ${ticket.id}.`,
        path: ticket.id,
        line: previousLine,
      });
      issues.push({
        message: `Duplicate Ticket id ${ticket.id}.`,
        path: ticket.id,
        line: index + 1,
      });
    } else {
      ticketsById.set(ticket.id, ticket);
      lineById.set(ticket.id, index + 1);
    }

    if (ticket.level === "epic" && ticket.parentId !== undefined) {
      issues.push({
        message: "Epics cannot have parents.",
        path: ticket.id,
        line: index + 1,
      });
    }

    if (ticket.level === "subtask" && ticket.parentId === undefined) {
      issues.push({
        message: "Subtasks must have a parent Task.",
        path: ticket.id,
        line: index + 1,
      });
    }

    const dependencies = ticket.blockedBy ?? [];
    const dependencyCounts = new Map<string, number>();
    for (const dependencyId of dependencies) {
      const previousCount = dependencyCounts.get(dependencyId) ?? 0;
      if (previousCount === 1) {
        issues.push({
          message: `Duplicate dependency ${dependencyId}.`,
          path: ticket.id,
          line: index + 1,
        });
      }
      dependencyCounts.set(dependencyId, previousCount + 1);

      if (dependencyId === ticket.id) {
        issues.push({
          message: "A Ticket cannot depend on itself.",
          path: ticket.id,
          line: index + 1,
        });
      }
    }
  });

  for (const ticket of tickets) {
    if (ticket.parentId === undefined) {
      continue;
    }

    const parent = ticketsById.get(ticket.parentId);
    const line = lineById.get(ticket.id);
    if (parent === undefined) {
      issues.push({
        message: `Parent ${ticket.parentId} does not exist.`,
        path: ticket.id,
        line,
      });
      continue;
    }

    if (!parentAllowsChild(parent.level, ticket.level)) {
      issues.push({
        message: `${ticket.level} cannot be parented under ${parent.level}.`,
        path: ticket.id,
        line,
      });
    }
  }

  for (const ticket of tickets) {
    const dependencies = ticket.blockedBy ?? [];
    for (const dependencyId of dependencies) {
      if (!ticketsById.has(dependencyId)) {
        issues.push({
          message: `Dependency ${dependencyId} does not exist.`,
          path: ticket.id,
          line: lineById.get(ticket.id),
        });
      }
    }
  }

  issues.push(...detectParentCycles(ticketsById));
  issues.push(...detectDependencyCycles(ticketsById));

  return issues;
};

export const ensureValidStore = (
  tickets: ReadonlyArray<Ticket>,
  summary: string,
): ValidationFailure | undefined => {
  const issues = validateStore(tickets);
  if (issues.length === 0) {
    return undefined;
  }
  return new ValidationFailure({ summary, issues });
};

const validateDescriptionRequirement = (
  description: string,
  allowEmptyDescription: boolean,
): ValidationIssue | undefined =>
  allowEmptyDescription || description.trim() !== ""
    ? undefined
    : {
        message: "Description is required unless --allow-empty-description is set.",
        path: "description",
      };

const validateContextRequirement = (
  context: string,
  allowEmptyContext: boolean,
): ValidationIssue | undefined =>
  allowEmptyContext || context.trim() !== ""
    ? undefined
    : {
        message: "Context is required unless --allow-empty-context is set.",
        path: "context",
      };

export const ensureCanCreateTicket = (options: {
  readonly level: TicketLevel;
  readonly parent?: Ticket;
  readonly subject: string;
  readonly description: string;
  readonly context: string;
  readonly allowEmptyDescription: boolean;
  readonly allowEmptyContext: boolean;
}): ValidationFailure | undefined => {
  const issues: Array<ValidationIssue> = [...validateSubject(options.subject)];
  const descriptionIssue = validateDescriptionRequirement(
    options.description,
    options.allowEmptyDescription,
  );
  const contextIssue = validateContextRequirement(options.context, options.allowEmptyContext);

  if (descriptionIssue !== undefined) {
    issues.push(descriptionIssue);
  }

  if (contextIssue !== undefined) {
    issues.push(contextIssue);
  }

  if (options.level === "epic" && options.parent !== undefined) {
    issues.push({
      message: "Epics cannot have parents.",
      path: "parent",
    });
  }

  if (options.level === "subtask" && options.parent === undefined) {
    issues.push({
      message: "Subtasks require a parent Task.",
      path: "parent",
    });
  }

  if (options.parent !== undefined && !parentAllowsChild(options.parent.level, options.level)) {
    issues.push({
      message: `${options.level} cannot be parented under ${options.parent.level}.`,
      path: "parent",
    });
  }

  if (issues.length === 0) {
    return undefined;
  }

  return new ValidationFailure({
    summary: "Ticket validation failed.",
    issues,
  });
};

export const ensureCanUpdateTicket = (options: {
  readonly subject?: string;
  readonly description?: string;
  readonly context?: string;
  readonly allowEmptyDescription: boolean;
  readonly allowEmptyContext: boolean;
}): ValidationFailure | undefined => {
  const issues: Array<ValidationIssue> = [
    ...(options.subject === undefined ? [] : validateSubject(options.subject)),
  ];
  const descriptionIssue =
    options.description === undefined
      ? undefined
      : validateDescriptionRequirement(options.description, options.allowEmptyDescription);
  const contextIssue =
    options.context === undefined
      ? undefined
      : validateContextRequirement(options.context, options.allowEmptyContext);

  if (descriptionIssue !== undefined) {
    issues.push(descriptionIssue);
  }

  if (contextIssue !== undefined) {
    issues.push(contextIssue);
  }

  if (issues.length === 0) {
    return undefined;
  }

  return new ValidationFailure({
    summary: "Ticket update validation failed.",
    issues,
  });
};

export const hasOpenChildren = (ticket: Ticket, tickets: ReadonlyArray<Ticket>): boolean =>
  tickets.some((candidate) => candidate.parentId === ticket.id && candidate.status === "open");

export const isLeafTicket = (ticket: Ticket, tickets: ReadonlyArray<Ticket>): boolean =>
  !hasOpenChildren(ticket, tickets);

export const sortChildrenForSelection = (tickets: ReadonlyArray<Ticket>): ReadonlyArray<Ticket> =>
  tickets.toSorted((left, right) => {
    const diff = toMillis(left.createdAt) - toMillis(right.createdAt);
    if (diff !== 0) {
      return diff;
    }
    return left.id.localeCompare(right.id);
  });

const indexTicketsById = (tickets: ReadonlyArray<Ticket>): ReadonlyMap<string, Ticket> => {
  const ticketsById = new Map<string, Ticket>();
  for (const ticket of tickets) {
    ticketsById.set(ticket.id, ticket);
  }
  return ticketsById;
};

const hasCompletedDependencies = (
  ticket: Ticket,
  ticketsById: ReadonlyMap<string, Ticket>,
): boolean =>
  (ticket.blockedBy ?? []).every(
    (dependencyId) => ticketsById.get(dependencyId)?.status === "done",
  );

const isActionableTreeNode = (
  node: TicketTreeNode,
  ticketsById: ReadonlyMap<string, Ticket>,
  now: DateTime.Utc,
  includeClaimed: boolean,
  executorFilter: TicketExecutorFilter,
): boolean =>
  node.ticket.status === "open" &&
  node.children.length === 0 &&
  matchesExecutorFilter(node.ticket, executorFilter) &&
  hasCompletedDependencies(node.ticket, ticketsById) &&
  (includeClaimed || !isClaimActive(node.ticket.claim, now));

const findFirstActionableNode = (
  nodes: ReadonlyArray<TicketTreeNode>,
  ticketsById: ReadonlyMap<string, Ticket>,
  now: DateTime.Utc,
  includeClaimed: boolean,
  executorFilter: TicketExecutorFilter,
): Ticket | undefined => {
  for (const node of nodes) {
    if (isActionableTreeNode(node, ticketsById, now, includeClaimed, executorFilter)) {
      return node.ticket;
    }

    const child = findFirstActionableNode(
      node.children,
      ticketsById,
      now,
      includeClaimed,
      executorFilter,
    );
    if (child !== undefined) {
      return child;
    }
  }

  return undefined;
};

export const orderedOpenChildren = (
  ticket: Ticket,
  tickets: ReadonlyArray<Ticket>,
): ReadonlyArray<Ticket> =>
  sortChildrenForSelection(
    tickets.filter((candidate) => candidate.parentId === ticket.id && candidate.status === "open"),
  );

export const findNextActionableTicket = (
  tickets: ReadonlyArray<Ticket>,
  options: {
    readonly now: DateTime.Utc;
    readonly root?: Ticket;
    readonly includeClaimed?: boolean;
    readonly executorFilter?: TicketExecutorFilter;
  },
): Ticket | undefined => {
  const ticketsById = indexTicketsById(tickets);
  const tree = buildTree(tickets, {
    ...(options.root === undefined ? {} : { root: options.root }),
    openOnly: true,
  });

  return findFirstActionableNode(
    tree,
    ticketsById,
    options.now,
    options.includeClaimed ?? false,
    options.executorFilter ?? specificExecutorFilter("agent"),
  );
};
