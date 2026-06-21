import * as DateTime from "effect/DateTime";

import { ValidationFailure, type ValidationIssue } from "./Errors";
import {
  buildTree,
  isClaimActive,
  type WorkItem,
  type WorkItemLevel,
  type WorkItemTreeNode,
  validateSubject,
} from "./WorkItem";

const toMillis = (value: DateTime.Utc): number => DateTime.toEpochMillis(value);

const parentAllowsChild = (parentLevel: WorkItemLevel, childLevel: WorkItemLevel): boolean => {
  if (childLevel === "task") {
    return parentLevel === "epic";
  }
  if (childLevel === "subtask") {
    return parentLevel === "task";
  }
  return false;
};

const detectParentCycles = (
  itemsById: ReadonlyMap<string, WorkItem>,
): ReadonlyArray<ValidationIssue> => {
  const issues: Array<ValidationIssue> = [];

  for (const item of itemsById.values()) {
    const visited = new Set<string>([item.id]);
    let currentParentId = item.parentId;

    while (currentParentId !== undefined) {
      if (visited.has(currentParentId)) {
        issues.push({
          message: `Hierarchy cycle detected for ${item.id}.`,
          path: item.id,
        });
        break;
      }

      visited.add(currentParentId);
      const parent = itemsById.get(currentParentId);
      if (parent === undefined) {
        break;
      }
      currentParentId = parent.parentId;
    }
  }

  return issues;
};

const detectDependencyCycles = (
  itemsById: ReadonlyMap<string, WorkItem>,
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
    const item = itemsById.get(id);
    const dependencies = item?.blockedBy ?? [];
    for (const dependencyId of dependencies) {
      visit(dependencyId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const item of itemsById.values()) {
    visit(item.id, []);
  }

  return issues;
};

export const validateStore = (items: ReadonlyArray<WorkItem>): ReadonlyArray<ValidationIssue> => {
  const issues: Array<ValidationIssue> = [];
  const itemsById = new Map<string, WorkItem>();
  const lineById = new Map<string, number>();

  items.forEach((item, index) => {
    const subjectIssues = validateSubject(item.subject);
    for (const subjectIssue of subjectIssues) {
      issues.push({
        ...subjectIssue,
        line: index + 1,
      });
    }

    if (itemsById.has(item.id)) {
      const previousLine = lineById.get(item.id);
      issues.push({
        message: `Duplicate Work Item id ${item.id}.`,
        path: item.id,
        line: previousLine,
      });
      issues.push({
        message: `Duplicate Work Item id ${item.id}.`,
        path: item.id,
        line: index + 1,
      });
    } else {
      itemsById.set(item.id, item);
      lineById.set(item.id, index + 1);
    }

    if (item.level === "epic" && item.parentId !== undefined) {
      issues.push({
        message: "Epics cannot have parents.",
        path: item.id,
        line: index + 1,
      });
    }

    if (item.level === "subtask" && item.parentId === undefined) {
      issues.push({
        message: "Subtasks must have a parent Task.",
        path: item.id,
        line: index + 1,
      });
    }

    if (item.status === "open") {
      if (item.result !== undefined) {
        issues.push({
          message: "Open Work Items cannot include a result.",
          path: item.id,
          line: index + 1,
        });
      }
      if (item.cancellation !== undefined) {
        issues.push({
          message: "Open Work Items cannot include a cancellation.",
          path: item.id,
          line: index + 1,
        });
      }
    }

    if (item.status === "done") {
      if (item.result === undefined) {
        issues.push({
          message: "Done Work Items must include a result.",
          path: item.id,
          line: index + 1,
        });
      }
      if (item.cancellation !== undefined) {
        issues.push({
          message: "Done Work Items cannot include a cancellation.",
          path: item.id,
          line: index + 1,
        });
      }
    }

    if (item.status === "cancelled") {
      if (item.cancellation === undefined) {
        issues.push({
          message: "Cancelled Work Items must include a cancellation.",
          path: item.id,
          line: index + 1,
        });
      }
      if (item.result !== undefined) {
        issues.push({
          message: "Cancelled Work Items cannot include a result.",
          path: item.id,
          line: index + 1,
        });
      }
    }

    const dependencies = item.blockedBy ?? [];
    const dependencyCounts = new Map<string, number>();
    for (const dependencyId of dependencies) {
      const previousCount = dependencyCounts.get(dependencyId) ?? 0;
      if (previousCount === 1) {
        issues.push({
          message: `Duplicate dependency ${dependencyId}.`,
          path: item.id,
          line: index + 1,
        });
      }
      dependencyCounts.set(dependencyId, previousCount + 1);

      if (dependencyId === item.id) {
        issues.push({
          message: "A Work Item cannot depend on itself.",
          path: item.id,
          line: index + 1,
        });
      }
    }
  });

  for (const item of items) {
    if (item.parentId === undefined) {
      continue;
    }

    const parent = itemsById.get(item.parentId);
    const line = lineById.get(item.id);
    if (parent === undefined) {
      issues.push({
        message: `Parent ${item.parentId} does not exist.`,
        path: item.id,
        line,
      });
      continue;
    }

    if (!parentAllowsChild(parent.level, item.level)) {
      issues.push({
        message: `${item.level} cannot be parented under ${parent.level}.`,
        path: item.id,
        line,
      });
    }
  }

  for (const item of items) {
    const dependencies = item.blockedBy ?? [];
    for (const dependencyId of dependencies) {
      if (!itemsById.has(dependencyId)) {
        issues.push({
          message: `Dependency ${dependencyId} does not exist.`,
          path: item.id,
          line: lineById.get(item.id),
        });
      }
    }
  }

  issues.push(...detectParentCycles(itemsById));
  issues.push(...detectDependencyCycles(itemsById));

  return issues;
};

export const ensureValidStore = (
  items: ReadonlyArray<WorkItem>,
  summary: string,
): ValidationFailure | undefined => {
  const issues = validateStore(items);
  if (issues.length === 0) {
    return undefined;
  }
  return new ValidationFailure({ summary, issues });
};

export const ensureCanCreateItem = (options: {
  readonly level: WorkItemLevel;
  readonly parent?: WorkItem;
  readonly subject: string;
  readonly description: string;
  readonly agentContext: string;
  readonly allowEmptyDescription: boolean;
  readonly allowEmptyContext: boolean;
}): ValidationFailure | undefined => {
  const issues: Array<ValidationIssue> = [...validateSubject(options.subject)];

  if (!options.allowEmptyDescription && options.description.trim() === "") {
    issues.push({
      message: "Description is required unless --allow-empty-description is set.",
      path: "description",
    });
  }

  if (!options.allowEmptyContext && options.agentContext.trim() === "") {
    issues.push({
      message: "Agent Context is required unless --allow-empty-context is set.",
      path: "agentContext",
    });
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
    summary: "Work Item validation failed.",
    issues,
  });
};

export const hasOpenChildren = (item: WorkItem, items: ReadonlyArray<WorkItem>): boolean =>
  items.some((candidate) => candidate.parentId === item.id && candidate.status === "open");

export const isLeafWorkItem = (item: WorkItem, items: ReadonlyArray<WorkItem>): boolean =>
  !hasOpenChildren(item, items);

export const sortChildrenForSelection = (items: ReadonlyArray<WorkItem>): ReadonlyArray<WorkItem> =>
  items.toSorted((left, right) => {
    const diff = toMillis(left.createdAt) - toMillis(right.createdAt);
    if (diff !== 0) {
      return diff;
    }
    return left.id.localeCompare(right.id);
  });

const indexItemsById = (items: ReadonlyArray<WorkItem>): ReadonlyMap<string, WorkItem> => {
  const itemsById = new Map<string, WorkItem>();
  for (const item of items) {
    itemsById.set(item.id, item);
  }
  return itemsById;
};

const hasCompletedDependencies = (
  item: WorkItem,
  itemsById: ReadonlyMap<string, WorkItem>,
): boolean =>
  (item.blockedBy ?? []).every((dependencyId) => itemsById.get(dependencyId)?.status === "done");

const isActionableTreeNode = (
  node: WorkItemTreeNode,
  itemsById: ReadonlyMap<string, WorkItem>,
  now: DateTime.Utc,
  includeClaimed: boolean,
): boolean =>
  node.item.status === "open" &&
  node.children.length === 0 &&
  hasCompletedDependencies(node.item, itemsById) &&
  (includeClaimed || !isClaimActive(node.item.claim, now));

const findFirstActionableNode = (
  nodes: ReadonlyArray<WorkItemTreeNode>,
  itemsById: ReadonlyMap<string, WorkItem>,
  now: DateTime.Utc,
  includeClaimed: boolean,
): WorkItem | undefined => {
  for (const node of nodes) {
    if (isActionableTreeNode(node, itemsById, now, includeClaimed)) {
      return node.item;
    }

    const child = findFirstActionableNode(node.children, itemsById, now, includeClaimed);
    if (child !== undefined) {
      return child;
    }
  }

  return undefined;
};

export const orderedOpenChildren = (
  item: WorkItem,
  items: ReadonlyArray<WorkItem>,
): ReadonlyArray<WorkItem> =>
  sortChildrenForSelection(
    items.filter((candidate) => candidate.parentId === item.id && candidate.status === "open"),
  );

export const findNextActionableWorkItem = (
  items: ReadonlyArray<WorkItem>,
  options: {
    readonly now: DateTime.Utc;
    readonly root?: WorkItem;
    readonly includeClaimed?: boolean;
  },
): WorkItem | undefined => {
  const itemsById = indexItemsById(items);
  const tree = buildTree(items, {
    ...(options.root === undefined ? {} : { root: options.root }),
    openOnly: true,
  });

  return findFirstActionableNode(tree, itemsById, options.now, options.includeClaimed ?? false);
};
