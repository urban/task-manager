import { assert } from "@effect/vitest";
import { Effect } from "effect";
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
type Body = Readonly<ReadableStream<Uint8Array>>;
type BodyKind = "erroring" | "finite" | "infinite" | "pending-cancel";
type Serialization = Immutable<OtlpSerialization.OtlpSerialization["Service"]>;
const responseRequest = HttpClientRequest.get("http://127.0.0.1/");
const serialization: Serialization = {
  traces: () => HttpBody.uint8Array(new Uint8Array([1]), "application/x-protobuf"),
  logs: () => HttpBody.uint8Array(new Uint8Array([2]), "application/x-protobuf"),
  metrics: () => HttpBody.uint8Array(new Uint8Array(), "application/x-protobuf"),
};

const makeBody = (...[kind, cancel]: readonly [BodyKind, () => Promise<void> | undefined]): Body =>
  new globalThis.ReadableStream<Uint8Array>({
    cancel,
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      if (kind === "erroring") {
        controller.error(new Error("response body defect"));
      } else if (kind === "finite") {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      } else if (kind === "infinite") {
        controller.enqueue(new Uint8Array([1]));
      }
    },
  });

const makeResponse = (
  ...[body, status, onStreamAccess]: readonly [Body | undefined, number, () => void]
): HttpClientResponse.HttpClientResponse => {
  const response = HttpClientResponse.fromWeb(
    responseRequest,
    new globalThis.Response(body, { status }),
  );
  Object.defineProperty(response, "stream", {
    get: () => {
      onStreamAccess();
      throw new Error("response stream must remain unopened");
    },
  });
  return response;
};

const publishOneTrace = (
  ...[client]: readonly [Immutable<HttpClient.HttpClient>]
): Effect.Effect<void> => {
  const session = makeDebugTelemetrySession({ client, serialization });
  session.recordTrace({ name: "CliApplication.run", outcome: "success" });
  return session.publish;
};

export const ignoredResponseBodiesCase = Effect.gen(function* () {
  const neverSettles = globalThis.Promise.withResolvers<void>().promise;
  let cancellations = 0;
  let streamAccesses = 0;
  const cancel = (): Promise<void> | undefined => {
    cancellations += 1;
    return undefined;
  };
  const bodies = [
    undefined,
    makeBody("finite", cancel),
    makeBody("erroring", cancel),
    makeBody("infinite", cancel),
    makeBody("pending-cancel", () => {
      cancellations += 1;
      return neverSettles;
    }),
  ];
  const statuses = [200, 200, 302, 503, 200];
  let requests = 0;
  const client = HttpClient.make(() => {
    const response = makeResponse(bodies[requests], statuses[requests] ?? 500, () => {
      streamAccesses += 1;
    });
    requests += 1;
    return Effect.succeed(response);
  });

  for (let index = 0; index < bodies.length; index += 1) {
    yield* publishOneTrace(client);
  }

  assert.strictEqual(requests, bodies.length);
  assert.strictEqual(streamAccesses, 0);
  assert.strictEqual(cancellations, 0);
  for (const body of bodies) {
    if (body !== undefined) {
      assert.isFalse(body.locked);
    }
  }
});

export const repeatedIgnoredResponseBodiesCase = Effect.gen(function* () {
  const neverSettles = globalThis.Promise.withResolvers<void>().promise;
  const bodies: Array<Body> = [];
  let cancellations = 0;
  let requests = 0;
  let streamAccesses = 0;
  const client = HttpClient.make(() => {
    requests += 1;
    const body = makeBody("pending-cancel", () => {
      cancellations += 1;
      return neverSettles;
    });
    bodies.push(body);
    return Effect.succeed(
      makeResponse(body, 503, () => {
        streamAccesses += 1;
      }),
    );
  });

  for (let index = 0; index < 32; index += 1) {
    yield* publishOneTrace(client);
  }

  assert.strictEqual(requests, 32);
  assert.strictEqual(streamAccesses, 0);
  assert.strictEqual(cancellations, 0);
  assert.isTrue(bodies.every((body: Body) => !body.locked));
});
