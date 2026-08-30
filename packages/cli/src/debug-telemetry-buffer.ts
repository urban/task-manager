import * as Model from "./debug-telemetry-model";

export type Buffer = {
  readonly push: (record: Readonly<Model.SafeRecord>) => void;
  readonly drain: () => ReadonlyArray<Model.SafeRecord>;
  readonly state: () => Readonly<{
    readonly capacity: number;
    readonly dropped: number;
    readonly size: number;
  }>;
};

export type Ids = {
  readonly id: (width: 16 | 32) => string;
  readonly current: () => bigint;
  readonly advance: () => void;
};
type RecordTrace = (
  record: Readonly<{ readonly name: string; readonly outcome: Model.SafeOutcome }>,
) => void;
type RecordLog = (record: Readonly<{ readonly outcome: "expected_failure" }>) => void;

export const makeBuffer = (): Buffer => {
  let records: Array<Model.SafeRecord> = [];
  let dropped = 0;
  return {
    push: (record: Readonly<Model.SafeRecord>) => {
      if (records.length >= Model.debugTelemetryCapacity) {
        dropped += 1;
      } else {
        records.push(record);
      }
    },
    drain: () => {
      const drained = records;
      records = [];
      return drained;
    },
    state: () => ({ capacity: Model.debugTelemetryCapacity, dropped, size: records.length }),
  };
};

export const makeIds = (): Ids => {
  let next = 1n;
  return {
    id: (...[width]: readonly [16 | 32]) => {
      const value = next.toString(16).padStart(width, "0").slice(-width);
      next += 1n;
      return value;
    },
    current: () => next,
    advance: () => {
      next += 1n;
    },
  };
};

export const makeRecordTrace =
  (...[buffer, ids]: readonly [Buffer, Ids]): RecordTrace =>
  (record: Readonly<{ readonly name: string; readonly outcome: Model.SafeOutcome }>) => {
    try {
      if (!Model.isSafeSpanName(record.name)) {
        return;
      }
      const start = ids.current();
      const outcomeAttribute = Model.safeAttribute("outcome", record.outcome);
      const safe = Model.makeSafeTraceRecord({
        kind: "trace",
        name: record.name,
        traceId: ids.id(32),
        spanId: ids.id(16),
        parentSpanId: undefined,
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: (start + 1n).toString(),
        attributes: outcomeAttribute === undefined ? [] : [outcomeAttribute],
        outcome: record.outcome,
      });
      if (safe !== undefined) {
        buffer.push(safe);
      }
    } catch {
      void 0;
    }
  };

export const makeRecordLog =
  (...[buffer, ids]: readonly [Buffer, Ids]): RecordLog =>
  (record: Readonly<{ readonly outcome: "expected_failure" }>) => {
    try {
      const attribute = Model.safeAttribute("outcome", record.outcome);
      const safe = Model.makeSafeLogRecord({
        kind: "log",
        timeUnixNano: ids.current().toString(),
        attributes: attribute === undefined ? [] : [attribute],
      });
      if (safe !== undefined) {
        buffer.push(safe);
      }
      ids.advance();
    } catch {
      void 0;
    }
  };
