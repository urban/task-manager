import { assert } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { OtlpSerialization } from "effect/unstable/observability";

import { makeDebugTelemetrySession } from "../../src/debug-telemetry-session";

type Immutable<T> = T extends globalThis.Function
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<Immutable<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;
type Serialization = Immutable<OtlpSerialization.OtlpSerialization["Service"]>;
type ResponseBody = Uint8Array | ReadableStream<Uint8Array> | undefined;
const responseRequest = HttpClientRequest.get("http://127.0.0.1/");
const neverSettles = globalThis.Promise.withResolvers<void>().promise;

const serialization: Serialization = {
  traces: () => HttpBody.uint8Array(new Uint8Array([1]), "application/x-protobuf"),
  logs: () => HttpBody.uint8Array(new Uint8Array([2]), "application/x-protobuf"),
  metrics: () => HttpBody.uint8Array(new Uint8Array(), "application/x-protobuf"),
};

export const pendingResponseCleanupCase = Effect.gen(function* () {
  let cancelled = 0;
  const body = new globalThis.ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled += 1;
      return neverSettles;
    },
  });
  const response = HttpClientResponse.fromWeb(
    responseRequest,
    new globalThis.Response(body, { status: 503 }),
  );
  const client = HttpClient.make(() => Effect.succeed(response));
  const session = makeDebugTelemetrySession({ client, serialization });
  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  const publication = yield* session.publish.pipe(Effect.forkDetach({ startImmediately: true }));
  yield* Effect.sleep(200);
  assert.isDefined(publication.pollUnsafe());
  assert.strictEqual(cancelled, 1);
});

export const responseBodyVariantsCase = Effect.gen(function* () {
  let requests = 0;
  const recordRequest = (): void => {
    requests += 1;
  };
  const erroringBody: ResponseBody = new globalThis.ReadableStream<Uint8Array>({
    pull: () => globalThis.Promise.reject(new Error("response body defect")),
  });
  const responseFactories = [
    () =>
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(undefined, { status: 200 }),
      ),
    () =>
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(new Uint8Array([1]), { status: 302 }),
      ),
    () =>
      HttpClientResponse.fromWeb(
        responseRequest,
        new globalThis.Response(erroringBody, { status: 503 }),
      ),
  ];
  const clients = responseFactories.map((makeResponse) =>
    HttpClient.make(() => {
      recordRequest();
      return Effect.succeed(makeResponse());
    }),
  );
  for (const client of clients) {
    const session = makeDebugTelemetrySession({ client, serialization });
    session.recordTrace({ name: "CliApplication.run", outcome: "success" });
    yield* session.publish;
  }
  assert.strictEqual(requests, 3);
});

export const interruptedResponseCleanupCase = Effect.gen(function* () {
  let cancelled = 0;
  let readStarted = false;
  const body = new globalThis.ReadableStream<Uint8Array>({
    pull: () => {
      readStarted = true;
    },
    cancel: () => {
      cancelled += 1;
      return neverSettles;
    },
  });
  const response = HttpClientResponse.fromWeb(
    responseRequest,
    new globalThis.Response(body, { status: 200 }),
  );
  const client = HttpClient.make(() => Effect.succeed(response));
  const session = makeDebugTelemetrySession({ client, serialization });
  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  const publication = yield* session.publish.pipe(Effect.forkDetach({ startImmediately: true }));
  yield* Effect.sleep(10);
  assert.isTrue(readStarted);
  const interruption = yield* Fiber.interrupt(publication).pipe(
    Effect.forkDetach({ startImmediately: true }),
  );
  yield* Effect.sleep(50);
  assert.isDefined(interruption.pollUnsafe());
  assert.strictEqual(cancelled, 1);
});
