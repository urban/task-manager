import { Context, Effect, Exit, Logger, Option, Tracer } from "effect";
import { CurrentLogAnnotations } from "effect/References";
import { HttpClient } from "effect/unstable/http";

import { makeBuffer, makeIds, makeRecordLog, makeRecordTrace } from "./debug-telemetry-buffer";
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

const makeSpanEnd =
  (
    ...[options]: readonly [
      Model.Immutable<{
        readonly buffer: Buffer;
        readonly spanOptions: Model.Immutable<Parameters<Tracer.Tracer["span"]>[0]>;
        readonly traceId: string;
        readonly spanId: string;
        readonly parentSpanId: string | undefined;
        readonly attributes: ReadonlyMap<string, unknown>;
        readonly setStatus: (status: Model.Immutable<Tracer.SpanStatus>) => void;
      }>,
    ]
  ) =>
  (...[endTime, exit]: readonly [bigint, Model.Immutable<Exit.Exit<unknown, unknown>>]): void => {
    try {
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
      if (!attributes.some((attribute) => attribute.key === "outcome")) {
        const outcomeAttribute = Model.safeAttribute("outcome", outcome);
        if (outcomeAttribute !== undefined) {
          attributes.push(outcomeAttribute);
        }
      }
      const safe = Model.makeSafeTraceRecord({
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
      if (safe !== undefined) {
        options.buffer.push(safe);
      }
    } catch {
      void 0;
    }
  };

const makeSpanIdentity = (
  ...[ids, parent]: readonly [Readonly<Ids>, Model.Immutable<Option.Option<Tracer.AnySpan>>]
) => {
  const traceId = Option.match(parent, {
    onNone: () => ids.id(32),
    onSome: (...[value]: readonly [Model.Immutable<Tracer.AnySpan>]) =>
      hex32.test(value.traceId) ? value.traceId : ids.id(32),
  });
  const parentSpanId = Option.match(parent, {
    onNone: noParentSpanId,
    onSome: (...[value]: readonly [Model.Immutable<Tracer.AnySpan>]) =>
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

const ignoreSpanLinks = (
  ...[links]: readonly [ReadonlyArray<Model.Immutable<Tracer.SpanLink>>]
): void => {
  void links;
};

const makeSpan = (
  ...[buffer, ids, spanOptions]: readonly [
    Readonly<Buffer>,
    Readonly<Ids>,
    Model.Immutable<Parameters<Tracer.Tracer["span"]>[0]>,
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
    setStatus: (...[value]: readonly [Model.Immutable<Tracer.SpanStatus>]) => {
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
      try {
        if (Model.safeAttribute(key, value) !== undefined) {
          attributes.set(key, value);
        }
      } catch {
        void 0;
      }
    },
    event: ignoreSpanEvent,
    addLinks: ignoreSpanLinks,
  };
};

const makeFallbackSpan = (...[ids]: readonly [Readonly<Ids>]): Tracer.Span => {
  const traceId = ids.id(32);
  const spanId = ids.id(16);
  let status: Tracer.SpanStatus = { _tag: "Started", startTime: 0n };
  return {
    _tag: "Span",
    name: "CliApplication.run",
    traceId,
    spanId,
    parent: Option.none(),
    annotations: Context.empty(),
    get status() {
      return status;
    },
    attributes: new Map(),
    links: [],
    sampled: false,
    kind: "internal",
    end: (...[endTime, exit]: readonly [bigint, Model.Immutable<Exit.Exit<unknown, unknown>>]) => {
      status = { _tag: "Ended", startTime: 0n, endTime, exit };
    },
    attribute: (...[key, value]: readonly [string, unknown]) => {
      void key;
      void value;
    },
    event: ignoreSpanEvent,
    addLinks: ignoreSpanLinks,
  };
};

const makeTotalSpan = (
  ...[buffer, ids, options]: readonly [
    Readonly<Buffer>,
    Readonly<Ids>,
    Model.Immutable<Parameters<Tracer.Tracer["span"]>[0]>,
  ]
): Tracer.Span => {
  try {
    return makeSpan(buffer, ids, options);
  } catch {
    return makeFallbackSpan(ids);
  }
};

const makeTracer = (...[buffer, ids]: readonly [Readonly<Buffer>, Readonly<Ids>]): Tracer.Tracer =>
  Tracer.make({
    span: (...[options]: readonly [Model.Immutable<Parameters<Tracer.Tracer["span"]>[0]>]) =>
      makeTotalSpan(buffer, ids, options),
  });

const makeLogger = (...[buffer]: readonly [Readonly<Buffer>]): Logger.Logger<unknown, void> =>
  Logger.make((...[options]: readonly [Model.Immutable<Logger.Options<unknown>>]) => {
    try {
      const attributes = Model.safeAttributes(
        Object.entries(options.fiber.getRef(CurrentLogAnnotations)),
      );
      if (attributes.length > 0) {
        const safe = Model.makeSafeLogRecord({
          kind: "log",
          timeUnixNano: String(options.date.getTime() * 1_000_000),
          attributes,
        });
        if (safe !== undefined) {
          buffer.push(safe);
        }
      }
    } catch {
      void 0;
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
