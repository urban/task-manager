import { assert } from "@effect/vitest";

type Request = { readonly body: { readonly _tag: string } };

export const privacyCanaries: ReadonlyArray<string> = [
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

export const assertPrivateRequestBytes = (
  ...[requests, resourceAttributes]: readonly [
    ReadonlyArray<Request>,
    Readonly<Record<string, string>>,
  ]
): void => {
  assert.lengthOf(requests, 2);
  const bytes = requests.flatMap((request) =>
    request.body["_tag"] === "Uint8Array" &&
    "body" in request.body &&
    request.body.body instanceof Uint8Array
      ? [new globalThis.TextDecoder().decode(request.body.body)]
      : [],
  );
  assert.lengthOf(bytes, 2);
  const payload = bytes.join("");
  assert.notInclude(payload, privacyCanaries.join(" | "));
  assert.notInclude(payload, "raw.argv");
  assert.notInclude(payload, "secret");
  for (const value of privacyCanaries) {
    assert.notInclude(payload, value);
  }
  for (const fragment of forbiddenFragments) {
    assert.notInclude(payload, fragment);
  }
  assert.include(payload, "CliApplication.run");
  for (const [key, value] of Object.entries(resourceAttributes)) {
    assert.include(payload, key);
    assert.include(payload, value);
  }
};
