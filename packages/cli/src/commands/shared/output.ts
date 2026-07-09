import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ValidationFailure, type TmError } from "../../domain/Errors";
import {
  buildTree,
  encodeWorkItem,
  type WorkItem,
  type WorkItemEncoded,
} from "../../domain/WorkItem";

const encodeJson = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const isValidationFailure = Schema.is(ValidationFailure);

export const renderJson = (value: unknown): string => encodeJson(value);

export const encodeItemForOutput = (item: WorkItem): WorkItemEncoded => encodeWorkItem(item);

const errorMessage = (error: Exclude<TmError, ValidationFailure>): string => {
  switch (error._tag) {
    case "CommandFailure":
    case "StorageFailure":
      return error.message;
    case "StorageNotInitialized":
      return `Task store is not initialized at ${error.tasksFile}. Run tm init first.`;
    case "WorkItemNotFound":
      return `Work Item ${error.query} was not found.`;
    case "WorkItemAmbiguous":
      return `Work Item prefix ${error.query} is ambiguous. Matches: ${error.matches.join(", ")}.`;
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

export const renderBullets = (items: ReadonlyArray<string>): ReadonlyArray<string> =>
  items.length === 0 ? ["-"] : items.map((item) => `- ${item}`);

const renderResultHuman = (result: WorkItemEncoded["result"]): string =>
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

const renderCancellationHuman = (cancellation: WorkItemEncoded["cancellation"]): string =>
  cancellation === undefined
    ? "-"
    : [
        `Reason: ${cancellation.reason}`,
        `Cancelled: ${cancellation.cancelledAt} by ${cancellation.cancelledBy}`,
      ].join("\n");

export const renderWorkItemHuman = (item: WorkItem): string => {
  const encoded = encodeItemForOutput(item);
  const dependencies = encoded.blockedBy?.length ?? 0;

  return [
    `${encoded.level.toUpperCase()} ${encoded.id}`,
    `Status: ${encoded.status}`,
    `Execution mode: ${encoded.executionMode}`,
    `Subject: ${encoded.subject}`,
    `Parent: ${encoded.parentId ?? "-"}`,
    `Dependencies: ${dependencies === 0 ? "-" : (encoded.blockedBy?.join(", ") ?? "-")}`,
    `Claim: ${
      encoded.claim === undefined ? "-" : `${encoded.claim.agent} until ${encoded.claim.expiresAt}`
    }`,
    "",
    "Description:",
    encoded.description === "" ? "-" : encoded.description,
    "",
    "Agent Context:",
    encoded.agentContext === "" ? "-" : encoded.agentContext,
    "",
    "Result:",
    renderResultHuman(encoded.result),
    "",
    "Cancellation:",
    renderCancellationHuman(encoded.cancellation),
  ].join("\n");
};

export const renderTreeLines = (
  nodes: ReadonlyArray<ReturnType<typeof buildTree>[number]>,
  prefix = "",
): ReadonlyArray<string> => {
  const lines: Array<string> = [];

  nodes.forEach((node, index) => {
    const branch = index === nodes.length - 1 ? "└─" : "├─";
    lines.push(
      `${prefix}${branch} ${node.item.subject} [${node.item.status}] [${node.item.executionMode}] (${node.item.id})`,
    );
    const childPrefix = `${prefix}${index === nodes.length - 1 ? "   " : "│  "}`;
    lines.push(...renderTreeLines(node.children, childPrefix));
  });

  return lines;
};

export interface RenderTreeJsonNode {
  readonly id: string;
  readonly level: string;
  readonly status: string;
  readonly executionMode: string;
  readonly subject: string;
  readonly matchesFilter: boolean;
  readonly children: ReadonlyArray<RenderTreeJsonNode>;
}

export const renderTreeJson = (
  nodes: ReadonlyArray<ReturnType<typeof buildTree>[number]>,
): ReadonlyArray<RenderTreeJsonNode> =>
  nodes.map((node) => ({
    id: node.item.id,
    level: node.item.level,
    status: node.item.status,
    executionMode: node.item.executionMode,
    subject: node.item.subject,
    matchesFilter: node.matchesFilter,
    children: renderTreeJson(node.children),
  }));
