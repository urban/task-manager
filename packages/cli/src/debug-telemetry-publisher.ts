import { Effect, Fiber, Option, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as Model from "./debug-telemetry-model";
import { serializeDebugLogs, serializeDebugTraces } from "./debug-telemetry-serialization";

type Drain = () => ReadonlyArray<Model.SafeRecord>;
type Serialize<A> = {
  readonly run: (records: ReadonlyArray<A>) => Model.HttpBody;
};

const ownResponseBody = (
  ...[response]: readonly [Model.Immutable<HttpClientResponse.HttpClientResponse>]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const consumer = yield* response.stream.pipe(
      Stream.take(1),
      Stream.runDrain,
      Effect.ignoreCause,
      Effect.withTracerEnabled(false),
      Effect.forkDetach({ startImmediately: true }),
    );
    let cleanupStarted = false;
    const startCleanup = Effect.suspend(() => {
      if (cleanupStarted) {
        return Effect.void;
      }
      cleanupStarted = true;
      return Fiber.interrupt(consumer).pipe(
        Effect.forkDetach({ startImmediately: true }),
        Effect.asVoid,
      );
    });
    const completed = yield* Fiber.await(consumer).pipe(
      Effect.timeoutOption(10),
      Effect.onInterrupt(() => startCleanup),
    );
    if (Option.isNone(completed)) {
      yield* startCleanup;
    }
  });

const publishBody = (
  ...[client, endpoint, body]: readonly [
    Model.Immutable<HttpClient.HttpClient>,
    string,
    Readonly<Model.HttpBody>,
  ]
): Effect.Effect<void> =>
  client.execute(HttpClientRequest.post(endpoint).pipe(HttpClientRequest.setBody(body))).pipe(
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.flatMap(
      (...[response]: readonly [Model.Immutable<HttpClientResponse.HttpClientResponse>]) =>
        ownResponseBody(response),
    ),
    Effect.ignoreCause,
    Effect.withTracerEnabled(false),
  );

const publishSignal = <A>(
  ...[client, endpoint, records, serialize]: readonly [
    Readonly<HttpClient.HttpClient>,
    string,
    ReadonlyArray<A>,
    Readonly<Serialize<A>>,
  ]
): Effect.Effect<void> =>
  records.length === 0
    ? Effect.void
    : Effect.sync(() => serialize.run(records)).pipe(
        Effect.flatMap((...[body]: readonly [Readonly<Model.HttpBody>]) =>
          publishBody(client, endpoint, body),
        ),
        Effect.ignoreCause,
        Effect.withTracerEnabled(false),
      );

const partitionRecords = (...[records]: readonly [ReadonlyArray<Readonly<Model.SafeRecord>>]) => {
  const traces: Array<Model.SafeTraceRecord> = [];
  const logs: Array<Model.SafeLogRecord> = [];
  for (const record of records) {
    if (record.kind === "trace") {
      traces.push(record);
    } else {
      logs.push(record);
    }
  }
  return { traces, logs };
};

export const makeDebugPublish = (
  ...[drain, client, serialization]: readonly [
    Drain,
    Readonly<HttpClient.HttpClient>,
    Readonly<Model.OtlpSerializationService>,
  ]
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const { traces, logs } = partitionRecords(drain());
    return Effect.all(
      [
        publishSignal(client, Model.debugTracesEndpoint, traces, {
          run: (items: ReadonlyArray<Model.SafeTraceRecord>) =>
            serializeDebugTraces(serialization, items),
        }),
        publishSignal(client, Model.debugLogsEndpoint, logs, {
          run: (items: ReadonlyArray<Model.SafeLogRecord>) =>
            serializeDebugLogs(serialization, items),
        }),
      ],
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.ignoreCause, Effect.withTracerEnabled(false));
