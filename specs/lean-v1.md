# Lean V1 Task Manager architecture

Status: Approved

Decision Ticket: **Define lean V1 core and CLI contract** (`8yqcz7`)

## Purpose

Lean V1 prioritizes a working orchestrator-facing Task Manager over exhaustive production hardening. It keeps the smallest useful local multi-process coordination product and preserves the current CLI where practical.

Previously researched production-hardening contracts are deliberately excluded from this repository's active implementation documentation. Backup, restore, revision, receipt, migration, and exhaustive recovery design must be reconsidered explicitly if later versions require them; they are not Lean V1 requirements.

## Product and package boundary

Task Manager is a local coordination kernel, not a workflow engine. External orchestrators own assignment, execution, review, and progress policy.

The repository will contain two packages:

- `packages/core` (`@urban/task-manager`) owns domain schemas, typed Effect operations, libSQL persistence, transactions, Claims, permanent Trash entries, and Semantic Activity.
- `packages/cli` (`@urban/task-manager-cli`) owns command parsing, environment-variable fallback, file-input convenience, confirmation, and human/JSON rendering. It depends on the core package and contains no SQL or duplicate domain mutations.

The core exposes one `Context.Service` capability, service-required typed access functions, and one parameterized live Layer:

```ts
type TaskManagerLayerOptions = {
  readonly storeLocation: CanonicalAbsolutePath;
};

type TaskManagerService = {
  readonly initializeStore: () => Effect.Effect<
    InitializeStoreResult,
    StoreInitializationRejected | StoreMutationError
  >;
  readonly validateStore: () => Effect.Effect<
    ValidateStoreReport,
    StoreValidationRejected | StoreValidationReadError
  >;
  readonly createTicket: (
    input: CreateTicketInput,
  ) => Effect.Effect<
    OpenTicket,
    | TicketCreationRejected
    | TicketNotFound
    | TicketInTrash
    | TicketIdSpaceExhausted
    | StoreMutationError
  >;
  readonly updateTicket: (
    input: UpdateTicketInput,
  ) => Effect.Effect<
    UpdateTicketResult,
    TicketUpdateRejected | TicketNotFound | TicketInTrash | StoreMutationError
  >;
  readonly getTicketDetails: (
    ticketId: TicketId,
  ) => Effect.Effect<
    TicketDetails,
    TicketNotFound | TicketInTrash | StoreReadError
  >;
  readonly listTickets: (
    input: ListTicketsInput,
  ) => Effect.Effect<
    ReadonlyArray<ListTicketNode>,
    TicketNotFound | TicketInTrash | StoreReadError
  >;
  readonly selectNextTicket: (
    input: SelectNextTicketInput,
  ) => Effect.Effect<
    SelectNextTicketResult,
    TicketNotFound | TicketInTrash | TicketNotOpen | StoreReadError
  >;
  readonly claimTicket: (
    input: ClaimTicketInput,
  ) => Effect.Effect<
    ClaimTicketResult,
    | TicketNotFound
    | TicketInTrash
    | TicketNotOpen
    | ActiveClaimConflict
    | HumanExecutorClaimExcluded
    | StoreMutationError
  >;
  readonly renewClaim: (
    input: RenewClaimInput,
  ) => Effect.Effect<
    RenewClaimResult,
    | TicketNotFound
    | TicketInTrash
    | TicketNotOpen
    | ClaimRenewalFenceError
    | StoreMutationError
  >;
  readonly releaseClaim: (
    input: ReleaseClaimInput,
  ) => Effect.Effect<
    ReleaseClaimResult,
    | TicketNotFound
    | TicketInTrash
    | TicketNotOpen
    | ClaimReleaseFenceError
    | StoreMutationError
  >;
  readonly completeTicket: (
    input: CompleteTicketInput,
  ) => Effect.Effect<
    DoneTicket,
    CompletionRejected | TicketNotFound | TicketInTrash | StoreMutationError
  >;
  readonly cancelTicket: (
    input: CancelTicketInput,
  ) => Effect.Effect<
    CancelTicketResult,
    CancellationRejected | TicketNotFound | TicketInTrash | StoreMutationError
  >;
  readonly deleteTicket: (
    input: DeleteTicketInput,
  ) => Effect.Effect<
    DeleteTicketResult,
    DeletionRejected | TicketNotFound | TicketInTrash | StoreMutationError
  >;
  readonly addTicketDependency: (
    input: ChangeDependencyInput,
  ) => Effect.Effect<
    AddTicketDependencyResult,
    | DependencyAdditionRejected
    | TicketNotFound
    | TicketInTrash
    | StoreMutationError
  >;
  readonly removeTicketDependency: (
    input: RemoveTicketDependencyInput,
  ) => Effect.Effect<
    RemoveTicketDependencyResult,
    | DependencyRemovalRejected
    | TicketNotFound
    | TicketInTrash
    | StoreMutationError
  >;
};

declare class TaskManager extends Context.Service<
  TaskManager,
  TaskManagerService
>()("@urban/task-manager/TaskManager") {}

declare const layer: (
  options: TaskManagerLayerOptions,
) => Layer.Layer<TaskManager>;
```

`TaskManagerService` is the closed service shape containing exactly the approved public core operations in this architecture. Each service method encapsulates persistence and has the same success and typed error channel as its corresponding access function, but no `TaskManager` requirement because it is the provided capability. Every exported access function delegates through this service and explicitly includes `TaskManager` as its `Effect.Effect` requirement. Store Location is supplied only through `TaskManagerLayerOptions`; neither service methods nor access-function inputs accept it.

A CLI subcommand resolves and canonicalizes Store Location, composes all core calls needed for that complete command program, and provides `layer({ storeLocation })` once around the composition. Tests may replace the complete `TaskManager` capability with a test Layer. LibSQL clients, SQL, rows, platform handles, internal repository services, and connection-lifecycle details never cross the core interface. Access functions never provide the live Layer internally or obtain Store configuration from hidden global state.

## Retained Lean V1 scope

- One persistent embedded-libSQL local Store at an explicitly resolved Store Location.
- A UUIDv4 Store Identity and one exact Store format.
- Fresh Store initialization; no JSONL import or migration.
- Multiple local processes sharing one Store through short libSQL transactions and `BEGIN IMMEDIATE` mutations.
- The reviewed CLI command surface defined below. Existing conveniences are retained where approved without restoring deferred hardening machinery.
- Singular expiring Claims with Claim IDs and Actor-Identity fencing for behavior-changing mutations while a Claim is active.
- Lean typed Semantic Activity: one ordered item per changed Ticket, an Activity Cursor, occurrence time, Actor Identity, Ticket ID, and operation-specific event.
- Permanent Trash entries that preserve complete soft-deleted Ticket Snapshots and deletion attribution for future recovery while reserving their IDs.
- Actor Identity supplied explicitly for every state-changing Ticket or Claim CLI command through `--actor` or `TM_ACTOR`; Store initialization is the unattributed administrative exception.

## Deferred production hardening

Lean V1 does not implement:

- backup or restore;
- Mutation IDs, durable idempotency receipts, or exact retry replay;
- Store Revision, Ticket Revision, or revision guards;
- new move, reparent, reopen, Trash recovery, Trash purge, or whole-Store destruction operations;
- a backup catalog, Git archival integration, or migration framework;
- broad OS/architecture/filesystem qualification;
- exhaustive phase-by-phase crash injection, power-loss qualification, or complete recovery-artifact validation;
- the earlier large typed recovery taxonomy.

Unknown commit outcomes in Lean V1 require callers to reread and reconcile current state. The product must not claim the deferred production guarantees.

## Store Location resolution

The CLI derives its default Store Location from a canonical project scope and places the Store in a user-level registry outside the repository:

```text
~/.task-manager/stores/<project-key>/
```

Inside a Git working tree, the project scope is the canonical Git common root rather than the current linked-worktree root. Every linked worktree of one repository therefore derives the same default Store Location. Outside Git, the project scope is the canonical resolved working directory.

The CLI derives the filesystem-safe project key from the canonical project-scope path with this exact procedure:

1. Take the final path component, lowercase it, replace every run outside ASCII `a-z` and `0-9` with `-`, trim leading and trailing `-`, and retain at most the first 48 characters. If the result is empty, use `project`.
2. Encode the complete canonical project-scope path as UTF-8 and compute its SHA-256 digest as 64 lowercase hexadecimal characters.
3. Join the readable slug, two hyphens, and the complete digest: `<slug>--<sha256>`.

The readable component does not establish identity; the complete digest prevents equal basenames at different canonical paths from sharing a Store. Canonically equivalent path aliases produce the same key because canonicalization precedes encoding.

Global adapter precedence is resolved independently per setting before the core Layer is constructed:

1. The working-directory basis is `--cwd`, otherwise `TM_CWD`, otherwise the process working directory.
2. Explicit Store Location is `--storage-path`, otherwise `TM_STORAGE_PATH`, otherwise absent. When absent, the CLI derives the user-level Store Location from the selected working-directory basis. A relative explicit Store Location resolves against that same selected basis; an absolute explicit location does not. `--cwd` and `--storage-path` are therefore valid together.
3. Actor Identity on commands that require it is `--actor`, otherwise `TM_ACTOR`, otherwise a required-Actor adapter failure.
4. Singular duplicate flags fail during CLI parsing before environment fallback. Command-specific confirmations and semantic flags have no environment equivalents unless this architecture explicitly names one.

An explicitly supplied higher-precedence value completely replaces the lower-precedence value for that setting; settings do not merge. Every selected path is boundary-validated and canonicalized before use, including a working-directory basis that accompanies an absolute Store Location. `--storage-path` and `TM_STORAGE_PATH` select the containing Store Location and bypass only project-scope derivation, not canonicalization or validation.

Store resolution canonicalizes path aliases before deriving project scope or accepting an explicit location. A selected working-directory basis resolves a relative value against process cwd, must already exist as a directory, and resolves symlinks to its canonical real path. An explicit relative Store Location then resolves against that canonical basis; an absolute Store Location remains independent of it. Store paths are lexically normalized for `.` and `..`, then the deepest existing ancestor is resolved through symlinks to its real path and the normalized nonexistent tail is appended. The final Store Location may be absent for `tm init`; if present, it must be a directory. Other commands resolve the same canonical path and return `StoreNotInitialized` when `task-manager.db` is absent.

Relative file-input paths resolve against the selected canonical working-directory basis rather than process cwd. They must exist as regular files and resolve symlinks before reading. Explicit CLI and environment path strings perform no shell-like `~` expansion; only default registry derivation obtains the user home directory through the platform home-directory service.

The CLI completes this resolution before constructing the core Layer. The core receives one resolved canonical Store Location and performs no Git discovery. Store Identity remains independent of Store Location.

Moving or renaming a repository changes its path-derived default Store Location. Callers that require location continuity across such a move must select the prior location explicitly. Lean V1 performs no automatic Store discovery, relocation, or merging.

The default active libSQL database is `task-manager.db` inside the resolved Store Location. It and its engine-owned sibling sidecars remain outside the repository and outside Git. Pi's exact-working-directory session partitioning is not copied: using the linked-worktree path would incorrectly split one coordination domain. Task Manager adopts only the user-level-registry idea while retaining libSQL as its transactional persistence engine.

## Core domain model

### Bounded diagnostics

Every public `BoundedDiagnostic` is a non-empty canonical single-line string produced before vendor-originated text crosses the core boundary. Mapping first removes prohibited SQL statements, query parameters, stacks, raw error serialization, and path aliases while classifying the public typed reason. It then replaces every run of line breaks, tabs, and Unicode control characters with one ASCII space and applies ECMAScript `String.prototype.trim()` semantics. If no text remains, it uses exactly `No diagnostic available.`.

The normalized diagnostic may contain at most 1,024 UTF-8 bytes. Exactly 1,024 bytes is accepted. When larger, mapping retains the longest complete Unicode-code-point prefix for which appending the single Unicode ellipsis `…` remains within 1,024 bytes, then appends that ellipsis; truncation never splits a UTF-8 sequence. Remaining case, Unicode, punctuation, and internal spacing are preserved without Unicode normalization.

The same type is used by Store read, mutation, initialization, and validation reasons that deliberately permit diagnostic evidence. Consumers identify failures by typed reason rather than diagnostic text. The CLI renders the already sanitized diagnostic verbatim without further interpretation.

### Shared Store read failures

Every ordinary public core read operation uses one reason-tagged Store failure outside Ticket lookup and operation-specific domain rejection:

```ts
type StoreOpenFailed = {
  readonly _tag: "StoreOpenFailed";
  readonly diagnostic: BoundedDiagnostic;
};

type StoreQueryFailed = {
  readonly _tag: "StoreQueryFailed";
  readonly diagnostic: BoundedDiagnostic;
};

type StoreReadErrorReason =
  | StoreNotInitialized
  | StoreOpenFailed
  | StoreQueryFailed;

type StoreReadError = {
  readonly _tag: "StoreReadError";
  readonly databasePath: CanonicalAbsolutePath;
  readonly reason: StoreReadErrorReason;
};
```

`StoreNotInitialized` means the configured database is absent, not corrupt. `StoreOpenFailed` means the configured database could not be opened. `StoreQueryFailed` means it opened but the requested read could not complete. Ticket lookup and domain checks occur only after Store reading is available. `tm validate` retains its more specific phase-gated rejection reasons rather than collapsing them into this ordinary-operation taxonomy.

Every diagnostic is normalized and bounded before crossing the core boundary and contains no vendor stack, SQL statement, query parameters, raw error object, or path alias. `databasePath` is the canonical absolute database path supplied through the configured Layer; it is runtime error context, not Store metadata.

Human output is exact:

- `StoreNotInitialized`: `Error: Task Manager Store is not initialized at <database-path>; run tm init.`
- `StoreOpenFailed`: `Error: Could not open Task Manager Store at <database-path>: <diagnostic>`
- `StoreQueryFailed`: `Error: Could not read Task Manager Store at <database-path>: <diagnostic>; run tm validate.`

JSON mechanically maps parent and reason `_tag` fields to `type`, preserves every field, and adds no prose `message`. Public schema-backed definitions support Effect parent/reason catching and reason unwrapping.

### Shared Store mutation failures

Every ordinary public core mutation uses one reason-tagged Store failure outside input, Ticket lookup, and operation-specific domain rejection:

```ts
type StoreMutationErrorReason =
  | {
      readonly _tag: "StoreNotInitialized";
    }
  | {
      readonly _tag: "StoreOpenFailed";
      readonly diagnostic: BoundedDiagnostic;
    }
  | {
      readonly _tag: "StoreTransactionFailed";
      readonly diagnostic: BoundedDiagnostic;
    }
  | {
      readonly _tag: "StoreCommitOutcomeUnknown";
      readonly diagnostic: BoundedDiagnostic;
    };

type StoreMutationError = {
  readonly _tag: "StoreMutationError";
  readonly databasePath: CanonicalAbsolutePath;
  readonly reason: StoreMutationErrorReason;
};
```

`StoreTransactionFailed` is used only when non-commit is known, including a failure before the `COMMIT` attempt whose transaction has completely rolled back. `StoreCommitOutcomeUnknown` means a commit was attempted but the physical outcome cannot be established; it never claims rollback or safe blind retry. Callers reread current state and reconcile before deciding whether to retry. Domain rejection and no-op outcomes remain distinct and never become Store failures. No generic retryability boolean is exposed because recovery follows the reason.

Diagnostics and `databasePath` follow the same canonical-path, normalization, bound, and no-vendor-internals rules as `StoreReadError`. Human output is exact:

- `StoreNotInitialized`: `Error: Task Manager Store is not initialized at <database-path>; run tm init.`
- `StoreOpenFailed`: `Error: Could not open Task Manager Store at <database-path>: <diagnostic>`
- `StoreTransactionFailed`: `Error: Task Manager Store mutation failed before commit at <database-path>: <diagnostic>`
- `StoreCommitOutcomeUnknown`: `Error: Task Manager Store commit outcome is unknown at <database-path>; reread current state before retrying: <diagnostic>`

JSON mechanically maps parent and reason `_tag` fields to `type`, preserves every field, and adds no prose `message`. Public schema-backed definitions support Effect parent/reason catching and reason unwrapping.

### Store format metadata

Lean V1 persists exactly one semantic Store-metadata record:

```ts
type StoreMetadata = {
  readonly applicationId: "task-manager";
  readonly formatVersion: 1;
  readonly storeId: StoreId;
  readonly activityHighWater: 0 | ActivityCursor;
};
```

`storeId` is a canonical UUIDv4 generated once by fresh initialization. `activityHighWater` is `0` for a Store with no Activity and otherwise equals the greatest committed positive Activity Cursor. It advances atomically with Activity and must agree with the contiguous persisted cursor sequence.

Application identity, format version, Store Identity, and Activity high-water are semantic metadata regardless of the private SQL table and column organization. Lean V1 does not duplicate them through a second normative pragma representation. Store creation time, Store Location, canonical project path, package or engine versions, durability profile, revisions, receipts, and migration history are not Store metadata. Runtime and engine qualification remains a deployment concern rather than part of Store Identity or format compatibility.

The only Lean V1 database filename is `task-manager.db`. A different filename selected through internal convention is unsupported; `--storage-path` selects its containing Store Location, not an arbitrary database file.

### Canonical time

Core domain instants use `DateTime.Utc`. Every persisted and public encoded timestamp is one canonical UTC RFC 3339/ISO 8601 string with exactly millisecond precision:

```text
YYYY-MM-DDTHH:mm:ss.SSSZ
```

Core-owned times are normalized to millisecond precision before they participate in state, Claim activity, comparisons, persistence, Activity, or results. Encoded boundaries reject offsets, absent fractional seconds, extra fractional precision, impossible dates, and other non-canonical spellings rather than preserving semantically equivalent text. Human CLI output uses the same canonical string for every timestamp placeholder and never applies locale formatting. Ordering, equality, and Claim-expiry decisions compare UTC instants rather than encoded strings.

### Ticket identity

A Ticket ID is exactly six lowercase alphanumeric characters (`a-z`, `0-9`). Every CLI command and core operation requires the complete six-character ID. Prefix lookup and ambiguity errors are unsupported.

The ID space contains `36^6 = 2,176,782,336` values. Creation checks both active Tickets and permanent Trash entries and never reuses an ID.

### Shared Ticket lookup errors

Every public core operation that resolves an exact Ticket Identity uses the same lookup errors:

```ts
type TicketNotFound = {
  readonly _tag: "TicketNotFound";
  readonly ticketId: TicketId;
};

type TicketInTrash = {
  readonly _tag: "TicketInTrash";
  readonly ticketId: TicketId;
  readonly deletedAt: DateTime.Utc;
  readonly deletedBy: ActorIdentity;
};
```

`TicketNotFound` means the canonical ID is absent from both active Tickets and Trash. `TicketInTrash` means Trash permanently reserves the ID; it returns deletion attribution but never the preserved Snapshot through an ordinary operation error. Malformed IDs fail boundary decoding before lookup and never become `TicketNotFound`.

Public operations whose target or supplied root categorically requires an open Ticket may also return this shared top-level lifecycle error after active identity resolution:

```ts
type TicketNotOpen = {
  readonly _tag: "TicketNotOpen";
  readonly ticketId: TicketId;
  readonly status: "done" | "cancelled";
};

type TicketNotOpenReason = {
  readonly _tag: "TicketNotOpen";
  readonly status: "done" | "cancelled";
};
```

`selectNextTicket` uses top-level `TicketNotOpen` for a supplied terminal root, and `claimTicket`, `renewClaim`, and `releaseClaim` use it for a terminal target. It contains no Result, Cancellation, Claim, or complete Snapshot. Operation-specific rejection wrappers use the separate status-only `TicketNotOpenReason` because their parent already owns `ticketId`; they do not reuse or structurally duplicate top-level `TicketNotOpen`. Both shapes mechanically encode `_tag` as JSON `type: "TicketNotOpen"`, and nested reasons retain operation-specific human rendering and Effect reason handling.

Human output is exactly `Error: Ticket <ticket-id> was not found.`, `Error: Ticket <ticket-id> is in Trash; moved at <deleted-at> by <deleted-by>.`, or `Error: Ticket <ticket-id> is <status>; expected an open Ticket.`. JSON mechanically maps `_tag` to `type`, preserves every field, and adds no prose `message`. Every command renders from the shared typed error without a Store reread.

### Ticket schema

Ticket Snapshot is one closed lifecycle-discriminated union:

```ts
type TicketLevel = "epic" | "task" | "subtask";
type Executor = "agent" | "human";
type TicketStatus = "open" | "done" | "cancelled";

type TicketBase = {
  readonly id: TicketId;
  readonly level: TicketLevel;
  readonly executor: Executor;
  readonly subject: Subject;
  readonly description: Description;
  readonly context?: Context;
  readonly parentId?: TicketId;
  readonly blockedBy?: NonEmptyReadonlyArray<TicketId>;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
};

type OpenTicket = TicketBase & {
  readonly status: "open";
};

type DoneTicket = TicketBase & {
  readonly status: "done";
  readonly result: Result;
  readonly completedAt: DateTime.Utc;
  readonly completedBy: ActorIdentity;
};

type CancelledTicket = TicketBase & {
  readonly status: "cancelled";
  readonly reason: CancellationReason;
  readonly cancelledAt: DateTime.Utc;
  readonly cancelledBy: ActorIdentity;
};

type Ticket = OpenTicket | DoneTicket | CancelledTicket;
```

Public boundary schemas reject excess lifecycle fields. An open Ticket has no Result or terminal metadata; a done Ticket has only its required Result and completion metadata; a cancelled Ticket has only its required reason and cancellation metadata. Cancellation uses no redundant single-field wrapper. Claims are separate coordination records and never Ticket fields. Store metadata, not each Ticket, owns `formatVersion`; Tickets do not contain `schemaVersion`.

Absent optional `context`, `parentId`, and `blockedBy` values are omitted in typed encodings and JSON rather than represented as `null`. `blockedBy` is absent when the Ticket has no dependencies and otherwise is a non-empty collection of unique Ticket IDs in ascending ID order. These are canonical Snapshot representations, including inside Trash entries.

Creation sets `createdAt` and `updatedAt` to the same core-owned occurrence time. Every effective mutation of the Snapshot advances `updatedAt` to that mutation's occurrence time; Claim acquisition, renewal, release, and logical expiry do not. Completion sets `updatedAt` equal to `completedAt`. Cancellation sets `updatedAt` equal to `cancelledAt`. No-op outcomes preserve every timestamp.

### Claim coordination record

A Claim is one closed separate coordination record:

```ts
type Claim = {
  readonly claimId: ClaimId;
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimedAt: DateTime.Utc;
  readonly expiresAt: DateTime.Utc;
};
```

`claimId` is a canonical UUIDv4 generated for that Claim incarnation. `expiresAt` is exactly one hour after `claimedAt`. The public schema rejects excess fields. A Claim is keyed to one open Ticket and is not part of the Ticket Snapshot. At most one current Claim record may exist per Ticket. Claim acquisition, renewal, release, and logical expiry do not modify the Ticket Snapshot or its `updatedAt`.

Core queries may compose the effective active Claim alongside a Ticket for convenience, but their types and JSON representations keep `ticket` and `activeClaim` or `claim` as distinct values. Expired Claims are omitted from normal composed reads without cleanup. Completion and cancellation coordinate Ticket and Claim records in one transaction where required. Soft deletion instead requires every selected Ticket to be unclaimed and may separately fence the surviving direct parent.

Subject, Description, and Context share one canonical text normalization. Decode a string by replacing every CRLF pair and every remaining CR with LF, then applying ECMAScript `String.prototype.trim()` semantics. Preserve all remaining case, Unicode, punctuation, Markdown, internal spacing, tabs, and line breaks exactly without Unicode normalization.

Subject must remain non-blank, contain no LF, tab, or other Unicode control character, and contain at most 50 Unicode code points after normalization. The limit is not measured in UTF-16 code units, grapheme clusters, or UTF-8 bytes. Capitalization, final punctuation, and Markdown characters are unrestricted.

Description is always present. It may contain LF and tab but rejects every other Unicode control character. An orchestrator may intentionally create or update a stub with the canonical value `description: ""`; the CLI requires `--allow-empty-description` for that choice. A whitespace-only input normalizes to that empty value rather than remaining a distinct state.

Context is either absent or normalized non-blank. It has the same multiline and control-character policy as Description. There is no present-empty Context state. The CLI omits Context when none exists and uses an explicit clear operation when removing it.

Description and Context have no additional Lean V1 domain size bound. An input or Store representation failure remains its applicable typed boundary or Store failure rather than an undocumented text-length rejection. Inline CLI input, file input, and direct core input use the same schemas. Canonical values are persisted and returned unchanged in typed values, JSON, human output, Trash, and Activity, and update equality or no-op detection compares those canonical values.

### Actor Identity

Actor Identity is an opaque caller-asserted single-line label used consistently in Claims, lifecycle attribution, Semantic Activity, structured errors, and output; it is not authentication or authorization. Its canonical schema applies ECMAScript `String.prototype.trim()` semantics, requires non-empty text afterward, rejects Unicode control characters, and permits at most 128 UTF-8 bytes after trimming. Exactly 128 bytes is accepted and one byte over is rejected. Case, Unicode, punctuation, and internal spaces are preserved. The schema performs no Unicode normalization or case folding, and Actor equality compares canonical strings exactly.

Both CLI `--actor` and `TM_ACTOR` values pass through this same schema, as do direct core inputs. A missing fallback value produces `ActorIdentityRequired`, while a supplied blank, multiline, control-containing, or oversized value produces boundary validation failure. Every state-changing Ticket or Claim CLI command requires Actor Identity. `tm init` creates Store metadata rather than mutating a Ticket or Claim, requires no Actor Identity, and emits no Activity.

### Required Actor adapter failure

After resolving `--actor`, then `TM_ACTOR`, a state-changing Ticket or Claim command with no Actor Identity fails with one fieldless typed adapter error:

```ts
type ActorIdentityRequired = {
  readonly _tag: "ActorIdentityRequired";
};
```

Human output is exactly `Error: Actor Identity is required; pass --actor or set TM_ACTOR.`. JSON failure is exactly `{ "ok": false, "error": { "type": "ActorIdentityRequired" } }`. Recovery is identical across commands, so the error contains no command name.

The failure applies uniformly before constructing a core request or reading the Store. It does not apply to read-only commands, `tm init`, `tm validate`, or deletion preview without `--yes`. An explicitly supplied but invalid Actor Identity fails boundary validation rather than `ActorIdentityRequired`.

### Global no-force policy

Lean V1 exposes no `--force` flag on any command. Actor Identity mismatch against an active Claim cannot be waived, and the typed core exposes no generic force or unsafe-bypass boolean.

Every direct mutation of a Ticket protected by an active Claim requires both the matching Actor Identity and the exact current Claim ID. Actor Identity alone is insufficient: renewal or replacement makes an earlier Claim ID stale even when the same Actor Identity is reused. Soft deletion is stricter: an active Claim on any selected Ticket blocks deletion categorically, while removal from an actively claimed surviving direct parent requires that parent's matching Actor Identity and exact Claim ID. These are core domain invariants, not CLI confirmation policy.

A Claim fences direct mutations of its Ticket, not the transitive graph of derived readiness and relationship effects. A dependent becoming ready, a parent becoming actionable, or a dependency gaining a derived reverse `Blocks` relationship does not require that observing Ticket's Claim fence. Creating a child beneath an actively claimed parent is the one explicit structural exception because it changes the decomposition of actively coordinated parent work.

Accordingly, `tm block` and `tm unblock` fence only the directly modified blocked Ticket, not the dependency Ticket. `tm update`, `tm cancel`, `tm block`, and `tm unblock` require Actor Identity and expose optional target `--claim-id`; absence asserts unclaimed state. `tm delete` accepts no target Claim ID and instead exposes optional `--parent-claim-id` for the surviving direct parent's structural fence. `tm complete` always requires `--claim-id` because completion is valid only for the exact active holder. `tm create` also retains optional `--parent-claim-id`, `tm renew` and `tm release` always require `--claim-id`, and `tm claim` accepts no Claim-fence input. Completing or cancelling a prerequisite does not require fences from claimed dependents, and ordinary terminal transition of a child does not require its claimed parent's fence merely because the parent may become actionable.

The holder may directly complete or cancel a claimed Ticket only with the matching Actor Identity and exact Claim ID. Completion has no unclaimed path: every completion must consume the target's exact active Claim. Cancellation may also directly mutate an unclaimed target without a Claim ID. Soft deletion has no claimed-target path: every selected Ticket must be unclaimed, and success moves its complete Snapshot to Trash while emitting only `TicketTrashed` Activity. Successful completion or cancellation atomically removes any permitted target Claim and emits only its operation-specific Activity, never an additional `TicketClaimReleased` item. Requiring a preliminary release before completion would make completion impossible until reacquisition and would introduce an unnecessary unclaimed race.

Executor is stable for the lifetime of an active Claim. No Actor, including the matching holder, may perform an effective Executor transition while the target has an active Claim. A holder that needs to change the kind of executor must release, update the then-unclaimed Ticket, and acquire a new Claim; logical expiry provides the same unclaimed transition boundary. Other effective text and Context edits remain available to the matching holder. A requested Executor value that already equals the current value remains an ineffective edit and participates in the ordinary update no-op rules rather than failing merely because a Claim exists. In a mixed update, any effective Executor transition blocks the complete atomic update, including otherwise valid text edits.

Completion and cancellation Activity uses `ClaimConsumption`: `Unclaimed`, or `Consumed` with the exact removed Claim ID. `TicketCompleted` is constrained to `Consumed`; `Unclaimed` remains possible only for cancellation targets and unclaimed cancellation descendants. Common Activity attribution identifies the Actor; prior Claim Activity retains the complete lease. The operation event does not embed the complete removed Claim or describe it as a release. In a cancellation cascade, only the explicit target can record `Consumed`; every changed descendant records `Unclaimed` because an actively claimed descendant would have blocked the transaction. `TicketTrashed` contains no `ClaimConsumption` because every moved Ticket is categorically unclaimed.

Completion is non-cascading: every descendant must already be done or cancelled, and any open descendant prevents completion whether claimed or unclaimed. Cancellation may cascade across open unclaimed descendants. Soft deletion may move descendants across every lifecycle state only with `--cascade`. For both operations, any active descendant Claim blocks the entire parent operation even when the command Actor holds it; callers must release or wait for logical expiry, and descendant Claim IDs cannot authorize a cascade.

The typed `ClaimedDescendants` failure contains the target Ticket ID and every blocking descendant in canonical tree order. Each entry contains the descendant Ticket ID, Subject, Executor, and complete active Claim, including Actor Identity, Claim ID, and expiry. Human output renders those recovery details; JSON preserves the structured non-empty collection. The failure leaves all active Ticket, Claim, Trash, timestamp, and Activity state unchanged.

A non-holder cannot release, replace, transfer, or reassign another Actor's unexpired Claim. Sequential work uses one orchestrator-held Claim or cooperative holder release followed by ordinary acquisition; if cooperation fails, recovery waits for logical expiry. Lean V1 adds no Claim-handoff operation. Release and acquisition remain separate transactions, so another claimant may win between them.

CLI confirmations such as `--allow-human` and `--allow-empty-description`, plus semantic scope choices such as `tm cancel --cascade`, acknowledge narrow adapter choices. They are not force under another name and never waive core Claim fencing or other domain invariants.

For a well-formed core mutation request, validation resolves Store and Ticket identity, checks lifecycle eligibility, then checks the explicit target's active Claim before descendant-Claim, hierarchy, dependency, and other operation-specific invariants, subject to the documented narrow operation-specific exceptions. Mutations that permit unclaimed targets express intent as `TargetClaimFence = RequireUnclaimed | MatchClaim { claimId }`. Their CLI adapters map an omitted optional `--claim-id` to `RequireUnclaimed` and a supplied `--claim-id <uuid>` to `MatchClaim`; they never pre-read Claim state to choose a fence. Completion has a required Claim ID and always performs the equivalent exact active-Claim match; it cannot express `RequireUnclaimed`. `RequireUnclaimed` succeeds only when no active Claim exists; an active Claim returns `ActiveClaimRequiresFence`. An exact match requires an active Claim with that ID and Actor Identity; no active Claim returns `NoActiveClaim`, a different ID returns `ClaimIdMismatch`, and only an exact ID proceeds to Actor comparison and possible `ActorMismatch`. Errors are not aggregated. A supplied Claim ID is never silently ignored merely because its Claim expired or was released; optional-fence callers must reread and explicitly retry against unclaimed state or acquire a new Claim, while completion must acquire a new Claim.

For an effective mutation, a stale claimant therefore receives its fence error before errors such as `OpenDependencies`.

Approved operation-specific exceptions remain narrow: `tm update` detects an effective no-op after lifecycle eligibility but before Claim fencing and therefore ignores its supplied fence when no write occurs. `tm block` returns `AlreadyBlocked` and `tm unblock` returns `AlreadyUnblocked` after both endpoint identities and open target lifecycle are resolved but before target Claim fencing; these proven relationship no-ops likewise ignore a supplied stale fence, write nothing, and emit no Activity. `tm release` returns `AlreadyInactive` for an open Ticket with no active Claim without validating the supplied Claim ID. Cancellation checks a valid target fence before descendant state. Soft deletion instead rejects an active target Claim categorically and then validates any surviving direct-parent fence before descendant state. Cancellation in `TargetOnly` scope rejects transaction-current open descendants without evaluating their Claims or Executors; deletion in `TargetOnly` scope rejects every transaction-current descendant without inspecting Claims, Executors, or dependencies. Cascade scopes then check descendant Claims before their later operation-specific invariants. CLI parsing, file loading, boundary-schema validation, and adapter confirmations occur before a well-formed core mutation request and cannot waive its invariants.

#### Command matrix

`--force` is absent from every command and rejected as an unknown flag. It waives no constraint.

| Command       | Required Claim fencing                                                                      | Constraints never waived                                                                                   | Activity implication                                                         |
| ------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tm init`     | None                                                                                        | Store identity, format, location, and initialization safety                                                | None                                                                         |
| `tm validate` | None                                                                                        | Complete Lean Store validation                                                                             | None                                                                         |
| `tm create`   | Matching Actor and exact parent Claim ID when the parent is actively claimed                | Input, hierarchy, dependency, and parent fencing                                                           | One `TicketCreated` for the new Ticket                                       |
| `tm update`   | Optional target `--claim-id`; absence requires unclaimed state; effective no-op is unfenced | Lifecycle, input, Claim fence, active-Claim Executor stability, and human-gate confirmation                | One `TicketUpdated` for an effective change; none for no-op                  |
| `tm show`     | None                                                                                        | Exact active lookup and Trash distinction                                                                 | None                                                                         |
| `tm list`     | None                                                                                        | Query and filter validation                                                                                | None                                                                         |
| `tm next`     | None                                                                                        | Hierarchy, dependency readiness, and selection rules                                                       | None                                                                         |
| `tm claim`    | Acquisition requires no active Claim                                                        | Lifecycle, active-Claim conflict, and human-gate confirmation                                              | One `TicketClaimed`                                                          |
| `tm renew`    | Matching active Actor and exact Claim ID                                                    | Lifecycle, expiry, Actor, and Claim ID                                                                     | One `TicketClaimRenewed`                                                     |
| `tm release`  | Matching active Actor and exact Claim ID; inactive state returns `AlreadyInactive`          | Lifecycle, Actor, and current-incarnation fencing                                                          | One `TicketClaimReleased` on removal; none for `AlreadyInactive`             |
| `tm complete` | Required `--claim-id`; exact active Claim and matching Actor are mandatory                  | Lifecycle, active Claim, open descendants, open dependencies, Result validation, and human gate            | One `TicketCompleted` with `Consumed { claimId }`                            |
| `tm cancel`   | Optional target `--claim-id`; every descendant must be unclaimed                            | Lifecycle, descendant Claims, reason validation, cascade confirmation, human gates, and target Claim fence | One `TicketCancelled` with `ClaimConsumption` per changed Ticket             |
| `tm delete`   | Selected Tickets must be unclaimed; optional exact surviving-parent `--parent-claim-id`      | Claims, scope, dependencies, Trash integrity, confirmation, human gates, and parent fence                  | One minimal `TicketTrashed` and one permanent Trash entry per moved Ticket   |
| `tm block`    | Optional target `--claim-id`; the dependency Claim is irrelevant                            | Lifecycle, dependency existence, uniqueness, cycle prevention, and target Claim fence                      | One `TicketDependencyAdded` for effective addition; none for `AlreadyBlocked` |
| `tm unblock`  | Optional target `--claim-id`; the dependency Claim is irrelevant                            | Lifecycle, relation state, open-human-prerequisite scope, and target Claim fence                           | One `TicketDependencyRemoved` for effective removal; none for `AlreadyUnblocked` |

#### Typed core policy

The core uses operation-specific inputs and shared closed unions, never a universal bypass boolean:

```ts
type TargetClaimFence =
  | { readonly _tag: "RequireUnclaimed" }
  | { readonly _tag: "MatchClaim"; readonly claimId: ClaimId };

type ClaimConsumption =
  | { readonly _tag: "Unclaimed" }
  | { readonly _tag: "Consumed"; readonly claimId: ClaimId };

type ActiveClaimRequiresFence = {
  readonly _tag: "ActiveClaimRequiresFence";
};

type NoActiveClaim = {
  readonly _tag: "NoActiveClaim";
  readonly providedClaimId: ClaimId;
};

type ClaimIdMismatch = {
  readonly _tag: "ClaimIdMismatch";
  readonly providedClaimId: ClaimId;
};

type ActorMismatch = {
  readonly _tag: "ActorMismatch";
  readonly providedActor: ActorIdentity;
  readonly activeClaim: Claim;
};

type CreateParent = {
  readonly ticketId: TicketId;
  readonly claimFence: TargetClaimFence;
};

type TicketEdit =
  | { readonly _tag: "SetSubject"; readonly subject: Subject }
  | { readonly _tag: "SetDescription"; readonly description: Description }
  | { readonly _tag: "SetContext"; readonly context: Context }
  | { readonly _tag: "ClearContext" }
  | { readonly _tag: "SetExecutor"; readonly executor: Executor };

declare const TicketEditsTypeId: unique symbol;

type TicketEdits = NonEmptyReadonlyArray<TicketEdit> & {
  readonly [TicketEditsTypeId]: "TicketEdits";
};

declare const TicketEditsSchema: Schema.Codec<
  TicketEdits,
  NonEmptyReadonlyArray<TicketEdit>
>;

type ExecutorTransitionScope =
  | { readonly _tag: "PreserveHumanExecutor" }
  | { readonly _tag: "AnyExecutorTransition" };

type UpdateTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimFence: TargetClaimFence;
  readonly executorTransitionScope: ExecutorTransitionScope;
  readonly edits: TicketEdits;
};

type CompleteTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimId: ClaimId;
  readonly result: Result;
};

type CancellationScope =
  | { readonly _tag: "TargetOnly" }
  | { readonly _tag: "CascadeOpenDescendants" };

type CancellationExecutorScope = { readonly _tag: "AgentOnly" } | { readonly _tag: "AnyExecutor" };

type CancelTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimFence: TargetClaimFence;
  readonly scope: CancellationScope;
  readonly executorScope: CancellationExecutorScope;
  readonly reason: CancellationReason;
};

type DeletionScope =
  | { readonly _tag: "TargetOnly" }
  | { readonly _tag: "CascadeDescendants" };

type DeletionExecutorScope = { readonly _tag: "AgentOnly" } | { readonly _tag: "AnyExecutor" };

type ParentClaimFence =
  | { readonly _tag: "RequireUnclaimed" }
  | { readonly _tag: "MatchClaim"; readonly claimId: ClaimId };

type DeleteTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly parentClaimFence: ParentClaimFence;
  readonly scope: DeletionScope;
  readonly executorScope: DeletionExecutorScope;
};

type ChangeDependencyInput = {
  readonly ticketId: TicketId;
  readonly dependencyId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimFence: TargetClaimFence;
};

type ClaimExecutorScope =
  | { readonly _tag: "AgentOnly" }
  | { readonly _tag: "AnyExecutor" };

type ClaimTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly executorScope: ClaimExecutorScope;
};

type RenewClaimInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimId: ClaimId;
};

type ReleaseClaimInput = RenewClaimInput;
```

`CreateTicketInput` contains optional `CreateParent`, required semantic fields, and an always-present dependency array:

```ts
type CreateTicketInput = {
  readonly actor: ActorIdentity;
  readonly level: TicketLevel;
  readonly executor: Executor;
  readonly subject: Subject;
  readonly description: Description;
  readonly context?: Context;
  readonly parent?: CreateParent;
  readonly blockedBy: ReadonlyArray<TicketId>;
};
```

An empty input `blockedBy` means no dependencies. Boundary decoding rejects duplicate dependency IDs; creation canonicalizes accepted dependencies into ascending order and omits Snapshot `blockedBy` when none exist. Cancellation and deletion inputs contain no descendant-fence collection. Raw CLI confirmation booleans are absent from core inputs. Cancellation carries `TargetOnly | CascadeOpenDescendants` and `AgentOnly | AnyExecutor`. Deletion carries `TargetOnly | CascadeDescendants`, `AgentOnly | AnyExecutor`, and the surviving direct-parent fence. Each CLI maps omitted or supplied semantic flags mechanically.

`TicketEdits` is an opaque schema-backed non-empty collection whose members are unique by edit `_tag`, so one request contains at most one edit for each field. Callers construct it by decoding through the exported `TicketEditsSchema` rather than asserting the brand.

The shared optional target-fence failure is reason-tagged as `ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch`. `ActiveClaimRequiresFence` means a `RequireUnclaimed` request encountered an active Claim; it does not mean every use of that mutation requires prior Claim acquisition. Required-Claim completion cannot produce `ActiveClaimRequiresFence`; its active-Claim fence reasons are `NoActiveClaim | ClaimIdMismatch | ActorMismatch`. `ClaimedDescendants` contains the target ID and a non-empty canonical list of blocking descendant summaries with complete active Claims. These typed domain failures remain distinct from CLI parse/file/confirmation failures and from operation errors such as `TicketNotOpen`, `OpenDescendants`, and `OpenDependencies`.

#### CLI surfaces

The CLI exposes no `--force` or renamed override flag. `tm update`, `tm cancel`, `tm block`, and `tm unblock` accept optional target `--claim-id`; omission maps to `RequireUnclaimed`. `tm complete`, `tm renew`, and `tm release` require target `--claim-id`; `tm create` and `tm delete` use optional `--parent-claim-id` for direct structural parent fencing; acquisition-only `tm claim` accepts none. Deletion accepts no target or descendant Claim ID. Read-only commands expose no Claim-fence flags. Actor fallback remains `--actor` then `TM_ACTOR` on state-changing Ticket and Claim commands; preview-only deletion remains read-only and needs no Actor.

Narrow confirmations retain their own spelling and purpose: `--allow-human` and `--allow-empty-description` confirm adapter-level intent and never become authorization capabilities. Where cancellation must enforce adapter intent transaction-current, `--allow-human` maps to semantic `CancellationExecutorScope`; the core never receives a raw approval boolean. `tm cancel --cascade` similarly selects an explicit core operation scope rather than passing a generic `yes` capability.

#### Representative scenarios

- **Unclaimed race:** for an operation that permits unclaimed targets, a request without `--claim-id` maps to `RequireUnclaimed`; if another process acquires a Claim before the transaction, the mutation fails with `ActiveClaimRequiresFence` and emits no Activity.
- **Completion without a Claim:** the CLI rejects a missing required `--claim-id`; a core completion against an unclaimed, released, or expired Claim state fails with `NoActiveClaim` and emits no Activity.
- **Stale renewal:** a holder using superseded Claim ID `C1` after renewal to `C2` receives `ClaimIdMismatch`, even when Actor Identity still matches.
- **Released or expired observation:** `MatchClaim(C1)` against no active Claim fails with `NoActiveClaim`; it never silently becomes an unclaimed mutation.
- **Human gate:** `--allow-human` may acknowledge the command's defined human boundary but cannot satisfy a Claim fence, lifecycle rule, dependency, or hierarchy invariant.
- **Lifecycle:** a terminal target returns `TicketNotOpen` before Claim fencing; terminal Snapshot history is never rewritten.
- **Dependency:** completion with an open direct dependency fails after a valid target fence; callers cancel the prerequisite or remove the relation rather than bypass readiness.
- **Cascade:** a validly fenced parent cancellation or structurally parent-fenced deletion reports all claimed descendants and changes nothing; after those Claims are released or expire, an explicit retry may cascade across the eligible transaction-current descendants.
- **Handoff:** sequential agents use an orchestrator-held Claim or cooperative release followed by acquisition. No caller can unilaterally transfer or release another Actor's unexpired Claim.

### Lean Semantic Activity

Every successful state-changing transaction emits one typed Activity item per changed Ticket. Reads, failures, and no-ops emit none. Each item contains:

- a contiguous Store-global Activity Cursor;
- occurrence time;
- Actor Identity;
- affected Ticket ID;
- an operation-specific typed event and payload.

Activity is committed atomically with active Ticket state and Trash. Lean V1 exposes no public Activity read operation; Activity observation APIs are outside this contract. Lean V1 also does not include Mutation ID or revision correspondence.

### Trash

Soft deletion atomically removes each selected Snapshot from active coordination and writes a permanent `TrashEntry { ticket, deletedAt, deletedBy }`. The entry retains the complete final pre-deletion open, done, or cancelled Snapshot; it does not embed Claim state or become a fourth Ticket lifecycle variant. Every selected Ticket must be unclaimed. Active Tickets and Trash entries are disjoint by ID, Trash IDs remain permanently reserved, ordinary active reads exclude Trash, and Lean V1 provides neither recovery nor purge. One minimal `TicketTrashed` Activity item per moved Ticket records the transition without duplicating the entry.

## Human CLI Subject rendering

Every human-readable CLI surface renders the complete canonical Ticket Subject. This includes command receipts, `show` details, list trees, previews, relationship displays, and typed error or recovery summaries. The domain's 50-character Subject validation is the only presentation bound; the CLI performs no additional truncation.

Typed core results, persisted Snapshots, Semantic Activity, errors, human output, and JSON output therefore use the same complete authoritative Subject.

## Adapter confirmation errors

Non-deletion adapter confirmations use purpose-specific closed errors:

```ts
type EmptyDescriptionConfirmationRequired = {
  readonly _tag: "EmptyDescriptionConfirmationRequired";
};

type HumanCompletionConfirmationRequired = {
  readonly _tag: "HumanCompletionConfirmationRequired";
  readonly ticketId: TicketId;
};
```

`EmptyDescriptionConfirmationRequired` applies uniformly when create or update intentionally supplies a Description that normalizes to empty without `--allow-empty-description`. The adapter resolves inline/file input and normalizes Description before this check, but performs no Store read or core call. A supplied non-empty Description needs no flag. Human output is exactly `Error: An empty Description requires --allow-empty-description.`.

`HumanCompletionConfirmationRequired` occurs only when completion's pre-read finds the direct target both open and human-executor and `--allow-human` is absent. A terminal target does not produce this adapter error; core lifecycle handling remains authoritative. Completion's required Claim ID and active-Claim Executor freeze ensure that a later Executor change invalidates the completion rather than escaping acknowledgment. Human output is exactly `Error: Completing human-executor Ticket <ticket-id> requires --allow-human.`.

JSON mechanically maps each `_tag` to `type`, preserves only `ticketId` where applicable, and adds no prose `message`. Neither confirmation can waive boundary, Store, lifecycle, Claim, hierarchy, dependency, Result, or other domain invariants.

## Effect CLI and shared adapter failures

The CLI is built on the pinned `effect/unstable/cli` `Command`, `Flag`, `Argument`, `Param`, `CliError`, and `CliOutput` APIs. It uses Effect CLI's lexer, command tree, unknown-command and unknown-option detection, required parameter handling, primitive and choice parsing, suggestions, help, version, shell completions, parameter schemas and filters, path primitives where their semantics match, and occurrence combinators. Task Manager does not implement a second command-line lexer, parser, choice validator, help generator, or completion generator.

The runner disables Effect CLI's automatic error rendering when Task Manager must produce its global human/JSON failure envelope, then mechanically projects the pinned structured `CliError` into stable project-owned adapter errors. This projection is intentionally thin: it does not reparse argv or parser prose. Effect CLI `UnrecognizedOption`, `MissingOption`, `MissingArgument`, `UnexpectedArgument`, `InvalidValue`, and `UnknownSubcommand` supply the corresponding parse facts. Effect's `DuplicateOption` denotes an invalid parent/child command declaration rather than repeated argv occurrence and is an application construction defect, not a user-input result. Singular argv flags are declared with Effect occurrence bounds such as `Flag.atMost(1)`; their excess-occurrence `InvalidValue` is mechanically projected to the public repeated-option reason before environment fallback. Cross-parameter source conflicts remain a small post-parse adapter check because they involve otherwise valid independent parameters.

The stable parse family is:

```ts
type CliParseErrorReason =
  | { readonly _tag: "UnknownCommand"; readonly command: string }
  | { readonly _tag: "UnknownOption"; readonly option: string }
  | { readonly _tag: "UnexpectedArgument"; readonly argument: string }
  | { readonly _tag: "MissingArgument"; readonly argument: string }
  | { readonly _tag: "MissingOption"; readonly option: string }
  | { readonly _tag: "MissingOptionValue"; readonly option: string }
  | { readonly _tag: "DuplicateOption"; readonly option: string }
  | {
      readonly _tag: "InvalidOptionValue";
      readonly option: string;
      readonly providedValue: string;
      readonly expectedValues: NonEmptyReadonlyArray<string>;
    }
  | {
      readonly _tag: "ConflictingOptions";
      readonly options: NonEmptyReadonlyArray<string>;
    };

type CliParseError = {
  readonly _tag: "CliParseError";
  readonly reason: CliParseErrorReason;
};
```

`MissingOption` is distinct from `MissingOptionValue` because the pinned Effect CLI exposes absence and a present flag without a value as different parse facts. When Effect accumulates several lexical errors, Task Manager returns the first error in argv order; parse failures are fail-fast public outcomes rather than an aggregate validation report. `UnexpectedArgument` similarly reports the first unexpected positional value. `InvalidOptionValue.expectedValues` uses command-declaration order. `ConflictingOptions.options` uses command-declaration order. Raw parser suggestions remain human help behavior and do not enter structured JSON.

Valid CLI syntax whose value fails a domain boundary uses:

```ts
declare const PublicPathIndexTypeId: unique symbol;

type PublicPathIndex = number & {
  readonly [PublicPathIndexTypeId]: "PublicPathIndex";
};

type PublicStructuralPath = ReadonlyArray<string | PublicPathIndex>;

type PublicSchemaIssue = {
  readonly path: PublicStructuralPath;
  readonly code: "required" | "invalid-type" | "invalid-value" | "constraint";
  readonly expected: BoundedDiagnostic;
};

type InputRejected = {
  readonly _tag: "InputRejected";
  readonly input: {
    readonly source: "argument" | "option" | "environment" | "file";
    readonly name: string;
  };
  readonly issues: NonEmptyReadonlyArray<PublicSchemaIssue>;
};
```

Effect CLI `Flag.withSchema`, `Argument.withSchema`, filters, and Effect Schema decoding perform validation wherever they can preserve the required source identity and precedence. Task Manager maps `SchemaIssue` structurally to `PublicSchemaIssue`; it exposes no rejected raw value, complete record, formatter internals, or schema implementation object. Issues preserve schema traversal order.

`PublicPathIndex` is an opaque schema-backed non-negative safe integer. Human output renders every `PublicStructuralPath`, including `PublicSchemaIssue.path` and `ForeignKeyViolation.field`, in one canonical bracket notation. The empty path is `$`; a string segment appends `[` followed by that segment's canonical JSON string encoding and `]`; and an index appends `[` followed by its canonical decimal representation and `]`. Dot shorthand is never used. For example, `["blockedBy", 1]` renders `$["blockedBy"][1]`. Structured JSON retains the original segment array and never replaces it with this display string.

File and path failures use:

```ts
type FileInputError = {
  readonly _tag: "FileInputError";
  readonly option: string;
  readonly path: CanonicalAbsolutePath;
  readonly reason:
    | { readonly _tag: "FileNotFound" }
    | { readonly _tag: "NotRegularFile" }
    | { readonly _tag: "InvalidUtf8" }
    | { readonly _tag: "FileReadFailed"; readonly diagnostic: BoundedDiagnostic };
};

type PathResolutionError = {
  readonly _tag: "PathResolutionError";
  readonly setting: "cwd" | "storage-path" | "home";
  readonly path?: AbsoluteNormalizedPath;
  readonly reason:
    | { readonly _tag: "PathNotFound" }
    | { readonly _tag: "NotDirectory" }
    | { readonly _tag: "HomeDirectoryUnavailable" }
    | {
        readonly _tag: "CanonicalizationFailed";
        readonly diagnostic: BoundedDiagnostic;
      };
};
```

Effect FileSystem and Path services own OS access. Task Manager adds only the canonical missing-tail Store resolution and error projection needed by its approved path contract. File failures identify the selecting option and resolved canonical path. Path failures occur before Layer construction. Parser-library, `SchemaIssue`, and raw OS error values never cross the adapter boundary.

JSON mechanically maps every outer and nested `_tag` to `type`, preserves the approved fields, and adds no generic `message`. Human output begins `Error:` and renders deterministically from the typed reason; it may use the pinned no-color `CliOutput` formatter for the underlying parse fact but never adopts Effect CLI's separate automatic error envelope. Help, version, and shell-completion rendering remain owned by Effect CLI.

## Global CLI process and JSON contract

Every successful command outcome exits with status `0`, including no-ops, empty reads, `NoActionableWork`, and initialization of an existing Store. Every expected CLI parse, boundary-validation, file-input, confirmation-required, Store, lookup, or domain failure exits with status `1`. Lean V1 defines no finer exit-code taxonomy; typed structured errors carry the actionable distinction. Help, version, and shell-completion output exits `0`. Unexpected defects and external-signal exit conventions are runtime concerns rather than structured Task Manager outcomes.

Without `--json`, success writes only its approved human output to stdout. Expected failure writes only its approved human output to stderr, beginning with `Error:`. Every Task Manager-owned human success or expected-failure output ends with exactly one newline; multiline output has no additional trailing blank line. Help, version, and shell-completion byte formatting remains owned by Effect CLI. With `--json`, success and expected failure each write exactly one compact JSON object followed by one newline to stdout and leave stderr empty. Success envelopes always contain `ok: true`. Failure envelopes are exactly `{ "ok": false, "error": <StructuredCliError> }`.

Structured JSON failures mechanically encode typed adapter or core error data. They do not duplicate human prose in a generic `message` field. A bounded diagnostic appears only when an approved typed error reason defines it as evidence, such as validation gate diagnostics; consumers identify the failure through `type`, never by parsing diagnostic prose.

## Reviewed CLI contracts

### `tm init`

Shared flags: `--cwd`, `--storage-path`, and `--json`. There are no command-specific flags.

The CLI resolves Store Location, constructs the core Layer, and calls `initializeStore`. The core atomically creates the libSQL schema, Store Identity, and metadata when absent; returns an `Existing` outcome for an already compatible Store; and rejects legacy JSONL, unrelated, partial, corrupt, or incompatible state without modifying it. Initialization emits no Activity.

Initialization-specific rejection is exact:

```ts
declare const ObservedApplicationIdTypeId: unique symbol;

type ObservedApplicationId = string & {
  readonly [ObservedApplicationIdTypeId]: "ObservedApplicationId";
};

declare const ObservedFormatVersionTypeId: unique symbol;

type ObservedFormatVersion = number & {
  readonly [ObservedFormatVersionTypeId]: "ObservedFormatVersion";
};

type StoreInitializationRejectionReason =
  | {
      readonly _tag: "LegacyStoreDetected";
      readonly legacyPath: CanonicalAbsolutePath;
    }
  | {
      readonly _tag: "InvalidDatabase";
      readonly diagnostic: BoundedDiagnostic;
    }
  | {
      readonly _tag: "ApplicationIdentityMismatch";
      readonly expectedApplicationId: "task-manager";
      readonly actualApplicationId?: ObservedApplicationId;
    }
  | {
      readonly _tag: "IncompatibleFormat";
      readonly expectedFormatVersion: 1;
      readonly actualFormatVersion?: ObservedFormatVersion;
    }
  | {
      readonly _tag: "InvalidStoreStructure";
      readonly component: "schema" | "metadata";
      readonly issues: NonEmptyReadonlyArray<PublicSchemaIssue>;
    };

type StoreInitializationRejected = {
  readonly _tag: "StoreInitializationRejected";
  readonly databasePath: CanonicalAbsolutePath;
  readonly reason: StoreInitializationRejectionReason;
};
```

An absent Store is initialization success rather than `StoreNotInitialized`. A detected legacy `tasks.jsonl` is never imported, migrated, replaced, or silently ignored. Corrupt or non-database content maps to `InvalidDatabase`; an unrelated valid database maps to `ApplicationIdentityMismatch`; another recognized Task Manager format maps to `IncompatibleFormat`; and a partial schema or malformed Lean metadata maps to `InvalidStoreStructure`. `ObservedApplicationId` is an opaque schema-backed string disclosed only when the persisted observation is already invariant under ECMAScript `String.prototype.trim()`, non-blank, single-line, contains no Unicode control character, and contains at most 128 UTF-8 bytes. Accepted case, Unicode, punctuation, and internal spacing are preserved without Unicode normalization. `ObservedFormatVersion` is an opaque schema-backed non-negative safe integer. An observation outside either schema is omitted rather than represented as `null`, sanitized, truncated, or coerced; mismatch classification does not require public disclosure of the unsafe value.

Generic filesystem access, open, transaction, and uncertain-commit failures use `StoreMutationError`, although its `StoreNotInitialized` reason is impossible for `initializeStore`. Every rejection leaves existing files unchanged. Concurrent initialization still yields one `Created` and compatible `Existing` outcomes.

The public core result and signature are:

```ts
type InitializeStoreResult =
  | {
      readonly _tag: "Created";
      readonly metadata: StoreMetadata;
    }
  | {
      readonly _tag: "Existing";
      readonly metadata: StoreMetadata;
    };

declare const initializeStore: () => Effect.Effect<
  InitializeStoreResult,
  StoreInitializationRejected | StoreMutationError,
  TaskManager
>;
```

`Created` returns the committed fresh metadata with `activityHighWater: 0`. `Existing` returns the authoritative current metadata, including the existing Store Identity and current Activity high-water. The result contains no libSQL client, persistence handle, or Store Location because location is a Layer parameter rather than Store metadata.

The CLI combines that result with its resolved canonical paths. JSON success is exactly:

```json
{
  "ok": true,
  "outcome": "created",
  "storeLocation": "/canonical/store/location",
  "databasePath": "/canonical/store/location/task-manager.db",
  "metadata": {
    "applicationId": "task-manager",
    "formatVersion": 1,
    "storeId": "00000000-0000-4000-8000-000000000000",
    "activityHighWater": 0
  }
}
```

`outcome` is `"created" | "existing"`; every other field has the same shape for both outcomes and contains transaction-current values. `storeLocation` and `databasePath` are canonical absolute paths. The illustrative UUID above represents the canonical UUIDv4 string shape rather than a fixed value.

Human success is exactly `Initialized Task Manager Store <store-id> at <database-path>.` for `Created` and `Task Manager Store <store-id> already exists at <database-path>.` for `Existing`. Existing-Store output never says that the Store was created, initialized, or opened. Neither format exposes Activity, a database handle, or engine details beyond the approved metadata receipt.

Human initialization-rejection output is exact:

- `LegacyStoreDetected`: `Error: Legacy Task Manager data exists at <legacy-path>; Lean V1 does not import or migrate it.`
- `InvalidDatabase`: `Error: Existing database at <database-path> is invalid: <diagnostic>`
- `ApplicationIdentityMismatch`: `Error: Database at <database-path> belongs to application <actual-application-id-or-unknown>; expected task-manager.`
- `IncompatibleFormat`: `Error: Task Manager Store at <database-path> uses format <actual-format-version-or-unknown>; expected format 1.`
- `InvalidStoreStructure`: first line `Error: Task Manager Store at <database-path> has invalid <component> structure.`, followed by every issue using shared deterministic schema-issue rendering.

The literal `unknown` represents an omitted unsafe observation in human output. JSON mechanically maps parent and reason `_tag` fields to `type`, preserves structured fields and issue order, omits unavailable optional values, and adds no prose `message`.

### `tm validate`

Shared flags only. The CLI calls `validateStore` and renders its report. Validation is read-only and emits no Activity.

Validation checks Store identity and format, the Lean V1 schema, libSQL `quick_check`, foreign keys, all active Ticket, Claim, Trash-entry, and Activity schemas, complete active hierarchy and dependency integrity, Trash Snapshot integrity, contiguous Activity Cursors and high-water agreement, matching `TicketTrashed` attribution, and disjoint active/Trash IDs. It does not validate revisions, receipts, backups, recovery, purge, or migration codecs.

Successful validation returns:

```ts
type ValidateStoreReport = {
  readonly metadata: StoreMetadata;
  readonly counts: {
    readonly tickets: number;
    readonly openTickets: number;
    readonly doneTickets: number;
    readonly cancelledTickets: number;
    readonly claimRecords: number;
    readonly trashEntries: number;
    readonly activityItems: number;
  };
};
```

All counts are non-negative safe integers from one consistent validated Store observation. `tickets` counts active-coordination Snapshots, excludes Trash, and equals `openTickets + doneTickets + cancelledTickets`. `claimRecords` counts persisted current-record slots, including records whose Claims are logically expired at validation time; validation neither cleans them up nor turns the report into a time-sensitive active-Claim view. `trashEntries` counts permanent Trash entries. `activityItems` equals `metadata.activityHighWater` because valid Activity Cursors are contiguous from 1; both are zero for no Activity.

JSON success is exactly `{ "ok": true, "storeLocation": <canonical-absolute-location>, "databasePath": <canonical-absolute-database-path>, "report": <ValidateStoreReport> }` and mechanically encodes the complete metadata and counts.

Human success is exactly these five lines:

```text
Validated Task Manager Store <store-id> (format <format-version>) at <database-path>.
Tickets: <tickets> total; <open-tickets> open; <done-tickets> done; <cancelled-tickets> cancelled.
Claim records: <claim-records>.
Trash entries: <trash-entries>.
Activity items: <activity-items>; high-water: <activity-high-water>.
```

The report contains no active/expired Claim classification, actionability, readiness, Activity payloads, or Trash Snapshots. Validation failure is typed and returns no partial success report.

Validation failure uses phase-gated aggregation. The core first establishes that the database can be opened as the expected Task Manager application and format, then runs engine `quick_check` and foreign-key integrity gates, then decodes persisted records, and finally checks cross-record domain integrity. A failed earlier gate returns its typed gate failure without attempting later checks whose results would be unsafe or meaningless. Once the database passes those gates and is safely inspectable, validation completes every deterministic record-schema and cross-record integrity check and returns all discovered issues as one canonically ordered non-empty collection. Independent safely discoverable defects therefore require one validation run rather than repeated fail-fast repair cycles. Validation never reports a check as completed when its prerequisite gate failed and never returns a success report together with issues.

Validation gate precedence is exact and fail-fast after canonical Store resolution: absent database produces `StoreNotInitialized`; failure to open or query enough state for classification produces `StoreValidationReadError`; non-database or corrupt content produces `InvalidDatabase`; a safely inspectable application identity other than `task-manager` produces `ApplicationIdentityMismatch`; a recognized Task Manager format other than `1` produces `IncompatibleFormat`; and the expected application/format then checks `InvalidStoreStructure`, with `schema` before `metadata`. Only a valid expected structure proceeds to `EngineIntegrityFailed`, then `ForeignKeyIntegrityFailed`, then record decoding and cross-record integrity aggregation. A failed earlier gate prevents every later gate.

Validation follows the same Effect reason-error contract as resolved mutation invariants:

```ts
type StoreValidationRejected = {
  readonly _tag: "StoreValidationRejected";
  readonly databasePath: CanonicalAbsolutePath;
  readonly reason: StoreValidationRejectionReason;
};

type StoreValidationReadError = {
  readonly _tag: "StoreReadError";
  readonly databasePath: CanonicalAbsolutePath;
  readonly reason: StoreOpenFailed | StoreQueryFailed;
};

type StoreValidationRejectionReason =
  | StoreNotInitialized
  | InvalidDatabase
  | ApplicationIdentityMismatch
  | IncompatibleFormat
  | InvalidStoreStructure
  | EngineIntegrityFailed
  | ForeignKeyIntegrityFailed
  | StoreIntegrityIssues;

type StoreNotInitialized = {
  readonly _tag: "StoreNotInitialized";
};

type InvalidDatabase = {
  readonly _tag: "InvalidDatabase";
  readonly diagnostic: BoundedDiagnostic;
};

type ApplicationIdentityMismatch = {
  readonly _tag: "ApplicationIdentityMismatch";
  readonly expectedApplicationId: "task-manager";
  readonly actualApplicationId?: ObservedApplicationId;
};

type IncompatibleFormat = {
  readonly _tag: "IncompatibleFormat";
  readonly expectedFormatVersion: 1;
  readonly actualFormatVersion?: ObservedFormatVersion;
};

type InvalidStoreStructure = {
  readonly _tag: "InvalidStoreStructure";
  readonly component: "schema" | "metadata";
  readonly issues: NonEmptyReadonlyArray<PublicSchemaIssue>;
};

type StoreIntegrityIssues = {
  readonly _tag: "StoreIntegrityIssues";
  readonly issues: NonEmptyReadonlyArray<StoreValidationIssue>;
};

type StoreValidationIssue =
  | RecordSchemaInvalid
  | HierarchyIntegrityInvalid
  | DependencyIntegrityInvalid
  | ClaimIntegrityInvalid
  | ActivityIntegrityInvalid
  | TrashIntegrityInvalid
  | ActiveTrashIdentityOverlap;

type PersistedRecordLocator = {
  readonly ordinal: number;
};

type PublicTicketReference = {
  readonly _tag: "Ticket";
  readonly collection: "tickets";
  readonly ticketId: TicketId;
};

type PublicClaimReference = {
  readonly _tag: "Claim";
  readonly collection: "claims";
  readonly claimId: ClaimId;
};

type PublicTrashReference = {
  readonly _tag: "Trash";
  readonly collection: "trash";
  readonly ticketId: TicketId;
};

type PublicActivityReference = {
  readonly _tag: "Activity";
  readonly collection: "activity";
  readonly cursor: ActivityCursor;
};

type PublicPersistedRecordReference =
  | PublicTicketReference
  | PublicClaimReference
  | PublicTrashReference
  | PublicActivityReference;

type ForeignKeyViolationSource =
  | {
      readonly collection: "tickets";
      readonly locator: PersistedRecordLocator;
      readonly identity?: PublicTicketReference;
    }
  | {
      readonly collection: "claims";
      readonly locator: PersistedRecordLocator;
      readonly identity?: PublicClaimReference;
    }
  | {
      readonly collection: "trash";
      readonly locator: PersistedRecordLocator;
      readonly identity?: PublicTrashReference;
    }
  | {
      readonly collection: "activity";
      readonly locator: PersistedRecordLocator;
      readonly identity?: PublicActivityReference;
    };

type ForeignKeyViolationReference =
  | {
      readonly collection: "tickets";
      readonly identity?: PublicTicketReference;
    }
  | {
      readonly collection: "claims";
      readonly identity?: PublicClaimReference;
    }
  | {
      readonly collection: "trash";
      readonly identity?: PublicTrashReference;
    }
  | {
      readonly collection: "activity";
      readonly identity?: PublicActivityReference;
    };

type ForeignKeyViolation = {
  readonly source: ForeignKeyViolationSource;
  readonly field: NonEmptyReadonlyArray<string | PublicPathIndex>;
  readonly reference: ForeignKeyViolationReference;
};

type EngineIntegrityFailed = {
  readonly _tag: "EngineIntegrityFailed";
  readonly diagnostics: NonEmptyReadonlyArray<BoundedDiagnostic>;
};

type ForeignKeyIntegrityFailed = {
  readonly _tag: "ForeignKeyIntegrityFailed";
  readonly violations: NonEmptyReadonlyArray<ForeignKeyViolation>;
};

type RecordSchemaInvalid = {
  readonly _tag: "RecordSchemaInvalid";
  readonly collection: "tickets" | "claims" | "trash" | "activity";
  readonly locator: PersistedRecordLocator;
  readonly issues: NonEmptyReadonlyArray<PublicSchemaIssue>;
};

type HierarchyIntegrityInvalid = {
  readonly _tag: "HierarchyIntegrityInvalid";
  readonly ticketId: TicketId;
  readonly reason:
    | { readonly _tag: "ParentRequired" }
    | { readonly _tag: "ParentForbidden"; readonly parentId: TicketId }
    | { readonly _tag: "ParentNotFound"; readonly parentId: TicketId }
    | {
        readonly _tag: "InvalidParentLevel";
        readonly childLevel: TicketLevel;
        readonly parentId: TicketId;
        readonly parentLevel: TicketLevel;
      }
    | {
        readonly _tag: "HierarchyCycle";
        readonly cycle: NonEmptyReadonlyArray<TicketId>;
      };
};

type DependencyIntegrityInvalid = {
  readonly _tag: "DependencyIntegrityInvalid";
  readonly ticketId: TicketId;
  readonly reason:
    | { readonly _tag: "DependencyNotFound"; readonly dependencyId: TicketId }
    | { readonly _tag: "DuplicateDependency"; readonly dependencyId: TicketId }
    | { readonly _tag: "SelfDependency"; readonly dependencyId: TicketId }
    | {
        readonly _tag: "DependencyCycle";
        readonly cycle: NonEmptyReadonlyArray<TicketId>;
      };
};

type ClaimIntegrityInvalid = {
  readonly _tag: "ClaimIntegrityInvalid";
  readonly claimId: ClaimId;
  readonly ticketId: TicketId;
  readonly reason:
    | { readonly _tag: "ClaimTicketNotFound" }
    | {
        readonly _tag: "ClaimTicketNotOpen";
        readonly status: "done" | "cancelled";
      }
    | {
        readonly _tag: "InvalidLeaseWindow";
        readonly claimedAt: DateTime.Utc;
        readonly expiresAt: DateTime.Utc;
      };
};

type ActivityIntegrityInvalid = {
  readonly _tag: "ActivityIntegrityInvalid";
  readonly reason:
    | {
        readonly _tag: "ActivityCursorSequenceInvalid";
        readonly expectedCursor: ActivityCursor;
        readonly observedCursor?: ActivityCursor;
      }
    | {
        readonly _tag: "ActivityHighWaterMismatch";
        readonly metadataHighWater: 0 | ActivityCursor;
        readonly observedHighWater: 0 | ActivityCursor;
      };
};

type TrashIntegrityInvalid = {
  readonly _tag: "TrashIntegrityInvalid";
  readonly ticketId: TicketId;
  readonly reason:
    | { readonly _tag: "MissingTicketTrashed" }
    | {
        readonly _tag: "TicketTrashedAttributionMismatch";
        readonly cursor: ActivityCursor;
        readonly expectedDeletedAt: DateTime.Utc;
        readonly observedOccurredAt: DateTime.Utc;
        readonly expectedDeletedBy: ActorIdentity;
        readonly observedActor: ActorIdentity;
      };
};

type ActiveTrashIdentityOverlap = {
  readonly _tag: "ActiveTrashIdentityOverlap";
  readonly ticketId: TicketId;
};
```

`PersistedRecordLocator.ordinal` is a positive, one-based canonical position within its collection's public-evidence validation scan. Records with a safely decoded public collection identity sort before records without one. Present Ticket and Trash Ticket IDs sort in ascending ECMAScript string order, Claim IDs sort in ascending ECMAScript string order, and Activity Cursors sort numerically. Records tied by or lacking that identity then compare by their complete safely derived public diagnostic projection: their ordered public schema issues and public foreign-key evidence, excluding the locator being constructed. The total public comparator below governs those projection fields.

Records with identical public diagnostic projections are diagnostically equivalent. Exchanging them cannot change public output, so they occupy one consecutive ordinal range without a private tie-breaker. The scan never uses or exposes physical retrieval order, insertion order, SQL row IDs, table layout, raw-record encodings, hashes, or hidden durable sequence fields. An ordinal is invocation-specific bounded diagnostic evidence, not Store identity, a stable repair handle, or a durable record identity.

The actual public definitions are schema-backed reason classes. Callers may catch `StoreValidationRejected`, catch any nested reason, or unwrap the reason through the same Effect APIs used by other command operations. Validation-specific gates are nested reasons rather than unrelated top-level validation error classes. `databasePath` is the configured canonical absolute database path and gives direct core callers runtime error context without making the path Store metadata or duplicating it inside each reason. Generic inability to open or query the configured database remains `StoreValidationReadError`, the exact validation-specific subset of shared `StoreReadError` with the same parent JSON tag and reason classes. Absence is impossible through that outer read error because validation represents it only as `StoreValidationRejected(StoreNotInitialized)`.

Every issue variant contains only its relevant structured domain context. It contains no complete malformed record, SQL identifier, query, table name or layout detail, or generic detail string. Optional Cursor fields are omitted rather than encoded as `null`. `PublicSchemaIssue` owns boundary-shape detail; semantic variants remain purpose-specific.

The Store schema makes Claim duplication unrepresentable after structural validation: each Ticket has at most one current Claim record and `claimId` is globally unique. It also makes Activity Cursor duplication unrepresentable and enforces at most one `TicketTrashed` Activity item per Ticket ID independently of Cursor uniqueness. A missing or malformed uniqueness constraint is `InvalidStoreStructure`; engine corruption that invalidates an established constraint is `EngineIntegrityFailed`. Normal core operations cannot create duplicate Claim IDs, Activity Cursors, or `TicketTrashed` items for one Ticket, so semantic integrity does not duplicate those earlier gates with unreachable duplicate reasons. Trash integrity retains `MissingTicketTrashed`, because uniqueness does not establish existence, and `TicketTrashedAttributionMismatch`, because the one matching item may disagree with the Trash entry.

Record-schema and semantic aggregation uses whole-record eligibility. Every persisted record that fails its complete collection schema contributes one `RecordSchemaInvalid`. Only a completely schema-valid Ticket, Claim, Trash entry, or Activity may then own or satisfy a hierarchy, dependency, Claim, Trash-attribution, cycle, active/Trash-overlap, or other domain-semantic check. Validation runs those checks over the complete projection of schema-valid records rather than stopping after the first malformed record or suppressing unrelated valid-record defects. Consequently, when a schema-valid record references an identity whose only persisted record is schema-invalid, the canonical counterpart is absent and the applicable `ParentNotFound`, `DependencyNotFound`, `ClaimTicketNotFound`, or `MissingTicketTrashed` issue remains eligible. Validation never salvages fields from the malformed record to make it a partial domain object, cycle participant, attribution event, or identity-overlap participant.

Activity Cursor integrity is the narrow exception because it is a Store-global persisted-sequence check rather than an issue owned by one canonical Activity event. Validation scans every position in the deterministic Activity validation scan and independently decodes its Cursor. The expected Cursor is that position's positive one-based ordinal. Exactly one `ActivityCursorSequenceInvalid` is emitted for each position whose Cursor is undecodable or differs from the expected Cursor; `observedCursor` is omitted only when decoding that Cursor is unsafe. A schema-invalid Activity also contributes its `RecordSchemaInvalid`, but contributes a sequence issue only when its independently decoded Cursor is undecodable or mismatched. It cannot satisfy Trash attribution or any other Activity-event semantic check.

No synthetic sequence issue is emitted beyond the persisted Activity record count. An internal missing Cursor is therefore evidenced by the later record occupying the expected position, while a missing tail is observable only through high-water disagreement. Duplicate Cursors never reach this aggregation because Cursor uniqueness belongs to the earlier structural and engine gates. Physical row or retrieval order is not a domain fact; only the deterministic validation scan order governs expected positions.

`observedHighWater` is safely derivable as `0` for no Activity records and otherwise as the numeric maximum of every independently decoded Cursor. When safely derivable and unequal to metadata, validation emits exactly one `ActivityHighWaterMismatch` even when sequence issues also exist. If any Activity Cursor is undecodable, validation suppresses `ActivityHighWaterMismatch` rather than manufacturing a high-water value.

Hierarchy and dependency cycle issues use one canonical witness per maximal cyclic component of the applicable schema-valid active-Ticket graph. A component is maximal when every member can reach every other member by following the graph's stored directed edges and no additional Ticket can be added while preserving that property. Hierarchy edges run from child to parent; dependency edges run from Ticket to prerequisite. The issue's outer `ticketId` is the component's smallest Ticket ID in ascending ECMAScript string order. Its `cycle` is the shortest directed closed path that begins and ends with that owner; equal-length candidates compare their complete Ticket-ID arrays positionally in ascending ECMAScript string order. The closed array's first and last IDs therefore equal the outer `ticketId`.

A hierarchy self-parent forms a one-Ticket cyclic component and emits its canonical `HierarchyCycle`. Dependency self-edges instead emit `SelfDependency` and do not emit a redundant one-Ticket `DependencyCycle`. A dependency component containing at least two Tickets emits its one ordinary `DependencyCycle` witness even when one or more members also have separately reported self-edges; self-edges are excluded when selecting that multi-Ticket witness. Validation does not emit one cycle issue per participant or enumerate every simple cycle.

`StoreIntegrityIssues` uses this exact canonical ordering:

1. Categories follow the declared `StoreValidationIssue` union order: `RecordSchemaInvalid`, `HierarchyIntegrityInvalid`, `DependencyIntegrityInvalid`, `ClaimIntegrityInvalid`, `ActivityIntegrityInvalid`, `TrashIntegrityInvalid`, then `ActiveTrashIdentityOverlap`. Collection order is `tickets`, `claims`, `trash`, then `activity`; nested reasons and every other closed-union discriminant follow declared variant order.
2. After those semantic ranks, values compare structurally through their exact public schemas. Object fields compare in declaration order; strings use ascending ECMAScript string order; numbers compare numerically; a present optional value sorts before absence; arrays compare positionally and place a shorter equal prefix first; and nested objects apply these rules recursively.
3. Public structural paths retain their specialized segment comparator: string segments before index segments, strings in ascending ECMAScript string order, indexes numerically, and a shorter equal prefix first. Canonical cycles compare Ticket IDs positionally in ascending ECMAScript string order and likewise place a shorter equal prefix first.
4. Public schema-issue sequences compare positionally in preserved schema traversal order rather than being resorted. Each issue compares by `path`, declared `code` order, then `expected` in ascending ECMAScript string order.
5. The resulting category keys are exact: `RecordSchemaInvalid` uses collection then locator ordinal; hierarchy and dependency use `ticketId`; Claim uses `claimId` then `ticketId`; Activity sequence uses reason rank, `expectedCursor`, then optional `observedCursor`; Activity high-water uses reason rank, `metadataHighWater`, then `observedHighWater`; Trash uses `ticketId`; and active/Trash overlap uses `ticketId`. Remaining reason payload fields follow their schema declaration order under the structural comparator.
6. If every structured field is equal, the issues compare equal. Canonical ordering retains duplicate multiplicity but invents no SQL, insertion-order, or hidden private tie-breaker.

The CLI renders human diagnostics only from the typed variants. JSON mechanically maps the outer, reason, issue, and nested-reason `_tag` fields to `type`, preserves the complete nested structure and canonical order, and adds no duplicate `message` field.

`StoreIntegrityIssues` human output begins exactly `Error: Task Manager Store validation failed:`. Every top-level issue line begins `- `. A `RecordSchemaInvalid` line is `- <collection> record <ordinal> has invalid schema:`, followed by every schema issue in preserved order as an indented `  - <path>: <code>; expected <expected>` line. Every other issue uses exactly one of these top-level lines:

- `ParentRequired`: `- Ticket <ticket-id> requires a parent.`
- `ParentForbidden`: `- Ticket <ticket-id> forbids parent <parent-id>.`
- `ParentNotFound`: `- Ticket <ticket-id> references missing parent <parent-id>.`
- `InvalidParentLevel`: `- <child-level> Ticket <ticket-id> has invalid <parent-level> parent <parent-id>.`
- `HierarchyCycle`: `- Hierarchy cycle: <cycle-ids-joined-by- -> >.`
- `DependencyNotFound`: `- Ticket <ticket-id> references missing dependency <dependency-id>.`
- `DuplicateDependency`: `- Ticket <ticket-id> contains duplicate dependency <dependency-id>.`
- `SelfDependency`: `- Ticket <ticket-id> depends on itself.`
- `DependencyCycle`: `- Dependency cycle: <cycle-ids-joined-by- -> >.`
- `ClaimTicketNotFound`: `- Claim <claim-id> references missing Ticket <ticket-id>.`
- `ClaimTicketNotOpen`: `- Claim <claim-id> references <status> Ticket <ticket-id>.`
- `InvalidLeaseWindow`: `- Claim <claim-id> for Ticket <ticket-id> has invalid lease <claimed-at> to <expires-at>.`
- `ActivityCursorSequenceInvalid`: `- Activity cursor sequence at position <expected-cursor>: observed <observed-cursor-or-undecodable>.`
- `ActivityHighWaterMismatch`: `- Activity high-water mismatch: metadata <metadata-high-water>; observed <observed-high-water>.`
- `MissingTicketTrashed`: `- Trash Ticket <ticket-id> has no matching TicketTrashed Activity.`
- `TicketTrashedAttributionMismatch`: `- Trash Ticket <ticket-id> attribution differs from TicketTrashed Activity <cursor>: expected <expected-deleted-at> by <expected-deleted-by>; observed <observed-occurred-at> by <observed-actor>.`
- `ActiveTrashIdentityOverlap`: `- Ticket <ticket-id> exists in both active coordination and Trash.`

Schema paths use the shared canonical bracket notation. Cycle IDs retain their canonical closed order and are joined by ` -> `. An omitted observed Activity Cursor renders exactly `undecodable`. Rendering preserves the canonical issue order and uses only the typed reason data without rereading the Store.

Gate-reason payloads are recovery-specific:

- `StoreNotInitialized` has no payload.
- `InvalidDatabase` contains a normalized bounded diagnostic mapped by the core before the error crosses its public boundary; it contains no vendor stack, SQL statement, path alias, or raw error object.
- `ApplicationIdentityMismatch` contains `expectedApplicationId: "task-manager"` and optional exact `actualApplicationId: ObservedApplicationId` only when the persisted observation satisfies its trim-invariant, non-blank, single-line, control-free, 128-UTF-8-byte schema.
- `IncompatibleFormat` contains `expectedFormatVersion: 1` and optional exact `actualFormatVersion: ObservedFormatVersion` only when the persisted observation is a non-negative safe integer.
- `InvalidStoreStructure` contains `component: "schema" | "metadata"` and a non-empty collection of schema issues expressed with public structural paths.
- `EngineIntegrityFailed` contains `diagnostics: NonEmptyReadonlyArray<BoundedDiagnostic>` produced by `quick_check`, without SQL execution details. After normalization, diagnostics sort in ascending ECMAScript string order and retain duplicate observations.
- `ForeignKeyIntegrityFailed` contains the exact schema-enforced non-empty `ForeignKeyViolation` collection above. `field` is a non-empty public semantic path and never a SQL column name. The source locator is always present; source or referenced identity is included only when it can be decoded safely and is otherwise omitted rather than replaced by malformed raw data. Violations sort by source collection in `tickets | claims | trash | activity` order, then source ordinal, field path, and safe referenced identity. SQL table names and row IDs never cross the core boundary. JSON preserves the complete structure and optional-field omission and mechanically maps every nested `PublicPersistedRecordReference._tag` to `type`. Human output describes an omitted identity as exactly `undecodable` without printing its value.

Optional observed identity or version fields are omitted when they cannot be decoded through `ObservedApplicationId` or `ObservedFormatVersion`; they are never `null`, sanitized, truncated, or coerced. Expected values remain explicit even though they are constants so recovery tools need not infer the running contract. Gate diagnostics are human-readable evidence subordinate to their typed reason, not stable codes to be parsed. The core maps and bounds all vendor-originated text before it reaches a public error.

The exact issue schemas above are closed. A reason contains no optional field unrelated to its case, malformed raw value, or canonical domain type manufactured from invalid data. Semantic reasons remain only for corruptions representable after the structural and engine gates; states made unrepresentable by required Store constraints belong to those earlier gates and do not receive redundant aggregate variants.

Validation-gate human output is exact:

- `StoreNotInitialized`: `Error: Task Manager Store is not initialized at <database-path>; run tm init.`
- `InvalidDatabase`: `Error: Existing database at <database-path> is invalid: <diagnostic>`
- `ApplicationIdentityMismatch`: `Error: Database at <database-path> belongs to application <actual-application-id-or-unknown>; expected task-manager.`
- `IncompatibleFormat`: `Error: Task Manager Store at <database-path> uses format <actual-format-version-or-unknown>; expected format 1.`
- `InvalidStoreStructure`: first line `Error: Task Manager Store at <database-path> has invalid <component> structure.`, followed by every schema issue as `- <path>: <code>; expected <expected>` in its preserved order.
- `EngineIntegrityFailed`: first line `Error: Task Manager Store at <database-path> failed engine integrity validation:`, followed by every ordered diagnostic as `- <diagnostic>`.
- `ForeignKeyIntegrityFailed`: first line `Error: Task Manager Store at <database-path> failed foreign-key integrity validation:`, followed by every ordered violation as `- <source-collection> record <ordinal> (<source-identity>) field <field-path> references <reference-collection> (<reference-identity>).`

Schema and field paths use the shared canonical bracket notation. A safely decoded identity renders as `Ticket <ticket-id>`, `Claim <claim-id>`, `Trash Ticket <ticket-id>`, or `Activity <cursor>` according to its `PublicPersistedRecordReference` variant. An omitted identity renders exactly `undecodable`. The literal `unknown` represents an omitted application identity or format version. Rendering uses only `StoreValidationRejected.databasePath` and its typed reason without rereading the Store.

The public access function is exact:

```ts
declare const validateStore: () => Effect.Effect<
  ValidateStoreReport,
  StoreValidationRejected | StoreValidationReadError,
  TaskManager
>;
```

### `tm create`

Usage: `tm create <subject> [flags]`.

Retained flags:

- `--level epic|task|subtask`, default `task`;
- `--executor agent|human`, default `agent`;
- `--parent <ticket-id>`;
- `--parent-claim-id <uuid>`;
- repeatable `--blocked-by <ticket-id>`;
- `--description` or `--description-file`;
- `--allow-empty-description`;
- optional `--context` or `--context-file`;
- required `--actor` with `TM_ACTOR` fallback;
- shared Store/JSON flags.

Removed flags: `--message`, `--message-file`, and `--allow-empty-context`.

Epic is root-only. Task may be root or a child of an open Epic. Subtask must be a child of an open Task. Creating beneath an actively claimed parent requires matching Actor Identity and `--parent-claim-id`; generic force does not bypass the Claim. Dependencies use exact existing IDs and must be unique.

The core owns time, ID generation, transaction-current validation, persistence, and one `TicketCreated` Activity item containing the complete resulting Ticket. `createTicket(input)` returns the complete committed canonical `OpenTicket` directly. Creation has one successful state-changing outcome, so the public core adds no single-case result wrapper, outcome tag, Activity payload, Cursor, Store metadata, or Claim.

Resolved creation invariants use one exact reason-tagged operation error:

```ts
type TicketCreationRejectionReason =
  | { readonly _tag: "ParentRequired" }
  | {
      readonly _tag: "ParentForbidden";
      readonly providedParentId: TicketId;
    }
  | {
      readonly _tag: "ParentNotOpen";
      readonly parentId: TicketId;
      readonly status: "done" | "cancelled";
    }
  | {
      readonly _tag: "InvalidParentLevel";
      readonly parentId: TicketId;
      readonly parentLevel: TicketLevel;
      readonly childLevel: TicketLevel;
    }
  | {
      readonly _tag: "ActiveParentClaimRequiresFence";
      readonly parentId: TicketId;
    }
  | {
      readonly _tag: "NoActiveParentClaim";
      readonly parentId: TicketId;
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ParentClaimIdMismatch";
      readonly parentId: TicketId;
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ParentActorMismatch";
      readonly parentId: TicketId;
      readonly providedActor: ActorIdentity;
      readonly activeClaim: Claim;
    };

type TicketCreationRejected = {
  readonly _tag: "TicketCreationRejected";
  readonly reason: TicketCreationRejectionReason;
};

type TicketIdSpaceExhausted = {
  readonly _tag: "TicketIdSpaceExhausted";
};

declare const createTicket: (
  input: CreateTicketInput,
) => Effect.Effect<
  OpenTicket,
  | TicketCreationRejected
  | TicketNotFound
  | TicketInTrash
  | TicketIdSpaceExhausted
  | StoreMutationError,
  TaskManager
>;
```

Input boundary validation precedes Store lookup. For a well-formed request, creation checks parent-required or parent-forbidden shape, then resolves parent identity, parent open lifecycle, parent-level compatibility, and parent Claim fence; it then resolves dependencies in canonical ascending Ticket-ID order before atomic creation. Parent and dependency identity failures use shared `TicketNotFound` or `TicketInTrash`. The generated ID is checked against active Tickets and Trash; theoretical exhaustion of all IDs returns fieldless `TicketIdSpaceExhausted`. Errors are not aggregated. Public schema-backed creation rejection definitions support Effect parent/reason catching and reason unwrapping.

Human creation-rejection output is exact:

- `ParentRequired`: `Error: A Subtask requires a parent Task.`
- `ParentForbidden`: `Error: An Epic cannot have parent Ticket <parent-id>.`
- `ParentNotOpen`: `Error: Parent Ticket <parent-id> is <status> and cannot accept a child.`
- `InvalidParentLevel`: `Error: <child-level> Ticket cannot have <parent-level> parent Ticket <parent-id>.`
- `ActiveParentClaimRequiresFence`: `Error: Parent Ticket <parent-id> has an active Claim; reread it and pass --parent-claim-id.`
- `NoActiveParentClaim`: `Error: Claim <provided-claim-id> is not active on parent Ticket <parent-id>; reread it before retrying.`
- `ParentClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on parent Ticket <parent-id>; reread it before retrying.`
- `ParentActorMismatch`: `Error: Claim <claim-id> on parent Ticket <parent-id> is held by <holder>, not <provided-actor>.`
- `TicketIdSpaceExhausted`: `Error: No unused Ticket IDs remain.`

JSON mechanically maps parent and reason `_tag` fields to `type`, preserves reason-specific fields, and adds no prose `message`.

Human success is exactly `Created <subject> (<ticket-id>).`. JSON success is exactly `{ "ok": true, "ticket": <complete OpenTicket> }`. The returned Ticket contains the generated ID, normalized fields, canonical optional-field omission and dependency order, and committed timestamps. Rendering uses only that returned Snapshot and performs no Store reread. Tickets contain no `schemaVersion`; absent Context, parent, and dependencies are omitted according to the canonical Snapshot contract.

### `tm update`

`tm update` may modify Subject, Description, Context, and Executor only on open Tickets. Attempts to update done or cancelled Tickets fail without changing the Ticket, its Result or Cancellation, timestamps, or Activity.

An actual text or Context update to an open Ticket with an active Claim requires both the matching Actor Identity and matching Claim ID. Actor Identity alone is insufficient, and generic force does not bypass the Claim fence. An effective Executor transition instead requires the Ticket to be unclaimed; even the matching holder cannot change Executor while its Claim remains active.

When at least one edit is requested but every supplied value already equals the current open Ticket, the core returns `Unchanged` without checking the Claim fence, writing, advancing `updatedAt`, or emitting Activity. Done and cancelled Tickets fail lifecycle eligibility before no-op detection. A same-value Executor edit therefore remains ineffective and does not violate active-Claim Executor stability.

One invocation may update Subject, Description, Context, and Executor together. The core accepts a non-empty collection containing at most one edit per field and applies all effective edits atomically as one Ticket update. If a mixed update contains an effective Executor transition while a Claim is active, the entire update fails without applying otherwise valid text or Context edits.

A changed update emits one `TicketUpdated` Activity item whose non-empty changes contain only effective fields, each with its before and after value. Executor changes use the same event and transaction as text changes, but occur only while the Ticket is unclaimed. The event does not duplicate the complete resulting Ticket Snapshot.

The CLI accepts `--subject`; `--description` or `--description-file`; `--allow-empty-description`; `--context`, `--context-file`, or `--clear-context`; `--executor agent|human`; conditional `--allow-human`; required `--actor` with `TM_ACTOR` fallback; optional `--claim-id`; and the shared Store/JSON flags. Inline/file alternatives and Context set/clear alternatives are mutually exclusive. The CLI requires at least one edit. `--message`, `--message-file`, and `--allow-empty-context` are removed.

The CLI maps omitted `--allow-human` to semantic `ExecutorTransitionScope.PreserveHumanExecutor` and a supplied flag to `AnyExecutorTransition`; the core receives no raw approval boolean. An effective transaction-current Executor transition from `human` to `agent` under `PreserveHumanExecutor` fails `HumanExecutorTransitionExcluded`. The same transition under `AnyExecutorTransition` may proceed subject to every other invariant. Transitioning from `agent` to `human`, editing text or Context on a human Ticket, and an Executor no-op do not require the broader scope. Every effective Executor transition still requires transaction-current unclaimed state.

The scope is enforced after lifecycle eligibility, effective no-op detection, and Claim/active-Claim Executor-freeze validation. `Unchanged` therefore still ignores Claim and scope, while a mixed effective update fails atomically. This closes the race in which a caller earlier observed agent Executor but another unclaimed update establishes a human gate before the writer transaction. Actor attribution, Claim fencing, active-Claim Executor stability, semantic Executor scope, and Activity remain core accountability.

The public core result and rejection types are exact:

```ts
type ExecutorChangeWhileClaimed = {
  readonly _tag: "ExecutorChangeWhileClaimed";
  readonly currentExecutor: Executor;
  readonly requestedExecutor: Executor;
  readonly activeClaim: Claim;
};

type HumanExecutorTransitionExcluded = {
  readonly _tag: "HumanExecutorTransitionExcluded";
  readonly currentExecutor: "human";
  readonly requestedExecutor: "agent";
};

type TicketUpdateRejectionReason =
  | TicketNotOpenReason
  | ActiveClaimRequiresFence
  | NoActiveClaim
  | ClaimIdMismatch
  | ActorMismatch
  | ExecutorChangeWhileClaimed
  | HumanExecutorTransitionExcluded;

type TicketUpdateRejected = {
  readonly _tag: "TicketUpdateRejected";
  readonly ticketId: TicketId;
  readonly reason: TicketUpdateRejectionReason;
};

type UpdateTicketResult =
  | {
      readonly _tag: "Updated";
      readonly ticket: OpenTicket;
    }
  | {
      readonly _tag: "Unchanged";
      readonly ticket: OpenTicket;
    };

declare const updateTicket: (
  input: UpdateTicketInput,
) => Effect.Effect<
  UpdateTicketResult,
  TicketUpdateRejected | TicketNotFound | TicketInTrash | StoreMutationError,
  TaskManager
>;
```

Both variants return the authoritative transaction-current complete open Snapshot. `Updated` does not duplicate the effective before/after changes recorded by `TicketUpdated` Activity. `Unchanged` returns the unchanged Snapshot that proved the no-op, so callers never infer outcome from timestamps or a pre-read.

JSON success mechanically maps the core tag to `{ "ok": true, "outcome": "updated" | "unchanged", "ticket": <complete OpenTicket> }`. Human output is exactly `Updated (<ticket-id>).` for a changed update and `No changes to (<ticket-id>).` for a no-op. CLI output does not include the Activity payload.

Resolved update-invariant failures use one schema-backed `TicketUpdateRejected { ticketId, reason }` wrapper with the closed reason union `TicketNotOpen | ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch | ExecutorChangeWhileClaimed | HumanExecutorTransitionExcluded`. `TicketNotOpen` contains terminal status; `ActiveClaimRequiresFence` contains no current Claim details; `NoActiveClaim` and `ClaimIdMismatch` contain only the provided Claim ID; and `ActorMismatch` contains the provided Actor plus complete exactly matched active Claim. `ExecutorChangeWhileClaimed` contains the current Executor, requested Executor, and complete active Claim. It occurs only after an exact `MatchClaim` passes; `RequireUnclaimed` against the same Claim fails earlier as `ActiveClaimRequiresFence`. `HumanExecutorTransitionExcluded` contains exactly `currentExecutor: "human"` and `requestedExecutor: "agent"` and occurs only for an effective unclaimed transition under `PreserveHumanExecutor`. A mixed edit fails atomically with the selected reason. Invalid edits and schemas, shared Store failures, `TicketNotFound`, and `TicketInTrash` remain distinct. `Unchanged` remains successful before Claim, Executor-freeze, and Executor-scope checks. Public definitions support Effect parent/reason catching and reason unwrapping.

Human rejection rendering is exact:

- `TicketNotOpen`: `Error: Ticket <ticket-id> is <status> and cannot be updated.`
- `ActiveClaimRequiresFence`: `Error: Ticket <ticket-id> has an active Claim; reread the Ticket and pass --claim-id to update it.`
- `NoActiveClaim`: `Error: Claim <provided-claim-id> is not active on Ticket <ticket-id>; reread the Ticket before retrying.`
- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <ticket-id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <ticket-id> is held by <holder>, not <provided-actor>.`
- `ExecutorChangeWhileClaimed`: `Error: Ticket <ticket-id> cannot change Executor from <current-executor> to <requested-executor> while Claim <claim-id> is active; release the Claim before retrying.`
- `HumanExecutorTransitionExcluded`: `Error: Updating Ticket <ticket-id> from human to agent requires --allow-human.`

JSON mechanically maps the outer and nested `_tag` fields to `type`, preserves reason payloads, and omits a duplicate human `message`. The CLI renders only typed data without rereading the Store or recomputing effective edits.

`@urban/task-manager` exposes the `TicketEdit` union, including `SetExecutor`, a non-empty unique edit collection, `ExecutorTransitionScope`, `UpdateTicketInput`, the `Updated | Unchanged` outcome, and typed `updateTicket(input)`. `@urban/task-manager-cli` resolves flags, files, Actor fallback, and semantic Executor scope before making one core call.

### `tm set-executor` (removed)

Lean V1 removes the dedicated `tm set-executor` command. Callers use `tm update <ticket-id> --executor agent|human` while the Ticket is unclaimed. Executor retains the same atomic update, no-op contract, and `TicketUpdated` Activity event as other editable fields, but an active Claim freezes effective Executor transitions.

### `tm show`

`tm show <ticket-id>` is a read-only exact-ID lookup backed by typed `getTicketDetails(ticketId)`. Unknown IDs fail with `TicketNotFound`. Trash-reserved IDs fail distinctly with `TicketInTrash { ticketId, deletedAt, deletedBy }` without returning the preserved Snapshot through an ordinary active read. The Trash entry does not appear as an active Ticket, and the command emits no Activity.

Human output begins with one exact lifecycle-valid primary detail block. An open Ticket uses the same block as a selected `tm next` Ticket:

```text
<uppercase-level> <ticket-id>
Status: open
Executor: <executor>
Subject: <subject>
Parent: <parent-id-or-dash>
Blocked by: <ascending-comma-separated-ids-or-dash>
Created: <created-at>
Updated: <updated-at>
Claim: <dash-or-active-until-expires-at-(claim-id)>

Description:
<description-or-(empty)>

Context:
<context-or-dash>
```

A done Ticket uses:

```text
<uppercase-level> <ticket-id>
Status: done
Executor: <executor>
Subject: <subject>
Parent: <parent-id-or-dash>
Blocked by: <ascending-comma-separated-ids-or-dash>
Created: <created-at>
Updated: <updated-at>
Completed: <completed-at> by <completed-by>

Description:
<description-or-(empty)>

Context:
<context-or-dash>

Result:
Summary: <summary>
Details:
<details-or-dash>
Data:
<canonical-compact-json-or-dash>
```

A cancelled Ticket uses:

```text
<uppercase-level> <ticket-id>
Status: cancelled
Executor: <executor>
Subject: <subject>
Parent: <parent-id-or-dash>
Blocked by: <ascending-comma-separated-ids-or-dash>
Created: <created-at>
Updated: <updated-at>
Cancelled: <cancelled-at> by <cancelled-by>

Description:
<description-or-(empty)>

Context:
<context-or-dash>

Cancellation reason:
<reason>
```

The heading renders `EPIC`, `TASK`, or `SUBTASK`. The common fields use the same absence, ordering, canonical timestamp, complete-Subject, intentional-empty Description, and absent-Context rules as `tm next`. Impossible Claim, Result, and Cancellation sections are omitted rather than rendered empty. Absent Result Details or Data render `-`; present Result Data uses the Result contract's canonical compact JSON encoding. Multiline Details and Cancellation reason are preserved. Relationship sections follow the primary block.

The core `getTicketDetails(ticketId)` result also includes the optional separate `activeClaim`, an optional direct parent summary, direct `blockedBy` summaries for Tickets that prevent this Ticket from executing, and direct `blocks` summaries for Tickets prevented by this Ticket. Relationship presentation needs more derived context than the shared neutral mutation `TicketSummary`, so the public read model uses:

```ts
type RelationshipTicketSummary = TicketSummary & {
  readonly activeClaim?: Claim;
  readonly hasProgressedDescendants: boolean;
};

type TicketDetails = {
  readonly ticket: Ticket;
  readonly activeClaim?: Claim;
  readonly relationships: {
    readonly parent?: RelationshipTicketSummary;
    readonly blockedBy: ReadonlyArray<RelationshipTicketSummary>;
    readonly blocks: ReadonlyArray<RelationshipTicketSummary>;
  };
};

declare const getTicketDetails: (
  ticketId: TicketId,
) => Effect.Effect<
  TicketDetails,
  TicketNotFound | TicketInTrash | StoreReadError,
  TaskManager
>;
```

`getTicketDetails` accepts the exact typed ID directly and returns `TicketDetails` directly without single-field input or result wrappers. Its complete value is one transaction-consistent Store observation. It exposes no persistence handle or Store Location.

`hasProgressedDescendants` is transaction-current derived query data and is never persisted as Ticket state. It is true exactly when the summarized Ticket has at least one descendant at any depth that is done or has an effective active Claim, matching `tm list` even when such descendants are filtered or not expanded. Expired Claims do not contribute. `parent` and top-level `activeClaim` are omitted when absent; both relationship arrays are always present and ordered by ascending Ticket ID. The neutral `TicketSummary { ticketId, subject, status, executor }` remains unchanged for operation results and errors that do not need presentation context.

Human output appends this exact stable relationship section after the primary lifecycle block:

```text
Relationships:
Parent:
<parent-summary-or-dash>
Blocked by:
<blocked-by-summaries-or-dash>
Blocks:
<blocks-summaries-or-dash>
```

All four headings are always present. An empty subsection renders `-` on the following line. A present Parent renders one `└── <relationship-summary>` line. Each relationship array renders `├── <relationship-summary>` for every item except the final `└── <relationship-summary>`, preserving ascending Ticket-ID order. A relationship summary is exactly `<marker> <ticket-id>: <human-executor-notation><subject>`, where human Executor notation is `(H) ` and agent Executor notation is empty. Because `tm show` has no Executor filter, `(H) ` is always shown for a human relationship summary.

Marker precedence is done `[x]`, cancelled `[-]`, effectively actively claimed open `[>]`, other open with progressed descendants `[/]`, then other open `[ ]`. Active Claim details affect the marker but are not repeated on relationship lines. Relationships remain direct and do not expand children or a transitive dependency graph merely because descendant progress is summarized. The primary block's `Parent:` and `Blocked by:` fields remain the authoritative Snapshot IDs; this section provides enriched summaries from the same `TicketDetails` result.

JSON returns `{ ok: true, ticket, activeClaim?, relationships }`, where `activeClaim` is a sibling of rather than a field within `ticket`, and `relationships` contains the same enriched optional `parent`, `blockedBy`, and `blocks` summaries used by human output. The CLI adds only this success envelope or human rendering to the one authoritative direct core result without extra Store reads.

`tm show` presents only an effective active Claim. In the open primary block, an absent or expired Claim renders `Claim: -`, while a present Claim renders exactly `Claim: active until <expires-at> (<claim-id>)`. JSON provides the complete separate active Claim fields when present and omits the field when absent or expired.

### `tm list`

The default view includes all lifecycle states and both Executors, preserving current behavior. `tm list` is the complete inspection view; actionable work selection remains the responsibility of `tm next`.

Because the default is already complete, Lean V1 removes the redundant `--all` and `--all-executors` flags. Callers narrow the view with `--status open|done|cancelled` and `--executor agent|human`.

Status and Executor filters retain non-matching ancestors as structural context for matching descendants. Each tree node identifies whether it matched the filters; contextual ancestors retain the existing unannotated human rendering.

An open Ticket with an active Claim uses the human marker `[>]`, making the derived In Progress state visible without adding actor or expiry text to the tree line. An unclaimed open Ticket uses `[/]` when any descendant at any depth is done or has an effective active Claim. This progressed-descendant fact is derived from the complete transaction-current subtree regardless of filters, so hiding the done or claimed descendant does not erase visible ancestor progress. Expired Claims do not contribute. Marker precedence is done `[x]`, cancelled `[-]`, actively claimed open `[>]`, other open with a progressed descendant `[/]`, then other open `[ ]`.

Tree ordering preserves current behavior: roots are ordered by level (Epic, Task, Subtask), then oldest `createdAt`, then Ticket ID; children are ordered by oldest `createdAt`, then Ticket ID. There are no sorting flags.

`--root <ticket-id>` uses an exact six-character live Ticket ID and scopes the view to that Ticket and its complete descendant subtree. Filters apply within the subtree; the root remains as structural context when a descendant matches.

The typed input, result, and JSON output use exact closed query and read models rather than optional scalar filter policy, complete Snapshots, or a flat array:

```ts
type TicketStatusFilter =
  | { readonly _tag: "AllStatuses" }
  | { readonly _tag: "Status"; readonly status: TicketStatus };

type TicketExecutorFilter =
  | { readonly _tag: "AllExecutors" }
  | { readonly _tag: "Executor"; readonly executor: Executor };

type ListTicketsInput = {
  readonly rootTicketId?: TicketId;
  readonly statusFilter: TicketStatusFilter;
  readonly executorFilter: TicketExecutorFilter;
};

type ListTicketSummary = {
  readonly ticketId: TicketId;
  readonly level: TicketLevel;
  readonly status: TicketStatus;
  readonly executor: Executor;
  readonly subject: Subject;
};

type ListTicketNode = {
  readonly ticket: ListTicketSummary;
  readonly activeClaim?: Claim;
  readonly hasProgressedDescendants: boolean;
  readonly matchesFilter: boolean;
  readonly children: ReadonlyArray<ListTicketNode>;
};

declare const listTickets: (
  input: ListTicketsInput,
) => Effect.Effect<
  ReadonlyArray<ListTicketNode>,
  TicketNotFound | TicketInTrash | StoreReadError,
  TaskManager
>;
```

An omitted `rootTicketId` means all roots and is never represented as `null`. Both filter fields are required, so every caller selects all or one exact value explicitly. `listTickets` returns the canonical tree directly without a single-case result wrapper; an empty array is successful. `TicketNotFound` and `TicketInTrash` are possible only when `rootTicketId` is present.

`activeClaim` is separate composed coordination data and is omitted when absent or expired. `hasProgressedDescendants` is true exactly when at least one descendant at any depth is done or has an effective active Claim; it is computed from the complete scoped transaction-current subtree before filters determine visible nodes. `children` contains matching nodes and the contextual ancestors required to connect them, not hidden descendants retained merely to derive progress. JSON returns `{ ok: true, tickets }`. Human marker rendering is mechanical from status, `activeClaim`, and `hasProgressedDescendants`. Detailed fields remain the responsibility of `tm show`.

An empty result is a successful read. JSON returns `{ ok: true, tickets: [] }`. Human output is exactly `No [<status> ][<executor> ]Tickets.`: a selected lowercase status appears first, a selected lowercase Executor appears second, and each is followed by one space; an unselected dimension contributes no text. The unfiltered message is therefore `No Tickets.`, while examples include `No open Tickets.`, `No human Tickets.`, and `No done human Tickets.`. A `--root` scope does not alter this wording.

A malformed `--root` fails Ticket ID decoding. An ID absent from active state and Trash fails with `TicketNotFound`; a Trash-reserved ID fails distinctly with `TicketInTrash { ticketId, deletedAt, deletedBy }`. Trashed roots never render as active Tickets or successful empty subtrees.

`--status` and `--executor` each accept at most one value. When both are supplied they intersect. The typed query represents each dimension as either `all` or one exact value; Lean V1 has no repeatable or comma-separated list filters.

Human output uses this exact tree grammar:

```text
[/] abc123: (H) Epic subject
    ├── [>] def456: First task
    │   └── [x] ghi789: Finished subtask
    └── [-] jkl012: Cancelled task
```

Root lines have no connector or indentation. Non-root lines use `├── ` except the final sibling, which uses `└── `. Ancestor continuation uses `│   ` and other indentation uses four spaces. Each node text is exactly `<marker> <ticket-id>: <executor-notation><subject>`. The complete Subject is rendered, and no Claim holder or expiry appears on a tree line. Contextual ancestors use the identical grammar; `matchesFilter` is not annotated in human output.

Executor notation is exactly `(H) ` for human-executor Tickets whenever both Executors may appear and is empty for agent Tickets. A narrowed `--executor human` or `--executor agent` view renders no Executor notation because the selected Executor is redundant.

`tm list` is read-only: lifecycle states are observed but never changed; active Claims affect presentation but do not fence the read; Actor Identity is not required; and the command performs no writes, timestamp changes, or Semantic Activity emission. An empty result is its successful no-op equivalent.

`@urban/task-manager` exposes the exact `ListTicketsInput`, lifecycle and Executor filter unions, lifecycle-discriminated `ListTicketSummary`, recursive `ListTicketNode`, and direct-tree `listTickets(input)` result above. `@urban/task-manager-cli` decodes the exact root ID and maps omitted or supplied filter flags mechanically to the required unions, calls the core once, and adds only the JSON `{ ok: true, tickets }` envelope or renders the human tree without reproducing query rules.

### `tm next`

By default, `tm next` selects agent-executor Tickets, preserving current behavior. Selecting human work or both Executors remains explicit.

Selection is strictly leaf-first: any open direct child makes an open parent ineligible, regardless of the child's Executor, dependency state, or Claim. Hierarchy represents decomposition and may not be bypassed by a narrower selection filter.

A direct dependency is satisfied when it is terminal: either done or cancelled. Cancellation may represent an intentional scope change or a correction to Ticket decomposition, so it does not indefinitely prevent dependent or parent work from becoming actionable. This is one global dependency-readiness invariant shared by selection and eventual completion; a Ticket selected as actionable cannot later fail completion solely because the same dependency is cancelled.

Active Claims exclude Tickets by default. `--include-claimed` explicitly includes them for inspection or recovery, but because `tm next` is read-only it does not bypass the Claim fence on later mutations. Expired Claims do not affect selection.

Selection walks the canonical tree depth-first. It starts with the oldest root of the earliest root level, descends through each oldest open child until reaching the oldest actionable leaf, and then works back up that branch as descendants become terminal before moving to a later sibling or root. Root ordering is level, `createdAt`, then ID; sibling ordering is `createdAt`, then ID.

`--root <ticket-id>` requires an exact six-character open Ticket and scopes selection to its subtree. A done or cancelled root fails with typed `TicketNotOpen` rather than returning no actionable work.

The public core input and result are exact closed selection models:

```ts
type NextExecutorSelection =
  | { readonly _tag: "AgentExecutor" }
  | { readonly _tag: "HumanExecutor" }
  | { readonly _tag: "AllExecutors" };

type ClaimedTicketSelection =
  | { readonly _tag: "ExcludeClaimed" }
  | { readonly _tag: "IncludeClaimed" };

type SelectNextTicketInput = {
  readonly rootTicketId?: TicketId;
  readonly executorSelection: NextExecutorSelection;
  readonly claimedTicketSelection: ClaimedTicketSelection;
};

type SelectNextTicketResult =
  | {
      readonly _tag: "Selected";
      readonly ticket: OpenTicket;
      readonly activeClaim?: Claim;
    }
  | {
      readonly _tag: "NoActionableWork";
    };

declare const selectNextTicket: (
  input: SelectNextTicketInput,
) => Effect.Effect<
  SelectNextTicketResult,
  TicketNotFound | TicketInTrash | TicketNotOpen | StoreReadError,
  TaskManager
>;
```

An omitted `rootTicketId` means all roots and is never represented as `null`. Both selection dimensions are required; no optional scalar or boolean carries implicit core default policy. Root-specific lookup and lifecycle failures are possible only when `rootTicketId` is present.

`Selected.ticket` is the complete authoritative open Snapshot, including Description and optional Context, so an orchestrator can inspect and then claim it without another read. `activeClaim` is present only when the selected Ticket has an effective active Claim and is necessarily absent when the input excludes claimed Tickets. It is separate composed coordination data rather than embedded Ticket state. Unlike `tm show`, the result contains no relationship summaries.

JSON mechanically maps `Selected` to `{ "ok": true, "ticket": <complete OpenTicket>, "activeClaim"?: <complete Claim> }`. Human output is exactly this complete open-Ticket detail block:

```text
<uppercase-level> <ticket-id>
Status: open
Executor: <executor>
Subject: <subject>
Parent: <parent-id-or-dash>
Blocked by: <ascending-comma-separated-ids-or-dash>
Created: <created-at>
Updated: <updated-at>
Claim: <dash-or-active-until-expires-at-(claim-id)>

Description:
<description-or-(empty)>

Context:
<context-or-dash>
```

The heading renders the Ticket level as `EPIC`, `TASK`, or `SUBTASK`. `Description: (empty)` distinguishes an intentionally empty Description, while `Context: -` represents absent Context. An absent Claim renders `Claim: -`; a present effective Claim renders `Claim: active until <expires-at> (<claim-id>)`, exactly as in `tm show`. Parent and dependency values come directly from the selected Snapshot: absent parent or dependencies render `-`, and present dependencies render their canonical ascending Ticket IDs joined by `, `. The complete Subject is rendered without further truncation. The block contains no reverse `Blocks`, parent summary, Result, Cancellation, or other `tm show` relationship data, and the CLI performs no follow-up Store reads.

`NoActionableWork` is a successful explicit outcome with no nullable Ticket or optional Claim fields. Human output is exactly `No actionable Tickets.`; JSON is `{ "ok": true, "reason": "no-actionable-work" }`.

The CLI retains mutually exclusive `--executor agent|human` and `--all-executors`. No Executor flag maps to `AgentExecutor`; `--executor agent` also maps to `AgentExecutor`; `--executor human` maps to `HumanExecutor`; and `--all-executors` maps to `AllExecutors`. Omitted `--include-claimed` maps to `ExcludeClaimed`, while a supplied flag maps to `IncludeClaimed`.

`tm next` is read-only. It requires no Actor Identity or Claim fence, performs no Claim acquisition or expiry cleanup, changes no lifecycle or timestamps, and emits no Semantic Activity. Selection does not reserve work; callers must subsequently use `tm claim` and reconcile races through that mutation.

`@urban/task-manager` exposes the exact `SelectNextTicketInput`, Executor and Claim-selection unions, `Selected | NoActionableWork`, and `selectNextTicket(input)` boundary above. `@urban/task-manager-cli` resolves flags and exact root ID mechanically into those required unions, makes one core call, and renders the selected Ticket or no-work outcome.

### `tm claim`

`tm claim` performs acquisition only and has no renewal or forced-takeover mode. If any active Claim exists, including one with the same Actor Identity, acquisition fails with typed `ActiveClaimConflict` without mutation or Activity.

`tm claim` cannot replace another Actor's active Claim. Another Actor receives typed `ActiveClaimConflict` without mutation or Activity. Handoff requires the holder to perform an ordinary release followed by the next Actor's ordinary acquisition, producing separate release and claim transactions and Activity. Another claimant may win between those transactions; the later claim attempt then fails normally rather than silently replacing it. If the holder cannot cooperate, recovery waits for logical expiry.

Claiming Executor scope is transaction-current:

```ts
type ClaimExecutorScope =
  | { readonly _tag: "AgentOnly" }
  | { readonly _tag: "AnyExecutor" };
```

The CLI maps omitted `--allow-human` to `AgentOnly` and a supplied flag to `AnyExecutor`. The core receives semantic scope rather than a raw confirmation boolean. Under `AgentOnly`, a transaction-current human-executor target fails `HumanExecutorClaimExcluded`; under `AnyExecutor`, it may be acquired subject to every other invariant. This acknowledgment is not authentication or authorization.

Any open Ticket may be claimed, including a parent with open children or a dependency-blocked Ticket. Claims coordinate intent rather than duplicating `tm next` actionability policy; claiming a parent before decomposition is supported by the fenced child-creation contract.

A Ticket has at most one active Claim record associated with it. Many historical Claim incarnations may exist in Semantic Activity, but multiple active Claims are invalid; concurrent non-exclusive participation would require a separate future concept rather than weakening Claim fencing.

Each Claim has a fixed one-hour lease. The core owns acquisition time and computes `expiresAt`; the CLI exposes no duration flag.

Expiry is logical and clock-based. Clock passage makes a Claim inactive without a write, timestamp change, or Semantic Activity; no background process or read performs cleanup. An expired persisted Claim record is treated as absent by normal reads and Claim fencing until a later mutation replaces or explicitly handles the stale representation.

Claiming after expiry is a fresh acquisition. It atomically writes a new Claim record and emits `TicketClaimed` containing only the complete new Claim. The earlier Claim and its expiry remain evident in prior Activity; the new event does not reference it and no release, renewal, or reacquisition event is emitted.

Successful claim acquisition returns the exact result and access-function boundary:

```ts
type ClaimTicketResult = {
  readonly ticket: OpenTicket;
  readonly claim: Claim;
};

declare const claimTicket: (
  input: ClaimTicketInput,
) => Effect.Effect<
  ClaimTicketResult,
  | TicketNotFound
  | TicketInTrash
  | TicketNotOpen
  | ActiveClaimConflict
  | HumanExecutorClaimExcluded
  | StoreMutationError,
  TaskManager
>;
```

The result contains the unchanged complete open Ticket and complete new separate Claim from the committed transaction. Acquisition has one successful outcome and always changes Claim state, so the result has no redundant outcome tag. JSON is `{ ok: true, ticket, claim }`, with Claim kept as a sibling rather than merged into the Ticket. Human output is exactly `Claimed <subject> (<ticket-id>) for <actor> until <expires-at> (Claim <claim-id>).`. The CLI adds only the JSON `ok` field or renders that sentence; it does not expose Activity.

For a well-formed request, the core resolves active identity and open lifecycle, then checks existing effective active Claim before Executor scope. An existing Claim therefore returns `ActiveClaimConflict` regardless of Executor. If no Claim exists, `ClaimExecutorScope` is enforced before acquisition. A concurrent Executor update committed first determines the transaction-current scope outcome; acquisition committed first freezes a later effective Executor transition. Failures write no Claim and emit no Activity.

Active acquisition conflict has one exact public error:

```ts
type ActiveClaimConflict = {
  readonly _tag: "ActiveClaimConflict";
  readonly ticketId: TicketId;
  readonly activeClaim: Claim;
};
```

The same shape applies whether the provided Actor equals or differs from the current holder. It returns the complete effective active Claim for recovery and coordination, but no proposed replacement Claim, takeover option, or generic retryability field. Human output is exactly `Error: Ticket <ticket-id> already has active Claim <claim-id> held by <actor> until <expires-at>.`. JSON mechanically maps `_tag` to `type`, preserves `ticketId` and the complete `activeClaim`, and adds no prose `message`. Rendering uses only typed error data.

Human Executor exclusion uses one exact public error:

```ts
type HumanExecutorClaimExcluded = {
  readonly _tag: "HumanExecutorClaimExcluded";
  readonly ticketId: TicketId;
};
```

Human output is exactly `Error: Claiming human-executor Ticket <ticket-id> requires --allow-human.`. JSON mechanically maps `_tag` to `type`, preserves `ticketId`, and adds no prose `message`.

`@urban/task-manager` exposes typed `ClaimExecutorScope`, `ClaimTicketInput`, `ActiveClaimConflict`, `HumanExecutorClaimExcluded`, and `claimTicket(input)`. The operation accepts an effectively unclaimed open Ticket, atomically writes its separate Claim record without modifying the Ticket Snapshot or `updatedAt`, and emits one `TicketClaimed` containing the complete new Claim. Expected failures include typed Store mutation failures, `TicketNotFound`, `TicketInTrash`, `TicketNotOpen`, `ActiveClaimConflict`, and `HumanExecutorClaimExcluded`. Every success changes Claim state; failures and conflicts emit no Activity. `@urban/task-manager-cli` resolves Actor fallback and human confirmation, makes one core call, and renders the composed result.

### `tm renew`

Lean V1 adds dedicated `tm renew <ticket-id> --actor <identity> --claim-id <uuid>` rather than overloading `tm claim`. Renewal requires the matching active Actor Identity and Claim ID, atomically replaces that separate Claim record with a new Claim ID, acquisition time, and one-hour lease window without modifying the Ticket Snapshot or `updatedAt`, and emits one `TicketClaimRenewed` event containing the previous Claim ID and complete new Claim. It returns the exact result and access-function boundary:

```ts
type RenewClaimResult = {
  readonly ticket: OpenTicket;
  readonly claim: Claim;
};

declare const renewClaim: (
  input: RenewClaimInput,
) => Effect.Effect<
  RenewClaimResult,
  | TicketNotFound
  | TicketInTrash
  | TicketNotOpen
  | ClaimRenewalFenceError
  | StoreMutationError,
  TaskManager
>;
```

The result contains the unchanged complete open Ticket and complete new separate Claim. Renewal has one successful state-changing outcome, so the result has no outcome tag and does not duplicate the previous Claim ID already present in the input and durable Activity. JSON is `{ ok: true, ticket, claim }`; human output is exactly `Renewed Claim on <subject> (<ticket-id>) for <actor> until <expires-at> (Claim <claim-id>).`. The previous Claim is not separately released. An absent, expired, other-Actor, or mismatched Claim fails without falling back to acquisition, mutation, or Activity. Renewal does not require `--allow-human` because acquisition already crossed the human boundary.

Renewal fencing uses one exact reason-tagged operation error:

```ts
type ClaimRenewalFenceReason =
  | {
      readonly _tag: "NoActiveClaim";
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ClaimIdMismatch";
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ActorMismatch";
      readonly providedActor: ActorIdentity;
      readonly activeClaim: Claim;
    };

type ClaimRenewalFenceError = {
  readonly _tag: "ClaimRenewalFenceError";
  readonly ticketId: TicketId;
  readonly reason: ClaimRenewalFenceReason;
};
```

The core checks effective active Claim presence, then Claim ID, then Actor Identity and does not aggregate failures. `NoActiveClaim` and `ClaimIdMismatch` return only the provided Claim ID and never reveal a current Claim ID. `ActorMismatch` returns the provided Actor and the complete exactly matched active Claim. Public schema-backed definitions support Effect parent/reason catching and reason unwrapping.

Human renewal-fence output is exact:

- `NoActiveClaim`: `Error: Claim <provided-claim-id> is not active on Ticket <ticket-id>; acquire a new Claim before retrying.`
- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <ticket-id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <ticket-id> is held by <holder>, not <provided-actor>.`

JSON mechanically maps both parent and reason `_tag` fields to `type`, preserves every reason-specific payload, and adds no prose `message`. Rendering uses only typed error data.

`@urban/task-manager` exposes typed `RenewClaimInput`, `ClaimRenewalFenceError`, and `renewClaim(input)`. Expected failures include typed Store mutation failures, `TicketNotFound`, `TicketInTrash`, `TicketNotOpen`, and `ClaimRenewalFenceError`. Every success creates a new Claim incarnation without changing the Ticket; failures emit no Activity. `@urban/task-manager-cli` resolves Actor fallback and exact IDs, makes one core call, and renders the composed result.

### `tm release`

Releasing an open Ticket with no active Claim, including one with only an expired persisted Claim record, returns successful `AlreadyInactive`. It performs no write and emits no Activity. This makes release safely retryable and treats never-claimed, already-released, and expired Claims identically at the semantic boundary. Claim operations never modify the Ticket Snapshot or `updatedAt`, whether release changes Claim state or returns this no-op.

Release returns an exact compact receipt rather than the complete Ticket:

```ts
type ReleaseClaimResult =
  | {
      readonly _tag: "Released";
      readonly ticketId: TicketId;
      readonly claimId: ClaimId;
    }
  | {
      readonly _tag: "AlreadyInactive";
      readonly ticketId: TicketId;
    };

declare const releaseClaim: (
  input: ReleaseClaimInput,
) => Effect.Effect<
  ReleaseClaimResult,
  | TicketNotFound
  | TicketInTrash
  | TicketNotOpen
  | ClaimReleaseFenceError
  | StoreMutationError,
  TaskManager
>;
```

JSON maps the core tags to flat adapter outcomes: `{ "ok": true, "outcome": "released", "ticketId": <id>, "claimId": <id> }` and `{ "ok": true, "outcome": "already-inactive", "ticketId": <id> }`. Human output is exactly `Released Claim <claim-id> from Ticket <ticket-id>.` and `Claim on Ticket <ticket-id> is already inactive.`. The CLI does not expose core `_tag` values or require consumers to infer the outcome from field presence.

Release is open-only, and lifecycle eligibility precedes no-op detection. Done and cancelled Tickets fail with typed `TicketNotOpen`; Trash-reserved IDs fail with `TicketInTrash`; unknown IDs fail with `TicketNotFound`. Only an open Ticket without an active Claim returns `AlreadyInactive`.

Release of an active Claim requires both matching Actor Identity and matching Claim ID. Actor Identity alone is insufficient because it may be reused across Claim incarnations. Another Actor cannot release or reassign the Claim before expiry. Successful release emits one attributed `TicketClaimReleased` Activity item containing the released Claim ID; the earlier Claim Activity retains the complete lease details.

For an active Claim, release validates the supplied Claim ID before comparing Actor Identity. Release fencing uses one exact reason-tagged operation error:

```ts
type ClaimReleaseFenceReason =
  | {
      readonly _tag: "ClaimIdMismatch";
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ActorMismatch";
      readonly providedActor: ActorIdentity;
      readonly activeClaim: Claim;
    };

type ClaimReleaseFenceError = {
  readonly _tag: "ClaimReleaseFenceError";
  readonly ticketId: TicketId;
  readonly reason: ClaimReleaseFenceReason;
};
```

A stale Claim ID returns `ClaimIdMismatch` even when the current holder also differs. It contains only the provided ID and never reveals the current Claim ID. Once the Claim ID matches, another Actor receives `ActorMismatch`, containing the provided Actor and complete exactly matched active Claim. The Claim ID within `activeClaim` is the already matched provided incarnation, not an additional current-Claim disclosure. `ActorMismatch` does not duplicate it as `providedClaimId`. Errors are not aggregated. No `NoActiveClaim` reason exists because an open Ticket without an effective active Claim returns successful `AlreadyInactive`. Public schema-backed definitions support Effect parent/reason catching and reason unwrapping.

Human release-fence output is exact:

- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <ticket-id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <ticket-id> is held by <holder>, not <provided-actor>.`

JSON mechanically maps both parent and reason `_tag` fields to `type`, preserves every reason-specific payload, and adds no prose `message`. Rendering uses only typed error data.

Successful completion and cancellation automatically remove the separate target Claim when each operation's Claim fence permits success. Soft deletion cannot begin while any selected Ticket has an active Claim, so it consumes none; it moves Snapshots to Trash and preserves any surviving parent's separately fenced Claim. Each operation emits only its operation-specific Activity per changed Ticket, not an additional `TicketClaimReleased` item. A failed lifecycle transition or deletion changes neither active Tickets nor Claims or Trash.

`tm release` always requires `--claim-id <uuid>` at the CLI boundary, and `ReleaseClaimInput` always contains a Claim ID. Release targets one observed Claim incarnation rather than acting as an unfenced ensure-inactive operation. The requirement remains even when the transaction returns `AlreadyInactive`: holders retain the Claim ID for retries and expired-Claim release attempts, while a never-claimed Ticket has no valid release request. If another active Claim has replaced the observed incarnation, the supplied Claim ID fails transaction-current validation.

When no active Claim exists, `AlreadyInactive` does not validate the supplied Claim ID against an expired persisted Claim or historical Activity. Expired Claims are semantically absent, and an already-released Claim record is no longer present; release does not make those persistence representations observably different. A syntactically valid but unrelated Claim ID therefore also receives `AlreadyInactive` when no active Claim exists, while it cannot release or bypass a newer active Claim.

`@urban/task-manager` exposes required `ReleaseClaimInput { ticketId, actor, claimId }`, `Released | AlreadyInactive`, the exact `ClaimReleaseFenceError` above, and `releaseClaim(input)`. Expected failures are typed Store mutation failures, `TicketNotFound`, `TicketInTrash`, `TicketNotOpen`, and `ClaimReleaseFenceError`. The core removes only the separate Claim record and emits Activity atomically; it never modifies the Ticket Snapshot.

`@urban/task-manager-cli` exposes `tm release <ticket-id> --actor <identity> --claim-id <uuid>` with Actor fallback from `TM_ACTOR` and shared Store/JSON flags. It decodes exact IDs, makes one core call, and renders the compact receipt without reproducing lifecycle or fencing rules.

### `tm complete` (reviewed)

Completion is non-cascading and requires every descendant to be terminal. Any open descendant prevents completion whether claimed or unclaimed; completion never manufactures Results for descendants.

Completion also requires every direct dependency to be terminal. Done and cancelled dependencies both satisfy this invariant, matching `tm next`; any open direct dependency fails with typed `OpenDependencies` without changing the Ticket, separate Claim record, timestamps, or Activity.

Lean V1 does not permit completion through an open dependency and exposes no `--force` flag. If a dependency relation is no longer correct, callers use `tm unblock`; if the prerequisite work is intentionally abandoned, callers use `tm cancel`. Completion therefore cannot produce a done Ticket that remains blocked by an open prerequisite.

Completion always requires an active Claim with the matching Actor Identity and exact current Claim ID. The CLI requires `--claim-id`, and `CompleteTicketInput` contains a required `claimId` rather than `TargetClaimFence`; completion cannot express an unclaimed mutation. An unclaimed, released, or logically expired target fails with `NoActiveClaim`, while a stale ID fails with `ClaimIdMismatch` and an exact ID held by another Actor fails with `ActorMismatch`. The successful completion transaction removes the separate Claim and emits only `TicketCompleted` with `Consumed { claimId }`, not a separate `TicketClaimReleased` item.

Claim expiry for completion is linearized at one core-owned occurrence time sampled after the `BEGIN IMMEDIATE` transaction has acquired its writer position. That same instant becomes the done Ticket's `completedAt` and common Activity `occurredAt`. A transaction that reaches this instant after the lease expired fails with `NoActiveClaim`; a Claim active at this instant remains valid for that completion even if wall-clock time passes its expiry before the physical commit finishes. Completion performs no second expiry check before commit.

All other completion races are resolved by serialized writer-position order and transaction-current revalidation, without an automatic retry:

| Race                                               | Competing mutation commits before completion                                                                               | Completion commits first                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Release of `C1`                                    | Completion with `C1` fails `NoActiveClaim`                                                                                 | Later release observes the terminal Ticket and fails `TicketNotOpen`                                                              |
| Renewal of `C1` to `C2`                            | Completion with `C1` fails `ClaimIdMismatch`                                                                               | Later renewal observes the terminal Ticket and fails `TicketNotOpen`                                                              |
| Fresh replacement `C2` after `C1` expires          | Completion with `C1` fails `ClaimIdMismatch`, including when both Claims use the same Actor Identity                       | Later acquisition observes the terminal Ticket and fails `TicketNotOpen`                                                          |
| Effective Executor update versus Claim acquisition | An update committed while unclaimed determines the Executor observed by the later Claim and completion                     | Acquisition committed first freezes Executor and the effective update fails atomically                                            |
| Child creation beneath the target                  | Completion observes the new open descendant and fails `OpenDescendants`                                                    | Later creation observes a terminal parent and fails parent lifecycle eligibility                                                  |
| Dependency addition or removal on the target       | Completion observes the committed relationship set; an added open dependency blocks it, while removal may make it eligible | A later dependency mutation observes the terminal target and fails lifecycle eligibility                                          |
| Descendant or dependency lifecycle transition      | A committed terminal transition may remove the blocker                                                                     | Completion that observes the blocker rejects without waiting; the caller must reread and retry after the other transition commits |

The same rule protects the CLI human-confirmation pre-read. That read neither reserves the Ticket nor establishes race precedence. An effective Executor transition requires release or expiry of the observed Claim, an unclaimed update, and a fresh Claim; therefore completion with the pre-read Claim ID fails `NoActiveClaim` or `ClaimIdMismatch` instead of completing against the later Executor state. CLI and core perform no automatic retry after a race rejection.

The exact compact core input is:

```ts
type CompleteTicketInput = {
  readonly ticketId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimId: ClaimId;
  readonly result: Result;
};
```

Callers construct the canonical Result through exported core schemas or constructors, and the public operation still validates runtime input defensively. The input contains no target-fence union, adapter confirmation, expected Executor, caller-supplied completion time, or generic bypass. The core owns completion time.

The public access function is exact:

```ts
declare const completeTicket: (
  input: CompleteTicketInput,
) => Effect.Effect<
  DoneTicket,
  CompletionRejected | TicketNotFound | TicketInTrash | StoreMutationError,
  TaskManager
>;
```

`completeTicket(input)` returns the canonical `DoneTicket` directly. Completion has exactly one successful outcome and always changes state, so the core exposes no single-case outcome tag, wrapper receipt, no-op variant, duplicate consumed Claim ID, Activity payload, or Activity Cursor. A repeated completion fails lifecycle eligibility rather than replaying success. The returned done Snapshot contains Result plus sibling `completedAt` and `completedBy`; terminal integrity guarantees that no active Claim remains.

`TicketCompleted` contains only the semantic completion payload beyond common Activity fields:

```ts
type TicketCompleted = {
  readonly _tag: "TicketCompleted";
  readonly result: Result;
  readonly claimConsumption: {
    readonly _tag: "Consumed";
    readonly claimId: ClaimId;
  };
};
```

The event cannot represent unclaimed completion and does not embed the complete Claim or duplicate the complete resulting Ticket. Its common `occurredAt`, `actor`, and `ticketId` exactly equal the done Ticket's `completedAt`, `completedBy`, and `id`, and its Result equals the done Ticket Result. Unchanged Subject, Description, Context, Executor, hierarchy, dependencies, and creation time remain Snapshot facts rather than completion-event payload.

Human success output is exactly `Completed <subject> (<ticket-id>).`. It does not echo summary, details, application-owned data, Claim consumption, or Activity. JSON success is `{ "ok": true, "ticket": <complete DoneTicket> }`; the actual `ticket` value is the encoded object, optional Result fields are omitted when absent, and no active Claim is embedded. JSON adds no redundant outcome, consumed Claim ID, Activity payload, or Cursor.

The base CLI requires `--allow-human` only when directly completing a human-executor target. Human-executor ancestors, descendants, dependencies, dependents, and other graph observers require no completion confirmation merely because their derived readiness or presentation changes. An open human dependency still blocks completion categorically because it is open; `--allow-human` cannot satisfy or bypass it. The flag is an adapter acknowledgment of the direct target's Executor, not authorization or a core lifecycle, hierarchy, dependency, Result, or Claim-fence override. Because completion requires an active Claim and Executor cannot change during that Claim, the CLI may read the target Executor for confirmation and then complete with the same Claim ID without an `expectedExecutor` core field. Expiry, release, or renewal invalidates that Claim ID and makes the completion fail rather than apply against a later Executor state.

Result is completion evidence rather than the complete lifecycle-transition record. A done Ticket stores core-owned `completedAt` and caller-supplied `completedBy` as lifecycle metadata alongside its required `result`; neither field is nested inside Result. This keeps the done Snapshot self-describing without consulting Semantic Activity while preventing occurrence time and Actor attribution from being misclassified as evidence. Semantic Activity still records the same occurrence time and Actor Identity through its common attribution.

The current implementation nests `completedAt` and `completedBy` inside Result. Lean V1 must move those fields to the done-Ticket lifecycle variant without deriving them from generic `updatedAt` or requiring consumers to recover them from `TicketCompleted` Activity.

Lean V1 uses one small application-extensible Result shape:

```ts
type Result = {
  readonly summary: ResultSummary;
  readonly details?: ResultDetails;
  readonly data?: JsonValue;
};
```

`summary` is the required human-readable completion account. `details` provides optional additional human-readable context. `data` is an optional application-owned JSON value for consuming or wrapping applications that require a structured completion protocol. The core validates the generic JSON boundary and round-trips the value but does not interpret its schema, discriminator, version, workflow outcome, verification meaning, or consistency with the human-readable fields. Each wrapping application owns its data codec, semantic validation, versioning, and the policy decisions it derives after decoding.

The core Result is not generic over an application type and imposes no universal structured envelope. A wrapper may encode a discriminated and versioned object when its protocol requires one, while another caller may omit `data` entirely.

Result text has one canonical representation. `ResultSummary` trims surrounding whitespace, must remain non-blank, and must be a single line. `ResultDetails` also trims surrounding whitespace and must remain non-blank when supplied, while preserving internal whitespace and line breaks. Omitted details mean no additional human-readable context; explicitly supplied empty or whitespace-only details fail Result decoding rather than silently becoming absent or persisting a present-empty state. The core imposes no subjective vague-summary blacklist: structurally valid text such as `"done"` is accepted, while a wrapping application may enforce stronger writing policy.

The complete Result is measured through one compact canonical JSON encoding. After the approved text normalization, the outer object encodes fields in fixed `summary`, optional `details`, optional `data` order. Data arrays preserve order; data-object keys sort lexicographically by UTF-16 code units. Strings use deterministic JSON escaping, including `\uXXXX` for unpaired UTF-16 surrogates. Finite numbers use ECMAScript's shortest JSON number representation and encode negative zero as `0`. The canonical text is encoded as UTF-8. Exactly 256 KiB (262,144 bytes), including field names and structural overhead, is accepted; one byte over is rejected.

Generic runtime JSON validation is owned by Effect Schema rather than reimplemented as domain code. Under the pinned Effect version, `Schema.Json` already performs iterative stack-safe validation, accepts only null, strings, booleans, finite numbers, arrays, and plain string-keyed objects, rejects sparse arrays, unsupported leaves, non-plain objects, and cycles, and safely accepts reusable acyclic subgraphs. The Result schema composes that capability with the Result text schemas and canonical aggregate-byte check.

Effect's standard JSON-string transformation is not sufficient for the complete contract: the pinned implementation delegates to native `JSON.parse` and `JSON.stringify`, so it does not reject duplicate input object member names, sort object keys canonically, or guarantee stack-safe deterministic encoding at arbitrary accepted depth. The CLI therefore uses a duplicate-aware complete-JSON parser for `--data` and `--data-file`, and the core uses one iterative canonical encoder/byte counter after `Schema.Json` validation. The custom code owns only those missing guarantees and must not duplicate Effect Schema's generic JSON type validation.

The contract has no nesting-depth limit: every valid acyclic `JsonValue` within the aggregate byte bound is accepted regardless of depth. Inline input, file input, and direct core calls all pass through the same Result schema and canonical measurement. Cycles, sparse arrays, `undefined`, non-finite numbers, `bigint`, functions, symbols, non-plain objects, and other non-JSON runtime values fail Result decoding rather than being coerced. Oversized or invalid Result input is rejected before Store and Ticket resolution and has no confirmation or bypass. Duplicate member names in CLI JSON input fail parsing rather than using last-value-wins semantics.

The current implementation's first-class `decisions` and `verification` collections are removed from the core Result. Completion decisions, verification evidence, artifacts, retry instructions, review outcomes, and similar application-specific structures belong in `data` when a wrapping application needs them.

The base CLI also removes repeatable `--verification` and the `--allow-no-verification` confirmation; both are unknown flags. The generic adapter neither imposes a verification protocol nor inspects application-owned `data` to infer one. A wrapping application that requires verification validates its own typed data before calling the core. Removing this adapter policy does not waive Claim fencing, lifecycle, hierarchy, dependency readiness, the human gate, or Result boundary validation.

The base CLI uses field-oriented Result input only:

```text
--summary <text>
[--details <text> | --details-file <path>]
[--data <json> | --data-file <path>]
```

`--summary` is required and inline because it is single-line. Details and data are independently optional; each inline/file pair is mutually exclusive. `--data` parses its argument as one complete JSON value, and `--data-file` reads one complete UTF-8 JSON value. All Result flags are singular and duplicate occurrences fail rather than merge. Application-specific collections belong inside the one JSON value.

The CLI removes `--decision`, `--result-message`, and `--result-message-file` in addition to the verification flags. It exposes no whole-Result `--result` or `--result-file` mode and no `--summary-file`. File loading, JSON parsing, source-conflict checks, and core Result-schema decoding precede a well-formed completion mutation. Every accepted input path constructs the same typed Result and cannot waive its text or aggregate-size invariants.

Completion follows Effect's reason-error pattern: one schema-backed outer `CompletionRejected` error contains a closed union of schema-backed reason variants with reason-specific recovery data.

```ts
type CompletionBlocker = {
  readonly ticketId: TicketId;
  readonly subject: Subject;
  readonly executor: Executor;
  readonly activeClaim?: Claim;
};

type CompletionOpenDescendants = {
  readonly _tag: "OpenDescendants";
  readonly tickets: NonEmptyReadonlyArray<CompletionBlocker>;
};

type CompletionOpenDependencies = {
  readonly _tag: "OpenDependencies";
  readonly tickets: NonEmptyReadonlyArray<CompletionBlocker>;
};

type CompletionRejectionReason =
  | TicketNotOpenReason
  | NoActiveClaim
  | ClaimIdMismatch
  | ActorMismatch
  | CompletionOpenDescendants
  | CompletionOpenDependencies;

type CompletionRejected = {
  readonly _tag: "CompletionRejected";
  readonly ticketId: TicketId;
  readonly reason: CompletionRejectionReason;
};
```

The actual public definitions use Effect Schema error classes so callers may handle the parent with `Effect.catchTag`, handle nested reasons with `Effect.catchReason` or `Effect.catchReasons`, or use `Effect.unwrapReason`. Each reason owns its human-readable message and only the recovery fields meaningful to that reason; the parent exposes the target Ticket ID and delegates its cause to the reason. Task Manager adds no generic retryability flag because recovery is reason-specific.

`ClaimIdMismatch` deliberately returns only the provided stale Claim ID, never the current active Claim ID; recovering the current fence requires an explicit reread. `ActorMismatch` may return the complete active Claim because the provided Claim ID already exactly matched that incarnation. Open-descendant blockers are returned in canonical tree order; open direct dependencies are ordered by ascending Ticket ID. Both return every blocker with ID, Subject, Executor, and optional complete effective active Claim; expired Claims are omitted.

This wrapper covers completion lifecycle, Claim, hierarchy, and dependency rejection after a well-formed input and resolved Ticket. Shared invalid-input, Store mutation, `TicketNotFound`, and `TicketInTrash` failures remain distinct because they occur outside that resolved operation-invariant boundary.

The CLI mechanically maps the outer and nested Effect `_tag` fields to JSON `type` fields while preserving every reason-specific payload field and omitting a duplicate human message:

```json
{
  "ok": false,
  "error": {
    "type": "CompletionRejected",
    "ticketId": "abc123",
    "reason": {
      "type": "OpenDependencies",
      "tickets": [
        {
          "ticketId": "def456",
          "subject": "Finish prerequisite",
          "executor": "agent"
        }
      ]
    }
  }
}
```

Non-empty collection schemas prevent a blocker reason from encoding an empty `tickets` array.

Human reason rendering is exact:

- `TicketNotOpen`: `Error: Ticket <id> is <status> and cannot be completed.`
- `NoActiveClaim`: `Error: Claim <provided-claim-id> is not active on Ticket <id>; acquire a Claim before completing it.`
- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <id> is held by <holder>, not <provided-actor>.`
- `OpenDescendants`: first line `Error: Ticket <id> has open descendants:` followed by all blocker lines.
- `OpenDependencies`: first line `Error: Ticket <id> has open dependencies:` followed by all blocker lines.

An unclaimed blocker line is exactly `- <blocker-id>: <subject> (executor: <executor>)`. A claimed blocker line is exactly `- <blocker-id>: <subject> (executor: <executor>; Claim <claim-id> held by <actor> until <expires-at>)`. The CLI obtains these strings from the typed reason data and does not recompute rejection rules.

Completion validation is fail-fast and never aggregates errors. Adapter and public-input boundary precedence is:

1. CLI syntax and required flags;
2. inline/file source conflicts and file loading;
3. JSON parsing;
4. Ticket ID, Claim ID, Actor Identity, Result text, JSON validity, and 256 KiB Result decoding;
5. Ticket pre-read for the human-target acknowledgment;
6. `--allow-human` when that pre-read finds an open human-executor target.

The core then re-resolves transaction-current state in this order:

1. Store and exact Ticket resolution, including shared Store failures, `TicketNotFound`, and `TicketInTrash`;
2. lifecycle eligibility, producing `CompletionRejected(TicketNotOpen)`;
3. required active Claim, producing `NoActiveClaim`, then `ClaimIdMismatch`, then `ActorMismatch` by first failed check;
4. complete hierarchy validation, producing `OpenDescendants`;
5. direct dependency validation, producing `OpenDependencies`;
6. one atomic completion transaction producing the done Snapshot, required Claim removal, and one `TicketCompleted` Activity item.

Accordingly, invalid Result beats missing Store; an open human target missing `--allow-human` beats a stale Claim; terminal lifecycle beats Claim state; no active Claim beats open descendants; Claim ID mismatch beats Actor mismatch; exact Claim ID with the wrong Actor produces Actor mismatch; and open descendants beat open dependencies. A failure at any stage leaves Ticket, Claim, timestamps, and Activity unchanged.

Completion failure atomicity has bounded Lean V1 qualification. Adapter Result/input rejection occurs before a core mutation request. Store/Ticket resolution, lifecycle, Claim, hierarchy, and dependency rejection performs no write. For persistence rollback, one deterministic private test barrier fails a real file-backed completion after the done Snapshot, Claim removal, lifecycle timestamps, and `TicketCompleted` insertion have executed inside the transaction but before `COMMIT`. After closing and reopening the Store, the test must prove the original open Ticket Snapshot is unchanged, the exact Claim remains unchanged and active, no Result or completion timestamp exists, Activity high-water is unchanged, neither completion nor release Activity exists, and a retry with the same Claim can complete normally.

This is one bounded rollback/reopen smoke test rather than fault injection after every SQL statement or commit phase. A failure known to occur before the `COMMIT` attempt must roll back completely. An error whose physical commit outcome is unknown retains Lean V1's global reread-and-reconcile rule; the completion contract does not misclassify that outcome as a proven rollback.

#### Current implementation migration delta

The existing JSONL implementation is migration evidence, not normative compatibility surface. Lean V1 replaces it as follows:

| Area                       | Current implementation                                                                                                                                                                                                                                                             | Required Lean V1 migration                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI flags and help         | Optional `--summary`; inline `--details`; repeatable `--decision` and `--verification`; `--result-message` or `--result-message-file`; `--allow-no-verification`; `--force`; and broadly described `--allow-human`. No `--claim-id`, `--details-file`, `--data`, or `--data-file`. | Require singular `--summary` and `--claim-id`; add singular `--details-file`, `--data`, and `--data-file`; retain `--allow-human` only for the direct human target; remove every legacy, verification, and force flag from help and reject it as unknown.                                            |
| Result parsing             | `complete-input.ts` parses Git-style whole messages, merges repeatable collections, cleans empty items, rejects a built-in vague-summary list, and requires verification unless bypassed. Details always resolve to a string.                                                      | Delete those parsing paths. Resolve only field-oriented inline/file sources, parse one complete generic JSON value, accept structurally valid summaries such as `"done"`, preserve absent details, reject supplied blank details, and decode every path through the canonical bounded Result schema. |
| Claim eligibility          | Completion permits an unclaimed Ticket and a same-Actor embedded Claim without a Claim ID. Only another Actor's active Claim blocks, and `--force` bypasses it.                                                                                                                    | Require a transaction-current separate active Claim on every completion. Match exact Claim ID before Actor Identity, reject absent, released, expired, stale, or other-Actor Claims through typed reasons, and expose no bypass.                                                                     |
| Claim persistence          | Claim is embedded in the Ticket, has no Claim ID, and Claim changes update the Ticket. Completion drops the embedded field as part of rewriting the Ticket.                                                                                                                        | Persist Claim separately with its UUID Claim ID. Completion atomically consumes exactly that record without treating Claim churn as a Ticket update or emitting release Activity.                                                                                                                    |
| Executor race              | The current holder may complete after a CLI pre-read while Executor and Claim are part of one mutable Ticket record; no active-Claim Executor-freeze contract exists.                                                                                                              | Freeze effective Executor transitions while any Claim is active. Executor handoff requires release or expiry, unclaimed update, and fresh acquisition, making completion's required Claim ID fence the confirmation pre-read.                                                                        |
| Hierarchy and dependencies | The CLI checks only open direct children, treats cancelled dependencies as incomplete, and lets `--force` bypass open dependencies. Checks occur on a JSONL read before the publication lock.                                                                                      | In one `BEGIN IMMEDIATE` operation, reject every open descendant, treat done and cancelled direct dependencies as satisfied, reject every open dependency categorically, and resolve all races from transaction-current state.                                                                       |
| Domain and lifecycle shape | `TicketResultSchema` requires string details, decisions, verification, and nested `completedAt`/`completedBy`; each Ticket embeds Claim and `schemaVersion`. The local `completeTicket` helper accepts a Ticket plus decomposed fields and caller-supplied time.                   | Core owns canonical `Result { summary, details?, data? }`, separate Claim state, and done-Ticket sibling `completedAt`/`completedBy`; `CompleteTicketInput` is exactly `{ ticketId, actor, claimId, result }`; the core owns time and returns `DoneTicket` directly.                                 |
| Core operation and errors  | The CLI loads and rewrites the whole Store, performs domain checks itself, calls a pure Ticket helper, and reports generic `CommandFailure` messages. There is no typed completion service operation.                                                                              | Move resolution, ordered invariants, mutation, and Activity into typed `completeTicket`. Use distinct boundary/Store/lookup failures plus schema-backed `CompletionRejected` with the approved closed reason union.                                                                                  |
| Success output             | Human success prints completion, Summary, and Verification lines. JSON returns the complete Ticket in the old encoded lifecycle shape. Shared `show` rendering expects the old Result fields.                                                                                      | Human success is one exact line. JSON returns the complete canonical done Snapshot only. Shared lifecycle rendering must read sibling completion metadata and optional Result fields without restoring removed verification semantics.                                                               |
| Failure output             | Human errors prepend `Error:` to generic strings; JSON returns `{ type, message }`. Claim conflicts can instruct callers to use `--force`.                                                                                                                                         | Render the approved exact reason-specific human lines and blocker lists. JSON maps outer and nested `_tag` to `type`, preserves structured recovery payloads, omits duplicate messages, and never recommends force.                                                                                  |
| Activity and atomicity     | No Semantic Activity exists. JSONL load/check/rewrite is not one transaction-current Ticket/Claim/Activity mutation, and the write lock covers publication after the read.                                                                                                         | Commit the done Snapshot, exact Claim consumption, lifecycle timestamps, and one `TicketCompleted { result, claimConsumption: Consumed { claimId } }` atomically; emit no release event and qualify rollback/reopen behavior.                                                                        |

The twelve current `cli-complete.test.ts` cases are not a compatibility suite. Tests for Git-style result messages, message files, repeatable decisions and verification, mandatory verification, `--allow-no-verification`, force through open dependencies or human dependencies, non-holder forced completion, and embedded Claim clearing become obsolete and must be removed or rewritten. The remaining Actor, summary, human-target, hierarchy, visibility, and show scenarios must be rewritten against required Claim acquisition and Claim ID, the canonical Result/lifecycle shape, exact output, typed errors, complete descendant checks, and cancelled-dependency readiness. New public-boundary coverage must add inline/file details and data, duplicate/source conflicts, JSON primitives and invalid JSON, aggregate size and stack-safe depth, every required-Claim reason and precedence, same-Actor stale Claim IDs, Activity payload and absence of release Activity, the approved race matrix, and bounded rollback/reopen proof.

Related fixtures and assertions outside that file also migrate: `cli-test-support.ts`, `cli-validation.test.ts`, and `cli-commands.test.ts` construct or inspect the old embedded completion shape; `shared/output.ts` renders old Result collections and nested completion metadata; `shared/tickets.ts` emits force guidance; and pre-Lean CLI documentation records removed complete flags and bypass behavior. These references must change during implementation but do not alter this Lean V1 contract.

The `tm complete` contract is fully approved.

### `tm cancel` (reviewed)

Cancellation scope is explicit and transaction-current:

```ts
type CancellationScope =
  | { readonly _tag: "TargetOnly" }
  | { readonly _tag: "CascadeOpenDescendants" };
```

The CLI removes generic `--yes` and adds `--cascade`. Omitting `--cascade` maps to `TargetOnly`; if any open descendant exists when the mutation holds its `BEGIN IMMEDIATE` writer position, cancellation rejects without changing any Ticket, Claim, timestamp, or Activity. Supplying `--cascade` maps to `CascadeOpenDescendants` and atomically includes every transaction-current open descendant, including one created after the CLI constructed its core request. Done and already-cancelled descendants remain unchanged.

`--cascade` acknowledges a category of transaction-current impact rather than binding to any caller-observed ID set. The CLI neither reserves the subtree nor determines the affected set. `CancelTicketInput` carries `CancellationScope`, not a raw `yes` boolean or descendant Claim-fence collection. Claim blockers and all other cancellation invariants remain transaction-current and cannot be waived by scope selection.

Human-executor scope is also transaction-current:

```ts
type CancellationExecutorScope = { readonly _tag: "AgentOnly" } | { readonly _tag: "AnyExecutor" };
```

Omitting CLI `--allow-human` maps to `AgentOnly`; the core rejects if any Ticket that this invocation would actually cancel is human-executor. Supplying `--allow-human` maps to `AnyExecutor`. The affected set contains the direct target and, under `CascadeOpenDescendants`, every open descendant being cancelled. Done and already-cancelled descendants, ancestors, dependencies, dependents, and other graph observers are excluded because the operation does not mutate them.

This semantic constraint prevents an agent-only pre-read from authorizing a human Ticket created or changed before the writer transaction. It is not authentication or authorization: direct core callers select their intended Executor scope, while the CLI owns whether selecting `AnyExecutor` requires acknowledgment. The core receives no raw `allowHuman` boolean.

Cancellation is a strict open-only lifecycle transition for the explicit target. It does not require prior Claim acquisition: an unclaimed target is cancelled through `RequireUnclaimed`, while an actively claimed target may be cancelled only by its matching holder through `MatchClaim { claimId }`. If an active Claim appears before an unclaimed cancellation reaches its transaction, the request fails `ActiveClaimRequiresFence`; this describes a failed unclaimed-state assertion, not a universal Claim prerequisite. A done or already-cancelled target fails typed `TicketNotOpen`; cancellation has no terminal no-op, same-request replay, or history-rewriting path. Lifecycle eligibility precedes target Claim fencing, cascade scope, Executor scope, and other cancellation invariants. Done and already-cancelled descendants remain unchanged under a valid cascade because they are not transition targets. After an uncertain commit outcome, callers reread rather than treating a repeated cancellation as replayed success.

Cancellation is represented directly by the cancelled lifecycle variant:

```ts
type CancelledTicket = TicketBase & {
  readonly status: "cancelled";
  readonly reason: CancellationReason;
  readonly cancelledAt: DateTime.Utc;
  readonly cancelledBy: ActorIdentity;
};
```

The CLI supplies the canonical reason and Actor Identity; the core owns one occurrence time and constructs the complete cancelled Snapshot. Every Ticket changed by one cascade receives the same `reason`, `cancelledAt`, and `cancelledBy`, and each changed Ticket's `updatedAt` equals that `cancelledAt`. Separate Claim state is never embedded in the cancelled Snapshot. Result remains nested because it is a genuine multi-field application-extensible completion account; cancellation has one operation-specific value, so a single-field `cancellation` wrapper would add no domain information.

`CancellationReason` trims surrounding whitespace, must remain non-blank, and may contain internal whitespace and line breaks. Its normalized UTF-8 encoding may contain at most 16 KiB (16,384 bytes); the exact limit is accepted and one byte over is rejected. The bound limits multiplication across every changed Snapshot and Activity item in a cascade. The core schema owns normalization and validation for every caller.

The CLI retains singular mutually exclusive `--reason <text>` and `--reason-file <path>`. It resolves the inline or complete UTF-8 file source before constructing a core request. Missing, blank, unreadable, conflicting, duplicate, or oversized reason input fails before Store and Ticket resolution and changes no Ticket, Claim, timestamp, or Activity. There is no confirmation or bypass for reason validity.

`cancelTicket(input)` returns the complete canonical changed Snapshots without Activity metadata or duplication:

```ts
type CancelTicketResult = {
  readonly target: CancelledTicket;
  readonly cancelledDescendants: ReadonlyArray<CancelledTicket>;
};

declare const cancelTicket: (
  input: CancelTicketInput,
) => Effect.Effect<
  CancelTicketResult,
  CancellationRejected | TicketNotFound | TicketInTrash | StoreMutationError,
  TaskManager
>;
```

`target` is always the explicitly requested Ticket. `cancelledDescendants` contains exactly the open descendants changed by this invocation in canonical tree order and is empty for target-only or leaf cancellation. Done and already-cancelled descendants are absent because they were unchanged. Consumers need no positional convention or Store reread to distinguish direct and cascade effects; Activity Cursors and Claim-consumption audit data remain Semantic Activity facts rather than mutation-result fields.

Human leaf success is exactly `Cancelled <subject> (<ticket-id>).`. Cascade success reports the actual committed changed set without echoing the potentially multiline reason. Its first line is `Cancelled <subject> (<ticket-id>) and 1 descendant Ticket:` for one descendant or `Cancelled <subject> (<ticket-id>) and <n> descendant Tickets:` otherwise, followed by each changed descendant in canonical tree order as `- <descendant-subject> (<descendant-id>)`. The target is named only in the heading.

JSON success is `{ "ok": true, "ticket": <complete target CancelledTicket>, "cancelledDescendants": [<complete changed descendant Snapshots>] }`. The array is always present and empty for leaf or target-only cancellation. JSON adds no outcome tag, duplicate target, reason outside the Snapshot, active Claim, Claim-consumption field, Activity payload, or Cursor. Both renderings derive only from `CancelTicketResult` without rereading the Store or recomputing the cascade.

Cancellation emits one minimal semantic Activity item per changed Ticket:

```ts
type TicketCancelled = {
  readonly _tag: "TicketCancelled";
  readonly reason: CancellationReason;
  readonly claimConsumption: ClaimConsumption;
};
```

The explicit target records `Unclaimed` when cancelled through `RequireUnclaimed` or `Consumed { claimId }` when its exact active Claim is fenced and removed. Every cascaded descendant records `Unclaimed`; any active descendant Claim rejects the entire transaction before mutation. Removing an expired persisted Claim representation does not turn it into active Claim consumption. No successful cancellation emits `TicketClaimReleased`.

A cascade emits the target item first and descendant items in canonical tree order, atomically with every changed Snapshot and Claim removal. All items share the core-owned occurrence time, Actor Identity, and canonical reason. Each common Activity `occurredAt`, `actor`, and `ticketId` equals the corresponding Snapshot's `cancelledAt`, `cancelledBy`, and `id`; the event reason equals the Snapshot's `reason`. The event does not duplicate cancellation metadata, unchanged Snapshot fields, or the removed complete Claim.

For a well-formed core cancellation request, validation is fail-fast. After Store/Ticket resolution, target lifecycle, and the explicit target Claim fence, `TargetOnly` rejects when any transaction-current open descendant exists. It returns every open descendant in canonical tree order without evaluating descendant Claims or Executor scope because those Tickets were not selected as mutation targets. Under `CascadeOpenDescendants`, the core instead checks all active descendant Claims and then enforces `CancellationExecutorScope` against the complete changed set before mutation. Errors are not aggregated.

This scope-first branch prevents callers from having to release descendant Claims or acknowledge human descendants before learning that cascade scope itself is absent. Once cascade is selected, claimed-descendant recovery precedes Executor-scope recovery. Reason decoding and CLI source/flag validation remain earlier adapter and public-boundary concerns.

Cancellation linearizes every Claim-expiry decision at one core-owned occurrence time sampled after the `BEGIN IMMEDIATE` transaction acquires its writer position. That same instant becomes every changed Snapshot's `cancelledAt` and `updatedAt` and every emitted Activity item's `occurredAt`. A target Claim matched and active at that instant may be consumed even if wall-clock expiry passes before physical commit finishes; `RequireUnclaimed` fails `ActiveClaimRequiresFence` when the target Claim is active then. Any descendant Claim active at that instant blocks a cascade. Claims expired by then are semantically absent and any stale persisted representation removed by success records `Unclaimed`. Cancellation performs no second expiry check before commit.

All other cancellation races are resolved by serialized writer-position order and transaction-current revalidation without automatic retry. Claim acquisition committed before unclaimed cancellation produces `ActiveClaimRequiresFence`; cancellation committed first makes later acquisition fail `TicketNotOpen`. Release before `MatchClaim(C1)` produces `NoActiveClaim`; renewal or replacement with `C2` first produces `ClaimIdMismatch` even for the same Actor; cancellation first makes the later Claim mutation fail lifecycle. A descendant acquisition committed first produces `ClaimedDescendants`, while a completed cascade makes later acquisition fail lifecycle.

Child creation committed first is observed by cancellation: `TargetOnly` rejects and `CascadeOpenDescendants` includes the new child subject to the remaining invariants. Cancellation committed first makes later creation fail against the terminal parent. An Executor update committed first determines transaction-current Executor scope; cancellation committed first makes the update fail lifecycle. Dependency relationship changes do not block cancellation: a relationship mutation committed first is observed but remains irrelevant to cancellation eligibility, while cancellation committed first makes a later direct relationship mutation of the terminal target fail lifecycle. Derived readiness changes require no fences from dependents or other graph observers.

A rejected cancellation does not wait for or automatically retry after a competing mutation. The command's scope and Executor acknowledgments reserve neither target nor subtree; callers reread and retry explicitly.

Resolved cancellation-invariant failures use one schema-backed outer error and a closed schema-backed reason union:

```ts
type CancellationTicketSummary = {
  readonly ticketId: TicketId;
  readonly subject: Subject;
  readonly executor: Executor;
};

type CancellationClaimedTicketSummary = CancellationTicketSummary & {
  readonly activeClaim: Claim;
};

type CancellationOpenDescendants = {
  readonly _tag: "OpenDescendants";
  readonly tickets: NonEmptyReadonlyArray<CancellationTicketSummary>;
};

type CancellationClaimedDescendants = {
  readonly _tag: "ClaimedDescendants";
  readonly tickets: NonEmptyReadonlyArray<CancellationClaimedTicketSummary>;
};

type CancellationHumanTicketsExcluded = {
  readonly _tag: "HumanTicketsExcluded";
  readonly tickets: NonEmptyReadonlyArray<CancellationTicketSummary>;
};

type CancellationRejectionReason =
  | TicketNotOpenReason
  | ActiveClaimRequiresFence
  | NoActiveClaim
  | ClaimIdMismatch
  | ActorMismatch
  | CancellationOpenDescendants
  | CancellationClaimedDescendants
  | CancellationHumanTicketsExcluded;

type CancellationRejected = {
  readonly _tag: "CancellationRejected";
  readonly ticketId: TicketId;
  readonly reason: CancellationRejectionReason;
};
```

The public definitions use Effect Schema error classes. Callers may catch the parent with `Effect.catchTag`, handle nested reasons with `Effect.catchReason` or `Effect.catchReasons`, and use `Effect.unwrapReason`; the parent delegates its cause to the reason. Invalid Ticket ID, Claim ID, Actor, reason, cancellation scope, or Executor scope; shared Store mutation failures; `TicketNotFound`; and `TicketInTrash` remain distinct because they occur outside the resolved operation-invariant boundary. Task Manager exposes no generic retryability field; recovery follows the selected reason.

Cancellation rejection payloads are recovery-specific. `TicketNotOpen` contains terminal status. `ActiveClaimRequiresFence` adds no active Claim data and requires a reread. `NoActiveClaim` and `ClaimIdMismatch` contain only the provided Claim ID and never reveal a current Claim ID. `ActorMismatch` contains the provided Actor and complete exactly matched active Claim. `OpenDescendants` contains every open descendant's Ticket ID, Subject, and Executor in canonical tree order without inspecting or returning Claims. `ClaimedDescendants` contains every blocking descendant's Ticket ID, Subject, Executor, and complete active Claim in canonical tree order. `HumanTicketsExcluded` contains every affected human Ticket's ID, Subject, and Executor, with the explicit target first when applicable followed by descendants in canonical tree order. Every collection is schema-enforced non-empty.

Human reason rendering is exact:

- `TicketNotOpen`: `Error: Ticket <id> is <status> and cannot be cancelled.`
- `ActiveClaimRequiresFence`: `Error: Ticket <id> has an active Claim; reread the Ticket and pass --claim-id to cancel it.`
- `NoActiveClaim`: `Error: Claim <provided-id> is not active on Ticket <id>; reread the Ticket before retrying.`
- `ClaimIdMismatch`: `Error: Claim <provided-id> does not match the active Claim on Ticket <id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <id> is held by <holder>, not <provided-actor>.`
- `OpenDescendants`: `Error: Ticket <id> has open descendants; pass --cascade to cancel them:`
- `ClaimedDescendants`: `Error: Ticket <id> has actively claimed descendants:`
- `HumanTicketsExcluded`: `Error: Cancellation would include human-executor Tickets; pass --allow-human to continue:`

An ordinary summary line is `- <id>: <subject> (executor: <executor>)`. A claimed-descendant line is `- <id>: <subject> (executor: <executor>; Claim <claim-id> held by <actor> until <expires-at>)`. JSON mechanically maps the outer and nested Effect `_tag` fields to `type`, preserves all reason-specific payload fields and ordering, and omits duplicate human messages. The CLI renders only typed reason data and never rereads the Store or recomputes a failure.

Cancellation failure atomicity includes one bounded multi-Ticket rollback/reopen qualification. A real file-backed cascade starts with an exactly claimed open target, at least two open unclaimed descendants, unchanged terminal descendants, and a known Activity high-water. A private deterministic failure is injected after target and at least one descendant Snapshot/Activity effect execute inside the transaction but before the complete changed set or `COMMIT` attempt finishes. After closing and reopening, every previously open Snapshot must remain unchanged and open, the exact target Claim must remain active and unchanged, terminal descendants must remain unchanged, no Cancellation reason or timestamp may persist, Activity high-water must be unchanged, no cancellation or release Activity may exist, and retry with the same target Claim must successfully cancel the complete eligible subtree.

This is one cancellation-specific mid-cascade proof, not injection after every Ticket, Claim, Activity, or commit phase. Every failure known to occur before the `COMMIT` attempt must roll back all target and descendant state. An error with unknown physical commit outcome retains Lean V1's reread-and-reconcile rule rather than being reported as a proven rollback. Adapter input, source, and confirmation failures occur before a core mutation and likewise change nothing.

#### Current cancellation implementation migration delta

The existing JSONL cancellation implementation is migration evidence, not normative compatibility surface:

| Area                   | Current implementation                                                                                                                           | Required Lean V1 migration                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI flags and help     | Exposes `--reason`, `--reason-file`, Actor fallback, `--force`, generic `--yes`, and `--allow-human`; no `--claim-id` or `--cascade`.            | Retain singular reason sources, Actor fallback, and `--allow-human`; add optional `--claim-id` and semantic `--cascade`; remove `--force` and `--yes` from help and reject them as unknown.                                    |
| Reason input           | Trims and rejects blank inline/file text with no size bound.                                                                                     | Decode one canonical `CancellationReason`, reject duplicate/conflicting sources, preserve internal multiline text, and enforce the exact 16 KiB UTF-8 bound before Store/Ticket resolution.                                    |
| Cascade selection      | Pre-reads all open descendants from JSONL, emits a generic preview failure without `--yes`, and binds the later write to that stale loaded set.  | Map omitted `--cascade` to transaction-current `TargetOnly` and supplied `--cascade` to `CascadeOpenDescendants`; reject or include newly created descendants according to scope without a reservation or exact preview token. |
| Human scope            | Uses `firstHumanExecutorTicket` against the pre-read target set; a concurrent Executor or subtree change is not fenced.                          | Map `--allow-human` to transaction-current `CancellationExecutorScope`, requiring `AgentOnly` or permitting `AnyExecutor` only across Tickets actually changed.                                                                |
| Target Claim           | Permits unclaimed and same-Actor embedded Claims without a Claim ID; only another Actor blocks, and `--force` bypasses it.                       | Preserve unclaimed cancellation through `RequireUnclaimed`, but require matching Actor and exact optional `MatchClaim { claimId }` for an active target. Use `ActiveClaimRequiresFence`, never forced cancellation.            |
| Descendant Claims      | Cancels same-Actor claimed descendants and permits forced cancellation of other Actors' descendants, clearing embedded Claim fields.             | Reject the entire cascade for every active descendant Claim, including the command Actor's; accept no descendant fence collection and preserve all state on rejection.                                                         |
| Cancellation lifecycle | Local `cancelTicket` constructs the current nested reason/time/Actor shape from caller-supplied time and removes embedded Claim state.           | Flatten canonical `reason`, `cancelledAt`, and `cancelledBy` onto `CancelledTicket`; let the typed core own one occurrence time, separate Claim state, transaction-current validation, and consistent timestamps across the changed set. |
| Return and output      | JSON returns `ticket` plus `cancelledTickets` with the target duplicated. Human output echoes reason and either one target or a flat count/list. | Return `CancelTicketResult { target, cancelledDescendants }`; render exact concise human target/descendant output and `{ ok: true, ticket, cancelledDescendants }` JSON without duplication or reason echo.                    |
| Errors                 | Reports generic `CommandFailure` strings, force guidance, and stale preview details.                                                             | Expose schema-backed `CancellationRejected` with the approved closed reason union, exact structured payloads, human lines, and mechanically mapped JSON `type` fields.                                                         |
| Activity and atomicity | Emits no Semantic Activity and performs load/check/rewrite outside one transaction-current mutation; publication locking follows the read.       | Atomically commit every changed Snapshot, target Claim consumption, stale Claim cleanup, and target-first `TicketCancelled` Activity sequence under `BEGIN IMMEDIATE`; qualify races and mid-cascade rollback/reopen behavior. |

The five current `cli-cancel.test.ts` cases are not a compatibility suite. Forced cancellation of a claimed descendant, same-Actor claimed-target cancellation without a Claim ID, generic `--yes` preview/retry behavior, embedded Claim clearing, duplicated `cancelledTickets`, reason-echoing human success, and generic conflict messages are obsolete and must be removed or rewritten. Existing reason-file, Actor, human-target, lifecycle-filter, cascade-terminal-preservation, expired-Claim, and invalid-input scenarios remain useful only after migration to canonical schemas, semantic scopes, separate Claims, typed errors, exact output, and public core behavior.

New coverage must include optional target-fence paths and races, every active descendant regardless of Actor, transaction-current cascade and Executor scopes, exact reason byte boundaries, return ordering, ClaimConsumption and Activity equality, exact error payloads/rendering/precedence, all approved writer races, and bounded mid-cascade rollback/reopen proof. Related `cli-test-support.ts`, `Ticket.ts`, shared output/error rendering, shared force guidance, help snapshots, and pre-Lean cancellation documentation also require migration without changing this contract.

The `tm cancel` contract is fully approved.

### `tm delete` (reviewed)

Hard deletion is rejected. `tm delete` performs soft deletion by moving the selected Ticket Snapshots into durable Trash, where they are preserved indefinitely for future recovery and are never purged. Lean V1 deliberately exposes no recovery operation: it must retain enough authoritative data for a future recovery contract, but `tm restore` or any equivalent command and core function are deferred.

Trash stores a self-contained `TrashEntry { ticket, deletedAt, deletedBy }`. `ticket` is the complete final pre-deletion Ticket Snapshot and retains its original `open | done | cancelled` lifecycle variant, including any Result or Cancellation, plus its Subject, Description, Context, Executor, parent ID, and stored `blockedBy` dependency IDs. It does not become a fourth lifecycle state. The core owns deletion time; the entry records the command Actor Identity. Active Tickets and Trash entries are disjoint by Ticket ID, and an ID present in Trash remains permanently reserved. Claims are not preserved in Trash because deletion requires the complete selected set to be unclaimed.

The final CLI surface is `tm delete <ticket-id>` with command flags `--yes`, `--cascade`, `--allow-human`, `--parent-claim-id <uuid>`, and `--actor <identity>`, plus shared Store/JSON flags. Ticket and Claim IDs are exact; singular flags reject duplicates. `--claim-id` and `--force` are absent and rejected. Redundant `--cascade` on a transaction-current leaf succeeds as an ordinary one-Ticket move. Command help describes `tm delete` as moving accidental Tickets and descendants to Trash, states that Trash is permanent in Lean V1 and recovery is unavailable, and exposes no recovery or purge command.

Preview-only invocation without `--yes` is read-only and requires no Actor Identity. A confirmed invocation with `--yes` requires `--actor <identity>` or `TM_ACTOR` before constructing the core request; every `deleteTicket` call therefore contains Actor Identity and every Trash entry and Activity item is attributed. Preview output records no Actor because no mutation occurred.

A leaf may be deleted with the mandatory destructive acknowledgment `--yes`. When `--yes` is omitted, the CLI calls the existing public `listTickets` query once with the exact target as `rootTicketId`, `AllStatuses`, and `AllExecutors`. It flattens that transaction-consistent canonical tree in tree order and projects only the target and descendants to the shared neutral `TicketSummary`; it adds no deletion-preview core operation or second hierarchy traversal.

The exact adapter error is:

```ts
type DeletionPreview = {
  readonly target: TicketSummary;
  readonly descendants: ReadonlyArray<TicketSummary>;
};

type DeletionConfirmationRequired = {
  readonly _tag: "DeletionConfirmationRequired";
  readonly requiredFlags:
    | readonly ["--yes"]
    | readonly ["--yes", "--cascade"];
  readonly nonBinding: true;
  readonly preview: DeletionPreview;
};
```

An observed leaf uses `requiredFlags: ["--yes"]`; any observed descendant uses `requiredFlags: ["--yes", "--cascade"]`. `preview.target` is the supplied root summary, and `preview.descendants` contains every other returned node in canonical tree order. JSON mechanically maps `_tag` to `type` and preserves the exact nested payload without a prose `message`.

Human preview output is exact:

```text
Error: Moving Ticket <target-id> to Trash requires confirmation.
This preview is informational and reserves or fixes nothing:
- <target-id>: <subject> (status: <status>; executor: <executor>)
- <descendant-id>: <subject> (status: <status>; executor: <executor>)
Re-run with --yes --cascade.
```

A leaf renders only the target bullet and ends exactly `Re-run with --yes.`. A non-leaf renders the target first, then every descendant in canonical tree order, and ends exactly `Re-run with --yes --cascade.`. The error is distinct from core `DeletionRejected`. Preview is read-only, requires no Actor Identity, evaluates no mutation-only Claim, parent-fence, dependency, or Executor blockers, reserves and fixes nothing, and passes no preview set or token to the core.

A non-leaf target requires both `--yes` and explicit `--cascade`; omitting `--cascade` rejects when the target has any transaction-current descendant. Supplying `--cascade` selects the target and every transaction-current descendant across all lifecycle states, including a child created after the informational preview. Target-only deletion may therefore succeed only for a transaction-current leaf. A descendant created after a leaf preview makes a later `--yes` request without `--cascade` reject rather than silently expand scope.

Deletion has no claimed-target path. Any active Claim on the explicit target rejects deletion even when the command Actor holds it, and any active Claim on any selected descendant rejects the complete cascade. The CLI exposes no deletion `--claim-id`, and the core accepts no target or descendant Claim fence capable of authorizing deletion. Callers must release the blocking Claims or wait for logical expiry before retrying.

Deletion preserves dependency integrity. If any active-store Ticket outside the selected deletion set references a selected Ticket through `blockedBy`, the complete deletion rejects regardless of the external dependent's lifecycle state. Relationships whose endpoints are both moved in the same operation remain unchanged inside their preserved Trash Snapshots. A selected Ticket may continue to reference an active-store prerequisite outside the selected set through its preserved `blockedBy` IDs; ordinary active reverse `Blocks` views exclude the trashed dependent, and future recovery must revalidate the relationship transaction-current. Deletion never silently removes dependency edges from either active or trashed Snapshots.

The explicit target may have an active-store parent outside the selected deletion set. Its Trash Snapshot preserves that `parentId`; the surviving parent's ordinary active child view excludes the trashed target, and future recovery must revalidate parent existence and level compatibility. Internal hierarchy remains unchanged when parent and descendants move together. Deletion never clears a Trash Snapshot's parent ID or requires callers to delete an entire root hierarchy.

Removing a child is a direct structural mutation of its surviving parent's active decomposition, symmetrical with child creation. The CLI maps omitted `--parent-claim-id` to `ParentClaimFence.RequireUnclaimed` and a supplied ID to `ParentClaimFence.MatchClaim { claimId }`; it never pre-reads Claim state to choose the fence. A root accepts only `RequireUnclaimed`; supplying a parent Claim ID fails `TargetHasNoParent`. For a surviving direct parent, `RequireUnclaimed` fails when an active parent Claim exists, while `MatchClaim` requires that exact active Claim and matching Actor. Released or expired state fails `NoActiveParentClaim`, renewal or replacement fails `ParentClaimIdMismatch`, and an exact ID held by another Actor fails `ParentActorMismatch`. A supplied parent fence is never silently ignored or degraded into an unclaimed structural mutation.

Claims on higher ancestors remain irrelevant. The direct-parent fence can authorize only the structural change to the surviving parent: any active Claim on the explicit target or selected descendant still blocks deletion categorically. `--yes`, `--cascade`, and `--allow-human` cannot replace the parent fence.

Human-executor scope is transaction-current across the complete selected set and every lifecycle state. Omitted CLI `--allow-human` maps to `DeletionExecutorScope.AgentOnly`; supplied `--allow-human` maps to `DeletionExecutorScope.AnyExecutor`. Under `AgentOnly`, any selected human-executor target or descendant rejects the complete deletion, including done and cancelled descendants and a human descendant created after an earlier preview. The core accepts semantic Executor scope rather than a raw confirmation boolean. Neither scope bypasses Claims, dependency integrity, or cascade requirements.

The public core input is exactly `DeleteTicketInput { ticketId, actor, parentClaimFence, scope, executorScope }`. `parentClaimFence` is `RequireUnclaimed | MatchClaim { claimId }`; `scope` is `TargetOnly | CascadeDescendants`; and `executorScope` is `AgentOnly | AnyExecutor`. It contains no raw `yes`, `cascade`, or `allowHuman` booleans; no target or descendant Claim IDs; no previewed Ticket IDs; no caller-supplied time; and no purge or recovery option. The CLI mechanically maps its semantic flags while keeping `--yes` entirely adapter-side. The core owns transaction-current selection, validation, occurrence time, Trash entries, and Activity.

The Trash and deletion result boundary is exact:

```ts
type TrashEntry = {
  readonly ticket: Ticket;
  readonly deletedAt: DateTime.Utc;
  readonly deletedBy: ActorIdentity;
};

type DeleteTicketResult = {
  readonly target: TrashEntry;
  readonly trashedDescendants: ReadonlyArray<TrashEntry>;
};

declare const deleteTicket: (
  input: DeleteTicketInput,
) => Effect.Effect<
  DeleteTicketResult,
  DeletionRejected | TicketNotFound | TicketInTrash | StoreMutationError,
  TaskManager
>;
```

`target` is the complete Trash entry for the explicitly requested Ticket and `trashedDescendants` contains exactly the complete descendant Trash entries moved by this invocation in canonical tree order. A leaf returns an empty descendant array. The result reflects the transaction-current committed set, including descendants created after preview, and lets the CLI render success without recomputing scope or rereading the Store.

Exact deletion lookup distinguishes active Tickets, permanent Trash entries, and unknown IDs. A Trash-reserved target fails with typed `TicketInTrash { ticketId, deletedAt, deletedBy }`; an identity absent from both active state and Trash fails with `TicketNotFound`. `TicketInTrash` returns no complete Snapshot through the ordinary error, performs no write, and emits no Activity. Repeated deletion is not a successful no-op or replay: after an uncertain commit outcome, callers reread and reconcile.

Human leaf success is exactly `Moved <subject> (<ticket-id>) to Trash.`. Cascade success is `Moved <subject> (<ticket-id>) and 1 descendant Ticket to Trash:` or `Moved <subject> (<ticket-id>) and <n> descendant Tickets to Trash:`, followed by each descendant in canonical tree order as `- <subject> (<id>)`. JSON success is `{ "ok": true, "trashEntry": <complete target TrashEntry>, "trashedDescendants": [<complete descendant TrashEntry>] }`; the descendant array is always present and empty for a leaf. Output does not use hard-deletion terminology, reread the Store, duplicate the target, or include Activity.

Resolved deletion-invariant failures use exact closed schema-backed payloads:

```ts
type ClaimedTicketSummary = TicketSummary & {
  readonly activeClaim: Claim;
};

type ExternalDependentSummary = TicketSummary & {
  readonly dependencyIds: NonEmptyReadonlyArray<TicketId>;
};

type DeletionRejectionReason =
  | {
      readonly _tag: "ActiveTargetClaim";
      readonly activeClaim: Claim;
    }
  | {
      readonly _tag: "TargetHasNoParent";
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ActiveParentClaimRequiresFence";
      readonly parentId: TicketId;
    }
  | {
      readonly _tag: "NoActiveParentClaim";
      readonly parentId: TicketId;
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ParentClaimIdMismatch";
      readonly parentId: TicketId;
      readonly providedClaimId: ClaimId;
    }
  | {
      readonly _tag: "ParentActorMismatch";
      readonly parentId: TicketId;
      readonly providedActor: ActorIdentity;
      readonly activeClaim: Claim;
    }
  | {
      readonly _tag: "DescendantsRequireCascade";
      readonly tickets: NonEmptyReadonlyArray<TicketSummary>;
    }
  | {
      readonly _tag: "ClaimedDescendants";
      readonly tickets: NonEmptyReadonlyArray<ClaimedTicketSummary>;
    }
  | {
      readonly _tag: "ExternalDependents";
      readonly tickets: NonEmptyReadonlyArray<ExternalDependentSummary>;
    }
  | {
      readonly _tag: "HumanTicketsExcluded";
      readonly tickets: NonEmptyReadonlyArray<TicketSummary>;
    };

type DeletionRejected = {
  readonly _tag: "DeletionRejected";
  readonly ticketId: TicketId;
  readonly reason: DeletionRejectionReason;
};
```

`ExternalDependentSummary.dependencyIds` contains every selected Ticket referenced by that external dependent, in ascending Ticket-ID order. `DescendantsRequireCascade` returns every descendant summary in canonical tree order without Claim inspection. `ClaimedDescendants` returns every claimed descendant in canonical tree order with its complete active Claim. `ExternalDependents` returns every external dependent canonically. `HumanTicketsExcluded` returns the human target first when applicable, followed by human descendants in canonical tree order. Every collection and each external dependent's `dependencyIds` are schema-enforced non-empty.

Invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` remain distinct outside this resolved-operation boundary. Public definitions use Effect's reason-error pattern so callers can catch the parent, catch nested reasons, or unwrap a reason. The CLI mechanically maps outer and nested tags and never recomputes rejection rules. JSON preserves every structured field, maps tags to `type`, and omits duplicate prose messages.

Human single-state rejection output is exact:

- `ActiveTargetClaim`: `Error: Ticket <id> has active Claim <claim-id> held by <actor> until <expires-at>; release it before moving the Ticket to Trash.`
- `TargetHasNoParent`: `Error: Ticket <id> has no parent; do not pass --parent-claim-id.`
- `ActiveParentClaimRequiresFence`: `Error: Parent Ticket <parent-id> has an active Claim; reread it and pass --parent-claim-id.`
- `NoActiveParentClaim`: `Error: Claim <provided-id> is not active on parent Ticket <parent-id>; reread it before retrying.`
- `ParentClaimIdMismatch`: `Error: Claim <provided-id> does not match the active Claim on parent Ticket <parent-id>; reread it before retrying.`
- `ParentActorMismatch`: `Error: Claim <claim-id> on parent Ticket <parent-id> is held by <holder>, not <provided-actor>.`

Collection rejection headings are exact:

- `DescendantsRequireCascade`: `Error: Ticket <id> has descendants; pass --cascade to move them to Trash:`
- `ClaimedDescendants`: `Error: Ticket <id> has actively claimed descendants:`
- `ExternalDependents`: `Error: Moving Ticket <id> to Trash would leave external dependents:`
- `HumanTicketsExcluded`: `Error: Deletion would include human-executor Tickets; pass --allow-human to continue:`

An ordinary summary bullet is exactly `- <id>: <subject> (status: <status>; executor: <executor>)`. A claimed summary bullet is exactly `- <id>: <subject> (status: <status>; executor: <executor>; Claim <claim-id> held by <actor> until <expires-at>)`. An external-dependent bullet is exactly `- <id>: <subject> (status: <status>; executor: <executor>; selected dependencies: <ascending-comma-separated-ids>)`. Rendering emits every item in the reason's canonical order using only typed payloads; it never shows only the first blocker, rereads the Store, or requires JSON for complete recovery data.

Deletion linearizes Claim activity at one core-owned occurrence time sampled after `BEGIN IMMEDIATE` acquires its writer position. That instant determines target and descendant Claim activity, surviving-parent fence validity, every `TrashEntry.deletedAt`, and every `TicketTrashed.occurredAt`. Claims expired by then are inactive; a parent Claim active and exactly matched then remains valid even if wall-clock expiry passes before physical commit. The operation performs no per-Ticket sampling or second pre-commit expiry check.

For a well-formed confirmed request, core deletion validation is fail-fast and transaction-current: resolve active versus Trash-reserved versus unknown target; reject an active explicit-target Claim; validate the surviving direct-parent Claim fence; under target-only scope reject every descendant without inspecting descendant Claims, Executors, or dependencies; under cascade scope reject every active descendant Claim; reject every external active-store dependent; enforce `DeletionExecutorScope`; then mutate atomically. Errors are not aggregated. CLI syntax, informational preview when `--yes` is absent, and boundary decoding precede the core request. Every failed stage leaves active Tickets, Claims, Trash, timestamps, and Activity unchanged.

All deletion races resolve by serialized writer-position order with complete transaction-current revalidation and no automatic retry or preview reservation. Claim acquisition committed first produces the corresponding target, descendant, or parent Claim rejection; deletion committed first makes later target/descendant mutations resolve the identity as `TicketInTrash`, while mutations of a surviving parent remain valid. Parent renewal committed first makes an old parent Claim ID stale; deletion committed first leaves the surviving parent Claim available for later renewal. Child creation committed first makes target-only deletion reject or becomes part of a cascade; deletion committed first makes creation against the trashed parent fail. External dependency addition or Executor update committed first determines deletion blockers; deletion committed first makes later direct mutation of the trashed Ticket fail. Concurrent deletion has one success and a later `TicketInTrash`. Rejections return immediately; callers reread and explicitly retry. Unknown physical commit outcomes retain the global reread-and-reconcile rule.

Deletion failure atomicity is qualified by one bounded real file-backed mid-cascade rollback/reopen test. A private deterministic barrier fails after the target and at least one descendant have been removed from active state and their Trash and Activity effects have executed, but before the complete set or `COMMIT` attempt finishes. Reopening must prove every selected Snapshot remains unchanged and active, no partial Trash entry exists, any surviving parent and exact Claim remain unchanged, Activity high-water is unchanged, and retry succeeds. This is not exhaustive per-statement fault injection. Known pre-commit failures must roll back completely; unknown physical commit outcomes require reread and reconciliation.

Each moved Ticket emits one minimal `TicketTrashed` Semantic Activity item with no operation-specific payload beyond its tag. Common Activity fields provide Ticket ID, Actor Identity, and occurrence time, which equal the corresponding `TrashEntry.ticket.id`, `deletedBy`, and `deletedAt`. One cascade uses one core-owned occurrence time and Actor, emits the explicit target first and descendants in canonical tree order, and commits Activity atomically with all Trash entries and active-state removals. The event does not duplicate the complete Snapshot or Trash entry and contains no `ClaimConsumption`, because successful deletion is categorically unclaimed. Rejection emits no Activity and creates no Trash entry.

#### Current deletion implementation migration delta

The existing JSONL implementation is migration evidence, not normative compatibility surface. It hard-removes a stale preloaded subtree, accepts prefix IDs, has no Actor or parent fence, permits claimed deletion, performs human and dangling-dependency checks outside the publication lock, emits no Activity, and returns compact hard-deletion output. Lean V1 replaces it with exact IDs, permanent self-contained Trash entries, explicit transaction-current scope and Executor unions, categorical selected-Claim rejection, exact surviving-parent fencing, typed rejection payloads, complete Trash-entry results, `TicketTrashed` Activity, and one atomic libSQL transaction. Existing hard-delete, prefix, generic-message, compact `deleted` JSON, and stale-preview assertions must be rewritten. The unrelated `tm next` scenario currently located in `cli-delete.test.ts` is not deletion coverage and must move to its owning suite during implementation.

The `tm delete` contract is fully approved.

### `tm block` (reviewed)

`tm block <ticket-id> --by <dependency-id>` adds one directed prerequisite relationship to an open target. The directly modified target must be open; done and cancelled targets fail `TicketNotOpen` and retain immutable terminal history. The prerequisite may be any active open, done, or cancelled Ticket. A done or cancelled prerequisite is immediately satisfied under the shared dependency-readiness invariant but remains valid relationship history. Unknown and Trash-reserved identities remain distinct. Lifecycle and exact lookup are transaction-current core invariants rather than CLI pre-read policy.

Adding an already-present exact relationship returns explicit successful `AlreadyBlocked` after target lifecycle eligibility but before target Claim fencing. It performs no write, does not change `updatedAt`, and emits no Activity. A supplied stale Claim ID is ignored only for this proven no-op. An absent relationship follows ordinary target fencing and returns `Blocked` only after mutation. The CLI never pre-reads the relation to choose the outcome.

An effective addition rejects self-dependency with a distinct `SelfDependency` reason and rejects every longer active-graph cycle. Cycle recovery data is the canonical shortest closed path beginning and ending with the target; equal-length paths break ties by ascending Ticket ID at each traversal step. Cycle detection uses transaction-current active relationships after a valid target fence, excludes Trash relationships, and changes no state on rejection.

`tm block` has no `--allow-human`. Adding a dependency restricts readiness and neither removes nor consumes a human gate, whether the human Executor is on the target or prerequisite. Every effective addition still requires `--actor` or `TM_ACTOR` and optional exact target `--claim-id`; the core fences only the directly modified target, and any prerequisite Claim is irrelevant.

The core returns an explicit outcome with authoritative transaction-current endpoint data:

```ts
type TicketSummary = {
  readonly ticketId: TicketId;
  readonly subject: Subject;
  readonly status: TicketStatus;
  readonly executor: Executor;
};

type AddTicketDependencyResult =
  | {
      readonly _tag: "Blocked";
      readonly ticket: OpenTicket;
      readonly dependency: TicketSummary;
    }
  | {
      readonly _tag: "AlreadyBlocked";
      readonly ticket: OpenTicket;
      readonly dependency: TicketSummary;
    };
```

`TicketSummary` is a shared neutral compact Ticket type rather than a deletion-specific summary. Both outcomes contain the complete open target Snapshot and a compact prerequisite summary from the same transaction-current observation. This lets the CLI render without a Store reread or a pre-read that determines the outcome.

Human success output distinguishes the outcomes:

- `Blocked <target-subject> (<target-id>) by <dependency-subject> (<dependency-id>).`
- `Ticket <target-subject> (<target-id>) is already blocked by <dependency-subject> (<dependency-id>).`

JSON success is `{ ok: true, outcome: "blocked" | "already-blocked", ticket, dependency }`. The CLI mechanically maps the core outcome tag and does not expose `_tag`, Activity, or a Cursor.

An effective addition emits one minimal event:

```ts
type TicketDependencyAdded = {
  readonly _tag: "TicketDependencyAdded";
  readonly dependencyId: TicketId;
};
```

Common Activity fields identify the command Actor and directly modified target Ticket. The Activity occurrence time equals the returned target's `updatedAt`. The event does not duplicate endpoint summaries or the complete target Snapshot. `AlreadyBlocked` emits no Activity.

Resolved dependency-addition invariant failures use one schema-backed outer error with a closed schema-backed reason union:

```ts
type SelfDependency = {
  readonly _tag: "SelfDependency";
};

type DependencyCycle = {
  readonly _tag: "DependencyCycle";
  readonly cycle: NonEmptyReadonlyArray<TicketId>;
};

type DependencyAdditionRejectionReason =
  | TicketNotOpenReason
  | ActiveClaimRequiresFence
  | NoActiveClaim
  | ClaimIdMismatch
  | ActorMismatch
  | SelfDependency
  | DependencyCycle;

type DependencyAdditionRejected = {
  readonly _tag: "DependencyAdditionRejected";
  readonly ticketId: TicketId;
  readonly dependencyId: TicketId;
  readonly reason: DependencyAdditionRejectionReason;
};
```

`TicketNotOpen` contains the target's terminal status. `ActiveClaimRequiresFence` contains no active-Claim details and requires a reread. `NoActiveClaim` and `ClaimIdMismatch` contain only the provided Claim ID and never reveal a current Claim ID. `ActorMismatch` contains the provided Actor and the complete exactly matched active Claim. `SelfDependency` needs no duplicate reason payload because both endpoint IDs are present on the wrapper. `DependencyCycle` contains the canonical schema-enforced non-empty closed cycle path.

The public definitions use Effect Schema error classes so callers can catch the parent, catch nested reasons, or unwrap a reason. Invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` remain distinct outside this resolved-operation boundary. The CLI mechanically maps outer and nested `_tag` fields to JSON `type`, preserves reason-specific recovery data, and renders failures without rereading the Store or recomputing dependency rules. JSON errors omit a duplicate human `message` field.

Human rejection rendering is exact:

- `TicketNotOpen`: `Error: Ticket <target-id> is <status> and cannot have a dependency added.`
- `ActiveClaimRequiresFence`: `Error: Ticket <target-id> has an active Claim; reread the Ticket and pass --claim-id to add the dependency.`
- `NoActiveClaim`: `Error: Claim <provided-claim-id> is not active on Ticket <target-id>; reread the Ticket before retrying.`
- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <target-id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <target-id> is held by <holder>, not <provided-actor>.`
- `SelfDependency`: `Error: Ticket <target-id> cannot depend on itself.`
- `DependencyCycle`: `Error: Adding dependency <dependency-id> to Ticket <target-id> would create a dependency cycle: <id> -> ... -> <target-id>.`

The cycle line renders every ID from the canonical closed `cycle` collection joined by ` -> `. These sentences are CLI adapter policy; the core supplies only the typed reason data and canonical path.

Validation is fail-fast and never aggregates errors. The CLI first resolves syntax and required flags, exact Ticket IDs, optional Claim ID, and Actor Identity, then constructs one core request without a Store pre-read. Actor Identity remains required even when transaction-current state later proves `AlreadyBlocked`; the adapter cannot pre-read the relationship to decide whether attribution will be needed.

For a well-formed core request, transaction-current precedence is:

1. resolve Store and target identity as active, Trash-reserved, or unknown;
2. resolve prerequisite identity as active, Trash-reserved, or unknown;
3. require the target to be open;
4. detect the exact existing relationship and return `AlreadyBlocked`;
5. validate the target Claim fence;
6. reject `SelfDependency`;
7. detect and reject a longer `DependencyCycle`;
8. atomically add the relationship, update the target timestamp, and emit Activity.

Accordingly, missing or trashed prerequisite identity precedes terminal-target lifecycle; endpoint resolution precedes Claim fencing; and `AlreadyBlocked` ignores stale Claim input only after both active endpoints and target lifecycle are proven. Missing or stale target fencing precedes self-dependency and cycle disclosure, while self-dependency precedes longer-cycle analysis after a valid fence.

Dependency addition is serialized under one `BEGIN IMMEDIATE` writer transaction. After proving the relationship absent, the core samples one occurrence time for target Claim activity, the changed target's `updatedAt`, and `TicketDependencyAdded.occurredAt`; it performs no second Claim-expiry check before commit. Successful addition preserves every Claim record and neither consumes nor renews the target Claim. The operation never automatically retries a rejected race.

Concurrent identical additions produce one `Blocked` followed by `AlreadyBlocked`; the later no-op ignores a Claim ID that became stale before its transaction. Claim acquisition committed before `RequireUnclaimed` produces `ActiveClaimRequiresFence`; release before `MatchClaim(C1)` produces `NoActiveClaim`; and renewal to `C2` first produces `ClaimIdMismatch`. An addition committed first remains visible to later Claim and lifecycle operations without changing their Claim records.

A target terminal transition committed first makes addition fail `TicketNotOpen`; addition committed first makes later completion evaluate the new prerequisite. Moving the prerequisite to Trash first makes addition fail `TicketInTrash`; addition committed first makes the new active dependent participate in deletion's external-dependent invariant. Competing relationship mutations are evaluated against the committed graph, so the later addition may fail with the canonical `DependencyCycle`. The CLI establishes no reservation, performs no relationship preview, and does not retry automatically.

Dependency-addition atomicity receives one real file-backed rollback/reopen test. A private deterministic failure after the target relationship update and `TicketDependencyAdded` insertion execute inside the transaction but before the `COMMIT` attempt must leave the target Snapshot, `blockedBy`, `updatedAt`, all target and prerequisite Claims, and Activity high-water unchanged after reopen, with no dependency-addition Activity. A retry must then succeed normally. This is bounded pre-commit qualification rather than exhaustive fault injection; an unknown physical commit outcome requires reread and reconciliation.

The public core operation uses the shared neutral endpoint-and-fence input with an addition-specific function and result:

```ts
type ChangeDependencyInput = {
  readonly ticketId: TicketId;
  readonly dependencyId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimFence: TargetClaimFence;
};

declare const addTicketDependency: (
  input: ChangeDependencyInput,
) => Effect.Effect<
  AddTicketDependencyResult,
  | DependencyAdditionRejected
  | TicketNotFound
  | TicketInTrash
  | StoreMutationError,
  TaskManager
>;
```

Dependency removal shares these endpoint and fence fields but uses its own operation-specific input because its required human-gate scope is not meaningful for addition. Addition and removal remain separate functions with their own results, invariant failures, and Activity. The core operation name follows the Dependency domain language rather than the CLI verb.

The CLI surface is `tm block <ticket-id> --by <dependency-id> --actor <identity> [--claim-id <uuid>]` plus shared Store/JSON flags, with `TM_ACTOR` fallback. Omitted `--claim-id` maps mechanically to `RequireUnclaimed`; a supplied ID maps to `MatchClaim`. `--allow-human`, `--force`, prefix IDs, and graph-policy flags are absent. The adapter decodes input, calls `addTicketDependency` once, and renders the approved result or typed failure.

#### Current dependency-addition implementation migration delta

The current JSONL command accepts prefixes, performs lookup, self/no-op checks, and mutation in the CLI, reports existing relationships as generic failures, relies on whole-Store validation for cycle detection, has no Actor or Claim fence, emits no Activity, and returns only the complete target. Lean V1 replaces it with exact IDs, one typed core operation and transaction, explicit `Blocked | AlreadyBlocked`, authoritative endpoint data, target-only Claim fencing, canonical cycle recovery, schema-backed reasons, minimal Activity, and exact human/JSON rendering. Existing prefix, duplicate-failure, generic-error, JSONL storage, and output assertions are migration evidence rather than compatibility requirements.

The `tm block` contract is fully approved.

### `tm unblock` (reviewed)

`tm unblock <ticket-id> --by <dependency-id>` removes one directed prerequisite relationship from an open target. Both endpoint identities must resolve transaction-current as active rather than Trash-reserved or unknown, and the directly modified target must be open before relation-state no-op detection.

When the exact relationship is absent, the core returns explicit successful `AlreadyUnblocked` after endpoint resolution and target lifecycle but before target Claim fencing or later effective-removal policy. It writes nothing, preserves `updatedAt`, emits no Activity, and ignores a stale supplied target Claim ID only for this proven no-op. Done and cancelled targets still fail `TicketNotOpen`; missing and Trash-reserved endpoints retain their distinct lookup failures. An existing relationship proceeds as effective `Unblocked` removal. The CLI never pre-reads relation state to select the outcome.

Effective removal protects only an open human-executor prerequisite because that relationship is an active human gate. The target's Executor is irrelevant, and a done or cancelled human prerequisite is already satisfied and may be removed without acknowledgment. Human intent is represented transaction-current through a semantic core scope:

```ts
type DependencyRemovalGateScope =
  | { readonly _tag: "PreserveOpenHumanPrerequisites" }
  | { readonly _tag: "AnyPrerequisite" };
```

Omitted CLI `--allow-human` maps mechanically to `PreserveOpenHumanPrerequisites`; supplying the flag maps to `AnyPrerequisite`. The core enforces this scope after relation existence and a valid target Claim fence, so a prerequisite that becomes open-human before the writer transaction is rejected without acknowledgment. The scope never waives lookup, lifecycle, relation, or Claim invariants. `AlreadyUnblocked` requires no acknowledgment because nothing is removed. The CLI owns the flag's acknowledgment wording but performs no endpoint lifecycle or Executor pre-read.

The core returns explicit outcomes with authoritative transaction-current endpoint data:

```ts
type RemoveTicketDependencyResult =
  | {
      readonly _tag: "Unblocked";
      readonly ticket: OpenTicket;
      readonly dependency: TicketSummary;
    }
  | {
      readonly _tag: "AlreadyUnblocked";
      readonly ticket: OpenTicket;
      readonly dependency: TicketSummary;
    };
```

`Unblocked` contains the updated target with the relationship absent; `AlreadyUnblocked` contains the unchanged open target. Both contain the shared compact authoritative prerequisite summary from the same core observation. Removing the last dependency uses the canonical absent `blockedBy` representation rather than storing an empty collection.

Human success output is exact:

- `Unblocked <target-subject> (<target-id>) from <dependency-subject> (<dependency-id>).`
- `Ticket <target-subject> (<target-id>) is already unblocked from <dependency-subject> (<dependency-id>).`

JSON success is `{ ok: true, outcome: "unblocked" | "already-unblocked", ticket, dependency }`. The CLI maps the outcome mechanically and renders without a Store reread.

Effective removal emits one minimal event:

```ts
type TicketDependencyRemoved = {
  readonly _tag: "TicketDependencyRemoved";
  readonly dependencyId: TicketId;
};
```

Common Activity fields identify the command Actor and directly modified target Ticket. Activity `occurredAt` equals the returned target's `updatedAt`. The event does not duplicate endpoint data. `AlreadyUnblocked` emits no Activity.

Resolved dependency-removal invariant failures use one schema-backed outer error with a closed schema-backed reason union:

```ts
type OpenHumanPrerequisiteExcluded = {
  readonly _tag: "OpenHumanPrerequisiteExcluded";
};

type DependencyRemovalRejectionReason =
  | TicketNotOpenReason
  | ActiveClaimRequiresFence
  | NoActiveClaim
  | ClaimIdMismatch
  | ActorMismatch
  | OpenHumanPrerequisiteExcluded;

type DependencyRemovalRejected = {
  readonly _tag: "DependencyRemovalRejected";
  readonly ticketId: TicketId;
  readonly dependencyId: TicketId;
  readonly reason: DependencyRemovalRejectionReason;
};
```

`TicketNotOpen` contains terminal target status. `ActiveClaimRequiresFence` contains no current Claim details. `NoActiveClaim` and `ClaimIdMismatch` contain only the provided Claim ID and never reveal a current Claim ID. `ActorMismatch` contains the provided Actor and complete exactly matched active Claim. `OpenHumanPrerequisiteExcluded` needs no duplicate payload because the wrapper identifies both endpoints and the reason proves that the prerequisite is transaction-current open-human. Invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` remain distinct outside the resolved-operation boundary.

The public definitions use Effect Schema error classes and support parent/reason catching and reason unwrapping. The CLI mechanically maps outer and nested `_tag` values to JSON `type`, preserves recovery-specific fields, and renders failures without rereading endpoint state. JSON errors omit a duplicate human `message` field.

Human rejection rendering is exact:

- `TicketNotOpen`: `Error: Ticket <target-id> is <status> and cannot have a dependency removed.`
- `ActiveClaimRequiresFence`: `Error: Ticket <target-id> has an active Claim; reread the Ticket and pass --claim-id to remove the dependency.`
- `NoActiveClaim`: `Error: Claim <provided-claim-id> is not active on Ticket <target-id>; reread the Ticket before retrying.`
- `ClaimIdMismatch`: `Error: Claim <provided-claim-id> does not match the active Claim on Ticket <target-id>; reread the Ticket before retrying.`
- `ActorMismatch`: `Error: Claim <claim-id> on Ticket <target-id> is held by <holder>, not <provided-actor>.`
- `OpenHumanPrerequisiteExcluded`: `Error: Removing dependency <dependency-id> from Ticket <target-id> would remove an open human-executor gate; pass --allow-human to continue.`

These sentences are CLI adapter policy; the core supplies only typed reason data.

Validation is fail-fast and never aggregates errors. The CLI resolves syntax, required `--by`, exact endpoint IDs, optional Claim ID, Actor Identity, and gate-scope mapping, then constructs one core request without endpoint or relationship pre-reads. Actor Identity remains required even when the transaction later returns `AlreadyUnblocked`.

For a well-formed core request, transaction-current precedence is:

1. resolve Store and target identity as active, Trash-reserved, or unknown;
2. resolve prerequisite identity as active, Trash-reserved, or unknown;
3. require the target to be open;
4. return `AlreadyUnblocked` when the exact relationship is absent;
5. validate the target Claim fence;
6. enforce `DependencyRemovalGateScope`;
7. atomically remove the relationship, normalize `blockedBy`, update the target timestamp, and emit Activity.

Accordingly, missing or trashed prerequisite identity precedes terminal-target lifecycle. `AlreadyUnblocked` ignores stale Claim input and open-human gate state only after both active endpoints and open target lifecycle are proven. For an effective removal, target Claim rejection precedes `OpenHumanPrerequisiteExcluded`. Errors are not aggregated.

Dependency removal is serialized under one `BEGIN IMMEDIATE` writer transaction. After proving the relationship exists, the core samples one occurrence time for target Claim activity, the changed target's `updatedAt`, and `TicketDependencyRemoved.occurredAt`; it performs no second Claim-expiry check before commit. Successful removal preserves every Claim record and neither consumes nor renews either endpoint Claim. The operation never automatically retries a rejected race.

Concurrent removals produce one `Unblocked` followed by `AlreadyUnblocked`; the later no-op ignores a Claim ID that became stale before its transaction. Claim acquisition committed before `RequireUnclaimed` produces `ActiveClaimRequiresFence`; release before `MatchClaim(C1)` produces `NoActiveClaim`; and renewal to `C2` first produces `ClaimIdMismatch`.

A prerequisite that becomes open-human first is rejected under `PreserveOpenHumanPrerequisites`; an open-human prerequisite that becomes terminal first is already satisfied and may be removed without acknowledgment. A target terminal transition committed first makes removal fail `TicketNotOpen`; removal committed first makes later completion evaluate the reduced prerequisite set. Deletion of the prerequisite while the edge exists is rejected by deletion's external-dependent invariant; removal committed first may allow later deletion to proceed. The CLI establishes no reservation, performs no endpoint or relationship preview, and does not retry automatically.

Dependency-removal atomicity receives one real file-backed rollback/reopen test. A private deterministic failure after relationship deletion and `TicketDependencyRemoved` insertion execute inside the transaction but before the `COMMIT` attempt must leave the complete target Snapshot, relationship, `updatedAt`, all endpoint Claims, and Activity high-water unchanged after reopen, with no dependency-removal Activity. A retry must then succeed normally. Unknown physical commit outcomes require reread and reconciliation rather than claimed rollback.

The public core boundary is operation-specific because gate scope is meaningful only for removal:

```ts
type RemoveTicketDependencyInput = {
  readonly ticketId: TicketId;
  readonly dependencyId: TicketId;
  readonly actor: ActorIdentity;
  readonly claimFence: TargetClaimFence;
  readonly gateScope: DependencyRemovalGateScope;
};

declare const removeTicketDependency: (
  input: RemoveTicketDependencyInput,
) => Effect.Effect<
  RemoveTicketDependencyResult,
  | DependencyRemovalRejected
  | TicketNotFound
  | TicketInTrash
  | StoreMutationError,
  TaskManager
>;
```

The endpoint and fence fields mirror `ChangeDependencyInput`, but the required `gateScope` prevents invalid addition/removal field combinations. The core owns lookup, lifecycle, no-op detection, target fencing, gate enforcement, dependency normalization, transaction, and Activity.

The CLI surface is `tm unblock <ticket-id> --by <dependency-id> --actor <identity> [--claim-id <uuid>] [--allow-human]` plus shared Store/JSON flags, with `TM_ACTOR` fallback. The optional Claim ID maps mechanically to `TargetClaimFence`, and `--allow-human` maps to `DependencyRemovalGateScope`. Prefix IDs, `--force`, and graph-policy flags are absent. The adapter calls `removeTicketDependency` once without endpoint or relationship pre-reads.

#### Current dependency-removal implementation migration delta

The current JSONL command accepts prefixes, performs lookup, relation detection, broad either-endpoint human checks, and mutation in the CLI, reports absent relationships as generic failures, has no Actor or Claim fence, emits no Activity, and returns only the complete target. Lean V1 replaces it with exact IDs, one typed core transaction, `Unblocked | AlreadyUnblocked`, authoritative endpoint data, target-only Claim fencing, transaction-current open-human-prerequisite scope, schema-backed reasons, minimal Activity, and exact rendering. Existing prefix, absent-relation failure, broad human guard, generic-error, JSONL storage, and target-only output assertions are migration evidence rather than compatibility requirements.

The `tm unblock` contract is fully approved.

## Implementation documentation and skill migration

The architecture and verification checklist are the only implementation contract. Existing source, tests, generated help, and skill content are migration evidence and cannot override this document.

Lean V1 implementation includes these documentation-facing deliverables:

1. Rebuild `skills/task-manager/SKILL.md` and create only the supporting reference files needed to describe the completed Lean V1 CLI and Store behavior. The migrated skill must use exact Ticket and Claim IDs, separate Claim receipts, required Actor Identity, the reviewed Claim-fence flags, `tm update --executor`, semantic cancellation/deletion scope, permanent Trash terminology, and the reviewed Result inputs. It must contain no JSONL editing guidance, prefix lookup, `tm set-executor`, force/takeover behavior, cancellation `--yes`, deletion hard-delete language, verification-specific completion flags, or other removed commands and flags.
2. Rebuild `skills/to-tickets/SKILL.md` to create and organize Tickets through the completed Lean V1 CLI. Its preflight and examples must use `tm update --executor` rather than `tm set-executor`, exact IDs rather than prefixes, Actor Identity for every state-changing Ticket mutation, current list/next filters, and Lean V1 parent fencing when creating beneath an actively claimed parent. It must remove JSONL recovery instructions, generic force guidance, removed list flags, and obsolete message or empty-Context inputs.
3. Validate both skills against generated Lean V1 command help and public JSON output after the product implementation is complete. Skill examples must not rely on implementation-private storage details or reproduce core invariants differently from this architecture.
4. Regenerate end-user documentation only after the Lean V1 implementation and skill migrations conform to the verification checklist. Generated documentation must describe the implemented public surface without becoming a second normative architecture.

Until those tasks are complete, files under `skills/` are explicit migration targets and must not be used to infer Lean V1 behavior.

## Final active-architecture audit

Audit the active Lean V1 architecture, verification checklist, glossary, implementation entry documents, and skill-migration obligations for unresolved placeholders, historical terminology presented as current, superseded Claim or deletion rules, broken references, and cross-command contradictions before deciding whether Ticket `8yqcz7` is complete. Previously researched production-hardening topics remain excluded from the active contract.
