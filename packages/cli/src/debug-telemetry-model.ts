import { Cause, Exit } from "effect";
import { OtlpSerialization } from "effect/unstable/observability";

import PackageJson from "../package.json" with { type: "json" };

export type OtlpSerializationService = OtlpSerialization.OtlpSerialization["Service"];
type ReadonlyMember<T> = T extends unknown ? Readonly<T> : never;
export type Immutable<T> = T extends globalThis.Function
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Immutable<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;
type DebugExit = Immutable<ReadonlyMember<Exit.Exit<unknown, unknown>>>;
export type HttpBody = Immutable<ReturnType<OtlpSerializationService["traces"]>>;
export type SafeOutcome = "composite_failure" | "defect" | "interrupted" | "success";
export type SafeKeyValue = {
  readonly key: string;
  readonly value: {
    readonly stringValue?: string;
    readonly intValue?: number;
  };
};
export type SafeTraceRecord = {
  readonly kind: "trace";
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes: ReadonlyArray<SafeKeyValue>;
  readonly outcome: SafeOutcome;
};
export type SafeLogRecord = {
  readonly kind: "log";
  readonly timeUnixNano: string;
  readonly attributes: ReadonlyArray<SafeKeyValue>;
};
export type SafeRecord = SafeLogRecord | SafeTraceRecord;

const safeKeyValues = new WeakSet<SafeKeyValue>();
const safeTraceRecords = new WeakSet<SafeTraceRecord>();
const safeLogRecords = new WeakSet<SafeLogRecord>();

export const debugTelemetryCapacity = 128;
export const debugTracesEndpoint = "http://127.0.0.1:4318/v1/traces";
export const debugLogsEndpoint = "http://127.0.0.1:4318/v1/logs";
export const debugFetchRequestInit: Readonly<globalThis.RequestInit> = {
  credentials: "omit",
  redirect: "manual",
};
export const debugTelemetryResourceAttributes: Readonly<Record<string, string>> = {
  "service.name": "task-manager",
  "service.version": PackageJson.version,
  "effect.version": "4.0.0-rc.112",
  "telemetry.schema.version": "1",
  "telemetry.mode": "privileged-debug",
};

const safeSpanNames: ReadonlyArray<string> = [
  "CliApplication.run",
  "StoreLocationResolver.resolve",
  "StoreLocationResolver.gitCommonRoot",
  "CommandInput.readFile",
  "TaskManager.initializeStore",
  "TaskManager.validateStore",
  "TaskManager.createTicket",
  "TaskManager.updateTicket",
  "TaskManager.getTicketDetails",
  "TaskManager.listTickets",
  "TaskManager.selectNextTicket",
  "TaskManager.claimTicket",
  "TaskManager.renewClaim",
  "TaskManager.releaseClaim",
  "TaskManager.completeTicket",
  "TaskManager.cancelTicket",
  "TaskManager.deleteTicket",
  "TaskManager.blockTicket",
  "TaskManager.unblockTicket",
  "CoordinationStore.runRead",
  "CoordinationStore.runMutation",
  "CoordinationStore.runInitialization",
  "CoordinationStore.runValidation",
  "CoordinationStore.publishInitialization",
  "StoreSqlClient.acquire",
  "ProcessOutput.publish",
];
const safeSpanNameSet: ReadonlySet<string> = new Set(safeSpanNames);
const safeOutcomes: ReadonlySet<SafeOutcome> = new Set([
  "composite_failure",
  "defect",
  "interrupted",
  "success",
]);
const hex16 = /^[0-9a-f]{16}$/u;
const hex32 = /^[0-9a-f]{32}$/u;
const unsignedNanoTime = /^(?:0|[1-9][0-9]*)$/u;
const stringAttributeValues: Readonly<Record<string, ReadonlySet<string>>> = {
  command: new Set([
    "init",
    "validate",
    "create",
    "update",
    "show",
    "list",
    "next",
    "claim",
    "renew",
    "release",
    "complete",
    "cancel",
    "delete",
    "block",
    "unblock",
  ]),
  "output.mode": new Set(["human", "json"]),
  operation: new Set(safeSpanNames),
  "operation.kind": new Set(["read", "mutation", "initialization", "validation"]),
  "store.source": new Set(["explicit", "project"]),
  "store.session": new Set(["read", "write", "initialization", "validation"]),
  "client.profile": new Set(["readonly", "readwrite", "initialization"]),
  outcome: new Set(["success", "expected_failure", "defect", "interrupted", "composite_failure"]),
  "transaction.outcome": new Set(["committed", "rolled_back", "outcome_unknown"]),
  "recovery.class": new Set([
    "non_commit_established",
    "transaction_outcome_unknown",
    "committed_finalization_failed",
  ]),
  "db.system": new Set(["sqlite"]),
};
const countAttributeNames: ReadonlySet<string> = new Set([
  "failure.fail_count",
  "failure.die_count",
  "failure.interrupt_count",
]);
export const isSafeSpanName = (...[name]: readonly [string]): boolean => safeSpanNameSet.has(name);

export const safeAttribute = (
  ...[key, value]: readonly [string, unknown]
): SafeKeyValue | undefined => {
  const stringValues = stringAttributeValues[key];
  if (stringValues !== undefined && typeof value === "string" && stringValues.has(value)) {
    const attribute = Object.freeze({ key, value: Object.freeze({ stringValue: value }) });
    safeKeyValues.add(attribute);
    return attribute;
  }
  if (
    countAttributeNames.has(key) &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255
  ) {
    const attribute = Object.freeze({ key, value: Object.freeze({ intValue: value }) });
    safeKeyValues.add(attribute);
    return attribute;
  }
  if (key === "process.exit_code" && (value === 0 || value === 1)) {
    const attribute = Object.freeze({ key, value: Object.freeze({ intValue: value }) });
    safeKeyValues.add(attribute);
    return attribute;
  }
  return undefined;
};

export const safeAttributes = (
  ...[entries]: readonly [Readonly<Iterable<readonly [string, unknown]>>]
): Array<SafeKeyValue> =>
  Array.from(entries).flatMap((...[entry]: readonly [readonly [string, unknown]]) => {
    const attribute = safeAttribute(...entry);
    return attribute === undefined ? [] : [attribute];
  });

export const makeSafeTraceRecord = (
  ...[record]: readonly [Readonly<SafeTraceRecord>]
): SafeTraceRecord | undefined => {
  if (
    !isSafeSpanName(record.name) ||
    !hex32.test(record.traceId) ||
    !hex16.test(record.spanId) ||
    (record.parentSpanId !== undefined && !hex16.test(record.parentSpanId)) ||
    !unsignedNanoTime.test(record.startTimeUnixNano) ||
    !unsignedNanoTime.test(record.endTimeUnixNano) ||
    !safeOutcomes.has(record.outcome) ||
    !record.attributes.every((attribute) => safeKeyValues.has(attribute))
  ) {
    return undefined;
  }
  const safe = Object.freeze({
    ...record,
    attributes: Object.freeze([...record.attributes]),
  });
  safeTraceRecords.add(safe);
  return safe;
};

export const makeSafeLogRecord = (
  ...[record]: readonly [Readonly<SafeLogRecord>]
): SafeLogRecord | undefined => {
  if (
    !unsignedNanoTime.test(record.timeUnixNano) ||
    !record.attributes.every((attribute) => safeKeyValues.has(attribute))
  ) {
    return undefined;
  }
  const safe = Object.freeze({
    ...record,
    attributes: Object.freeze([...record.attributes]),
  });
  safeLogRecords.add(safe);
  return safe;
};

export const projectDebugDefect = (
  ...[defect]: readonly [unknown]
): Readonly<{
  readonly classification: "untrusted";
  readonly message: "Untrusted defect message omitted.";
  readonly frames: readonly [];
}> => {
  void defect;
  return {
    classification: "untrusted",
    message: "Untrusted defect message omitted.",
    frames: [],
  };
};

export const classifyDebugExit = (...[exit]: readonly [DebugExit]): SafeOutcome => {
  if (!Exit.isFailure(exit)) {
    return "success";
  }
  const reasons = exit.cause.reasons;
  const firstReason = reasons[0];
  if (reasons.length === 1 && firstReason !== undefined && Cause.isDieReason(firstReason)) {
    return "defect";
  }
  let everyReasonIsInterruption = reasons.length > 0;
  for (const reason of reasons) {
    if (!Cause.isInterruptReason(reason)) {
      everyReasonIsInterruption = false;
    }
  }
  if (everyReasonIsInterruption) {
    return "interrupted";
  }
  return "composite_failure";
};

export const safeTracesForSerialization = (
  ...[records]: readonly [ReadonlyArray<Readonly<SafeTraceRecord>>]
): ReadonlyArray<SafeTraceRecord> => records.filter((record) => safeTraceRecords.has(record));

export const safeLogsForSerialization = (
  ...[records]: readonly [ReadonlyArray<Readonly<SafeLogRecord>>]
): ReadonlyArray<SafeLogRecord> => records.filter((record) => safeLogRecords.has(record));
