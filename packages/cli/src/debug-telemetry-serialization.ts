import { OtlpResource } from "effect/unstable/observability";

import * as Model from "./debug-telemetry-model";

const resource = OtlpResource.make({
  serviceName: "task-manager",
  serviceVersion: Model.debugTelemetryResourceAttributes["service.version"],
  attributes: {
    "effect.version": Model.debugTelemetryResourceAttributes["effect.version"],
    "telemetry.schema.version": Model.debugTelemetryResourceAttributes["telemetry.schema.version"],
    "telemetry.mode": Model.debugTelemetryResourceAttributes["telemetry.mode"],
  },
});

const traceStatus = (
  ...[outcome]: readonly [Model.SafeOutcome]
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
    Readonly<Model.OtlpSerializationService>,
    ReadonlyArray<Readonly<Model.SafeTraceRecord>>,
  ]
): Model.HttpBody => {
  const safeRecords = Model.safeTracesForSerialization(records);
  return serialization.traces({
    resourceSpans: [
      {
        resource,
        scopeSpans: [
          {
            scope: { name: "task-manager" },
            spans: safeRecords.map((record) => ({
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
};

export const serializeDebugLogs = (
  ...[serialization, records]: readonly [
    Readonly<Model.OtlpSerializationService>,
    ReadonlyArray<Readonly<Model.SafeLogRecord>>,
  ]
): Model.HttpBody => {
  const safeRecords = Model.safeLogsForSerialization(records);
  return serialization.logs({
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: { name: "task-manager" },
            logRecords: safeRecords.map((record) => ({
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
};
