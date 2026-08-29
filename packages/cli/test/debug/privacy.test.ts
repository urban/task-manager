/* oxlint-disable typescript/prefer-readonly-parameter-types */
import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  debugTelemetryResourceAttributes,
  makeDebugTelemetrySession,
  projectDebugDefect,
} from "../../src/debug-telemetry-session";

type Request = Readonly<HttpClientRequest.HttpClientRequest>;

const decode = (...[bytes]: readonly [Readonly<Uint8Array>]): string =>
  new globalThis.TextDecoder().decode(bytes);
const canaries: ReadonlyArray<string> = [
  "ARGV_CANARY --storage-path=/private/tmp/store.db",
  "ENV_CANARY TM_ACTOR=alice OTEL_EXPORTER_OTLP_HEADERS=token",
  "INPUT_CANARY stdin-and-file-content",
  "DOMAIN_CANARY ticket=abc123 claim=secret cursor=91 result=payload",
  "PATH_CANARY /Users/alice/repo/.tasks/task-manager.db",
  "SQL_CANARY SELECT secret FROM tickets WHERE actor = ?",
  "CAUSE_CANARY Cause.pretty fiber=99 composite=vendor-value",
  "HOST_CANARY host=workstation user=alice pid=123 executable=/bin/bun",
  "CREDENTIAL_CANARY authorization=bearer-secret cookie=session-token",
  "URL_CANARY http://alice:secret@example.com/path?token=secret",
];
const forbiddenFragments: ReadonlyArray<string> = [
  "ARGV_CANARY",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "stdin-and-file-content",
  "abc123",
  "/Users/alice/repo",
  "SELECT secret",
  "Cause.pretty",
  "workstation",
  "bearer-secret",
  "alice:secret@example.com",
  "telemetry.sdk.name",
  "host.name",
  "process.pid",
];

const assertPrivateBytes = (...[requests]: readonly [ReadonlyArray<Request>]): void => {
  assert.lengthOf(requests, 2);
  const bytes = requests.flatMap((...[request]: readonly [Request]) =>
    request.body["_tag"] === "Uint8Array" ? [decode(request.body.body)] : [],
  );
  assert.lengthOf(bytes, 2);
  const payload = bytes.join("");
  assert.notInclude(payload, canaries.join(" | "));
  assert.notInclude(payload, "raw.argv");
  assert.notInclude(payload, "secret");
  for (const value of canaries) {
    assert.notInclude(payload, value);
  }
  for (const fragment of forbiddenFragments) {
    assert.notInclude(payload, fragment);
  }
  assert.include(payload, "CliApplication.run");
  for (const [key, value] of Object.entries(debugTelemetryResourceAttributes)) {
    assert.include(payload, key);
    assert.include(payload, value);
  }
};

const stockSerializationCase = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const client = HttpClient.make((...[request]: readonly [Request]) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new globalThis.Response(undefined, { status: 200 })),
    );
  });
  const serialization = yield* OtlpSerialization.OtlpSerialization;
  const session = makeDebugTelemetrySession({ client, serialization });
  const canary = canaries.join(" | ");
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
  assertPrivateBytes(requests);
});

const overflowCase = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const client = HttpClient.make((...[request]: readonly [Request]) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new globalThis.Response(undefined, { status: 200 })),
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
      HttpClientResponse.fromWeb(request, new globalThis.Response(undefined, { status: 200 })),
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
  it("uses the closed fallback for unapproved defects", () => {
    assert.deepStrictEqual(projectDebugDefect(new Error("sensitive")), {
      classification: "untrusted",
      message: "Untrusted defect message omitted.",
      frames: [],
    });
  });
});
