/* oxlint-disable typescript/prefer-readonly-parameter-types */
import { Effect, Exit, Logger, Option, Tracer } from "effect";
import { CurrentLogAnnotations } from "effect/References";
import { HttpClient } from "effect/unstable/http";

import * as Model from "./debug-telemetry-model";
import { makeDebugPublish } from "./debug-telemetry-publisher";

type Buffer = {
  readonly push: (record: Readonly<Model.SafeRecord>) => void;
  readonly drain: () => ReadonlyArray<Model.SafeRecord>;
  readonly state: () => Readonly<{
    readonly capacity: number;
    readonly dropped: number;
    readonly size: number;
  }>;
};
type Ids = {
  readonly id: (width: 16 | 32) => string;
  readonly current: () => bigint;
  readonly advance: () => void;
};
export type DebugTelemetryRuntimeSession = {
  readonly tracer: Tracer.Tracer;
  readonly logger: Logger.Logger<unknown, void>;
  readonly recordTrace: (
    record: Readonly<{ readonly name: string; readonly outcome: Model.SafeOutcome }>,
  ) => void;
  readonly recordLog: (record: Readonly<{ readonly outcome: "expected_failure" }>) => void;
  readonly publish: Effect.Effect<void>;
  readonly bufferState: Buffer["state"];
};

const hex16 = /^[0-9a-f]{16}$/u;
const hex32 = /^[0-9a-f]{32}$/u;
const noParentSpanId = (): string | undefined => undefined;

const makeBuffer = (): Buffer => {
  let records: Array<Model.SafeRecord> = [];
  let dropped = 0;
  return {
    push: (...[record]: readonly [Readonly<Model.SafeRecord>]) => {
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

const makeIds = (): Ids => {
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

const makeRecordTrace =
  (...[buffer, ids]: readonly [Buffer, Ids]) =>
  (
    ...[record]: readonly [Readonly<{ readonly name: string; readonly outcome: Model.SafeOutcome }>]
  ) => {
    if (!Model.isSafeSpanName(record.name)) {
      return;
    }
    const start = ids.current();
    const outcomeAttribute = Model.safeAttribute("outcome", record.outcome);
    buffer.push({
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
  };

const makeRecordLog =
  (...[buffer, ids]: readonly [Buffer, Ids]) =>
  (...[record]: readonly [Readonly<{ readonly outcome: "expected_failure" }>]) => {
    const attribute = Model.safeAttribute("outcome", record.outcome);
    buffer.push({
      kind: "log",
      timeUnixNano: ids.current().toString(),
      attributes: attribute === undefined ? [] : [attribute],
    });
    ids.advance();
  };

const makeSpanEnd =
  (
    ...[options]: readonly [
      Readonly<{
        readonly buffer: Buffer;
        readonly spanOptions: Readonly<Parameters<Tracer.Tracer["span"]>[0]>;
        readonly traceId: string;
        readonly spanId: string;
        readonly parentSpanId: string | undefined;
        readonly attributes: ReadonlyMap<string, unknown>;
        readonly setStatus: (status: Readonly<Tracer.SpanStatus>) => void;
      }>,
    ]
  ) =>
  (...[endTime, exit]: readonly [bigint, Readonly<Exit.Exit<unknown, unknown>>]): void => {
    options.setStatus({
      _tag: "Ended",
      startTime: options.spanOptions.startTime,
      endTime,
      exit,
    });
    if (!options.spanOptions.sampled || !Model.isSafeSpanName(options.spanOptions.name)) {
      return;
    }
    const outcome = Model.classifyDebugExit(exit);
    const attributes = Model.safeAttributes(options.attributes.entries());
    if (
      !attributes.some(
        (...[attribute]: readonly [Readonly<{ readonly key: string }>]) =>
          attribute.key === "outcome",
      )
    ) {
      const outcomeAttribute = Model.safeAttribute("outcome", outcome);
      if (outcomeAttribute !== undefined) {
        attributes.push(outcomeAttribute);
      }
    }
    options.buffer.push({
      kind: "trace",
      name: options.spanOptions.name,
      traceId: options.traceId,
      spanId: options.spanId,
      parentSpanId: options.parentSpanId,
      startTimeUnixNano: options.spanOptions.startTime.toString(),
      endTimeUnixNano: endTime.toString(),
      attributes,
      outcome,
    });
  };

const makeSpanIdentity = (
  ...[ids, parent]: readonly [Readonly<Ids>, Readonly<Option.Option<Tracer.AnySpan>>]
) => {
  const traceId = Option.match(parent, {
    onNone: () => ids.id(32),
    onSome: (...[value]: readonly [Readonly<Tracer.AnySpan>]) =>
      hex32.test(value.traceId) ? value.traceId : ids.id(32),
  });
  const parentSpanId = Option.match(parent, {
    onNone: noParentSpanId,
    onSome: (...[value]: readonly [Readonly<Tracer.AnySpan>]) =>
      hex16.test(value.spanId) ? value.spanId : undefined,
  });
  return { traceId, spanId: ids.id(16), parentSpanId };
};

const ignoreSpanEvent = (
  ...[name, startTime, attributes]: readonly [
    string,
    bigint,
    Readonly<Record<string, unknown>> | undefined,
  ]
): void => {
  void name;
  void startTime;
  void attributes;
};

const ignoreSpanLinks = (...[links]: readonly [ReadonlyArray<Tracer.SpanLink>]): void => {
  void links;
};

const makeSpan = (
  ...[buffer, ids, spanOptions]: readonly [
    Readonly<Buffer>,
    Readonly<Ids>,
    Readonly<Parameters<Tracer.Tracer["span"]>[0]>,
  ]
): Tracer.Span => {
  const attributes = new Map<string, unknown>();
  const { traceId, spanId, parentSpanId } = makeSpanIdentity(ids, spanOptions.parent);
  let status: Tracer.SpanStatus = { _tag: "Started", startTime: spanOptions.startTime };
  const end = makeSpanEnd({
    buffer,
    spanOptions,
    traceId,
    spanId,
    parentSpanId,
    attributes,
    setStatus: (...[value]: readonly [Readonly<Tracer.SpanStatus>]) => {
      status = value;
    },
  });
  return {
    _tag: "Span",
    name: spanOptions.name,
    traceId,
    spanId,
    parent: spanOptions.parent,
    annotations: spanOptions.annotations,
    get status() {
      return status;
    },
    attributes,
    links: [],
    sampled: spanOptions.sampled,
    kind: spanOptions.kind,
    end,
    attribute: (...[key, value]: readonly [string, unknown]) => {
      if (Model.safeAttribute(key, value) !== undefined) {
        attributes.set(key, value);
      }
    },
    event: ignoreSpanEvent,
    addLinks: ignoreSpanLinks,
  };
};

const makeTracer = (...[buffer, ids]: readonly [Readonly<Buffer>, Readonly<Ids>]): Tracer.Tracer =>
  Tracer.make({
    span: (...[options]: readonly [Readonly<Parameters<Tracer.Tracer["span"]>[0]>]) =>
      makeSpan(buffer, ids, options),
  });

const makeLogger = (...[buffer]: readonly [Readonly<Buffer>]): Logger.Logger<unknown, void> =>
  Logger.make((...[options]: readonly [Readonly<Logger.Options<unknown>>]) => {
    const attributes = Model.safeAttributes(
      Object.entries(options.fiber.getRef(CurrentLogAnnotations)),
    );
    if (attributes.length > 0) {
      buffer.push({
        kind: "log",
        timeUnixNano: String(options.date.getTime() * 1_000_000),
        attributes,
      });
    }
  });

export const makeDebugTelemetrySession = (
  ...[options]: readonly [
    Readonly<{
      readonly client: Readonly<HttpClient.HttpClient>;
      readonly serialization: Readonly<Model.OtlpSerializationService>;
    }>,
  ]
): DebugTelemetryRuntimeSession => {
  const buffer = makeBuffer();
  const ids = makeIds();
  return {
    tracer: makeTracer(buffer, ids),
    logger: makeLogger(buffer),
    recordTrace: makeRecordTrace(buffer, ids),
    recordLog: makeRecordLog(buffer, ids),
    publish: makeDebugPublish(buffer.drain, options.client, options.serialization),
    bufferState: buffer.state,
  };
};
