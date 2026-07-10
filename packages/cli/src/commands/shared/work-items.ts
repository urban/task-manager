import { formatClaimExpiresAt, type WorkItem, type WorkItemClaim } from "../../domain/WorkItem";

export const replaceWorkItem = (
  items: ReadonlyArray<WorkItem>,
  updatedItem: WorkItem,
): ReadonlyArray<WorkItem> =>
  items.map((item) => (item.id === updatedItem.id ? updatedItem : item));

export const activeClaimConflictMessage = (
  item: WorkItem,
  claim: WorkItemClaim,
  action: string,
): string =>
  `Work Item ${item.id} is actively claimed by ${claim.actor} until ${formatClaimExpiresAt(
    claim,
  )}. Use --force to ${action}.`;

export const firstHumanExecutorWorkItem = (items: ReadonlyArray<WorkItem>): WorkItem | undefined =>
  items.find((item) => item.executor === "human");

export const humanExecutorGuardMessage = (item: WorkItem, action: string): string =>
  `Work Item ${item.id} uses human executor. Pass --allow-human to ${action}.`;
