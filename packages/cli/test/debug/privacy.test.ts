import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, Logger, Option } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  debugTelemetryResourceAttributes,
  makeDebugTelemetrySession,
  projectDebugDefect,
} from "../../src/debug-telemetry-session";
import { serializeDebugTraces } from "../../src/debug-telemetry-serialization";
import { assertPrivateRequestBytes, privacyCanaries } from "./privacy-support";

type Immutable<T> = T extends globalThis.Function
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Immutable<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;
type Request = Immutable<HttpClientRequest.HttpClientRequest>;
type Session = Immutable<ReturnType<typeof makeDebugTelemetrySession>>;
const responseRequest = HttpClientRequest.get("http://127.0.0.1/");

const stockSerializationCase = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const client = HttpClient.make((...[request]: readonly [Request]) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    );
  });
  const serialization = yield* OtlpSerialization.OtlpSerialization;
  const session = makeDebugTelemetrySession({ client, serialization });
  const canary = privacyCanaries.join(" | ");
  const span = session.tracer.span({
    name: "CliApplication.run",
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: 1n,
    kind: "internal",
    root: true,
    sampled: true,
  });
  span.attribute("outcome", "success");
  span.attribute("raw.argv", canary);
  span.attribute("command", canary);
  span.event(canary, 2n, { secret: canary });
  span.end(3n, Exit.failCause(Cause.die(new Error(canary))));

  yield* Effect.logError(canary).pipe(
    Effect.annotateLogs({ outcome: "expected_failure", secret: canary }),
    Effect.withLogger(session.logger),
  );
  yield* session.publish;
  assertPrivateRequestBytes(requests, debugTelemetryResourceAttributes);
});

const overflowCase = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const client = HttpClient.make((...[request]: readonly [Request]) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    );
  });
  const serialization = yield* OtlpSerialization.OtlpSerialization;
  const session = makeDebugTelemetrySession({ client, serialization });

  for (let index = 0; index < 64; index += 1) {
    const span = session.tracer.span({
      name: "CliApplication.run",
      parent: Option.none(),
      annotations: Context.empty(),
      links: [],
      startTime: BigInt(index),
      kind: "internal",
      root: true,
      sampled: true,
    });
    span.end(BigInt(index + 1), Exit.succeed(void 0));
  }
  for (let index = 0; index < 65; index += 1) {
    session.recordLog({ outcome: "expected_failure" });
  }

  assert.deepStrictEqual(session.bufferState(), { capacity: 128, dropped: 1, size: 128 });
  yield* session.publish;
  assert.deepStrictEqual(session.bufferState(), { capacity: 128, dropped: 1, size: 0 });
  assert.lengthOf(requests, 2);
});

const serializedFixture = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const client = HttpClient.make((...[request]: readonly [Request]) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    );
  });
  const serialization = yield* OtlpSerialization.OtlpSerialization;
  const session = makeDebugTelemetrySession({ client, serialization });
  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  session.recordLog({ outcome: "expected_failure" });
  yield* session.publish;
  return requests.flatMap((...[request]: readonly [Request]) =>
    request.body["_tag"] === "Uint8Array" ? [request.body.body] : [],
  );
});

const deterministicBytesCase = Effect.scoped(
  Effect.gen(function* () {
    const services = yield* Layer.build(OtlpSerialization.layerProtobuf);
    const first = yield* Effect.provideContext(serializedFixture, services);
    const second = yield* Effect.provideContext(serializedFixture, services);
    assert.deepStrictEqual(
      first.map((bytes) => bytes.length),
      [285, 248],
    );
    assert.lengthOf(first, 2);
    assert.lengthOf(second, 2);
    assert.deepStrictEqual(first, second);
  }),
);

const directBoundaryCase = Effect.scoped(
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
  }),
);

const exerciseHostileCreationAndQueue = (...[session]: readonly [Session]): void => {
  const span = session.tracer.span({
    get name(): string {
      throw new Error("hostile span name getter");
    },
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: 1n,
    kind: "internal",
    root: true,
    sampled: true,
  });
  span.attribute("outcome", "success");
  span.end(2n, Exit.succeed(void 0));
  session.recordTrace({
    get name(): string {
      throw new Error("hostile queued trace getter");
    },
    outcome: "success",
  });
  session.recordLog({
    get outcome(): "expected_failure" {
      throw new Error("hostile queued log getter");
    },
  });
};

const exerciseHostileEnd = (...[session]: readonly [Session]): void => {
  const endingSpan = session.tracer.span({
    name: "CliApplication.run",
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: 3n,
    kind: "internal",
    root: true,
    sampled: true,
  });
  endingSpan.attribute(
    "outcome",
    new Proxy(
      {},
      {
        get() {
          throw new Error("hostile attribute value");
        },
      },
    ),
  );
  endingSpan.end(
    4n,
    new Proxy(Exit.succeed(void 0), {
      get() {
        throw new Error("hostile exit getter");
      },
    }),
  );
};

const makeHostileLogger = (...[session]: readonly [Session]) =>
  Logger.make((...[options]: readonly [Immutable<Logger.Options<unknown>>]) => {
    session.logger.log({
      ...options,
      fiber: new Proxy(options.fiber, {
        get() {
          throw new Error("hostile fiber getter");
        },
      }),
    });
    session.logger.log({
      ...options,
      get date(): Date {
        throw new Error("hostile date getter");
      },
    });
  });

const totalDelegatesCase = Effect.gen(function* () {
  const client = HttpClient.make(() =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    ),
  );
  const serialization = yield* OtlpSerialization.OtlpSerialization;
  const session = makeDebugTelemetrySession({ client, serialization });
  exerciseHostileCreationAndQueue(session);
  exerciseHostileEnd(session);
  const hostileLogger = makeHostileLogger(session);
  yield* Effect.logInfo("observer canary").pipe(Effect.withLogger(hostileLogger));
});

describe("privileged debug privacy", () => {
  it.effect("serializes only closed safe records and the exact resource allowlist", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const services = yield* Layer.build(OtlpSerialization.layerProtobuf);
        return yield* Effect.provideContext(stockSerializationCase, services);
      }),
    ),
  );
  it.effect("drops newest records after the combined capacity of 128", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const services = yield* Layer.build(OtlpSerialization.layerProtobuf);
        return yield* Effect.provideContext(overflowCase, services);
      }),
    ),
  );
  it.effect(
    "produces deterministic stock protobuf bytes for an identical safe fixture",
    () => deterministicBytesCase,
  );
  it.effect("rejects forged records at the stock serialization boundary", () => directBoundaryCase);
  it.effect("contains throwing tracer and logger delegates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const services = yield* Layer.build(OtlpSerialization.layerProtobuf);
        return yield* Effect.provideContext(totalDelegatesCase, services);
      }),
    ),
  );
  it("uses the closed fallback for unapproved defects", () => {
    assert.deepStrictEqual(projectDebugDefect(new Error("sensitive")), {
      classification: "untrusted",
      message: "Untrusted defect message omitted.",
      frames: [],
    });
  });
});
