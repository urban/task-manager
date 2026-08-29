/* oxlint-disable typescript/prefer-readonly-parameter-types */
import { Cause, Exit } from "effect";
import { OtlpResource, OtlpSerialization } from "effect/unstable/observability";

import PackageJson from "../package.json" with { type: "json" };

export type OtlpSerializationService = OtlpSerialization.OtlpSerialization["Service"];
type ReadonlyMember<T> = T extends unknown ? Readonly<T> : never;
type DebugExit = ReadonlyMember<Exit.Exit<unknown, unknown>>;
type DebugFailure = Readonly<Exit.Failure<unknown, unknown>>;
export type HttpBody = ReturnType<OtlpSerializationService["traces"]>;
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
const resource = OtlpResource.make({
  serviceName: "task-manager",
  serviceVersion: PackageJson.version,
  attributes: {
    "effect.version": "4.0.0-rc.112",
    "telemetry.schema.version": "1",
    "telemetry.mode": "privileged-debug",
  },
});

export const isSafeSpanName = (...[name]: readonly [string]): boolean => safeSpanNameSet.has(name);

export const safeAttribute = (
  ...[key, value]: readonly [string, unknown]
): SafeKeyValue | undefined => {
  const stringValues = stringAttributeValues[key];
  if (stringValues !== undefined && typeof value === "string" && stringValues.has(value)) {
    return { key, value: { stringValue: value } };
  }
  if (
    countAttributeNames.has(key) &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 255
  ) {
    return { key, value: { intValue: value } };
  }
  if (key === "process.exit_code" && (value === 0 || value === 1)) {
    return { key, value: { intValue: value } };
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

const isDebugFailure = (exit: DebugExit): exit is DebugFailure => Exit.isFailure(exit);

export const classifyDebugExit = (...[exit]: readonly [DebugExit]): SafeOutcome => {
  if (!isDebugFailure(exit)) {
    return "success";
  }
  const reasons = exit.cause.reasons;
  const firstReason = reasons[0];
  if (reasons.length === 1 && firstReason !== undefined && Cause.isDieReason(firstReason)) {
    return "defect";
  }
  if (
    reasons.length > 0 &&
    reasons.every((...[reason]: readonly [Readonly<Cause.Reason<unknown>>]) =>
      Cause.isInterruptReason(reason),
    )
  ) {
    return "interrupted";
  }
  return "composite_failure";
};

const traceStatus = (
  ...[outcome]: readonly [SafeOutcome]
): Readonly<
  | { readonly code: 1 }
  | { readonly code: 2 }
  | { readonly code: 2; readonly message: "Untrusted defect message omitted." }
> => {
  if (outcome === "success") {
    return { code: 1 };
  }
  if (outcome === "defect") {
    return { code: 2, message: "Untrusted defect message omitted." };
  }
  return { code: 2 };
};

export const serializeDebugTraces = (
  ...[serialization, records]: readonly [
    Readonly<OtlpSerializationService>,
    ReadonlyArray<Readonly<SafeTraceRecord>>,
  ]
): HttpBody =>
  serialization.traces({
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: "task-manager" },
            spans: records.map((...[record]: readonly [Readonly<SafeTraceRecord>]) => ({
              traceId: record.traceId,
              spanId: record.spanId,
              parentSpanId: record.parentSpanId,
              name: record.name,
              kind: 1,
              startTimeUnixNano: record.startTimeUnixNano,
              endTimeUnixNano: record.endTimeUnixNano,
              attributes: [...record.attributes],
              droppedAttributesCount: 0,
              events: [],
              droppedEventsCount: 0,
              status: traceStatus(record.outcome),
              links: [],
              droppedLinksCount: 0,
            })),
          },
        ],
      },
    ],
  });

export const serializeDebugLogs = (
  ...[serialization, records]: readonly [
    Readonly<OtlpSerializationService>,
    ReadonlyArray<Readonly<SafeLogRecord>>,
  ]
): HttpBody =>
  serialization.logs({
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: { name: "task-manager" },
            logRecords: records.map((...[record]: readonly [Readonly<SafeLogRecord>]) => ({
              timeUnixNano: record.timeUnixNano,
              observedTimeUnixNano: record.timeUnixNano,
              severityNumber: 9,
              severityText: "Info",
              attributes: [...record.attributes],
              droppedAttributesCount: 0,
            })),
          },
        ],
      },
    ],
  });
