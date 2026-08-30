import { assert } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  makeSafeLogRecord,
  makeSafeTraceRecord,
  safeAttribute,
} from "../../src/debug-telemetry-model";
import { serializeDebugLogs, serializeDebugTraces } from "../../src/debug-telemetry-serialization";

type SafeKeyValue = Exclude<ReturnType<typeof safeAttribute>, undefined>;
type SafeTrace = Exclude<ReturnType<typeof makeSafeTraceRecord>, undefined>;
type SafeLog = Exclude<ReturnType<typeof makeSafeLogRecord>, undefined>;
type ReadCounter = {
  readonly next: <A>(...[key, allowed, substituted]: readonly [string, A, A]) => A;
  readonly values: () => ReadonlyArray<number>;
};

const makeReadCounter = (): ReadCounter => {
  const reads = new Map<string, number>();
  return {
    next: <A>(...[key, allowed, substituted]: readonly [string, A, A]): A => {
      const count = reads.get(key) ?? 0;
      reads.set(key, count + 1);
      return count === 0 ? allowed : substituted;
    },
    values: () => [...reads.values()],
  };
};

const statefulTraceRecord = (...[counter, attribute]: readonly [ReadCounter, SafeKeyValue]) =>
  makeSafeTraceRecord({
    get kind(): "trace" {
      return counter.next("kind", "trace", "trace");
    },
    get name(): string {
      return counter.next("name", "CliApplication.run", "UNSAFE_NAME_CANARY");
    },
    get traceId(): string {
      return counter.next("traceId", "0123456789abcdef0123456789abcdef", "UNSAFE_TRACE_ID_CANARY");
    },
    get spanId(): string {
      return counter.next("spanId", "0123456789abcdef", "UNSAFE_SPAN_ID_CANARY");
    },
    get parentSpanId(): string {
      return counter.next("parentSpanId", "fedcba9876543210", "UNSAFE_PARENT_ID_CANARY");
    },
    get startTimeUnixNano(): string {
      return counter.next("startTimeUnixNano", "1", "UNSAFE_START_CANARY");
    },
    get endTimeUnixNano(): string {
      return counter.next("endTimeUnixNano", "2", "UNSAFE_END_CANARY");
    },
    get attributes() {
      return counter.next(
        "attributes",
        [attribute],
        [{ key: "UNSAFE_KEY_CANARY", value: { stringValue: "UNSAFE_VALUE_CANARY" } }],
      );
    },
    get outcome(): "success" {
      return counter.next("outcome", "success", "success");
    },
  });

const assertThrowingTraceIsContained = (attribute: SafeKeyValue): void => {
  const record = makeSafeTraceRecord({
    kind: "trace",
    get name(): string {
      throw new Error("hostile direct trace getter");
    },
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    parentSpanId: undefined,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [attribute],
    outcome: "success",
  });
  assert.strictEqual(record, undefined);
};

export const assertStatefulTraceBoundary = (): SafeTrace => {
  const attribute = safeAttribute("command", "list");
  if (attribute === undefined) {
    assert.fail("expected the fixture attribute to be safe");
  }
  const counter = makeReadCounter();
  const record = statefulTraceRecord(counter, attribute);
  if (record === undefined) {
    assert.fail("expected captured trace values to receive provenance");
  }
  assert.strictEqual(record.name, "CliApplication.run");
  assert.strictEqual(record.traceId, "0123456789abcdef0123456789abcdef");
  assert.strictEqual(record.spanId, "0123456789abcdef");
  assert.strictEqual(record.parentSpanId, "fedcba9876543210");
  assert.strictEqual(record.startTimeUnixNano, "1");
  assert.strictEqual(record.endTimeUnixNano, "2");
  assert.deepStrictEqual(record.attributes, [attribute]);
  assert.deepStrictEqual(
    counter.values(),
    Array.from(counter.values(), () => 1),
  );
  assert.lengthOf(counter.values(), 9);
  assertThrowingTraceIsContained(attribute);
  return record;
};

const statefulLogRecord = (...[counter, attribute]: readonly [ReadCounter, SafeKeyValue]) =>
  makeSafeLogRecord({
    get kind(): "log" {
      return counter.next("kind", "log", "log");
    },
    get timeUnixNano(): string {
      return counter.next("timeUnixNano", "3", "UNSAFE_LOG_TIME_CANARY");
    },
    get attributes() {
      return counter.next(
        "attributes",
        [attribute],
        [{ key: "UNSAFE_LOG_KEY_CANARY", value: { stringValue: "UNSAFE_LOG_VALUE_CANARY" } }],
      );
    },
  });

const throwingForgedTrace = new Proxy(
  {
    get kind(): "trace" {
      return "trace";
    },
    name: "CliApplication.run",
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    parentSpanId: undefined,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [],
    get outcome(): "success" {
      return "success";
    },
  },
  {
    get() {
      throw new Error("serialization accessed an unprovenanced record");
    },
  },
);

const throwingForgedLog = new Proxy(
  {
    get kind(): "log" {
      return "log";
    },
    timeUnixNano: "3",
    attributes: [],
  },
  {
    get() {
      throw new Error("serialization accessed an unprovenanced log");
    },
  },
);

export const assertStatefulLogBoundary = (): SafeLog => {
  const attribute = safeAttribute("outcome", "expected_failure");
  if (attribute === undefined) {
    assert.fail("expected the fixture attribute to be safe");
  }
  const counter = makeReadCounter();
  const record = statefulLogRecord(counter, attribute);
  if (record === undefined) {
    assert.fail("expected captured log values to receive provenance");
  }
  assert.strictEqual(record.timeUnixNano, "3");
  assert.deepStrictEqual(record.attributes, [attribute]);
  assert.deepStrictEqual(
    counter.values(),
    Array.from(counter.values(), () => 1),
  );
  assert.lengthOf(counter.values(), 3);
  assert.strictEqual(
    makeSafeLogRecord({
      kind: "log",
      get timeUnixNano(): string {
        throw new Error("hostile direct log getter");
      },
      attributes: [attribute],
    }),
    undefined,
  );
  return record;
};

const assertStatefulSerialization = (
  serialization: Readonly<OtlpSerialization.OtlpSerialization["Service"]>,
): void => {
  const bodies = [
    serializeDebugTraces(serialization, [assertStatefulTraceBoundary()]),
    serializeDebugLogs(serialization, [assertStatefulLogBoundary()]),
  ];
  const payload = bodies
    .flatMap((body) =>
      body["_tag"] === "Uint8Array" ? [new globalThis.TextDecoder().decode(body.body)] : [],
    )
    .join("");
  for (const canary of ["UNSAFE_NAME", "UNSAFE_KEY", "UNSAFE_VALUE", "UNSAFE_LOG_TIME"]) {
    assert.notInclude(payload, canary);
  }
};

export const forgedRecordBoundaryCase = Effect.scoped(
  Effect.gen(function* () {
    const services = yield* Layer.build(OtlpSerialization.layerProtobuf);
    const serialization = Context.get(services, OtlpSerialization.OtlpSerialization);
    const body = serializeDebugTraces(serialization, [
      {
        kind: "trace",
        name: "UNSAFE_NAME_CANARY",
        traceId: "UNSAFE_TRACE_ID_CANARY",
        spanId: "UNSAFE_SPAN_ID_CANARY",
        parentSpanId: undefined,
        startTimeUnixNano: "UNSAFE_START_CANARY",
        endTimeUnixNano: "UNSAFE_END_CANARY",
        attributes: [{ key: "UNSAFE_KEY_CANARY", value: { stringValue: "UNSAFE_VALUE_CANARY" } }],
        outcome: "success",
      },
    ]);
    if (body["_tag"] === "Uint8Array") {
      const payload = new globalThis.TextDecoder().decode(body.body);
      assert.notInclude(payload, "UNSAFE_NAME_CANARY");
      assert.notInclude(payload, "UNSAFE_KEY_CANARY");
      assert.notInclude(payload, "UNSAFE_VALUE_CANARY");
      assert.notInclude(payload, "UNSAFE_TRACE_ID_CANARY");
      assert.notInclude(payload, "UNSAFE_START_CANARY");
    }
    assert.doesNotThrow(() => {
      void serializeDebugTraces(serialization, [throwingForgedTrace]);
    });
    assert.doesNotThrow(() => {
      void serializeDebugLogs(serialization, [throwingForgedLog]);
    });
    assertStatefulSerialization(serialization);
  }),
);
