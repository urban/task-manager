import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ValidationFailure } from "../../domain/Errors";
import { encodeTicket } from "../../domain/Ticket";

type TmError = import("../../domain/Errors").TmError;
type Ticket = import("../../domain/Ticket").Ticket;
type TicketCancellationEncoded = import("../../domain/Ticket").TicketCancellationEncoded;
type TicketEncoded = import("../../domain/Ticket").TicketEncoded;
type TicketResultEncoded = import("../../domain/Ticket").TicketResultEncoded;
type TicketExecutorFilter = import("../../domain/Ticket").TicketExecutorFilter;
type TicketTreeNode = import("../../domain/Ticket").TicketTreeNode;

const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const isValidationFailure = Schema.is(ValidationFailure);

export const renderJson = (value: unknown): string => encodeJson(value);

export const encodeTicketForOutput = (ticket: Ticket): TicketEncoded => encodeTicket(ticket);

const errorMessage = (error: Exclude<TmError, ValidationFailure>): string => {
  switch (error._tag) {
    case "CommandFailure":
    case "StorageFailure":
      return error.message;
    case "StorageNotInitialized":
      return `Task store is not initialized at ${error.tasksFile}. Run tm init first.`;
    case "TicketNotFound":
      return `Ticket ${error.query} was not found.`;
    case "TicketAmbiguous":
      return `Ticket prefix ${error.query} is ambiguous. Matches: ${error.matches.join(", ")}.`;
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

export const executeCommand = <A, R>(
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

export const renderBullets = (tickets: ReadonlyArray<string>): ReadonlyArray<string> =>
  tickets.length === 0 ? ["-"] : tickets.map((ticket) => `- ${ticket}`);

const renderResultHuman = (result: TicketResultEncoded | undefined): string =>
  result === undefined
    ? "-"
    : [
        `Summary: ${result.summary}`,
        "Details:",
        result.details === "" ? "-" : result.details,
        "Decisions:",
        ...renderBullets(result.decisions),
        "Verification:",
        ...renderBullets(result.verification),
        `Completed: ${result.completedAt} by ${result.completedBy}`,
      ].join("\n");

const renderCancellationHuman = (cancellation: TicketCancellationEncoded | undefined): string =>
  cancellation === undefined
    ? "-"
    : [
        `Reason: ${cancellation.reason}`,
        `Cancelled: ${cancellation.cancelledAt} by ${cancellation.cancelledBy}`,
      ].join("\n");

export const renderTicketHuman = (ticket: Ticket): string => {
  const encoded = encodeTicketForOutput(ticket);
  const dependencies = encoded.blockedBy?.length ?? 0;

  return [
    `${encoded.level.toUpperCase()} ${encoded.id}`,
    `Status: ${encoded.status}`,
    `Executor: ${encoded.executor}`,
    `Subject: ${encoded.subject}`,
    `Parent: ${encoded.parentId ?? "-"}`,
    `Dependencies: ${dependencies === 0 ? "-" : (encoded.blockedBy?.join(", ") ?? "-")}`,
    `Claim: ${
      encoded.claim === undefined ? "-" : `${encoded.claim.actor} until ${encoded.claim.expiresAt}`
    }`,
    "",
    "Description:",
    encoded.description === "" ? "-" : encoded.description,
    "",
    "Context:",
    encoded.context === "" ? "-" : encoded.context,
    "",
    "Result:",
    renderResultHuman(encoded.status === "done" ? encoded.result : undefined),
    "",
    "Cancellation:",
    renderCancellationHuman(encoded.status === "cancelled" ? encoded.cancellation : undefined),
  ].join("\n");
};

const containsCompletedWork = (node: TicketTreeNode): boolean =>
  node.ticket.status === "done" || node.children.some(containsCompletedWork);

const renderTreeMarker = (node: TicketTreeNode): string => {
  switch (node.ticket.status) {
    case "done":
      return "[x]";
    case "cancelled":
      return "[-]";
    case "open":
      return node.children.some(containsCompletedWork) ? "[/]" : "[ ]";
  }
};

const renderExecutorNotation = (
  node: TicketTreeNode,
  executorFilter: TicketExecutorFilter,
): string => {
  if (
    executorFilter._tag === "SpecificExecutor" &&
    node.ticket.executor === executorFilter.executor
  ) {
    return "";
  }
  return node.ticket.executor === "human" ? "(H) " : "";
};

const renderTreeNodeLines = (
  nodes: ReadonlyArray<TicketTreeNode>,
  prefix: string,
  roots: boolean,
  executorFilter: TicketExecutorFilter,
): ReadonlyArray<string> =>
  nodes.flatMap((node, index) => {
    const isLast = index === nodes.length - 1;
    const connector = roots ? "" : isLast ? "└── " : "├── ";
    const line = `${prefix}${connector}${renderTreeMarker(node)} ${node.ticket.id}: ${renderExecutorNotation(node, executorFilter)}${node.ticket.subject}`;
    const childPrefix = roots ? "    " : `${prefix}${isLast ? "    " : "│   "}`;
    return [line, ...renderTreeNodeLines(node.children, childPrefix, false, executorFilter)];
  });

export const renderTreeLines = (
  nodes: ReadonlyArray<TicketTreeNode>,
  executorFilter: TicketExecutorFilter,
): ReadonlyArray<string> => renderTreeNodeLines(nodes, "", true, executorFilter);

export interface RenderTreeJsonNode {
  readonly id: string;
  readonly level: string;
  readonly status: string;
  readonly executor: string;
  readonly subject: string;
  readonly matchesFilter: boolean;
  readonly children: ReadonlyArray<RenderTreeJsonNode>;
}

export const renderTreeJson = (
  nodes: ReadonlyArray<TicketTreeNode>,
): ReadonlyArray<RenderTreeJsonNode> =>
  nodes.map((node) => ({
    id: node.ticket.id,
    level: node.ticket.level,
    status: node.ticket.status,
    executor: node.ticket.executor,
    subject: node.ticket.subject,
    matchesFilter: node.matchesFilter,
    children: renderTreeJson(node.children),
  }));
