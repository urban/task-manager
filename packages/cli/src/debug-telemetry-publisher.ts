/* oxlint-disable typescript/prefer-readonly-parameter-types */
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import * as Model from "./debug-telemetry-model";

type Drain = () => ReadonlyArray<Model.SafeRecord>;
type Serialize<A> = {
  readonly run: (records: ReadonlyArray<A>) => Model.HttpBody;
};

const publishBody = (
  ...[client, endpoint, body]: readonly [
    Readonly<HttpClient.HttpClient>,
    string,
    Readonly<Model.HttpBody>,
  ]
): Effect.Effect<void> =>
  client
    .execute(HttpClientRequest.post(endpoint).pipe(HttpClientRequest.setBody(body)))
    .pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.asVoid,
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
        Effect.flatMap((...[body]: readonly [Model.HttpBody]) =>
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
            Model.serializeDebugTraces(serialization, items),
        }),
        publishSignal(client, Model.debugLogsEndpoint, logs, {
          run: (items: ReadonlyArray<Model.SafeLogRecord>) =>
            Model.serializeDebugLogs(serialization, items),
        }),
      ],
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.ignoreCause, Effect.withTracerEnabled(false));
