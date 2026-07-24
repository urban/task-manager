import { formatClaimExpiresAt } from "../../domain/Ticket";

type Ticket = import("../../domain/Ticket").Ticket;
type TicketClaim = import("../../domain/Ticket").TicketClaim;

export const replaceTicket = (
  tickets: ReadonlyArray<Ticket>,
  updatedTicket: Ticket,
): ReadonlyArray<Ticket> =>
  tickets.map((ticket) => (ticket.id === updatedTicket.id ? updatedTicket : ticket));

export const activeClaimConflictMessage = (
  ticket: Ticket,
  claim: TicketClaim,
  action: string,
): string =>
  `Ticket ${ticket.id} is actively claimed by ${claim.actor} until ${formatClaimExpiresAt(
    claim,
  )}. Use --force to ${action}.`;

export const firstHumanExecutorTicket = (tickets: ReadonlyArray<Ticket>): Ticket | undefined =>
  tickets.find((ticket) => ticket.executor === "human");

export const humanExecutorGuardMessage = (ticket: Ticket, action: string): string =>
  `Ticket ${ticket.id} uses human executor. Pass --allow-human to ${action}.`;
