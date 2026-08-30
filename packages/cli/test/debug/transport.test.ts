import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import {
  debugFetchRequestInit,
  debugLogsEndpoint,
  debugTracesEndpoint,
  makeDebugTelemetrySession,
} from "../../src/debug-telemetry-session";
import {
  ignoredResponseBodiesCase,
  repeatedIgnoredResponseBodiesCase,
} from "./ignored-response-support";

type Immutable<T> = T extends globalThis.Function
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Immutable<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;
type Serialization = Immutable<OtlpSerialization.OtlpSerialization["Service"]>;
type Request = Immutable<HttpClientRequest.HttpClientRequest>;
const responseRequest = HttpClientRequest.get("http://127.0.0.1/");
type RecordCall = (signal: "logs" | "traces") => void;

const ignoreSignal = (...[signal]: readonly ["logs" | "traces"]): void => {
  void signal;
};

const makeSerialization = (...[recordCall]: readonly [RecordCall]): Serialization => ({
  traces: () => {
    recordCall("traces");
    return HttpBody.uint8Array(new Uint8Array([1, 2, 3]), "application/x-protobuf");
  },
  logs: () => {
    recordCall("logs");
    return HttpBody.uint8Array(new Uint8Array([4, 5, 6]), "application/x-protobuf");
  },
  metrics: () => HttpBody.uint8Array(new Uint8Array(), "application/x-protobuf"),
});

const assertSafeRequests = (...[requests]: readonly [ReadonlyArray<Request>]): void => {
  assert.deepStrictEqual(
    requests.map((request: Request) => request.url),
    [debugTracesEndpoint, debugLogsEndpoint],
  );
  assert.deepStrictEqual(
    requests.map((request: Request) => request.method),
    ["POST", "POST"],
  );
  for (const request of requests) {
    assert.deepStrictEqual(Object.keys(request.headers).toSorted(), [
      "content-length",
      "content-type",
    ]);
    assert.strictEqual(request.headers["content-type"], "application/x-protobuf");
    assert.strictEqual(request.headers["authorization"], undefined);
    assert.strictEqual(request.headers["proxy-authorization"], undefined);
    assert.strictEqual(request.headers["cookie"], undefined);
    assert.strictEqual(request.headers["b3"], undefined);
    assert.strictEqual(request.headers["traceparent"], undefined);
    assert.deepStrictEqual(request.urlParams.params, []);
    assert.isFalse(request.url.includes("@"));
    assert.isFalse(request.url.includes("?"));
    assert.match(request.url, /^http:\/\/127\.0\.0\.1:4318\/v1\/(?:traces|logs)$/u);
    assert.strictEqual(request.body["_tag"], "Uint8Array");
    if (request.body["_tag"] === "Uint8Array") {
      assert.strictEqual(request.body.contentType, "application/x-protobuf");
    }
  }
};

const transportCase = Effect.gen(function* () {
  const requests: Array<Request> = [];
  const calls: Array<"logs" | "traces"> = [];
  const client = HttpClient.make((request: Request) => {
    requests.push(request);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    );
  });
  const session = makeDebugTelemetrySession({
    client,
    serialization: makeSerialization((signal) => {
      calls.push(signal);
    }),
  });

  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  session.recordLog({ outcome: "expected_failure" });
  yield* Effect.all([session.publish, session.publish], {
    concurrency: "unbounded",
    discard: true,
  });

  assert.deepStrictEqual(calls, ["traces", "logs"]);
  assertSafeRequests(requests);
});

const failureCase = Effect.gen(function* () {
  const statuses = [302, 503];
  for (const status of statuses) {
    let requests = 0;
    const calls: Array<"logs" | "traces"> = [];
    const client = HttpClient.make(() => {
      requests += 1;
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          responseRequest,
          new globalThis.Response(undefined, {
            status,
            headers: { location: "https://example.com/secret" },
          }),
        ),
      );
    });
    const session = makeDebugTelemetrySession({
      client,
      serialization: makeSerialization((signal) => {
        calls.push(signal);
      }),
    });
    session.recordTrace({ name: "CliApplication.run", outcome: "success" });
    yield* session.publish;
    assert.strictEqual(requests, 1);
    assert.deepStrictEqual(calls, ["traces"]);
  }

  let defectRequests = 0;
  const defectClient = HttpClient.make((request: Request) => {
    defectRequests += 1;
    return Effect.die({ request, kind: "transport defect" });
  });
  const defectSession = makeDebugTelemetrySession({
    client: defectClient,
    serialization: makeSerialization(ignoreSignal),
  });
  defectSession.recordTrace({ name: "CliApplication.run", outcome: "success" });
  yield* defectSession.publish;
  assert.strictEqual(defectRequests, 1);
});

const serializationDefectCase = Effect.gen(function* () {
  let requests = 0;
  const client = HttpClient.make(() => {
    requests += 1;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    );
  });
  const serialization = makeSerialization(ignoreSignal);
  const defecting: Serialization = {
    ...serialization,
    traces: () => {
      throw new Error("serializer defect");
    },
  };
  const session = makeDebugTelemetrySession({ client, serialization: defecting });
  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  yield* session.publish;
  assert.strictEqual(requests, 0);
});

describe("privileged debug OTLP transport", () => {
  it("pins the live fetch adapter to manual redirects and omitted credentials", () => {
    assert.deepStrictEqual(debugFetchRequestInit, {
      credentials: "omit",
      redirect: "manual",
    });
  });
  it.effect(
    "makes one direct header-free request per non-empty signal and drains once",
    () => transportCase,
  );
  it.effect("does not follow redirects or retry status and transport failures", () => failureCase);
  it.effect("contains serialization defects before transport", () => serializationDefectCase);
  it.effect(
    "returns without opening or cancelling response bodies",
    () => ignoredResponseBodiesCase,
  );
  it.effect(
    "leaves repeated response bodies unopened and unlocked",
    () => repeatedIgnoredResponseBodiesCase,
  );
});
