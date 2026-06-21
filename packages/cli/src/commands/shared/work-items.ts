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
  `Work Item ${item.id} is actively claimed by ${claim.agent} until ${formatClaimExpiresAt(
    claim,
  )}. Use --force to ${action}.`;
