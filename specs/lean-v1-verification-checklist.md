# Lean V1 verification checklist

Status: Final

Decision Ticket: **Define lean V1 core and CLI contract** (`8yqcz7`)

Architecture source: [`lean-v1.md`](./lean-v1.md)

## Authority and organization

Lean V1 uses a layered mandatory qualification gate. Each accepted contract obligation receives a stable scenario with its source, setup, controlled action, public observable result, and evidence. Scenarios are organized by contract obligation and trace back to CLI behavior rather than implementation modules.

Tests assert through the public typed core interface or CLI. Private test-only phase barriers, clocks, and fault controls may make scheduling deterministic, but may not manufacture domain outcomes or bypass production persistence logic.

Every environment advertised as supported must pass the complete Lean V1 checklist. Initially the project should advertise only the exact development/CI runtime, native libSQL artifact, OS/architecture, local filesystem, and connection profile that it actually tests.

## Deliberately excluded qualification

Lean V1 does not require:

- backup/restore tests;
- Mutation-receipt replay tests;
- revision-guard tests;
- broad cross-platform qualification;
- exhaustive crash points or physical power-loss testing;
- migration compatibility tests;
- complete production recovery-artifact validation.

## Public core service and Layer

- Expose one `TaskManager` capability through pinned Effect `Context.Service` with identifier exactly `@urban/task-manager/TaskManager` and a closed `TaskManagerService` shape containing exactly `initializeStore`, `validateStore`, `createTicket`, `updateTicket`, `getTicketDetails`, `listTickets`, `selectNextTicket`, `claimTicket`, `renewClaim`, `releaseClaim`, `completeTicket`, `cancelTicket`, `deleteTicket`, `addTicketDependency`, and `removeTicketDependency`.
- Expose exact `TaskManagerLayerOptions { storeLocation: CanonicalAbsolutePath }` and `layer(options): Layer.Layer<TaskManager>`; accept Store Location only through this Layer option rather than through operation inputs or hidden global state.
- Require every exported typed access function to delegate through `TaskManager` and explicitly include `TaskManager` as the third `Effect.Effect` requirement. Give each underlying service method the same success and typed error channel without a `TaskManager` requirement.
- Resolve and canonicalize Store Location in the CLI before Layer construction, compose every core call needed by one complete subcommand program, and provide `layer({ storeLocation })` exactly once around that composition.
- Prove a CLI flow that performs multiple core calls, such as completion's human-gate pre-read and mutation, uses one provided capability and exposes no libSQL client, SQL, row, platform handle, internal repository service, or connection-lifecycle detail.
- Permit tests to replace the complete `TaskManager` capability through a test Layer. Prohibit access functions from internally providing the live Layer or obtaining Store configuration from hidden global state.

## Store Location resolution

- Derive the default Store Location under `~/.task-manager/stores/<project-key>/`, outside the repository and Git, from a canonical project scope.
- Inside Git, use the canonical Git common root as project scope and prove the primary worktree and multiple linked worktrees resolve the same default Store Location rather than separate exact-working-directory Stores.
- Outside Git, use the canonical resolved working directory as project scope.
- Canonicalize path aliases before scope-key derivation or explicit-location use; prove equivalent canonical inputs resolve one Store rather than parallel Stores.
- Resolve a relative selected cwd against process cwd, require it to exist as a directory, and realpath symlinks. Resolve relative explicit Store Location against that canonical cwd; keep absolute Store Location independent of it.
- Lexically normalize Store `.` and `..`, realpath the deepest existing ancestor, and append the normalized nonexistent tail. Permit an absent final Store Location for `tm init`; require an existing location to be a directory; let other commands return `StoreNotInitialized` when the canonical `task-manager.db` is absent.
- Resolve relative file-input paths against the selected canonical cwd, require existing regular files, and resolve symlinks before reading.
- Perform no shell-style `~` expansion for explicit CLI or environment paths. Obtain home through the platform home-directory service only for default registry derivation.
- Derive the exact project key `<slug>--<sha256>`: lowercase the canonical scope basename, replace runs outside ASCII `a-z` and `0-9` with `-`, trim leading/trailing `-`, retain at most 48 characters with `project` as the empty fallback, then append `--` and all 64 lowercase hexadecimal characters of SHA-256 over the UTF-8 canonical project-scope path.
- Prove equal basenames at distinct canonical paths produce different keys, canonical path aliases produce one key, empty or non-ASCII-only basenames use the fallback slug, and the complete digest is retained.
- Resolve the working-directory basis as `--cwd`, then `TM_CWD`, then process cwd. Resolve explicit Store Location independently as `--storage-path`, then `TM_STORAGE_PATH`, then absent; when absent derive from the selected basis, when relative resolve against that basis, and when absolute use it independently of the basis.
- Permit `--cwd` with `--storage-path`; boundary-validate and canonicalize every selected path even when an absolute Store Location makes the working-directory basis irrelevant to location resolution.
- Resolve required Actor Identity as `--actor`, then `TM_ACTOR`, then required-Actor adapter failure. Give confirmations and command-specific semantic flags no environment fallback unless explicitly named by the architecture.
- Reject duplicate singular flags during parsing before environment fallback. Prove higher-precedence values replace rather than merge with lower-precedence values independently for each setting.
- Pass only the resolved canonical Store Location into the core Layer and keep Git discovery out of the core package.
- Keep Store Identity independent of Store Location and perform no automatic Store discovery, relocation, or merging after a repository path changes.
- Keep `task-manager.db` and its engine-owned sibling sidecars outside the repository by default. Treat `--storage-path` as selecting the containing Store Location rather than an arbitrary database filename. Do not copy Pi's exact-cwd partitioning or its JSONL persistence.

## Bounded diagnostics

- Map every public `BoundedDiagnostic` before vendor text crosses the core boundary: remove SQL statements, query parameters, stacks, raw error serialization, and path aliases; replace each run of line breaks, tabs, and Unicode control characters with one ASCII space; apply ECMAScript trim; and use exact `No diagnostic available.` when empty.
- Enforce a non-empty single-line maximum of 1,024 UTF-8 bytes. Accept exactly 1,024 bytes; when larger, preserve the longest complete Unicode-code-point prefix that leaves room for one `…`, append it, and never split a UTF-8 sequence.
- Preserve remaining case, Unicode, punctuation, and internal spacing without Unicode normalization. Use the same type for Store read, mutation, initialization, and validation reasons that permit diagnostics.
- Require consumers to identify failures by typed reason rather than diagnostic text; render the sanitized diagnostic verbatim without further adapter interpretation.

## Shared Store read failures

- Expose schema-backed `StoreReadError { databasePath, reason }` with exact `StoreNotInitialized | StoreOpenFailed { diagnostic } | StoreQueryFailed { diagnostic }` reasons from ordinary public core reads, outside Ticket lookup and operation-specific domain rejection.
- Use `StoreNotInitialized` only when the configured database is absent; distinguish failure to open an existing configured database from failure of a read after opening it. Perform Ticket lookup and domain checks only after Store reading is available.
- Include the configured canonical absolute database path as runtime error context without treating it as Store metadata.
- Normalize and bound diagnostics before they cross the core boundary; expose no vendor stack, SQL statement, query parameters, raw error object, or path alias.
- Render exact recovery-specific human lines for not initialized, open failed, and query failed; direct the absent case to `tm init` and the query-failed case to `tm validate`.
- Mechanically map parent and reason tags to JSON `type`, preserve fields, add no prose `message`, perform no Store reread, and support Effect parent/reason catching and reason unwrapping.
- Keep `tm validate` phase-gated reasons more specific rather than collapsing them into the ordinary read taxonomy.

## Shared Store mutation failures

- Expose schema-backed `StoreMutationError { databasePath, reason }` with exact `StoreNotInitialized | StoreOpenFailed { diagnostic } | StoreTransactionFailed { diagnostic } | StoreCommitOutcomeUnknown { diagnostic }` reasons outside input, lookup, and operation-specific domain rejection.
- Use `StoreTransactionFailed` only when non-commit is known, including a pre-commit failure with complete rollback. Use `StoreCommitOutcomeUnknown` only after a commit attempt whose physical outcome cannot be established, and never claim rollback or safe blind retry for it.
- Require callers receiving unknown outcome to reread and reconcile current state before deciding whether to retry. Expose no generic retryability boolean; recovery follows the reason.
- Keep domain rejection and no-op outcomes distinct from Store failures.
- Apply the same canonical database-path, normalized bounded diagnostic, no-stack, no-SQL, no-query-parameter, and no-raw-vendor-error rules as Store reads.
- Render exact recovery-specific human lines for absent Store, open failure, known pre-commit failure, and unknown commit outcome. Mechanically map parent and reason tags to JSON `type`, preserve fields, add no prose `message`, and support Effect parent/reason catching and reason unwrapping.

## Store format metadata

- Persist exactly one semantic `StoreMetadata { applicationId: "task-manager", formatVersion: 1, storeId, activityHighWater }` record, independent of private SQL table and column organization.
- Generate `storeId` as one canonical UUIDv4 during fresh initialization and preserve it for the Store's lifetime.
- Use `activityHighWater: 0` when no Activity exists; otherwise require it to equal the greatest committed positive Activity Cursor and advance it atomically with Activity.
- Reject a missing, duplicate, malformed, unrelated-application, or non-version-1 metadata record without modifying the database.
- Do not treat pragmas as a second normative copy of semantic application identity or format version.
- Exclude creation time, Store Location, project path, package or engine versions, durability profile, revisions, receipts, and migration history from Lean V1 Store metadata.
- Use exactly `task-manager.db` as the active database filename within every resolved Store Location.

## Canonical time

- Use `DateTime.Utc` for domain instants and normalize every core-owned occurrence time to millisecond precision before comparisons, Claim activity, state, persistence, Activity, or results.
- Encode every persisted and public timestamp exactly as canonical UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`, with exactly three fractional-second digits and `Z` rather than an offset.
- Reject impossible dates, offsets, absent fractions, extra precision, and semantically equivalent non-canonical timestamp strings at persisted and public encoded boundaries.
- Render the same canonical string on every human CLI timestamp surface without locale formatting; compare and order UTC instants rather than raw encoded strings.

## Shared Ticket lookup errors

- Expose exact shared `TicketNotFound { ticketId }` and `TicketInTrash { ticketId, deletedAt, deletedBy }` errors from every applicable public core operation resolving a canonical Ticket ID.
- Use `TicketNotFound` only when the ID is absent from both active Tickets and Trash. Use `TicketInTrash` for a permanently reserved Trash ID, returning deletion attribution but never the preserved Snapshot through an ordinary operation error.
- Reject malformed Ticket IDs at boundary decoding before lookup; never convert them into `TicketNotFound`.
- Expose exact shared top-level `TicketNotOpen { ticketId, status: "done" | "cancelled" }` after active identity resolution for a terminal supplied `selectNextTicket` root and terminal `claimTicket`, `renewClaim`, or `releaseClaim` target. Return no Result, Cancellation, Claim, or complete Snapshot.
- Expose separate exact status-only `TicketNotOpenReason { status: "done" | "cancelled" }` with the same `_tag: "TicketNotOpen"` for operation-specific rejection wrappers whose parent already owns `ticketId`; do not reuse top-level `TicketNotOpen` or duplicate its ID inside nested reasons.
- Mechanically map both tags to JSON `type: "TicketNotOpen"`. Keep nested lifecycle reasons inside their operation wrappers, operation-specific human rendering, and Effect reason handling.
- Render exact human `Error: Ticket <ticket-id> was not found.`, `Error: Ticket <ticket-id> is in Trash; moved at <deleted-at> by <deleted-by>.`, and `Error: Ticket <ticket-id> is <status>; expected an open Ticket.`. Mechanically map `_tag` to JSON `type`, preserve fields, add no prose `message`, and perform no Store reread.

## Canonical Ticket Snapshot

- Expose one closed `OpenTicket | DoneTicket | CancelledTicket` lifecycle union sharing exact `TicketBase { id, level, executor, subject, description, context?, parentId?, blockedBy?, createdAt, updatedAt }` fields.
- Restrict level to `epic | task | subtask`, Executor to `agent | human`, and public `TicketStatus` to exact `open | done | cancelled`; use status as the lifecycle discriminant and enforce the approved hierarchy compatibility rules.
- Require open Tickets to contain no terminal fields; done Tickets to contain exactly `result`, `completedAt`, and `completedBy` beyond the base; and cancelled Tickets to contain exactly flat `reason`, `cancelledAt`, and `cancelledBy` beyond the base.
- Reject excess or cross-lifecycle fields. Include no nested single-field `cancellation` wrapper, embedded Claim, Ticket `formatVersion`, or Ticket `schemaVersion`.
- Omit absent `context`, `parentId`, and `blockedBy` values from typed encodings and JSON rather than encoding `null`; require present `blockedBy` to be non-empty, unique, and sorted by ascending Ticket ID, and omit it after the final dependency is removed.
- Preserve this same canonical Snapshot representation in persistence, public core results, complete-Ticket JSON, Trash entries, and any Activity event that deliberately contains a complete Ticket.
- Set `createdAt` equal to `updatedAt` at creation. Advance `updatedAt` only for effective Snapshot mutations; set it equal to `completedAt` or `cancelledAt` for terminal transitions; preserve every timestamp for no-ops and all Claim-only changes.

## Canonical Actor Identity

- Define Actor Identity as an opaque caller-asserted single-line label. Apply ECMAScript `String.prototype.trim()` semantics, require non-empty text, reject Unicode control characters, and enforce at most 128 UTF-8 bytes after trimming; accept exactly 128 bytes and reject one byte over.
- Preserve case, Unicode, punctuation, and internal spaces without Unicode normalization or case folding. Compare canonical Actor strings exactly across Claims, fences, lifecycle attribution, Activity, errors, and output.
- Decode CLI `--actor`, `TM_ACTOR`, and direct core inputs through the same schema. Distinguish a missing Actor (`ActorIdentityRequired`) from a supplied blank, multiline, control-containing, or oversized boundary-validation failure.

## Canonical Claim record

- Expose one closed `Claim { claimId, ticketId, actor, claimedAt, expiresAt }` schema with no embedded Ticket or Snapshot fields.
- Generate every `claimId` as a canonical UUIDv4 for one Claim incarnation and require `expiresAt` to be exactly one hour after `claimedAt`.
- Preserve the same complete Claim field names and values in persistence, typed core results, composed reads, structured errors that deliberately disclose a Claim, Semantic Activity events containing a complete Claim, and JSON output.
- Reject excess Claim fields and keep every Claim separate from its Ticket Snapshot.

## Cross-cutting minimum evidence

- `bun run check` passes.
- Core behavior tests use the public `@urban/task-manager` typed interface.
- CLI tests prove flag parsing, environment fallback, output, and error rendering without duplicating core behavior assertions.
- Render the complete canonical Subject on every human CLI surface, including receipts, details, trees, previews, relationship displays, and typed error or recovery summaries; apply no adapter-specific truncation beyond the domain's 50-character Subject validation.
- Preserve the same complete authoritative Subject in typed core values, persistence, Semantic Activity, structured errors, human output, and JSON output.
- Storage integration tests use real temporary file-backed Stores.
- At least one bounded multi-process test proves two writers cannot corrupt or overwrite one another.
- At least one Claim race proves only one process acquires an unclaimed Ticket.
- At least one rollback/reopen smoke test proves a failed mutation leaves no partial active Ticket, Trash, or Activity state.
- Every state-changing Ticket or Claim command proves Actor attribution and Claim fencing when applicable. Every effective mutation proves atomic Activity emission, while failures and no-ops emit none. Store initialization requires no Actor and emits no Activity.
- No command accepts `--force`, and no typed core operation accepts a generic force or unsafe-bypass boolean. Actor Identity mismatch against an active Claim is never waivable.
- Every direct mutation of a Ticket protected by an active Claim requires both matching Actor Identity and the exact current Claim ID; prove Actor Identity alone cannot let a stale same-Actor process mutate after renewal or replacement. For soft deletion, prove every selected active Claim blocks categorically and only a surviving direct parent's Claim may be exactly fenced.
- Fence direct mutation targets rather than the transitive graph of derived observers: do not require a claimed dependent's fence when a prerequisite becomes terminal, a claimed parent's fence when a child becomes terminal, or a claimed dependency's fence for a derived reverse `Blocks` relationship.
- Retain child creation beneath an actively claimed parent as the one explicit structural exception, requiring matching Actor Identity and exact parent Claim ID because the operation changes the parent's decomposition.
- Require `tm block` and `tm unblock` to fence only the directly modified blocked Ticket, not the dependency Ticket.
- Require every completion to be performed by the matching active Claim holder with the exact Claim ID; permit no unclaimed completion path. Permit the matching holder to cancel a claimed target directly and permit cancellation of an unclaimed target without a Claim fence. Require every softly deleted target and descendant to be unclaimed. Atomically remove any permitted terminal target Claim on success, emit only the operation-specific terminal Activity, and require no preliminary release transaction.
- Include `ClaimConsumption` as `Unclaimed | Consumed { claimId }` in completion and cancellation Activity, constrain every `TicketCompleted` event to `Consumed`, and prove the exact removed Claim incarnation is recorded without embedding the complete Claim or emitting a release event. For cancellation cascades, permit only the explicit target to record `Consumed` and require every changed descendant to record `Unclaimed`. Require `TicketTrashed` to contain no `ClaimConsumption`.
- Keep completion non-cascading and reject every open descendant whether claimed or unclaimed. Permit cancellation across open descendants and soft deletion across all-lifecycle descendants only when every selected descendant is unclaimed; reject the entire operation when any descendant has an active Claim, including one held by the command Actor, and accept no descendant Claim-fence collection.
- Model cancellation scope as `TargetOnly | CascadeOpenDescendants`: map omitted CLI `--cascade` to `TargetOnly` and reject transaction-current open descendants; map supplied `--cascade` to `CascadeOpenDescendants` and atomically include every transaction-current open descendant. Remove generic `--yes`, do not bind scope to any caller-observed Ticket set, and never treat scope as a Claim bypass.
- Model cancellation Executor scope as `AgentOnly | AnyExecutor`: map omitted CLI `--allow-human` to `AgentOnly` and supplied `--allow-human` to `AnyExecutor`; enforce it against every transaction-current Ticket the invocation would cancel, not unchanged terminal descendants or graph observers, without passing a raw approval boolean or treating Executor scope as authorization.
- Return typed `ClaimedDescendants` with the target ID and a canonically ordered non-empty collection containing every blocking descendant's Ticket ID, Subject, Executor, and complete active Claim; render holder, Claim ID, and expiry in human output, preserve structured entries in JSON, and prove failure is atomic.
- Claims persist as separate coordination records rather than Ticket fields; Claim acquisition, renewal, release, and logical expiry never modify the Ticket Snapshot or `updatedAt`, while composed reads expose only the effective active Claim alongside the Ticket.
- Freeze Executor for the lifetime of an active Claim: reject an effective Executor transition by every Actor including the matching holder, permit other matching-holder edits, preserve ordinary no-op treatment for a same-value Executor request, and require release or expiry followed by unclaimed update and fresh acquisition for an Executor handoff.
- Represent mutation intent for operations that permit unclaimed targets as `TargetClaimFence = RequireUnclaimed | MatchClaim { claimId }`; map omitted optional CLI `--claim-id` to `RequireUnclaimed` and a supplied ID to `MatchClaim` without a CLI pre-read; require `RequireUnclaimed` to observe no active Claim and require `MatchClaim` to observe the exact active Claim and matching Actor.
- Expose optional target `--claim-id` and required Actor Identity on `update`, `cancel`, `block`, and `unblock`; require exact target `--claim-id` on `complete`, `renew`, and `release`; retain optional `create --parent-claim-id`; expose only optional surviving-parent `delete --parent-claim-id`; and accept no Claim fence on acquisition-only `claim`.
- For well-formed effective mutation requests, prove precedence is Store/Ticket resolution, lifecycle eligibility, explicit target Claim fence (`ActiveClaimRequiresFence` for `RequireUnclaimed` against an active Claim; `NoActiveClaim`, `ClaimIdMismatch`, then `ActorMismatch` for `MatchClaim` by first failed fence), descendant-Claim blockers, then hierarchy, dependency, and other operation invariants; do not aggregate errors.
- Reject rather than ignore `MatchClaim` when the observed Claim expired or was released; require the caller to reread and explicitly retry with `RequireUnclaimed` or acquire a new Claim.
- Preserve the narrow precedence exceptions: effective `tm update` no-op detection follows lifecycle eligibility but precedes and ignores Claim fencing; `tm block` returns `AlreadyBlocked` and `tm unblock` returns `AlreadyUnblocked` after endpoint resolution and open target lifecycle but before target Claim fencing; and `tm release` returns `AlreadyInactive` for an open Ticket without an active Claim without validating its supplied Claim ID. Every proven no-op writes nothing and emits no Activity. Cancellation validates its target fence before descendant state. Deletion instead rejects an active target Claim and validates any surviving direct-parent fence before descendant state. Let each target-only scope reject its applicable descendants without inspecting their Claims or Executors, while cascade scopes check claimed descendants before later operation invariants.
- Prove CLI parsing, file loading, boundary-schema validation, and adapter confirmations occur before a well-formed core mutation request and cannot waive core invariants.
- Exact six-character Ticket IDs are accepted; shorter, longer, malformed, active-duplicate, and Trash-reserved IDs are rejected or regenerated as applicable.

## Required Actor adapter failure

- After `--actor`, then `TM_ACTOR`, yield exact fieldless `ActorIdentityRequired` when a state-changing Ticket or Claim command still lacks Actor Identity. Make no core call or Store read.
- Apply the failure uniformly to applicable mutation commands, but not to reads, `tm init`, `tm validate`, or deletion preview without `--yes`. Treat an explicitly supplied invalid Actor as boundary-validation failure rather than absence.
- Render exact human `Error: Actor Identity is required; pass --actor or set TM_ACTOR.` and exact JSON `{ "ok": false, "error": { "type": "ActorIdentityRequired" } }`; include no command name or prose JSON message.

## Adapter confirmation errors

- Expose exact fieldless `EmptyDescriptionConfirmationRequired` when create or update supplies a Description that canonically normalizes through shared CR/LF normalization and ECMAScript trim to empty without `--allow-empty-description`. Resolve inline/file input and normalize before the check; perform no Store read or core call. Render exact `Error: An empty Description requires --allow-empty-description.`.
- Expose exact `HumanCompletionConfirmationRequired { ticketId }` only when completion pre-read finds the direct target open and human-executor without `--allow-human`. Let terminal targets proceed to core lifecycle handling, and rely on required Claim-ID fencing plus active-Claim Executor freeze to invalidate a later Executor change.
- Render exact `Error: Completing human-executor Ticket <ticket-id> requires --allow-human.`. Mechanically map confirmation tags to JSON `type`, preserve only applicable fields, add no prose `message`, and prove confirmations waive no other invariant.

## Effect CLI and shared adapter failures

- Build the CLI with the pinned `effect/unstable/cli` command tree, flags, arguments, parameters, structured `CliError`, formatter, help, version, and shell-completion support. Do not implement a second argv lexer/parser, choice validator, help generator, or completion generator.
- Disable Effect CLI automatic error rendering where Task Manager owns the global human/JSON envelope. Mechanically project structured Effect parse facts without reparsing argv or prose.
- Map Effect `UnrecognizedOption`, `MissingOption`, `MissingArgument`, `UnexpectedArgument`, `InvalidValue`, and `UnknownSubcommand` to stable project-owned parse reasons. Treat Effect `DuplicateOption` as an application construction defect because it identifies parent/child declaration collision rather than repeated argv.
- Declare every singular flag with Effect occurrence bounds such as `Flag.atMost(1)` and mechanically project an excess-occurrence `InvalidValue` to public `DuplicateOption` before environment fallback. Keep cross-parameter source conflicts as small post-parse checks.
- Expose exact `CliParseError { reason }` with `UnknownCommand | UnknownOption | UnexpectedArgument | MissingArgument | MissingOption | MissingOptionValue | DuplicateOption | InvalidOptionValue | ConflictingOptions`. Keep missing required option distinct from a present option without a value.
- When Effect accumulates lexical failures, expose only the first in argv order. Report only the first unexpected positional argument. Preserve command-declaration order for expected values and conflicting-option collections; omit parser suggestions from structured JSON.
- Use Effect CLI parameter schemas/filters and Effect Schema decoding wherever they preserve approved source and precedence. Expose exact opaque schema-backed `PublicPathIndex` as a non-negative safe integer, `PublicStructuralPath = ReadonlyArray<string | PublicPathIndex>`, `InputRejected { input: { source, name }, issues }`, and `PublicSchemaIssue { path: PublicStructuralPath, code, expected }`; structurally map schema issues without raw rejected values, complete records, formatter internals, or schema objects, preserving traversal order.
- Render every public structural path in human output with canonical bracket notation: `$` for the empty path; append `[<canonical-JSON-string>]` for each string segment and `[<canonical-non-negative-decimal>]` for each index; never use dot shorthand. Prove `["blockedBy", 1]` renders `$["blockedBy"][1]`, unusual string segments remain unambiguous, and JSON preserves the original segment array rather than the display string.
- Use Effect FileSystem and Path services for OS access. Expose exact `FileInputError { option, path, reason }` with `FileNotFound | NotRegularFile | InvalidUtf8 | FileReadFailed`, and exact `PathResolutionError { setting, path?, reason }` with `PathNotFound | NotDirectory | HomeDirectoryUnavailable | CanonicalizationFailed`.
- Add custom path code only for the approved canonical missing-tail Store resolution and stable error projection. Require file errors to identify selecting option and canonical path; require path errors before Layer construction; expose no parser-library, `SchemaIssue`, or raw OS values.
- Mechanically map outer and nested tags to JSON `type`, preserve fields, and add no generic `message`. Begin human output with `Error:`; permit the pinned no-color Effect formatter for the underlying parse fact without adopting its automatic error envelope. Keep help, version, and shell completions owned by Effect CLI.

## Global CLI process and JSON contract

- Exit `0` for every success, including no-ops, empty reads, `NoActionableWork`, and `tm init` `Existing`; exit `1` for every expected parse, input, confirmation, Store, lookup, or domain failure.
- Give help, version, and shell-completion output status `0`; do not define structured product semantics for unexpected defects or external-signal exit conventions.
- Without `--json`, write success only to stdout and expected failure only to stderr, with every human failure beginning `Error:`. End every Task Manager-owned human success or expected-failure output with exactly one newline and no additional trailing blank line; leave help, version, and shell-completion byte formatting to Effect CLI.
- With `--json`, write exactly one compact JSON object and one trailing newline to stdout for success or expected failure, and leave stderr empty.
- Require `ok: true` on every JSON success and exact `{ ok: false, error: StructuredCliError }` on every JSON failure.
- Mechanically encode typed adapter/core failures without a generic duplicate human `message`; permit bounded diagnostic prose only when an approved typed reason defines it as evidence, and require consumers to identify failures by `type`.
- Exercise representative success, no-op, no-work, parse, confirmation, lookup, Store, and domain-rejection processes through the real CLI entrypoint and assert status, stdout, stderr, one-object framing, and newline behavior.

## Global no-force command coverage

- Reject `--force` as an unknown flag on `init`, `validate`, `create`, `update`, `show`, `list`, `next`, `claim`, `renew`, `release`, `complete`, `cancel`, `delete`, `block`, and `unblock`; expose no renamed actor-override flag.
- Prove `init`, `validate`, `show`, `list`, and `next` have no Claim-fence capability or force Activity.
- Prove `create` fences only an active parent through `--parent-claim-id`; dependency Claims do not participate.
- Prove `update`, `cancel`, `block`, and `unblock` map optional target `--claim-id` to `TargetClaimFence`; prove `complete` requires an exact Claim ID and has no `RequireUnclaimed` variant; prove deletion accepts no target or descendant Claim ID and maps only optional `--parent-claim-id` to `ParentClaimFence`; require no descendant or graph-observer fence collection.
- Prove `claim` remains acquisition-only, while `renew` and `release` require exact Claim IDs and matching Actors without takeover, transfer, or non-holder release.
- Prove lifecycle, hierarchy, dependency readiness, human gates, destructive confirmation, Result/Cancellation/input validation, missing Claim IDs, stale Claim IDs, and Actor mismatch have no override path.
- Prove redundant `--force` is rejected rather than accepted or specially recorded; no command accepts a force reason, and no Activity contains force, override, displacement, or forced-release metadata.
- Prove release emits only ordinary `TicketClaimReleased`, while completion and cancellation emit only their ordinary event with `ClaimConsumption`; constrain completion to `Consumed` and never pair any terminal path with an extra release event. Prove deletion emits minimal `TicketTrashed` without Claim consumption or release Activity.

Representative global scenarios:

- Race an unclaimed-target mutation against acquisition and require `ActiveClaimRequiresFence` with no mutation or Activity when acquisition commits first; prove the name does not imply that an initially unclaimed target must first be claimed.
- Renew `C1` to `C2`, then attempt a same-Actor mutation with `C1`; require `ClaimIdMismatch` before operation-specific failures.
- Release or expire `C1`, then attempt `MatchClaim(C1)` without a replacement Claim; require `NoActiveClaim`, not silent unclaimed mutation.
- Exercise a human gate with valid and invalid Claim fencing; prove `--allow-human` changes only adapter confirmation and never the core fence outcome.
- Attempt a mutation on a terminal Ticket with stale Claim input; require lifecycle failure before Claim fencing and preserve terminal history.
- Attempt completion with a valid target fence and an open dependency; require `OpenDependencies` and prove there is no bypass.
- Attempt parent cancellation and deletion with several claimed descendants; return all `ClaimedDescendants` details in canonical order and commit nothing, including when every descendant Claim has the same Actor as the command.
- Release each blocking descendant cooperatively or let Claims expire, then retry the parent operation and prove only unclaimed descendants cascade.
- Exercise orchestrator-held sequential work and cooperative holder release followed by acquisition; prove there is no unilateral Claim transfer and another claimant may win the handoff race.

## Reviewed command scenarios

### `tm init`

- Expose schema-backed `StoreInitializationRejected { databasePath, reason }` with exact `LegacyStoreDetected { legacyPath } | InvalidDatabase { diagnostic } | ApplicationIdentityMismatch { expectedApplicationId, actualApplicationId? } | IncompatibleFormat { expectedFormatVersion, actualFormatVersion? } | InvalidStoreStructure { component, issues }` reasons.
- Treat an absent Store as initialization success, never `StoreNotInitialized`. Never import, migrate, replace, or silently ignore detected legacy `tasks.jsonl`; distinguish corrupt/non-database content, unrelated application, incompatible format, and partial schema or malformed metadata.
- Expose opaque schema-backed `ObservedApplicationId` only for persisted observations already invariant under ECMAScript trim, non-blank, single-line, free of Unicode control characters, and at most 128 UTF-8 bytes; preserve accepted case, Unicode, punctuation, and internal spacing without Unicode normalization. Expose opaque schema-backed `ObservedFormatVersion` only for non-negative safe integers.
- Use `ObservedApplicationId` and `ObservedFormatVersion` for optional initialization and validation `actual*` fields. Omit an unsafe or undecodable observation rather than encoding `null`, sanitizing, truncating, or coercing it; still classify the mismatch without public disclosure. Use shared bounded diagnostics and public schema issues without raw persistence data.
- Expose exact `initializeStore(): Effect.Effect<InitializeStoreResult, StoreInitializationRejected | StoreMutationError, TaskManager>`. Permit generic Store mutation reasons except make `StoreNotInitialized` impossible for initialization.
- Render exact recovery-specific human headings for every initialization reason, use literal `unknown` for omitted human observations, append shared deterministic schema-issue lines for invalid structure, and mechanically map JSON tags without prose `message`.
- Prove every rejection leaves existing files unchanged and concurrent initialization still yields one `Created` plus compatible `Existing` outcomes.
- Fresh dedicated location returns `Created { metadata }` and establishes one valid empty Store whose committed metadata has `applicationId: "task-manager"`, `formatVersion: 1`, one canonical UUIDv4 Store Identity, and `activityHighWater: 0`.
- Repeating initialization returns `Existing { metadata }` with the authoritative existing Store Identity and current Activity high-water, without changing state or emitting Activity.
- Expose exactly `InitializeStoreResult = Created { metadata } | Existing { metadata }`; return no Store Location, libSQL client, persistence handle, or engine details from the core operation.
- Concurrent initialization yields one Store and no partial schema.
- A legacy `tasks.jsonl`, unrelated database, partial Task Manager database, corrupt database, or incompatible format fails without replacement.
- Render human `Created` exactly as `Initialized Task Manager Store <store-id> at <database-path>.` and `Existing` exactly as `Task Manager Store <store-id> already exists at <database-path>.`; never describe the existing outcome as created, initialized, or opened.
- Render JSON as exactly `{ ok: true, outcome: "created" | "existing", storeLocation, databasePath, metadata }`, using canonical absolute paths and the complete transaction-current metadata with no Activity or persistence handle.

### `tm validate`

- A valid empty and non-empty Store returns exact `ValidateStoreReport { metadata, counts }`, where counts contain non-negative safe integers for `tickets`, `openTickets`, `doneTickets`, `cancelledTickets`, `claimRecords`, `trashEntries`, and `activityItems`.
- Require `tickets === openTickets + doneTickets + cancelledTickets`, exclude Trash from `tickets`, count persisted Claim records including logically expired records, and require `activityItems === metadata.activityHighWater` under contiguous cursor validation.
- Prove empty Activity reports both Activity values as zero and validation performs no logical-expiry cleanup or other write.
- Render JSON exactly as `{ ok: true, storeLocation, databasePath, report }` with canonical absolute paths and complete metadata/counts.
- Render human success as exactly five lines: the Store Identity/format/path heading; lifecycle Ticket counts; Claim-record count; Trash-entry count; and Activity-item/high-water count using the approved punctuation and labels.
- Return no active/expired Claim classification, readiness, actionability, Activity payload, Trash Snapshot, or partial success report.
- Enforce exact fail-fast gate precedence after canonical Store resolution: absent database as `StoreNotInitialized`; inability to open or query enough state for classification as `StoreValidationReadError`; non-database or corrupt content as `InvalidDatabase`; safely inspectable non-Task-Manager identity as `ApplicationIdentityMismatch`; recognized non-1 Task Manager format as `IncompatibleFormat`; expected application/format structure as `InvalidStoreStructure` with `schema` before `metadata`; then engine `quick_check`, foreign keys, persisted-record decoding, and cross-record domain integrity.
- When an earlier gate fails, return only its typed gate failure and do not claim or attempt later checks whose results would be unsafe or meaningless.
- Once the Store is safely inspectable, run every deterministic record-schema and cross-record integrity check and return all discovered issues as one canonically ordered schema-enforced non-empty collection; never return issues alongside a success report.
- Seed a readable Store with independent malformed-record, relationship, and Activity defects and prove one validation returns all safely discoverable issues in canonical order without writing.
- Represent every validation-specific failure as schema-backed `StoreValidationRejected { databasePath, reason }` using the same Effect reason-error pattern as mutation commands; require the configured canonical absolute database path as runtime error context without treating it as Store metadata or duplicating it inside each reason, and prove parent catching, nested-reason catching, and reason unwrapping.
- Use the closed reason union `StoreNotInitialized | InvalidDatabase | ApplicationIdentityMismatch | IncompatibleFormat | InvalidStoreStructure | EngineIntegrityFailed | ForeignKeyIntegrityFailed | StoreIntegrityIssues`. Keep generic open/query failures outside the resolved validation boundary as exact `StoreValidationReadError { _tag: "StoreReadError", databasePath, reason: StoreOpenFailed | StoreQueryFailed }`, reusing shared parent/reason JSON tags and payloads; make Store absence impossible through this outer error because validation reports it only as nested `StoreNotInitialized`.
- Expose exact gate schemas: fieldless `StoreNotInitialized`; `InvalidDatabase { diagnostic }`; `ApplicationIdentityMismatch { expectedApplicationId: "task-manager", actualApplicationId?: ObservedApplicationId }`; `IncompatibleFormat { expectedFormatVersion: 1, actualFormatVersion?: ObservedFormatVersion }`; and `InvalidStoreStructure { component: "schema" | "metadata", issues: NonEmptyReadonlyArray<PublicSchemaIssue> }`, in addition to the separately declared engine and foreign-key failures.
- Require `StoreIntegrityIssues` to contain a schema-enforced non-empty canonically ordered collection of the closed issue union `RecordSchemaInvalid | HierarchyIntegrityInvalid | DependencyIntegrityInvalid | ClaimIntegrityInvalid | ActivityIntegrityInvalid | TrashIntegrityInvalid | ActiveTrashIdentityOverlap`.
- Give every issue only its exact structured public fields; expose no complete malformed record, SQL identifier, query, table name or layout detail, generic detail string, or persisted human message. Omit an undecodable optional observed Cursor rather than encoding `null`, keep boundary-shape detail in `PublicSchemaIssue`, and keep semantic variants purpose-specific.
- Expose exact `PersistedRecordLocator { ordinal }`; assign its positive one-based value from the collection's public-evidence validation scan. Sort records with a safely decoded public collection identity before records without one; order present Ticket, Claim, and Trash identities by ascending ECMAScript string order and Activity identities numerically; then compare tied or identity-undecodable records by their complete safely derived public diagnostic projection of ordered schema issues and public foreign-key evidence, excluding the locator being constructed.
- Treat records with identical public diagnostic projections as diagnostically equivalent and assign their consecutive ordinal range without a private tie-breaker. Prove physical retrieval or insertion order cannot affect output, and use no SQL row ID, table layout, raw-record encoding, hash, hidden durable sequence, Store identity, or stable repair handle as the public ordering basis.
- Seed valid, malformed-with-decodable-identity, and multiple identity-undecodable records in different physical orders and require identical locators and diagnostics. Require physically reordered Activity records with decoded Cursors `3, 1, 2` to scan as `1, 2, 3`, while decoded/undecodable observations `1, 3, undecodable` produce the approved expected/observed sequence issues.
- Expose exact `RecordSchemaInvalid { collection, locator, issues }`, with collection restricted to `tickets | claims | trash | activity` and schema-enforced non-empty `PublicSchemaIssue` values.
- Give every persisted record that fails its complete collection schema one `RecordSchemaInvalid`. Permit only completely schema-valid Tickets, Claims, Trash entries, and Activities to own or satisfy domain-semantic checks; never salvage fields from a malformed record to manufacture a partial domain object, cycle participant, Trash-attribution event, or active/Trash-overlap participant.
- Continue every eligible semantic check over the complete projection of schema-valid records despite unrelated malformed records. When a schema-valid record references an identity whose only persisted record is schema-invalid, require the applicable `ParentNotFound`, `DependencyNotFound`, `ClaimTicketNotFound`, or `MissingTicketTrashed` issue because no canonical counterpart exists.
- Treat Activity Cursor integrity as the narrow Store-global persisted-sequence exception rather than an issue owned by a canonical Activity. For every deterministic Activity validation-scan position, derive `expectedCursor` from its positive one-based ordinal and independently decode `observedCursor`; emit exactly one `ActivityCursorSequenceInvalid` for that position only when the observation is undecodable or differs, omitting only an unsafe observation. Let a schema-invalid Activity also emit `RecordSchemaInvalid`, but emit its sequence issue only for an independently established Cursor defect and never let it satisfy Trash attribution or another Activity-event semantic check.
- Emit no synthetic sequence issue beyond the persisted Activity record count. Evidence an internal missing Cursor through the later record occupying its expected position and evidence a missing tail only through high-water disagreement. Treat physical row or retrieval order as non-domain behavior and use only the deterministic validation scan order for expected positions.
- Derive `observedHighWater` as `0` for no Activity records or otherwise the numeric maximum of all independently decoded Cursors. Emit exactly one `ActivityHighWaterMismatch` whenever that safe value differs from metadata, including alongside sequence issues; suppress it whenever any Cursor is undecodable.
- Seed one malformed Ticket whose canonical-looking ID is referenced by a schema-valid child and Claim, plus an unrelated cycle among schema-valid Tickets. Require `RecordSchemaInvalid`, `ParentNotFound`, `ClaimTicketNotFound`, and the independent cycle, while emitting no semantic issue owned by the malformed Ticket.
- Expose exact `HierarchyIntegrityInvalid { ticketId, reason }`, where reason is `ParentRequired | ParentForbidden { parentId } | ParentNotFound { parentId } | InvalidParentLevel { childLevel, parentId, parentLevel } | HierarchyCycle { cycle }`.
- Expose exact `DependencyIntegrityInvalid { ticketId, reason }`, where reason is `DependencyNotFound { dependencyId } | DuplicateDependency { dependencyId } | SelfDependency { dependencyId } | DependencyCycle { cycle }`.
- Make duplicate current Claims unrepresentable in a structurally valid Store: enforce at most one current Claim record per Ticket and global uniqueness of `claimId`. Require missing or malformed uniqueness constraints to fail `InvalidStoreStructure`, established-constraint engine corruption to fail `EngineIntegrityFailed`, and normal core operations never to create duplicate Claim IDs.
- Expose exact `ClaimIntegrityInvalid { claimId, ticketId, reason }`, where reason is only `ClaimTicketNotFound | ClaimTicketNotOpen { status } | InvalidLeaseWindow { claimedAt, expiresAt }` and terminal status is `done | cancelled`; expose no redundant semantic duplicate-Claim-ID reason after structural and engine gates.
- Expose exact `ActivityIntegrityInvalid { reason }`, where reason is `ActivityCursorSequenceInvalid { expectedCursor, observedCursor? } | ActivityHighWaterMismatch { metadataHighWater, observedHighWater }` and each high-water value is `0 | ActivityCursor`; expose no outer owner Cursor for a Store-global sequence issue.
- Make duplicate Activity Cursors and duplicate `TicketTrashed` Activity for one Ticket unrepresentable in a structurally valid Store through independent uniqueness constraints. Require a missing or malformed constraint to fail `InvalidStoreStructure`, established-constraint engine corruption to fail `EngineIntegrityFailed`, and normal core operations never to create either duplicate. Emit no aggregate semantic duplicate-Cursor or duplicate-`TicketTrashed` reason after those gates.
- Expose exact `TrashIntegrityInvalid { ticketId, reason }`, where reason is only `MissingTicketTrashed | TicketTrashedAttributionMismatch { cursor, expectedDeletedAt, observedOccurredAt, expectedDeletedBy, observedActor }`; retain missing and attribution mismatch because uniqueness establishes neither existence nor agreement, and expose no redundant semantic duplicate-Activity reason.
- Expose exact `ActiveTrashIdentityOverlap { ticketId }` with no nested reason.
- Emit exactly one cycle issue per maximal cyclic component of each applicable schema-valid active-Ticket graph, where every component member reaches every other by following stored directed edges and no additional Ticket can join while preserving mutual reachability. Follow child-to-parent direction for hierarchy and Ticket-to-prerequisite direction for dependencies.
- Own each cycle issue with the component's ascending-smallest Ticket ID. Require its `cycle` to be the shortest directed closed path beginning and ending with that owner; break equal-length ties by positional ascending Ticket-ID comparison, and require the schema-enforced non-empty closed array's first and last IDs to equal the outer `ticketId`.
- Treat a hierarchy self-parent as a one-Ticket `HierarchyCycle`. Emit `SelfDependency` rather than a redundant one-Ticket `DependencyCycle` for every dependency self-edge. Still emit one ordinary witness for a multi-Ticket dependency component containing that Ticket, excluding self-edges when selecting the multi-Ticket witness. Never emit cycle issues per participant or enumerate every simple cycle.
- Canonically order categories by exact declared `StoreValidationIssue` union order: `RecordSchemaInvalid`, `HierarchyIntegrityInvalid`, `DependencyIntegrityInvalid`, `ClaimIntegrityInvalid`, `ActivityIntegrityInvalid`, `TrashIntegrityInvalid`, then `ActiveTrashIdentityOverlap`. Use exact collection order `tickets`, `claims`, `trash`, then `activity`, and order nested reasons and other closed-union discriminants by declared variant order.
- After semantic ranks, apply one total structural comparator through the exact public schemas: object fields in declaration order; strings in ascending ECMAScript string order; numbers numerically; present optional values before absence; arrays positionally with a shorter equal prefix first; and nested objects recursively by the same rules.
- Retain the specialized public-path comparator of string segments before indexes, strings ascending, indexes numerically, and shorter equal prefixes first. Compare canonical cycles positionally by Ticket ID with shorter equal prefixes first.
- Compare public schema-issue sequences positionally in preserved traversal order rather than resorting them; compare each issue by path, declared code order, then expected text in ascending ECMAScript string order.
- Require exact category keys: collection then locator ordinal for `RecordSchemaInvalid`; `ticketId` for hierarchy and dependency; `claimId` then `ticketId` for Claim; reason rank, `expectedCursor`, then optional `observedCursor` for Activity sequence; reason rank, metadata high-water, then observed high-water for Activity high-water; `ticketId` for Trash; and `ticketId` for active/Trash overlap. Compare remaining reason payload fields in schema declaration order.
- When every structured field is equal, compare the issues equal and retain duplicate multiplicity without a SQL, insertion-order, or hidden private tie-breaker. Prove representative Claim-ID/Ticket-ID crossings, multiple reasons for one owner, Activity sequence positions, payload ties, and exact duplicate issues produce one implementation-independent ordered result.
- Mechanically map every outer, reason, issue, and nested-reason `_tag` to JSON `type`, preserve the complete nested structure and ordering, and omit duplicate `message` fields.
- Render human diagnostics entirely from typed reasons and issues without rereading the Store or parsing free-form details; begin aggregated integrity issues exactly `Error: Task Manager Store validation failed:` and preserve canonical issue order.
- Render `RecordSchemaInvalid` as `- <collection> record <ordinal> has invalid schema:` followed by every schema issue in preserved order as `  - <path>: <code>; expected <expected>`. Render every other aggregated issue as exactly one top-level `- ` line using the architecture's approved reason-specific hierarchy, dependency, Claim, Activity, Trash, or identity-overlap template.
- Join canonical closed cycle IDs with ` -> `; render `ActivityCursorSequenceInvalid` exactly as `- Activity cursor sequence at position <expected-cursor>: observed <observed-cursor-or-undecodable>.`; render an omitted observed Activity Cursor as exact `undecodable`; and prove every aggregated line is derived only from the typed issue without a Store reread.
- Render gate failures exactly from `StoreValidationRejected.databasePath` and the typed reason: reuse the approved absent-Store, invalid-database, application-mismatch, incompatible-format, and invalid-structure lines; render each invalid-structure schema issue as `- <path>: <code>; expected <expected>`; head engine failure with `Error: Task Manager Store at <database-path> failed engine integrity validation:` and render each ordered diagnostic as `- <diagnostic>`; head foreign-key failure with `Error: Task Manager Store at <database-path> failed foreign-key integrity validation:` and render each ordered violation as `- <source-collection> record <ordinal> (<source-identity>) field <field-path> references <reference-collection> (<reference-identity>).`
- Render safely decoded persisted identities exactly as `Ticket <ticket-id>`, `Claim <claim-id>`, `Trash Ticket <ticket-id>`, or `Activity <cursor>`; render an omitted identity as exact `undecodable`, use literal `unknown` for an omitted observed application identity or format version, and use canonical bracket notation for schema and foreign-key paths.
- Give `StoreNotInitialized` no payload; give `ApplicationIdentityMismatch` explicit expected identity plus optional exact `ObservedApplicationId`; and give `IncompatibleFormat` explicit expected version plus optional exact `ObservedFormatVersion`. Accept application observations at exactly 128 UTF-8 bytes and reject disclosure one byte over; accept format zero and the greatest safe integer and omit negative, fractional, non-finite, string, or larger numeric observations. Omit unavailable observations rather than encoding `null`, sanitizing, truncating, or coercing them, and render omitted human observations as literal `unknown`.
- Give `InvalidDatabase` only a normalized bounded diagnostic with no vendor stack, SQL, raw error object, or path alias.
- Give `InvalidStoreStructure` a `schema | metadata` component and non-empty public-path schema issues.
- Expose exact `EngineIntegrityFailed { diagnostics: NonEmptyReadonlyArray<BoundedDiagnostic> }`; normalize and bound every `quick_check` diagnostic, sort them in ascending ECMAScript string order, retain duplicate observations, and expose no SQL execution details.
- Expose exact named `PublicTicketReference`, `PublicClaimReference`, `PublicTrashReference`, and `PublicActivityReference` variants and their `PublicPersistedRecordReference` union, with each variant's collection literal coupled to its Ticket ID, Claim ID, Trash Ticket ID, or Activity Cursor identity.
- Expose exact collection-discriminated `ForeignKeyViolationSource` and `ForeignKeyViolationReference` unions that couple every optional identity variant to the enclosing collection, then exact `ForeignKeyViolation { source: ForeignKeyViolationSource, field: NonEmptyReadonlyArray<string | PublicPathIndex>, reference: ForeignKeyViolationReference }`; require `PersistedRecordLocator` on every source and permit optional identities only when safely decoded.
- Expose exact `ForeignKeyIntegrityFailed { violations: NonEmptyReadonlyArray<ForeignKeyViolation> }`. Omit an unsafe source or referenced identity instead of returning malformed raw data; expose no SQL column or table name, row ID, or private layout detail.
- Sort foreign-key violations by source collection in `tickets | claims | trash | activity` order, then source ordinal, field path, and safe referenced identity. Preserve the complete structure and optional-field omission in JSON, mechanically map every nested persisted-reference `_tag` to `type`, and render an omitted identity as exact `undecodable` without printing its value.
- Prove every vendor-originated diagnostic is mapped and bounded before crossing the core boundary and is never required to identify a reason programmatically.
- Model each aggregated issue with its own nested reason union rather than a generic record/related-IDs/detail envelope; prohibit unrelated optional fields and generic prose details.
- Return no complete offending record, malformed raw value, or canonical domain object manufactured from invalid persisted data. Retain semantic reasons only for states representable after structural and engine gates; assign constraint-unrepresentable states exclusively to those earlier gates without redundant aggregate variants.
- Invalid Store identity/format/schema fails.
- Engine quick-check or foreign-key failure fails.
- Malformed active Ticket, Claim, Trash entry, or Activity fails.
- Hierarchy and dependency cycles or dangling references fail.
- Missing Activity Cursors and high-water disagreement fail through aggregate Activity integrity; duplicate Activity Cursors fail only through the earlier structural or engine uniqueness gate; broken Trash/`TicketTrashed` attribution and active/Trash ID overlap fail through their aggregate integrity issues.
- Validation performs no write and emits no Activity.
- Expose exact `validateStore(): Effect.Effect<ValidateStoreReport, StoreValidationRejected | StoreValidationReadError, TaskManager>` with no partial report or persistence context in the success value.

### `tm create`

- Expose exact `CreateTicketInput { actor, level, executor, subject, description, context?, parent?, blockedBy }`, requiring an always-present dependency array whose empty value means none. Reject duplicate IDs at boundary decoding; sort accepted dependencies ascending and omit Snapshot `blockedBy` when empty.
- Expose exact `createTicket(input): Effect.Effect<OpenTicket, TicketCreationRejected | TicketNotFound | TicketInTrash | TicketIdSpaceExhausted | StoreMutationError, TaskManager>` with no success wrapper.
- Represent resolved creation invariants with schema-backed `TicketCreationRejected { reason }` and exact `ParentRequired | ParentForbidden { providedParentId } | ParentNotOpen { parentId, status } | InvalidParentLevel { parentId, parentLevel, childLevel } | ActiveParentClaimRequiresFence { parentId } | NoActiveParentClaim { parentId, providedClaimId } | ParentClaimIdMismatch { parentId, providedClaimId } | ParentActorMismatch { parentId, providedActor, activeClaim }` reasons. Support Effect parent/reason catching and reason unwrapping.
- Use fieldless `TicketIdSpaceExhausted` only when no active-or-Trash-unreserved six-character ID remains.
- Enforce input decoding before Store lookup, then parent shape, parent identity, parent lifecycle, parent level, parent Claim fence, dependency identity in ascending ID order, generated-ID reservation, and atomic creation without aggregating failures.
- Render exact recovery-specific human lines for all eight creation reasons plus `Error: No unused Ticket IDs remain.`; mechanically map tags to JSON `type`, preserve payloads, add no prose `message`, and perform no Store reread.
- Create root Epic/Task and valid Epic→Task→Subtask hierarchy.
- Reject invalid levels, parent placement, terminal parents, missing parents, duplicate/missing dependencies, and malformed exact IDs.
- Require matching parent Claim fence when the open parent has an active Claim.
- Support default `task` level and `agent` Executor.
- Normalize Subject, Description, and Context identically by replacing CRLF and remaining CR with LF, then applying ECMAScript `String.prototype.trim()` semantics. Preserve all remaining case, Unicode, punctuation, Markdown, internal spacing, tabs, and line breaks without Unicode normalization, subject to each field's control policy.
- Require Subject to remain non-blank and contain no LF, tab, or other Unicode control character. Accept exactly 50 Unicode code points and reject one code point over; prove the limit is independent of UTF-16 code units, grapheme clusters, and UTF-8 bytes.
- Require Description to be present, permit LF and tab, reject every other Unicode control character, and permit the canonical empty value only through CLI `--allow-empty-description`. Prove whitespace-only input normalizes to `""` rather than a distinct persisted state.
- Preserve Context as absent or normalized non-blank, using Description's multiline/control policy; reject supplied blank Context and remove it only through the explicit clear operation.
- Impose no additional Lean V1 domain size bound on Description or Context. Decode inline, file, and direct core inputs through the same schemas; persist and return canonical values unchanged across typed values, JSON, human output, Trash, and Activity; and use canonical equality for update no-op detection.
- Generate an ID absent from active Tickets and Trash.
- Atomically commit the Ticket and one correctly attributed `TicketCreated` item.
- Return the complete canonical committed `OpenTicket` directly from `createTicket(input)` with generated ID, normalized fields, canonical optional-field omission/dependency ordering, and committed timestamps; add no single-case wrapper, outcome tag, Claim, Activity, Cursor, or Store metadata.
- Render human success exactly as `Created <subject> (<ticket-id>).` and JSON exactly as `{ ok: true, ticket: <complete OpenTicket> }`, deriving both only from the core result without a Store reread.
- Failed creation leaves no Ticket or Activity.

### `tm update`

- Permit Subject, Description, Context, and Executor updates on open Tickets.
- Reject updates to done and cancelled Tickets without changing their Snapshot, Result or Cancellation, timestamps, or Activity.
- Require the matching Actor Identity and Claim ID for an actual text or Context update while an active Claim exists; reject missing, stale, or mismatched fences without changing the Ticket or Activity.
- Reject every effective Executor transition while an active Claim exists, including one requested by the matching holder with the exact Claim ID; require release or logical expiry, an unclaimed update, and fresh acquisition before completion under the new Executor.
- Do not permit generic force or a human confirmation to bypass the Claim fence or active-Claim Executor stability.
- Return `Unchanged` when all requested values already match an open Ticket, without checking its Claim fence, writing, advancing `updatedAt`, or emitting Activity; treat a same-value Executor request as ineffective even while a Claim is active.
- Reject done and cancelled Tickets before no-op detection.
- Expose exact `TicketEdit = SetSubject { subject } | SetDescription { description } | SetContext { context } | ClearContext | SetExecutor { executor }`, an opaque schema-backed `TicketEdits` branded non-empty readonly collection whose members are unique by edit tag, and exact `TicketEditsSchema: Schema.Codec<TicketEdits, NonEmptyReadonlyArray<TicketEdit>>`. Require callers to decode through that schema without assertions; reject duplicate edits for one field without changing the Ticket or Activity; and apply accepted edits atomically in one invocation.
- Reject an entire mixed update when it contains an effective Executor transition against an active Claim; apply none of its otherwise valid text or Context edits and emit no Activity.
- Emit one `TicketUpdated` item containing exactly the effective fields, including an unclaimed Executor transition, with their before and after values; do not include unchanged requested fields or a duplicate complete Ticket Snapshot.
- Accept explicit inline/file Subject, Description, and Context inputs, explicit Context clearing, and `--executor agent|human`; reject missing edits and conflicting input sources.
- Model update human-gate intent as required `ExecutorTransitionScope = PreserveHumanExecutor | AnyExecutorTransition` in `UpdateTicketInput`; map omitted CLI `--allow-human` to the former and a supplied flag to the latter without passing a raw approval boolean.
- Under `PreserveHumanExecutor`, reject an effective transaction-current unclaimed `human` to `agent` transition with `HumanExecutorTransitionExcluded`; permit it under `AnyExecutorTransition` subject to every other invariant. Do not restrict `agent` to `human`, text or Context edits on a human Ticket, or an Executor no-op.
- Enforce Executor transition scope after lifecycle, effective no-op detection, and Claim/active-Claim Executor-freeze checks. Preserve `Unchanged` before scope checks and reject mixed edits atomically.
- Race the CLI observation against an unclaimed Executor update that establishes a human gate before the writer transaction; require `PreserveHumanExecutor` to reject rather than remove the new gate without acknowledgment.
- Require CLI confirmation for an intentionally empty Description, reject blank Context input, and remove combined message and empty-Context compatibility flags.
- Require `--actor` or `TM_ACTOR` and accept `--claim-id` for active Claim fencing.
- Return exact core `UpdateTicketResult = Updated { ticket: OpenTicket } | Unchanged { ticket: OpenTicket }`, with the authoritative transaction-current complete Snapshot in both variants and no duplicated effective-change or Activity payload. Expose exact `updateTicket(input): Effect.Effect<UpdateTicketResult, TicketUpdateRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`.
- Mechanically render JSON as `{ ok: true, outcome: "updated" | "unchanged", ticket: <complete OpenTicket> }` without inferring outcome from timestamps or pre-read state.
- Render changed human output exactly as `Updated (<ticket-id>).` and no-op output exactly as `No changes to (<ticket-id>).`.
- Represent resolved update invariants with one schema-backed `TicketUpdateRejected { ticketId, reason }` wrapper and closed `TicketNotOpen | ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch | ExecutorChangeWhileClaimed | HumanExecutorTransitionExcluded` reason union; support Effect parent/reason catching and reason unwrapping.
- Include terminal status on `TicketNotOpen`; no current Claim details on `ActiveClaimRequiresFence`; only the provided Claim ID on `NoActiveClaim` and `ClaimIdMismatch`; and the provided Actor plus complete exactly matched active Claim on `ActorMismatch`.
- Include current Executor, requested Executor, and complete active Claim on `ExecutorChangeWhileClaimed`; produce it only after exact `MatchClaim` passes, while `RequireUnclaimed` against the same Claim fails earlier as `ActiveClaimRequiresFence`.
- Give `HumanExecutorTransitionExcluded` exactly current `human` and requested `agent`; produce it only for an effective unclaimed transition under `PreserveHumanExecutor` after Claim/Executor-freeze checks.
- Reject every mixed edit atomically through the same Executor-freeze reason; keep invalid edits/schemas, shared Store failures, `TicketNotFound`, and `TicketInTrash` distinct, and preserve `Unchanged` before Claim and Executor-freeze checks.
- Render exact reason-specific human lines for terminal target, active Claim requiring a fence, absent Claim, stale Claim ID, Actor mismatch, active-Claim Executor freeze, and `Error: Updating Ticket <ticket-id> from human to agent requires --allow-human.`; include the approved current/requested Executor and Claim ID in the freeze line.
- Mechanically map outer and nested `_tag` fields to JSON `type`, preserve reason payloads, omit duplicate human `message`, and prove rendering performs no Store reread or effective-edit recomputation.

### Removed `tm set-executor`

- Omit `set-executor` from CLI help and reject it as an unknown subcommand.
- Change Executor only through `tm update --executor` while the Ticket is unclaimed; retain atomic multi-field updates, but reject the whole update if a Claim becomes active before an effective Executor transition commits.

### `tm show`

- Return the complete open, done, or cancelled Ticket for an exact live ID without writing or emitting Activity.
- Reject an unknown ID with `TicketNotFound`.
- Reject a Trash-reserved ID with typed `TicketInTrash { ticketId, deletedAt, deletedBy }`, without returning the preserved Snapshot as an active Ticket.
- Begin human output with the exact lifecycle-valid primary detail block. Reuse the approved `tm next` open block exactly; for done and cancelled Tickets retain the same heading, common field order, absence rules, canonical timestamps, complete Subject, Description, and Context, replacing Claim with `Completed: <completed-at> by <completed-by>` or `Cancelled: <cancelled-at> by <cancelled-by>` respectively.
- For done Tickets, append exactly `Result:`, `Summary: <summary>`, `Details:` plus complete details or `-`, and `Data:` plus canonical compact JSON or `-`. For cancelled Tickets, append exactly `Cancellation reason:` plus the complete reason. Preserve multiline Details and Cancellation reason.
- Omit impossible Claim, Result, and Cancellation sections rather than rendering empty placeholders, and place relationship sections only after the complete primary lifecycle block.
- Load an optional direct parent summary for a Task or Subtask with a parent.
- Expose dedicated `RelationshipTicketSummary = TicketSummary & { activeClaim?, hasProgressedDescendants }` rather than weakening the neutral mutation summary or requiring CLI follow-up reads.
- Define `hasProgressedDescendants` as transaction-current derived query data that is true when the summarized Ticket has at least one descendant at any depth that is done or has an effective active Claim; never persist it as Ticket state and ignore expired Claims.
- Append an exact stable human relationship section containing the always-present headings `Relationships:`, `Parent:`, `Blocked by:`, and `Blocks:`. Render an empty subsection as `-` on the next line, one Parent with `└──`, and each ordered relationship array with `├──` except for final `└──`.
- Render each direct relationship summary exactly as `<marker> <ticket-id>: <human-executor-notation><subject>`, always using `(H) ` for human Executors because `tm show` has no Executor filter and using no notation for agent Executors. Do not repeat active Claim details on the line.
- Derive relationship markers with precedence done `[x]`, cancelled `[-]`, actively claimed open `[>]`, other open with progressed descendants `[/]`, then other open `[ ]`. Keep relationships direct and do not expand children or a transitive dependency graph.
- Retain the primary block's authoritative Parent and `Blocked by` Snapshot IDs; render enriched Parent, direct prerequisite, and reverse dependent summaries only in the relationship section from the same `TicketDetails` result.
- Omit expired Claims and absent optional parent/Claim values, always return `blockedBy` and `blocks` arrays ordered by ascending Ticket ID, and do not recursively expand transitive dependency graphs merely to expose the partial marker fact.
- Expose exact `getTicketDetails(ticketId: TicketId): Effect.Effect<TicketDetails, TicketNotFound | TicketInTrash | StoreReadError, TaskManager>`, accepting the typed ID directly and returning `TicketDetails` directly without single-field input or result wrappers, persistence handles, or Store Location.
- Return exact typed `TicketDetails { ticket, activeClaim?, relationships: { parent?, blockedBy, blocks } }` as one transaction-consistent authoritative observation. Let the CLI add only `{ ok: true, ticket, activeClaim?, relationships }` JSON or human rendering, using the same enriched summaries without Store rereads.
- In an open primary block, render an effective active Claim exactly as `Claim: active until <expires-at> (<claim-id>)`; render absent or expired Claim state as `Claim: -`.
- Return complete active Claim fields in JSON when present and omit the field when absent or expired.

### `tm list`

- With no command-specific filters, include open, done, and cancelled Tickets across both agent and human Executors.
- Omit `--all` and `--all-executors` from help and reject them as unknown flags; use `--status` and `--executor` only to narrow the default view.
- Preserve non-matching ancestors as structural context when a descendant matches status and Executor filters; distinguish matches from contextual nodes in the typed/JSON tree without adding a human `(context)` annotation.
- Render an open Ticket with its own active Claim as `[>]`, ahead of the progressed-descendant marker; return its complete active Claim in JSON and hide expired Claims in both formats.
- Render an unclaimed open Ticket as `[/]` when any descendant at any depth is done or effectively actively claimed, including when filters hide that descendant; ignore expired Claims.
- Preserve marker precedence: done `[x]`, cancelled `[-]`, actively claimed open `[>]`, other open with a progressed descendant `[/]`, and other open `[ ]`.
- Order roots deterministically by level (Epic, Task, Subtask), then `createdAt`, then Ticket ID; order children by `createdAt`, then Ticket ID; expose no sorting flags.
- Scope `--root` by an exact six-character live Ticket ID to the selected root and its complete descendant subtree; apply filters within that subtree and retain the root as context when a descendant matches.
- Expose exact closed `TicketStatusFilter = AllStatuses | Status { status }` and `TicketExecutorFilter = AllExecutors | Executor { executor }` unions plus `ListTicketsInput { rootTicketId?, statusFilter, executorFilter }`. Require both filter fields, omit rather than null an all-roots `rootTicketId`, and mechanically map CLI defaults into explicit union variants.
- Return `ReadonlyArray<ListTicketNode>` directly from `listTickets(input)` without a single-case result wrapper. Return exact closed nodes `ListTicketNode { ticket: ListTicketSummary, activeClaim?, hasProgressedDescendants, matchesFilter, children }`, where the compact summary contains Ticket ID, level, lifecycle status, Executor, and Subject; do not return complete Snapshots or flatten the hierarchy.
- Compute `hasProgressedDescendants` from the complete scoped transaction-current subtree before filtering visible nodes. Let `children` contain only matching nodes and required contextual ancestors rather than hidden descendants retained for marker calculation.
- Render JSON success as `{ ok: true, tickets }`.
- Treat no matches as a successful read, returning `{ ok: true, tickets: [] }` in JSON and exact human `No [<status> ][<executor> ]Tickets.` wording: lowercase selected status first, lowercase selected Executor second, one following space per selected dimension, and no contribution from an unselected dimension. Require `No Tickets.` when unfiltered, and do not alter the wording for `--root` scope.
- Reject a malformed `--root` at the Ticket ID boundary, reject an unknown root with `TicketNotFound`, and reject a Trash-reserved root with `TicketInTrash { ticketId, deletedAt, deletedBy }`; never render a trashed root or treat it as an empty subtree.
- Accept at most one `--status` and one `--executor`; intersect them when both are supplied and expose no repeatable or comma-separated multi-value filters.
- Render list roots without connectors or indentation; render non-roots with `├── ` except final siblings with `└── `; use `│   ` for ancestor continuation and four spaces for other indentation.
- Render each node exactly as `<marker> <ticket-id>: <executor-notation><subject>`, with the complete Subject and no Claim holder or expiry. Render contextual ancestors identically without a human `matchesFilter` annotation.
- Use exact `(H) ` notation for human Tickets when both Executors may appear and no notation for agent Tickets. Omit all Executor notation from either narrowed `--executor human` or `--executor agent` view.
- Prove listing open, done, and cancelled Tickets is read-only: no lifecycle, Claim, timestamp, Trash, or Activity state changes.
- Require no Actor Identity or Claim fence; evaluate active Claim presentation without persisting Claim expiry cleanup.
- Expose exact `listTickets(input): Effect.Effect<ReadonlyArray<ListTicketNode>, TicketNotFound | TicketInTrash | StoreReadError, TaskManager>`. Permit lookup failures only for a present root, map them through the CLI without duplicating core query rules, and let the adapter add only `{ ok: true, tickets }` in JSON.

### `tm next`

- With no Executor flag, select only agent-executor Tickets.
- Treat an open Ticket as non-actionable while it has any open direct child, including a child with another Executor, an incomplete dependency, or an active Claim.
- Treat both done and cancelled direct dependencies as satisfied for next-work selection; keep a Ticket ineligible while any dependency remains open.
- Use terminal dependency satisfaction as one shared core invariant so a Ticket selected through `tm next` remains dependency-eligible for eventual completion.
- Exclude actively claimed Tickets by default, include them with `--include-claimed`, and treat expired Claims as absent; prove the read neither bypasses later mutation fencing nor persists Claim cleanup.
- Traverse the canonical tree depth-first: choose the oldest root in root-level order, recursively choose its oldest open branch and oldest actionable leaf, then select newly eligible ancestors before moving to later siblings or roots.
- Break root ordering ties by level, `createdAt`, then ID and sibling ties by `createdAt`, then ID.
- Scope `--root` to an exact six-character open Ticket and its subtree; reject done or cancelled roots with typed `TicketNotOpen` rather than returning no actionable work.
- Expose exact required selection unions `NextExecutorSelection = AgentExecutor | HumanExecutor | AllExecutors` and `ClaimedTicketSelection = ExcludeClaimed | IncludeClaimed`, plus `SelectNextTicketInput { rootTicketId?, executorSelection, claimedTicketSelection }`. Omit rather than null an all-roots ID and carry no implicit core defaults through optional scalars or booleans.
- Return exact core `SelectNextTicketResult = Selected { ticket: OpenTicket, activeClaim? } | NoActionableWork`; permit the optional Claim only beside a selected Ticket and make it necessarily absent when the input excludes claimed Tickets.
- Return the complete selected open Ticket, including Description and optional Context, as `{ ok: true, ticket, activeClaim? }` in JSON. Render human selection as the exact complete open-Ticket block headed by uppercase `EPIC | TASK | SUBTASK`, followed by Status, Executor, complete Subject, Parent, ascending comma-separated `Blocked by` IDs, Created, Updated, Claim, Description, and Context in the approved order and punctuation.
- In selected-Ticket human output, render absent Parent, dependencies, Claim, and Context as `-`; render intentional empty Description as `(empty)`; render an effective Claim exactly as `active until <expires-at> (<claim-id>)`; and use canonical timestamps without further Subject truncation.
- Derive selected-Ticket human output only from `Selected { ticket, activeClaim? }`; include no reverse `Blocks`, parent summary, Result, Cancellation, or other `tm show` relationship data, and perform no follow-up Store read.
- Return no eligible Ticket as successful typed `NoActionableWork` with no nullable Ticket or optional Claim fields, rendering exactly `No actionable Tickets.` in human output and `{ "ok": true, "reason": "no-actionable-work" }` in JSON; do not use `null` or an error.
- Retain mutually exclusive `--executor agent|human` and `--all-executors`; map no Executor flag and explicit agent to `AgentExecutor`, human to `HumanExecutor`, and `--all-executors` to `AllExecutors`. Map omitted or supplied `--include-claimed` to `ExcludeClaimed` or `IncludeClaimed` respectively.
- Expose exact `selectNextTicket(input): Effect.Effect<SelectNextTicketResult, TicketNotFound | TicketInTrash | TicketNotOpen | StoreReadError, TaskManager>`. Reject malformed, unknown, Trash-reserved, and terminal supplied roots with the appropriate boundary or typed core error; permit those root-specific failures only when a root is present, and map Store failures without duplicating selection rules in the CLI.
- Prove selection is read-only: require no Actor Identity or Claim fence, acquire no Claim, persist no expiry cleanup, change no lifecycle or timestamps, and emit no Activity.
- Prove selection does not reserve work and a subsequent `tm claim` remains the concurrency boundary.

### `tm claim`

- Keep `tm claim` acquisition-only with no current-Claim-ID renewal mode or takeover; reject any active Claim, including the same Actor's, with exact `ActiveClaimConflict { ticketId, activeClaim: Claim }`, no mutation, and no Activity. Return the same complete-Claim shape for same-Actor and different-Actor conflicts, with no proposed replacement, takeover, or generic retryability field.
- Require cooperative holder release followed by ordinary acquisition for handoff, with a normal conflict if another claimant wins between them; if the holder cannot cooperate, require callers to wait for logical expiry. Expose no unilateral reassignment or Claim-handoff operation.
- Model claim human-gate intent as required `ClaimExecutorScope = AgentOnly | AnyExecutor` in `ClaimTicketInput`; map omitted CLI `--allow-human` to `AgentOnly` and a supplied flag to `AnyExecutor` without passing a raw approval boolean.
- Under `AgentOnly`, reject a transaction-current human target with exact `HumanExecutorClaimExcluded { ticketId }`; under `AnyExecutor`, permit acquisition subject to every other invariant. Render exact human `Error: Claiming human-executor Ticket <ticket-id> requires --allow-human.` and mechanically mapped JSON without prose `message`.
- Permit claiming any open Ticket, including parents with open children and dependency-blocked Tickets; do not duplicate `tm next` actionability rules in claim acquisition.
- Enforce at most one active Claim per Ticket under concurrent acquisition while retaining arbitrarily many historical Claim events in Activity.
- Create every Claim with a core-owned acquisition time and an expiry exactly one hour later; expose no caller-configurable duration or non-expiring Claim.
- Prove Claim expiry is logical: clock passage alone makes the Claim inactive without a write, timestamp change, cleanup, or Activity; reads and fencing treat an expired persisted Claim as absent.
- Treat acquisition after expiry as fresh `TicketClaimed` Activity containing only the complete new Claim; replace the stale persisted Claim record without emitting release, renewal, reacquisition, or previous-Claim linkage.
- Return exact `ClaimTicketResult { ticket: OpenTicket, claim: Claim }` with the unchanged complete open Ticket and complete new separate Claim; expose no redundant successful outcome tag. Expose exact `claimTicket(input): Effect.Effect<ClaimTicketResult, TicketNotFound | TicketInTrash | TicketNotOpen | ActiveClaimConflict | HumanExecutorClaimExcluded | StoreMutationError, TaskManager>`.
- Render JSON exactly as `{ ok: true, ticket, claim }` with sibling values and human success exactly as `Claimed <subject> (<ticket-id>) for <actor> until <expires-at> (Claim <claim-id>).`; expose no Activity or merged Ticket Claim.
- Render conflict human output exactly as `Error: Ticket <ticket-id> already has active Claim <claim-id> held by <actor> until <expires-at>.`; mechanically map `_tag` to JSON `type`, preserve `ticketId` and complete `activeClaim`, add no prose `message`, and render without a Store reread.
- Reject malformed, unknown, Trash-reserved, and terminal Ticket IDs with the appropriate boundary or typed core error; map Store failures without duplicating claim rules in the CLI.
- Enforce identity and open lifecycle, then effective active-Claim conflict, then Claim Executor scope before acquisition. Require `ActiveClaimConflict` to precede human scope when both apply.
- Race an unclaimed Executor update against acquisition: when the update commits first, enforce scope against the resulting Executor; when acquisition commits first, freeze a later effective Executor transition.
- Atomically create the separate Claim record with one `TicketClaimed` item without modifying the Ticket Snapshot or `updatedAt`; prove every success changes Claim state and every failure, scope exclusion, or conflict leaves Ticket, Claim, and Activity unchanged.
- Run a concurrent acquisition race proving exactly one claimant commits and every loser receives `ActiveClaimConflict`.

### `tm renew`

- Expose dedicated `tm renew <ticket-id> --actor <identity> --claim-id <uuid>` with no `--allow-human`; omit renewal flags from `tm claim`.
- Require the matching active Actor Identity and Claim ID, atomically create a new Claim ID and one-hour lease, and invalidate the prior Claim ID.
- Emit one `TicketClaimRenewed` item containing the previous Claim ID and complete new Claim; emit no separate release item.
- Return exact `RenewClaimResult { ticket: OpenTicket, claim: Claim }` with the unchanged complete open Ticket and complete new separate Claim; expose no outcome tag or duplicate previous Claim ID. Expose exact `renewClaim(input): Effect.Effect<RenewClaimResult, TicketNotFound | TicketInTrash | TicketNotOpen | ClaimRenewalFenceError | StoreMutationError, TaskManager>`.
- Render JSON exactly as `{ ok: true, ticket, claim }` and human success exactly as `Renewed Claim on <subject> (<ticket-id>) for <actor> until <expires-at> (Claim <claim-id>).`; expose no Activity or merged Ticket Claim.
- Reject absent, expired, other-Actor, and mismatched Claims without falling back to fresh acquisition, mutation, or Activity.
- Reject malformed, unknown, Trash-reserved, and terminal Ticket IDs with the appropriate boundary or typed core error. Expose schema-backed `ClaimRenewalFenceError { ticketId, reason }` with exact `NoActiveClaim { providedClaimId } | ClaimIdMismatch { providedClaimId } | ActorMismatch { providedActor, activeClaim }` reasons, supporting Effect parent/reason catching and reason unwrapping.
- Check effective active Claim presence, then Claim ID, then Actor without aggregation. Reveal no current Claim ID through absent or mismatched reasons; return the complete exactly matched Claim only for Actor mismatch.
- Render exact renewal-fence human lines: absent Claim instructs acquiring a new Claim; stale ID instructs rereading; Actor mismatch identifies the exactly matched Claim holder. Mechanically map parent and reason tags to JSON `type`, preserve payloads, add no prose `message`, and perform no Store reread.
- Atomically replace the separate Claim record without modifying the Ticket Snapshot or `updatedAt`; prove every success creates a new Claim incarnation and every failure leaves Ticket, Claim, and Activity unchanged.

### `tm release`

- Releasing a never-claimed, already-released, or expired Claim on an open Ticket returns successful `AlreadyInactive` without a write or Activity; prove neither this no-op nor a successful Claim-record removal modifies the Ticket Snapshot or `updatedAt`.
- Return a compact receipt: `Released` contains Ticket ID and released Claim ID; `AlreadyInactive` contains Ticket ID; do not return the complete Ticket.
- Render flat JSON with explicit adapter outcomes: `{ ok: true, outcome: "released", ticketId, claimId }` and `{ ok: true, outcome: "already-inactive", ticketId }`; do not expose core `_tag` values or infer the outcome from field presence.
- Render human output exactly as `Released Claim <claim-id> from Ticket <ticket-id>.` and `Claim on Ticket <ticket-id> is already inactive.`.
- Check lifecycle before no-op detection: reject done and cancelled Tickets with `TicketNotOpen`, Trash-reserved IDs with `TicketInTrash`, and unknown IDs with `TicketNotFound`; return `AlreadyInactive` only for an open Ticket without an active Claim.
- Always require a syntactically valid Claim ID in `ReleaseClaimInput` and CLI `--claim-id <uuid>`, including for retries that return `AlreadyInactive`; do not expose an unfenced ensure-inactive release request.
- When no active Claim exists, return `AlreadyInactive` without comparing the supplied Claim ID to an expired persisted Claim or historical Activity; prove a valid unrelated ID cannot make the no-op write or bypass a newer active Claim.
- Require matching Actor Identity and Claim ID for normal release of an active Claim; reject stale Claim IDs even when Actor Identity matches.
- For an active Claim, validate Claim ID before Actor Identity; return reason-tagged `ClaimIdMismatch` when both fences fail, return `ActorMismatch` only after the ID matches, and do not aggregate fence errors.
- Expose schema-backed `ClaimReleaseFenceError { ticketId, reason }` with exact `ClaimIdMismatch { providedClaimId } | ActorMismatch { providedActor, activeClaim }` reasons, supporting Effect parent/reason catching and reason unwrapping. Include no `NoActiveClaim` reason because absent active state returns successful `AlreadyInactive`.
- Reveal no current Claim ID through `ClaimIdMismatch`. For `ActorMismatch`, return the complete exactly matched active Claim; treat its Claim ID as the already matched provided incarnation and do not duplicate `providedClaimId`.
- Render exact stale-ID and Actor-mismatch human lines, mechanically map parent and reason tags to JSON `type`, preserve payloads, add no prose `message`, and perform no Store reread.
- Reject release by another Actor even when it supplies the current Claim ID; preserve the Ticket, Claim, timestamps, and Activity and require cooperative holder release or logical expiry.
- Include only the released Claim ID in `TicketClaimReleased`; obtain the releasing holder from common Activity attribution and prior lease details from earlier Claim Activity.
- Atomically remove the required active Claim during every successful completion and any permitted target Claim during successful cancellation, without embedding Claim state in the final Ticket Snapshot or emitting a separate `TicketClaimReleased` item. Require deletion to encounter no selected active Claim and preserve every Claim on failure.

- Expose core `ReleaseClaimInput { ticketId, actor, claimId }`, exact `ReleaseClaimResult = Released { ticketId, claimId } | AlreadyInactive { ticketId }`, the exact reason-tagged `ClaimReleaseFenceError`, and exact `releaseClaim(input): Effect.Effect<ReleaseClaimResult, TicketNotFound | TicketInTrash | TicketNotOpen | ClaimReleaseFenceError | StoreMutationError, TaskManager>` without exposing persistence handles or Ticket mutation.
- Expose CLI `tm release <ticket-id> --actor <identity> --claim-id <uuid>` with `TM_ACTOR` fallback and shared Store/JSON flags; decode exact IDs, make one core call, and map typed outcomes and failures without duplicating domain rules.

### `tm complete` (reviewed)

- Keep completion non-cascading; require every descendant to be done or cancelled, reject any open descendant whether claimed or unclaimed, and never manufacture descendant Results.
- Permit completion only when every direct dependency is terminal; treat both done and cancelled dependencies as satisfied and reject any open dependency with typed `OpenDependencies`.
- Expose no `--force` flag and prove completion cannot produce a done Ticket that remains blocked by an open prerequisite.
- On `OpenDependencies`, leave the Ticket, separate Claim record, timestamps, and Activity unchanged; require callers to remove an obsolete relation with `tm unblock` or intentionally abandon prerequisite work with `tm cancel`.
- Share the same terminal-dependency invariant with `tm next` so selection and completion cannot disagree about cancelled or open dependencies.
- Require an active Claim for every completion, with matching Actor Identity and exact current Claim ID; expose required CLI `--claim-id` and required core `claimId` with no `RequireUnclaimed` completion variant.
- Expose exactly `CompleteTicketInput { ticketId, actor, claimId, result }` with a canonical typed Result; omit target-fence unions, adapter confirmations, expected Executor, caller-supplied completion time, and generic bypass fields, while defensively validating runtime input at the public core boundary.
- Return the canonical `DoneTicket` directly from exact `completeTicket(input): Effect.Effect<DoneTicket, CompletionRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`; expose no single-case outcome tag, wrapper receipt, no-op variant, duplicate consumed Claim ID, or Activity Cursor, and require repeated completion to fail lifecycle eligibility.
- Prove the returned done Snapshot contains Result plus sibling `completedAt` and `completedBy` and that terminal integrity leaves no active Claim; include no Activity payload or Cursor in the mutation result.
- Render human success exactly as `Completed <subject> (<ticket-id>).` without echoing Result fields, application-owned data, Claim consumption, or Activity.
- Render JSON success as `{ "ok": true, "ticket": <complete DoneTicket> }`, omitting absent optional Result fields and any active Claim, redundant outcome, consumed Claim ID, Activity payload, or Cursor.
- Exercise a near-limit Result data value and prove human success remains one concise line while JSON returns the complete canonical done Snapshot.
- Reject missing CLI Claim ID before the core call; reject an unclaimed, released, or expired core target with `NoActiveClaim`, a stale ID with `ClaimIdMismatch`, and an exact ID held by another Actor with `ActorMismatch`, without changing Ticket, Claim, timestamps, or Activity.
- On successful completion, atomically remove the required separate Claim and emit only `TicketCompleted` with `Consumed { claimId }`, never `Unclaimed` or a separate `TicketClaimReleased` item.
- Define `TicketCompleted` payload as exactly Result plus `claimConsumption: Consumed { claimId }`; do not embed the complete Claim or complete resulting Ticket or duplicate Subject, Description, Context, Executor, hierarchy, dependencies, or creation time.
- Require common Activity `occurredAt`, `actor`, and `ticketId` to equal the done Ticket's `completedAt`, `completedBy`, and `id`, and require the event Result to equal the done Ticket Result in the same atomic transaction.
- Model Result as completion evidence only; store core-owned `completedAt` and caller-supplied `completedBy` as sibling fields of the done-Ticket lifecycle variant rather than nesting them inside Result.
- Return a done Snapshot whose completion occurrence and attribution remain explicit without consulting Activity or inferring completion time from generic `updatedAt`; retain the same occurrence time and Actor Identity in common `TicketCompleted` Activity attribution.
- Require Result to contain a human-readable `summary`, permit optional human-readable `details`, and permit optional application-owned `data` containing any valid `JsonValue`; remove first-class core `decisions` and `verification` fields.
- Round-trip present Result `data` through the public core interface and persisted Snapshot as a generic JSON value without interpreting an application schema, discriminator, version, workflow outcome, verification meaning, or consistency with `summary` and `details`.
- Permit a wrapping application to validate and decode Result `data` into its own versioned discriminated contract, while permitting callers without a structured completion protocol to omit `data`.
- Reject non-JSON Result data at the core boundary without changing Ticket, Claim, timestamps, or Activity.
- Measure exactly one canonical compact Result JSON encoding: fixed outer `summary`, optional `details`, optional `data` order; array order preserved; object keys sorted by UTF-16 code units; deterministic JSON string escaping with unpaired surrogates escaped as `\uXXXX`; finite numbers encoded with ECMAScript's shortest JSON representation and negative zero as `0`; then count UTF-8 bytes.
- Limit that complete encoding—including field names and structural overhead—to 256 KiB (262,144 bytes); accept the exact limit and reject one byte over before Store/Ticket resolution.
- Use pinned Effect `Schema.Json` for generic stack-safe runtime JSON validation; prove it accepts the JSON domain and reusable acyclic subgraphs while rejecting sparse arrays, non-finite numbers, unsupported leaves, non-plain objects, and cycles. Do not duplicate that generic validation in the canonical encoder.
- Add only the guarantees absent from Effect's native `JSON.parse`/`JSON.stringify`-backed string transformation: duplicate-member detection in CLI JSON parsing plus iterative canonical encoding and byte measurement in the core.
- Impose no JSON nesting-depth limit; accept and round-trip deeply nested valid acyclic `JsonValue` inputs within the aggregate byte bound through stack-safe boundary, canonical measurement, persistence, Activity, and output paths without a raw stack overflow.
- Reject duplicate member names in inline and file JSON rather than accepting native last-value-wins behavior. Reject cyclic, sparse, or otherwise non-JSON runtime values as invalid Result input without coercion, confirmation, or bypass.
- Omit `--verification` and `--allow-no-verification` from base CLI help and reject both as unknown flags; do not impose an adapter-owned verification envelope or inspect application-owned Result data for verification meaning.
- Permit a wrapping application to require and validate verification through its own typed Result data before invoking the core; prove the base CLI's lack of verification policy cannot waive Claim fencing, lifecycle, hierarchy, dependency readiness, the human gate, or Result boundary validation.
- Trim Result summary surrounding whitespace, then require non-blank single-line text; reject empty, whitespace-only, and multiline summaries without changing Ticket, Claim, timestamps, or Activity.
- Represent Result details as absent or trimmed non-blank text while preserving internal whitespace and line breaks; reject explicitly supplied empty or whitespace-only details rather than silently omitting them or persisting a present-empty state.
- Accept structurally valid summaries such as `"done"` without a subjective vague-word blacklist; leave stronger writing-quality policy to wrapping applications.
- Resolve all CLI Result input forms through the same core text schemas so normalization and rejection do not vary by inline or file-based input mode.
- Require singular inline `--summary`; accept optional `--details <text>` or `--details-file <path>` and optional `--data <json>` or `--data-file <path>`, with each inline/file pair mutually exclusive.
- Parse `--data` and one complete UTF-8 `--data-file` as exactly one generic JSON value, including primitives; reject malformed JSON, unreadable files, and source conflicts before a well-formed core completion request.
- Reject duplicate Result flags rather than merging values; represent application-specific collections inside the single Result data value.
- Omit `--decision`, `--result-message`, `--result-message-file`, whole-Result `--result` and `--result-file`, and `--summary-file` from help and reject them as unknown flags.
- Prove inline and file modes construct the same typed Result and enforce identical text and aggregate-size invariants without changing Ticket, Claim, timestamps, or Activity on adapter failure.
- Require CLI `--allow-human` only when directly completing a human-executor target; keep the acknowledgment out of Result and prevent it from waiving lifecycle, hierarchy, dependency, Claim-fence, or Result invariants.
- Require no completion confirmation for human-executor ancestors, descendants, dependencies, dependents, or other graph observers whose readiness or presentation changes derivatively without direct mutation.
- Reject completion through an open human dependency even with `--allow-human`; require the dependency to become terminal or the relation to be removed through its own operation.
- Freeze Executor for the lifetime of every active Claim so the CLI may inspect the target and apply `--allow-human` before completing with the same required Claim ID; require no `expectedExecutor` or core approval field.
- Race completion against release, expiry, renewal, and an unclaimed Executor update; require the original completion Claim ID to fail with `NoActiveClaim` or `ClaimIdMismatch` rather than complete against the later Executor state.
- At the Claim-expiry boundary, acquire the `BEGIN IMMEDIATE` writer position and sample one core-owned occurrence time: require `NoActiveClaim` when that instant is at or after expiry, permit completion when the Claim is active at that instant even if physical commit finishes after expiry, and require the same instant as the done Ticket's `completedAt` and Activity `occurredAt` without a second expiry check.
- Serialize release against completion: require `NoActiveClaim` when release commits first, and require a later release to observe `TicketNotOpen` when completion commits first.
- Serialize renewal or post-expiry replacement against completion: when `C2` commits first, require completion with `C1` to return `ClaimIdMismatch` even if `C1` and `C2` have the same Actor Identity; when completion commits first, require later renewal or acquisition to observe `TicketNotOpen`.
- Race an effective Executor update against Claim acquisition; if acquisition commits first, reject the update and preserve Executor, and if the update commits first, require the later Claim and completion to observe the new Executor.
- Race completion against child creation: if creation commits first, require `OpenDescendants`; if completion commits first, require creation to fail because its parent is terminal.
- Race completion against dependency addition and removal on the target: require completion to use the committed relationship set when the relationship mutation commits first, and require a later relationship mutation to reject the terminal target when completion commits first.
- Race completion against descendant and dependency lifecycle transitions: a terminal transition committed first may remove the blocker, while completion that observes an open blocker rejects without waiting or automatically retrying; require an explicit reread and retry.
- Pause after the CLI human-confirmation pre-read, then release or expire the observed Claim, update Executor while unclaimed, and acquire a fresh Claim; require completion with the original Claim ID to fail rather than apply against the later Executor state.
- Prove every completion race is decided by serialized writer-position order and transaction-current core validation; the CLI pre-read establishes no reservation or precedence, and neither adapter nor core automatically retries a rejected completion.
- Represent resolved completion-invariant failures with one schema-backed `CompletionRejected` wrapper and a closed schema-backed `TicketNotOpenReason | NoActiveClaim | ClaimIdMismatch | ActorMismatch | CompletionOpenDescendants | CompletionOpenDependencies` reason union; require the two completion-specific classes to retain JSON tags `OpenDescendants` and `OpenDependencies`.
- Support Effect's reason-error handling pattern: catch the parent with `Effect.catchTag`, catch nested reasons with `Effect.catchReason` or `Effect.catchReasons`, and unwrap reasons with `Effect.unwrapReason`; delegate parent cause to the reason and expose no generic retryability flag.
- Include target Ticket ID on `CompletionRejected`; include terminal status on `TicketNotOpen`; include the provided Claim ID on `NoActiveClaim` and `ClaimIdMismatch`; include provided Actor and complete active Claim on `ActorMismatch`.
- Never reveal the current active Claim ID from `ClaimIdMismatch`; require an explicit reread before a stale same-Actor caller can acquire the current fence.
- Return every open descendant in canonical tree order and every open direct dependency in ascending Ticket-ID order as a non-empty collection of ID, Subject, Executor, and optional complete effective active Claim; omit expired Claims and unrelated Snapshot fields.
- Keep invalid complete input, shared Store mutation failures, `TicketNotFound`, and `TicketInTrash` distinct from `CompletionRejected`; prove they occur before the resolved operation-invariant boundary and remain machine-readable.
- Map outer and nested Effect `_tag` fields mechanically to CLI JSON `type` fields, preserve all reason payload fields, omit duplicate human messages, and reject empty blocker collections through the reason schema.
- Render exact fixed human lines for terminal, absent-Claim, stale-Claim, and Actor mismatch reasons without revealing the current Claim ID on mismatch.
- Render open-descendant and open-dependency headings followed by every canonical blocker as `- <id>: <subject> (executor: <executor>)`, adding `; Claim <claim-id> held by <actor> until <expires-at>` inside the parentheses only when an effective active Claim is present.
- Prove CLI rendering consumes typed reason data without rereading the Store or recomputing completion rules.
- Enforce fail-fast adapter/input precedence: syntax and required flags; source conflicts and file loading; JSON parsing; exact ID, Actor, Result text, JSON validity, and aggregate-size decoding; Ticket pre-read; then human-target confirmation.
- Enforce fail-fast transaction-current core precedence: Store/Ticket resolution; lifecycle; required active Claim; complete hierarchy; direct dependencies; then atomic mutation. Do not aggregate failures.
- Combine invalid Result with a missing Store and require invalid Result; combine an open human target missing `--allow-human` with a stale Claim and require the adapter confirmation failure.
- Combine a terminal target with stale Claim input and require `TicketNotOpen`; combine no active Claim with open descendants and require `NoActiveClaim`.
- Combine wrong Claim ID and wrong Actor and require `ClaimIdMismatch`; use the exact Claim ID with the wrong Actor and require `ActorMismatch`.
- Combine open descendants and open dependencies and require `OpenDescendants`; after descendants become terminal, require `OpenDependencies` until every direct dependency is terminal.
- On every adapter, resolution, lifecycle, Claim, hierarchy, dependency, and persistence failure, prove Ticket, Claim, timestamps, and Activity remain unchanged.
- Through public CLI tests, reject invalid or conflicting Result inputs before a core mutation request and prove no Ticket, Claim, timestamp, or Activity change; through the public core interface, prove Store/Ticket resolution and every lifecycle, Claim, hierarchy, and dependency reason also writes nothing.
- In one real file-backed rollback/reopen smoke test, inject a deterministic private failure after the done Snapshot, Claim removal, lifecycle timestamps, and `TicketCompleted` insertion have executed in the transaction but before the `COMMIT` attempt; close and reopen the Store and prove the original open Snapshot and exact active Claim are unchanged, Result and completion timestamps remain absent, Activity high-water is unchanged, no completion or release Activity exists, and retry with the same Claim succeeds.
- Do not require completion fault injection after every SQL statement or commit phase. When a failure is known to precede the `COMMIT` attempt, require complete rollback; when physical commit outcome is unknown, require reread and reconciliation rather than claiming a proven rollback.
- Replace the current help surface with required singular `--summary` and `--claim-id`, optional singular inline/file details and data, narrowly scoped `--allow-human`, and shared flags; prove removed decision, verification, result-message, whole-Result, vague-summary-policy, no-verification, and force paths are absent and rejected as unknown.
- Replace current unclaimed, same-Actor-without-ID, and forced non-holder completion tests with required separate-Claim acquisition and exact Claim-ID fencing tests; include released, expired, renewed, replaced, same-Actor stale-ID, and other-Actor cases.
- Replace embedded Claim-clearing assertions with separate Claim consumption and prove completion never modifies Claim fields inside the Ticket, never emits `TicketClaimReleased`, and records the exact consumed Claim ID only in `TicketCompleted`.
- Replace direct-child and force-through-dependency tests with complete open-descendant collection, terminal cancelled-dependency readiness, categorical open-dependency rejection, typed blockers, and transaction-current race tests.
- Replace old Result fixtures and assertions in complete, validation, command, test-support, shared-output, and CLI documentation surfaces: details become optional, decisions and verification are removed, data is generic JSON, and `completedAt`/`completedBy` move beside Result in the done lifecycle variant.
- Replace generic `CommandFailure` and `{ type, message }` complete assertions with the typed core operation, `CompletionRejected` reason handling, exact human rendering, and mechanically mapped structured JSON errors.
- Replace multiline human success assertions with the exact one-line receipt and retain complete canonical done-Ticket JSON; update show rendering without reintroducing removed verification semantics.
- Add migration coverage not represented by current tests: details/data inline-file equivalence and conflicts, duplicate flags, JSON primitives and malformed input, exact Result byte boundary, stack-safe deep JSON, Activity equality and payload, all precedence combinations, the approved race matrix, and bounded rollback/reopen failure atomicity.

### `tm cancel` (reviewed)

- Remove `--yes` from help and reject it as unknown; expose `--cascade` as the only cascading-scope flag.
- Map omitted `--cascade` to core `TargetOnly` and supplied `--cascade` to `CascadeOpenDescendants`; expose no raw `yes` field and no descendant Claim-fence collection in the core input.
- With `TargetOnly`, reject when any open descendant exists transaction-current and prove the target, descendants, Claims, timestamps, and Activity remain unchanged.
- With `CascadeOpenDescendants`, atomically cancel the target and every transaction-current open descendant while leaving done and already-cancelled descendants byte-for-byte/domain-equal and emitting no Activity for them.
- Create an open descendant after the cancellation adapter constructs its core request but before the writer transaction; require `TargetOnly` to reject and `CascadeOpenDescendants` to include it, proving request construction neither reserves nor fixes the subtree.
- Treat redundant `--cascade` on a leaf as the same successful one-Ticket cancellation scope, not an error or separate outcome.
- Prove `--cascade` cannot bypass target Claim fencing, claimed-descendant rejection, lifecycle, reason, human-executor policy, or any other cancellation invariant.
- Map omitted `--allow-human` to `AgentOnly` and supplied `--allow-human` to `AnyExecutor`; expose semantic `CancellationExecutorScope` rather than a raw approval boolean in `CancelTicketInput`.
- Under `AgentOnly`, reject a human direct target or any human open descendant that would be changed by `--cascade`; under `AnyExecutor`, permit those Tickets subject to every other invariant.
- Do not require `--allow-human` for done or already-cancelled descendants, ancestors, dependencies, dependents, or other graph observers that cancellation leaves unchanged.
- Pause after the CLI constructs an agent-only core request, then change an affected Ticket's Executor to human or create a new human open descendant before the writer transaction; require transaction-current `AgentOnly` to reject atomically.
- Prove direct core callers may deliberately select either Executor scope without CLI confirmation semantics, while neither scope waives Claim fencing, lifecycle, cascade scope, or other domain invariants.
- Permit cancellation of an unclaimed explicit target through `RequireUnclaimed` without prior Claim acquisition; permit direct cancellation of an actively claimed target only through matching Actor Identity and exact `MatchClaim { claimId }`.
- When acquisition wins a race against `RequireUnclaimed`, return `ActiveClaimRequiresFence` and prove the reason denotes a failed unclaimed-state assertion rather than a universal cancellation Claim prerequisite.
- Reject an explicit done or already-cancelled target with typed `TicketNotOpen` before target Claim, cascade, Executor-scope, or other cancellation checks; preserve its complete terminal Snapshot, timestamps, Claims, and Activity.
- Expose no repeated-cancellation success, same-request no-op, or terminal-history rewrite. After an uncertain commit, require reread rather than replay semantics.
- Under a valid cascade, leave done and already-cancelled descendants unchanged and emit no Activity for them because only open descendants are transition targets.
- Represent every cancelled Snapshot with flat required `reason`, `cancelledAt`, and `cancelledBy` fields; use no nested `cancellation` wrapper and keep the separate Claim out of the Ticket Snapshot.
- In a cascade, require every changed Ticket to receive the same canonical reason, core-owned `cancelledAt`, and Actor Identity, and require each changed Ticket's `updatedAt` to equal that occurrence time.
- Prove cancelled Tickets remain self-describing through the public core interface and CLI show output without consulting Semantic Activity; preserve the flat lifecycle shape everywhere.
- Trim surrounding `CancellationReason` whitespace, require non-blank content, and preserve internal whitespace and line breaks through inline input, UTF-8 file input, core calls, persistence, Activity, and output.
- Accept a normalized reason of exactly 16,384 UTF-8 bytes and reject one byte over before Store/Ticket resolution; prove a cascade applies the same bounded canonical reason to every changed Ticket.
- Retain singular mutually exclusive `--reason` and `--reason-file`; reject missing, blank, unreadable, conflicting, duplicate, or oversized sources without changing Ticket, Claim, timestamp, or Activity state.
- Expose no reason-validation confirmation or bypass, and enforce the same schema for direct core callers.
- Return exact `CancelTicketResult { target: CancelledTicket, cancelledDescendants: ReadonlyArray<CancelledTicket> }` from exact `cancelTicket(input): Effect.Effect<CancelTicketResult, CancellationRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`, with the complete explicit target Snapshot and exactly the changed descendant Snapshots in canonical tree order.
- For leaf or target-only cancellation, return an empty `cancelledDescendants` array; omit done and already-cancelled descendants because they were unchanged.
- Do not duplicate the target in the descendant collection, rely on a positional flat-list convention, include Activity Cursors or Claim-consumption audit fields, or require a Store reread to identify cascade effects.
- Render leaf human success exactly as `Cancelled <subject> (<ticket-id>).` without echoing Cancellation reason or metadata.
- Render cascade human success as the exact singular/plural heading `Cancelled <subject> (<ticket-id>) and <n> descendant Ticket[s]:`, followed by every actually changed descendant in canonical tree order as `- <subject> (<id>)`; do not repeat the target in the bullets.
- Render JSON success as `{ ok: true, ticket, cancelledDescendants }` with the complete target and changed descendant Snapshots; retain an empty descendant array for a leaf and add no outcome, duplicate target, separate reason, active Claim, Claim-consumption, Activity, or Cursor fields.
- Prove human and JSON success derive only from `CancelTicketResult`, including a descendant created after an earlier preview, without a Store reread or cascade recomputation.
- Emit one `TicketCancelled { reason, claimConsumption }` per changed Ticket, target first and then descendants in canonical tree order; do not duplicate cancellation time or attribution, embed a complete Claim, or include unchanged Snapshot fields.
- Record `Unclaimed` for an unclaimed explicit target and every cascade descendant; record `Consumed { claimId }` only for an exactly fenced claimed explicit target, and never emit `TicketClaimReleased` for cancellation.
- Treat removal of an expired persisted Claim representation as `Unclaimed`, not consumption of an active Claim.
- Atomically require every Activity item's common time, Actor, and Ticket ID to equal its changed Snapshot's `cancelledAt`, `cancelledBy`, and `id`, and require its event reason to equal the Snapshot's `reason`; use one occurrence time, Actor, and reason across a cascade.
- On any target or descendant Claim rejection or later cancellation failure, preserve all Snapshots and Claim records and emit no partial cancellation or release Activity.
- Enforce core precedence as Store/Ticket resolution, target lifecycle, explicit target Claim fence, then Cancellation scope; under `TargetOnly`, return every transaction-current open descendant in canonical tree order without inspecting descendant Claims or Executors.
- Under `CascadeOpenDescendants`, check every active descendant Claim before enforcing `CancellationExecutorScope` against the changed set; do not aggregate scope, Claim, and Executor failures.
- Combine a missing target Claim fence with open descendants and require the target fence error; after satisfying it under `TargetOnly`, require the open-descendant scope rejection even when descendants are claimed or human-executor.
- Retry the same subtree under cascade scope and require claimed-descendant rejection before Executor-scope rejection; only after Claims become inactive may an agent-only request report affected human Tickets.
- Represent resolved cancellation-invariant failures with one schema-backed `CancellationRejected` wrapper and a closed schema-backed `TicketNotOpenReason | ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch | CancellationOpenDescendants | CancellationClaimedDescendants | CancellationHumanTicketsExcluded` reason union; require the three cancellation-specific classes to retain JSON tags `OpenDescendants`, `ClaimedDescendants`, and `HumanTicketsExcluded`.
- Support Effect's reason-error handling pattern through parent catch, nested reason catch, and reason unwrapping; delegate parent cause to the selected reason and expose no generic retryability field.
- Keep invalid cancellation input, shared Store mutation failures, `TicketNotFound`, and `TicketInTrash` distinct from `CancellationRejected` and machine-readable.
- Include terminal status on `TicketNotOpen`; no active Claim data on `ActiveClaimRequiresFence`; only provided Claim ID on `NoActiveClaim` and `ClaimIdMismatch`; and provided Actor plus complete exactly matched active Claim on `ActorMismatch`.
- Expose exact `CancellationTicketSummary { ticketId, subject, executor }` and `CancellationClaimedTicketSummary = CancellationTicketSummary & { activeClaim }`. Return every open descendant summary without Claim inspection for `CancellationOpenDescendants`, every complete active Claim with its claimed descendant summary for `CancellationClaimedDescendants`, and every affected human Ticket summary for `CancellationHumanTicketsExcluded`; enforce non-empty collections and approved canonical ordering.
- Never reveal a current Claim ID through `ActiveClaimRequiresFence` or `ClaimIdMismatch`; require an explicit reread before retrying.
- Render the exact approved human lines for all eight reasons, ordinary summary bullets, and claimed-descendant bullets containing Claim ID, holder, and expiry.
- Map outer and nested `_tag` fields mechanically to JSON `type`, preserve every reason payload and ordering, omit duplicate human messages, and prove rendering performs no Store reread or rejection recomputation.
- At the expiry boundary, acquire the `BEGIN IMMEDIATE` writer position and sample one core-owned occurrence time for every target and descendant Claim decision, changed Snapshot `cancelledAt`/`updatedAt`, and Activity `occurredAt`.
- Permit consumption of a target Claim active at that instant even if physical commit finishes after expiry; require `ActiveClaimRequiresFence` for `RequireUnclaimed` and reject a cascade for any descendant Claim active then, without a second pre-commit expiry check.
- Treat Claims expired by the occurrence time as semantically absent and record `Unclaimed` when success removes a stale persisted representation; prove waiting for the writer position until after expiry observes inactive state consistently across the changed set.
- Race unclaimed target cancellation against acquisition and require `ActiveClaimRequiresFence` when acquisition commits first or later `TicketNotOpen` when cancellation commits first.
- Race `MatchClaim(C1)` cancellation against release, renewal, and replacement; require `NoActiveClaim` after release, `ClaimIdMismatch` after C2 even for the same Actor, and later lifecycle failure when cancellation commits first.
- Race cascade cancellation against descendant acquisition; require `ClaimedDescendants` when acquisition commits first and later lifecycle failure when cancellation commits first.
- Race cancellation against child creation; require target-only rejection or cascade inclusion when creation commits first, and reject creation against a parent cancelled first.
- Race cancellation against Executor updates; require transaction-current Executor-scope enforcement when the update commits first and terminal lifecycle rejection when cancellation commits first.
- Race cancellation against dependency relationship mutations; prove committed relationships do not affect cancellation eligibility, later direct mutation of a cancelled target fails lifecycle, and derived readiness changes require no graph-observer fences.
- Prove every race uses serialized writer-position order, request construction reserves nothing, and neither adapter nor core waits or automatically retries a rejected cancellation.
- In one real file-backed mid-cascade rollback/reopen test, start with an exactly claimed target, at least two open unclaimed descendants, unchanged terminal descendants, and known Activity high-water; inject a private failure after target and at least one descendant effect but before finishing the changed set or attempting `COMMIT`.
- After reopen, prove every formerly open Snapshot remains unchanged and open, the exact target Claim remains active and unchanged, terminal descendants remain unchanged, no Cancellation reason or timestamp persists, Activity high-water is unchanged, no cancellation or release Activity exists, and retry with the same Claim succeeds across the eligible subtree.
- Do not require failure injection after every Ticket, Claim, Activity, or commit phase. Require complete rollback for failures known to precede the `COMMIT` attempt and reread/reconciliation for unknown physical commit outcomes.
- Prove adapter syntax, reason source, decoding, and acknowledgment failures occur before a core mutation and leave every Ticket, Claim, timestamp, and Activity item unchanged.
- Replace current help with retained reason/Actor/`--allow-human`, optional target `--claim-id`, and semantic `--cascade`; reject removed `--force` and `--yes` as unknown.
- Replace stale JSONL preview and `firstHumanExecutorTicket` decisions with transaction-current Cancellation and Executor scopes in the typed core input.
- Replace unclaimed/same-Actor/forced Claim behavior with `RequireUnclaimed | MatchClaim`, exact target fencing, `ActiveClaimRequiresFence`, and categorical claimed-descendant rejection regardless of Actor.
- Replace embedded Claim clearing, caller-owned mutation time, and nested Cancellation with separate Claim consumption/cleanup, one core-owned occurrence time, flat cancellation lifecycle fields, and target-first Activity.
- Replace duplicated JSON `cancelledTickets`, reason-echoing human output, force guidance, and generic `CommandFailure` assertions with `CancelTicketResult`, exact concise output, and structured `CancellationRejected` rendering.
- Rewrite current reason-file, Actor, human-target, lifecycle-filter, terminal-descendant, expired-Claim, and invalid-input tests against public core/CLI boundaries; remove forced-descendant, same-Actor-without-ID, and generic `--yes` compatibility expectations.
- Add missing coverage for exact reason byte limits, semantic-scope races, all optional target fences, same-Actor stale IDs, all claimed descendants, Activity/ClaimConsumption equality, precedence combinations, writer races, and mid-cascade rollback/reopen proof.

The `tm cancel` scenarios are approved.

### `tm delete` (reviewed)

- Reject hard deletion. Move every successfully deleted Ticket Snapshot into durable Trash, preserve it indefinitely for future recovery, never purge it, and exclude it from ordinary active Ticket reads.
- Expose no Lean V1 `tm restore` command or equivalent core recovery operation, while retaining enough authoritative Trash data for a future separately reviewed recovery contract.
- Store each deletion as exact `TrashEntry { ticket: Ticket, deletedAt: DateTime.Utc, deletedBy: ActorIdentity }`, where `ticket` is the complete final pre-deletion `open | done | cancelled` Snapshot and deletion attribution is core-owned time plus the command Actor Identity.
- Keep active Ticket IDs and Trash-entry IDs disjoint, permanently reserve every ID in Trash, and reject any fourth `trashed` Ticket lifecycle variant or Activity-only dependency for reconstructing the Trash entry.
- Preserve each selected Ticket's original lifecycle state and Result or Cancellation plus all ordinary Snapshot fields, including parent ID and stored `blockedBy` dependency IDs; preserve no Claim because every selected Ticket must be unclaimed.
- Expose final command flags `--yes`, `--cascade`, `--allow-human`, `--parent-claim-id <uuid>`, and `--actor <identity>` plus shared Store/JSON flags; require exact IDs and reject duplicate singular flags.
- Omit and reject `--claim-id` and `--force`; accept redundant `--cascade` on a transaction-current leaf as an ordinary one-Ticket move.
- Describe the command as moving accidental Tickets and descendants to Trash, state that Trash is permanent in Lean V1 and recovery is unavailable, and expose no recovery or purge command.
- Permit preview-only invocation without Actor Identity because it is read-only; require `--actor` or `TM_ACTOR` for every invocation with `--yes`, and prove every core deletion, Trash entry, and Activity item is attributed.
- Require `--yes` for every deletion. When it is omitted, call public `listTickets` exactly once with the exact target root, `AllStatuses`, and `AllExecutors`; flatten its transaction-consistent tree in canonical tree order and project only shared neutral `TicketSummary` values. Add no dedicated deletion-preview core query or duplicate hierarchy traversal.
- Expose exact `DeletionPreview { target: TicketSummary, descendants: ReadonlyArray<TicketSummary> }` and exact `DeletionConfirmationRequired { requiredFlags, nonBinding: true, preview }`, where `requiredFlags` is the closed tuple `["--yes"] | ["--yes", "--cascade"]`.
- Require `preview.target` to be the supplied root summary and `preview.descendants` to contain every other returned node in canonical tree order. Use `["--yes"]` for an observed leaf and `["--yes", "--cascade"]` whenever any descendant is observed.
- Render human preview exactly as `Error: Moving Ticket <target-id> to Trash requires confirmation.`, then `This preview is informational and reserves or fixes nothing:`, then the target and every descendant as `- <id>: <subject> (status: <status>; executor: <executor>)`, then `Re-run with --yes.` for a leaf or `Re-run with --yes --cascade.` for a non-leaf.
- State that preview is read-only, requires no Actor Identity, evaluates no mutation-only Claim, parent-fence, dependency, or Executor blockers, reserves and fixes nothing, and passes no preview set or token to the core. Prove a descendant created after a leaf preview makes a later `--yes` request without `--cascade` reject.
- Keep `DeletionConfirmationRequired` distinct from core `DeletionRejected`; mechanically map its tag to JSON `type`, preserve the exact nested payload, add no prose `message`, and never emit human prose in JSON mode.
- Permit target-only deletion only when the target is a transaction-current leaf.
- Require `--cascade` for a non-leaf target; reject an omitted cascade when any transaction-current descendant exists.
- With `--cascade`, select the explicit target and every transaction-current descendant across all lifecycle states, including descendants created after an earlier CLI preview; prove the preview neither reserves nor fixes the selected set.
- Reject deletion when the explicit target has an active Claim, including one held by the command Actor; expose no deletion `--claim-id` or matching-holder path.
- Reject the complete cascade when any selected descendant has an active Claim, including one held by the command Actor; accept no descendant Claim-fence collection and preserve all active and Trash state on rejection.
- Permit retry only after every blocking Claim is released or logically expires; prove neither `--yes`, `--cascade`, Actor Identity, nor human-executor acknowledgment can bypass an active Claim.
- Reject the complete deletion when any active-store Ticket outside the selected set references a selected Ticket through `blockedBy`, regardless of the external dependent's open, done, or cancelled lifecycle state.
- Preserve internal dependency relationships when both endpoints move to Trash together; never automatically remove an external dependency edge or mutate an external dependent as a side effect of deletion.
- Permit a selected Ticket's preserved `blockedBy` IDs to reference an active-store prerequisite outside the selected set; exclude the trashed dependent from ordinary active reverse `Blocks` views and leave transaction-current relationship revalidation to a future recovery contract.
- Permit the explicit target to retain an active-store parent outside the selected set; preserve its `parentId` in Trash, exclude it from the surviving parent's ordinary active child view, and leave parent existence and level revalidation to a future recovery contract.
- Preserve internal hierarchy when a complete subtree moves together; never clear the trashed target's parent ID or require deletion of the complete root hierarchy.
- Treat removal of the explicit target from a surviving direct parent as a direct structural parent mutation: map omitted `--parent-claim-id` to `ParentClaimFence.RequireUnclaimed` and a supplied ID to `ParentClaimFence.MatchClaim { claimId }` without a CLI Claim-state pre-read.
- Reject a supplied parent Claim ID for a root with `TargetHasNoParent`; against a surviving parent, reject released or expired state with `NoActiveParentClaim`, renewal or replacement with `ParentClaimIdMismatch`, and an exact ID held by another Actor with `ParentActorMismatch`.
- Never ignore a supplied parent fence or degrade it into an unclaimed structural mutation; permit an unclaimed parent only through `RequireUnclaimed`.
- Ignore Claims on higher ancestors, because their direct child decomposition is unchanged.
- Prove the parent fence authorizes only the surviving parent's structural change and never permits deletion of an actively claimed target or descendant; neither `--yes`, `--cascade`, nor `--allow-human` can replace it.
- Evaluate external dependency blockers transaction-current in the core; prove `--yes` and `--cascade` cannot bypass integrity and rejection changes neither active Tickets nor Trash.
- Map omitted `--allow-human` to `DeletionExecutorScope.AgentOnly` and supplied `--allow-human` to `DeletionExecutorScope.AnyExecutor`; pass semantic scope rather than a raw confirmation boolean to the core.
- Enforce deletion Executor scope transaction-current against the complete selected set across open, done, and cancelled lifecycle states; under `AgentOnly`, return every selected human Ticket, including a human descendant created after preview.
- Prove `AnyExecutor` permits selected human Tickets only subject to every Claim, dependency, cascade, and other deletion invariant.
- Expose exactly `DeleteTicketInput { ticketId, actor, parentClaimFence, scope, executorScope }`, using `ParentClaimFence = RequireUnclaimed | MatchClaim`, `DeletionScope = TargetOnly | CascadeDescendants`, and `DeletionExecutorScope = AgentOnly | AnyExecutor`.
- Exclude raw confirmation booleans, target or descendant Claim IDs, previewed Ticket sets, caller-supplied time, and purge/recovery options from the core input; keep `--yes` adapter-only and let the core own selection, validation, time, Trash, and Activity.
- Return exact `DeleteTicketResult { target: TrashEntry, trashedDescendants: ReadonlyArray<TrashEntry> }` from exact `deleteTicket(input): Effect.Effect<DeleteTicketResult, DeletionRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`, with the complete explicit-target Trash entry and exactly the complete descendant Trash entries moved by this invocation in canonical tree order; return an empty descendant array for a leaf.
- Include descendants created after preview in the committed result and render from that result without scope recomputation or a Store reread.
- Distinguish an unknown ID from a permanent Trash-reserved ID: return `TicketNotFound` for the former and typed `TicketInTrash { ticketId, deletedAt, deletedBy }` for the latter without exposing the complete Snapshot.
- Treat repeated deletion as a failure rather than successful `AlreadyInTrash` or replay; after uncertain commit outcome require reread and reconciliation, with no write or Activity from the retry.
- Render leaf human success exactly as `Moved <subject> (<ticket-id>) to Trash.`.
- Render cascade human success with the exact singular/plural heading `Moved <subject> (<ticket-id>) and <n> descendant Ticket[s] to Trash:`, followed by canonical `- <subject> (<id>)` descendant lines.
- Render JSON success as `{ ok: true, trashEntry, trashedDescendants }` with complete entries and an always-present descendant array; add no duplicate target, hard-deletion terminology, Activity, or post-commit reread.
- Expose exact `ClaimedTicketSummary = TicketSummary & { activeClaim: Claim }` and exact `ExternalDependentSummary = TicketSummary & { dependencyIds: NonEmptyReadonlyArray<TicketId> }`; require each external dependent's selected dependency IDs to be ascending and schema-enforced non-empty.
- Represent resolved deletion-invariant failures with exact schema-backed `DeletionRejected { ticketId, reason }`, where reason is `ActiveTargetClaim { activeClaim } | TargetHasNoParent { providedClaimId } | ActiveParentClaimRequiresFence { parentId } | NoActiveParentClaim { parentId, providedClaimId } | ParentClaimIdMismatch { parentId, providedClaimId } | ParentActorMismatch { parentId, providedActor, activeClaim } | DescendantsRequireCascade { tickets } | ClaimedDescendants { tickets } | ExternalDependents { tickets } | HumanTicketsExcluded { tickets }`.
- Use schema-enforced non-empty `TicketSummary` collections for descendant and human reasons, `ClaimedTicketSummary` for claimed descendants, and `ExternalDependentSummary` for external dependents. Return every descendant canonically without Claim inspection, every claimed descendant canonically with its complete Claim, every external dependent canonically with selected dependency IDs, and the human target first when applicable followed by human descendants canonically.
- Keep invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` distinct from `DeletionRejected`; support Effect parent/reason catching and unwrapping, and mechanically map tags in the CLI without recomputing rules.
- Render exact single-state lines: active target Claim identifies Claim ID, holder, expiry, and required release; root with supplied parent fence says not to pass `--parent-claim-id`; active parent requiring a fence directs reread and `--parent-claim-id`; absent and stale parent Claims identify only the provided Claim ID and parent; and parent Actor mismatch identifies the exactly matched Claim holder.
- Render exact collection headings: `Error: Ticket <id> has descendants; pass --cascade to move them to Trash:`, `Error: Ticket <id> has actively claimed descendants:`, `Error: Moving Ticket <id> to Trash would leave external dependents:`, and `Error: Deletion would include human-executor Tickets; pass --allow-human to continue:`.
- Render ordinary bullets exactly as `- <id>: <subject> (status: <status>; executor: <executor>)`, claimed bullets with exact suffix `; Claim <claim-id> held by <actor> until <expires-at>`, and external-dependent bullets with exact suffix `; selected dependencies: <ascending-comma-separated-ids>` inside the parentheses.
- Render every item in canonical order only from typed payloads without rereading or recomputation; never show only the first blocker or require JSON for complete recovery data. Mechanically map JSON tags to `type`, preserve all fields, and omit duplicate prose messages.
- After acquiring the `BEGIN IMMEDIATE` writer position, sample one core-owned occurrence time for target/descendant Claim activity, surviving-parent fence validity, every Trash entry's `deletedAt`, and every trash Activity item's `occurredAt`.
- Treat Claims expired by that instant as inactive; retain validity of an exactly matched parent Claim active then even if wall-clock expiry passes before commit, and perform no per-Ticket sampling or second expiry check.
- Enforce fail-fast transaction-current core precedence: active/Trash/unknown target resolution; explicit-target active Claim rejection; surviving direct-parent fence; target-only descendant-scope rejection; cascade descendant-Claim rejection; external-dependent rejection; `DeletionExecutorScope`; then atomic mutation.
- Under target-only scope, return every transaction-current descendant without inspecting its Claims, Executor, or dependencies; do not aggregate failures.
- Prove CLI syntax, informational preview when `--yes` is absent, and boundary decoding precede the core request, and every failed stage leaves active Tickets, Claims, Trash, timestamps, and Activity unchanged.
- Serialize deletion races by writer-position order with complete transaction-current revalidation; perform no automatic retry or preview reservation and require explicit caller reread/retry after rejection.
- Race deletion against target, descendant, and surviving-parent acquisition; parent renewal; child creation; external dependency addition; selected Executor update; and another deletion, proving the first commit determines the typed outcome described by the contract.
- When deletion commits first, require later direct target/descendant mutations to resolve `TicketInTrash` while leaving later surviving-parent Claim mutations valid; retain reread/reconciliation for unknown physical commit outcomes.
- In one real file-backed mid-cascade rollback/reopen test, inject a private deterministic failure after target and at least one descendant active removals, Trash insertions, and Activity effects execute but before finishing the selected set or attempting `COMMIT`.
- After reopen, prove every selected Snapshot remains unchanged and active, no partial Trash entry exists, any surviving parent and exact Claim remain unchanged, Activity high-water is unchanged, and retry succeeds.
- Do not require exhaustive per-statement fault injection; require complete rollback for known pre-commit failures and reread/reconciliation for unknown physical commit outcomes.
- Emit one minimal `TicketTrashed` item per moved Ticket with no payload beyond its tag; require common Activity Ticket ID, Actor, and occurrence time to equal the corresponding `TrashEntry.ticket.id`, `deletedBy`, and `deletedAt`.
- Use one core-owned occurrence time and Actor across a cascade; emit the target first and descendants in canonical tree order, atomically with every Trash insertion and active-Ticket removal.
- Do not duplicate complete Snapshots or Trash entries in Activity and do not include `ClaimConsumption`, because successful deletion is categorically unclaimed.
- On every rejection, emit no Activity and create no partial Trash entry.

The `tm delete` scenarios are approved.

### `tm block` (reviewed)

- Require the directly modified target to be open; reject done and cancelled targets with `TicketNotOpen` without changing terminal history, timestamps, dependencies, or Activity.
- Permit an active-store prerequisite in any open, done, or cancelled lifecycle state; treat done and cancelled prerequisites as immediately satisfied under the shared readiness invariant while retaining the relationship.
- Resolve exact target and prerequisite IDs transaction-current in the core; distinguish unknown IDs from `TicketInTrash` and keep lifecycle policy out of CLI pre-reads.
- Return explicit `AlreadyBlocked` when the exact relationship already exists, after target lifecycle eligibility but before target Claim fencing; prove it writes nothing, preserves `updatedAt`, and emits no Activity even with a stale supplied Claim ID.
- Return `Blocked` only when an absent relationship is atomically added under the ordinary target fence; never let the CLI pre-read relation state to choose the outcome.
- Reject self-dependency with distinct `SelfDependency`; reject longer active dependency cycles with the canonical shortest closed path beginning and ending at the target, breaking equal-length path ties by ascending Ticket ID at each traversal step.
- Detect cycles transaction-current after a valid target fence, exclude Trash relationships, and preserve all state and Activity on rejection.
- Expose no `--allow-human` on `tm block`; permit human Executor on either endpoint because addition restricts readiness rather than removing or consuming a human gate.
- Require `--actor` or `TM_ACTOR` and optional target `--claim-id` for effective addition; fence only the directly modified target and ignore any prerequisite Claim.
- Return `AddTicketDependencyResult = Blocked | AlreadyBlocked`; require both outcomes to contain the complete transaction-current target `OpenTicket` and a compact authoritative prerequisite `TicketSummary { ticketId, subject, status, executor }`.
- Use the shared neutral `TicketSummary` type rather than a deletion-specific summary name wherever the same compact Ticket facts are required.
- Prove `Blocked` returns the target Snapshot containing the newly added relationship and the transaction-current prerequisite summary without a CLI Store reread.
- Prove `AlreadyBlocked` returns the unchanged complete open target and transaction-current prerequisite summary while preserving `updatedAt`, Claim, dependencies, Trash, and Activity high-water.
- Render distinct human success sentences for `Blocked` and `AlreadyBlocked`; render JSON as `{ ok: true, outcome: "blocked" | "already-blocked", ticket, dependency }` without exposing core `_tag`, Activity, or Cursor fields.
- Emit exactly one minimal `TicketDependencyAdded { dependencyId }` item for an effective addition; require common Activity Actor and Ticket ID to identify the caller and target and require `occurredAt` to equal the returned target's `updatedAt`.
- Do not duplicate endpoint summaries or the complete target Snapshot in `TicketDependencyAdded`; emit no Activity for `AlreadyBlocked`.
- Represent resolved dependency-addition invariant failures with one schema-backed `DependencyAdditionRejected { ticketId, dependencyId, reason }` wrapper and a closed schema-backed `TicketNotOpenReason | ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch | SelfDependency | DependencyCycle` reason union.
- Support Effect parent/reason catching and reason unwrapping; keep invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` distinct and machine-readable.
- Include terminal status on `TicketNotOpen`; no active-Claim details on `ActiveClaimRequiresFence`; only the provided Claim ID on `NoActiveClaim` and `ClaimIdMismatch`; and the provided Actor plus complete exactly matched active Claim on `ActorMismatch`.
- Put both endpoint IDs on the rejection wrapper; add no duplicate payload to `SelfDependency`; require `DependencyCycle` to contain the canonical schema-enforced non-empty closed cycle path.
- Never reveal a current Claim ID through `ActiveClaimRequiresFence` or `ClaimIdMismatch`; require an explicit reread before retrying.
- Mechanically map outer and nested `_tag` fields to JSON `type`, preserve all recovery payload fields, omit duplicate human `message` fields, and render failures without a CLI Store reread or dependency-rule recomputation.
- Render exact fixed human lines for terminal target, missing target fence, absent active Claim, stale Claim ID, Actor mismatch, and self-dependency reasons.
- Render `DependencyCycle` as `Error: Adding dependency <dependency-id> to Ticket <target-id> would create a dependency cycle: <closed-path>.`, joining every canonical cycle ID with ` -> `.
- Prove human rendering uses only the typed reason payload and JSON preserves the wrapper and nested reason structure without prose duplication.
- Require CLI syntax, required `--by`, exact target/prerequisite IDs, optional Claim ID, and Actor Identity decoding before one core request; require Actor Identity even when transaction-current state later returns `AlreadyBlocked`, and perform no relationship pre-read.
- Enforce fail-fast core precedence: Store and target identity resolution; prerequisite identity resolution; target lifecycle; existing-relation `AlreadyBlocked`; target Claim fence; `SelfDependency`; longer `DependencyCycle`; then atomic mutation.
- Combine a terminal target with a missing or Trash-reserved prerequisite and require prerequisite lookup failure; combine a valid active prerequisite with the terminal target and require `TicketNotOpen`.
- Combine an active target Claim with self-dependency or a longer cycle and require the first target-fence failure; after satisfying the fence, require `SelfDependency` before longer-cycle analysis.
- Prove `AlreadyBlocked` ignores stale Claim input only after both active endpoints and open target lifecycle are established; do not aggregate lookup, lifecycle, Claim, self, or cycle failures.
- Serialize dependency addition under one `BEGIN IMMEDIATE` transaction; after proving the relationship absent, sample one occurrence time for Claim activity, target `updatedAt`, and Activity `occurredAt`, with no second expiry check before commit.
- Preserve every target and prerequisite Claim on successful addition; prove `tm block` never consumes, renews, or otherwise mutates either Claim.
- Race identical additions and require one `Blocked` followed by `AlreadyBlocked`, including when the later request's target Claim ID became stale before its transaction.
- Race `RequireUnclaimed` addition against target acquisition and require `ActiveClaimRequiresFence` when acquisition commits first; race `MatchClaim(C1)` against release and renewal and require `NoActiveClaim` or `ClaimIdMismatch` from transaction-current state.
- Race addition against target completion and require `TicketNotOpen` when completion commits first or require later completion to evaluate the newly committed prerequisite when addition commits first.
- Race prerequisite deletion against addition and require `TicketInTrash` when deletion commits first or require later deletion to observe the new external dependent when addition commits first.
- Race competing graph additions and require the later operation to evaluate the committed graph and return the canonical `DependencyCycle` when applicable.
- Prove the CLI establishes no reservation or preview and neither adapter nor core automatically retries a rejected race.
- In one real file-backed rollback/reopen test, inject a private failure after target relationship and `TicketDependencyAdded` effects execute but before the `COMMIT` attempt; after reopen, prove target Snapshot, `blockedBy`, `updatedAt`, endpoint Claims, and Activity high-water are unchanged, no dependency-addition Activity exists, and retry succeeds.
- Do not require exhaustive dependency-addition fault injection; require complete rollback for known pre-commit failure and reread/reconciliation for unknown physical commit outcomes.
- Expose shared `ChangeDependencyInput { ticketId, dependencyId, actor, claimFence }`, addition-specific `AddTicketDependencyResult`, and exact `addTicketDependency(input): Effect.Effect<AddTicketDependencyResult, DependencyAdditionRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`; keep later dependency removal separate even though its endpoint and fence fields align.
- Expose CLI `tm block <ticket-id> --by <dependency-id> --actor <identity> [--claim-id <uuid>]` with `TM_ACTOR` fallback and shared Store/JSON flags; map the optional Claim ID mechanically and make one core call.
- Omit and reject `--allow-human`, `--force`, prefix IDs, and graph-policy flags; keep lifecycle, no-op, Claim, and cycle rules out of the CLI adapter.
- Replace current prefix, duplicate-failure, generic-message, whole-Store cycle-validation, JSONL mutation, and target-only output assertions with the approved exact-ID typed core, outcomes, endpoint data, errors, Activity, transaction, and rendering contract.

The `tm block` scenarios are approved.

### `tm unblock` (reviewed)

- Require exact transaction-current resolution of both active endpoints and distinguish unknown IDs from `TicketInTrash` before relation-state no-op detection.
- Require the directly modified target to be open; reject done and cancelled targets with `TicketNotOpen` before no-op detection without changing terminal history, timestamps, dependencies, Claims, Trash, or Activity.
- Return explicit successful `AlreadyUnblocked` when the exact relationship is absent, after endpoint resolution and target lifecycle but before target Claim fencing or later effective-removal policy.
- Prove `AlreadyUnblocked` writes nothing, preserves `updatedAt`, dependency and Claim state, Trash, and Activity high-water, emits no Activity, and ignores a stale supplied target Claim ID only for the proven no-op.
- Return `Unblocked` only for effective relationship removal; never let the CLI pre-read relation state to choose the outcome.
- Combine a missing or Trash-reserved endpoint with an absent relationship and require lookup failure; combine a terminal target with an absent relationship and require `TicketNotOpen`; combine an open target's absent relationship with a stale Claim ID and require `AlreadyUnblocked`.
- Protect effective removal only when the prerequisite is transaction-current open and human-executor; do not require acknowledgment merely because the target is human or the prerequisite is done or cancelled human work.
- Model human intent as `DependencyRemovalGateScope = PreserveOpenHumanPrerequisites | AnyPrerequisite`; map omitted CLI `--allow-human` to the former and a supplied flag to the latter without passing a raw approval boolean.
- Enforce gate scope in the core after relation existence and a valid target Claim fence; prove a prerequisite that changes from agent to human before the writer transaction is rejected under `PreserveOpenHumanPrerequisites`.
- Prove `AnyPrerequisite` permits removal of an open human prerequisite only subject to every lookup, lifecycle, relation, and Claim invariant; prove `AlreadyUnblocked` requires no human acknowledgment because no gate is removed.
- Keep the target Executor and every terminal prerequisite Executor out of human-gate confirmation; perform no CLI lifecycle or Executor pre-read.
- Return `RemoveTicketDependencyResult = Unblocked | AlreadyUnblocked`; require both outcomes to contain the complete transaction-current target `OpenTicket` and shared compact authoritative prerequisite `TicketSummary`.
- Prove `Unblocked` returns the target with the exact relationship absent and uses the canonical absent `blockedBy` representation when removing the final dependency; prove `AlreadyUnblocked` returns the unchanged target.
- Render exact distinct human success sentences and JSON `{ ok: true, outcome: "unblocked" | "already-unblocked", ticket, dependency }` without exposing core `_tag`, Activity, or Cursor fields.
- Emit exactly one minimal `TicketDependencyRemoved { dependencyId }` for effective removal; require common Actor and Ticket ID to identify the caller and target and require `occurredAt` to equal the returned target's `updatedAt`.
- Do not duplicate endpoint data in `TicketDependencyRemoved`; emit no Activity for `AlreadyUnblocked`; render both outcomes without a CLI Store reread.
- Represent resolved dependency-removal invariant failures with one schema-backed `DependencyRemovalRejected { ticketId, dependencyId, reason }` wrapper and a closed `TicketNotOpenReason | ActiveClaimRequiresFence | NoActiveClaim | ClaimIdMismatch | ActorMismatch | OpenHumanPrerequisiteExcluded` reason union.
- Support Effect parent/reason catching and reason unwrapping; keep invalid input, shared Store failures, `TicketNotFound`, and `TicketInTrash` distinct and machine-readable.
- Include terminal status on `TicketNotOpen`; no current Claim details on `ActiveClaimRequiresFence`; only the provided Claim ID on `NoActiveClaim` and `ClaimIdMismatch`; and the provided Actor plus complete exactly matched active Claim on `ActorMismatch`.
- Put both endpoint IDs on the rejection wrapper and add no duplicate payload to `OpenHumanPrerequisiteExcluded`; prove that reason can occur only for transaction-current open human prerequisites under `PreserveOpenHumanPrerequisites`.
- Never reveal a current Claim ID through `ActiveClaimRequiresFence` or `ClaimIdMismatch`; mechanically map outer and nested tags without a CLI endpoint reread.
- Render exact fixed human lines for terminal target, missing target fence, absent active Claim, stale Claim ID, Actor mismatch, and excluded open-human prerequisite reasons.
- Map outer and nested `_tag` fields mechanically to JSON `type`, preserve every recovery payload, omit duplicate human `message` fields, and prove rendering performs no Store reread.
- Require CLI syntax, required `--by`, exact endpoint IDs, optional Claim ID, Actor Identity, and gate-scope mapping before one core request; perform no endpoint or relation pre-read and require Actor Identity even for `AlreadyUnblocked`.
- Enforce fail-fast core precedence: Store and target identity resolution; prerequisite identity resolution; target lifecycle; absent-relation `AlreadyUnblocked`; target Claim fence; `DependencyRemovalGateScope`; then atomic mutation.
- Combine a terminal target with a missing or Trash-reserved prerequisite and require prerequisite lookup failure; combine live endpoints with a terminal target and require `TicketNotOpen`.
- Combine an absent relationship with stale Claim input and open-human prerequisite state and require `AlreadyUnblocked`; combine an existing relationship with both invalid target fence and excluded human gate and require the target-fence reason first.
- After satisfying the target fence, require `OpenHumanPrerequisiteExcluded` under `PreserveOpenHumanPrerequisites`; do not aggregate lookup, lifecycle, relation, Claim, and gate failures.
- Serialize dependency removal under one `BEGIN IMMEDIATE` transaction; after proving the relationship exists, sample one occurrence time for Claim activity, target `updatedAt`, and Activity `occurredAt`, with no second expiry check before commit.
- Preserve every target and prerequisite Claim on successful removal; prove `tm unblock` never consumes, renews, or otherwise mutates either Claim.
- Race concurrent removals and require one `Unblocked` followed by `AlreadyUnblocked`, including when the later request's target Claim ID became stale.
- Race `RequireUnclaimed` removal against target acquisition and require `ActiveClaimRequiresFence` when acquisition commits first; race `MatchClaim(C1)` against release and renewal and require `NoActiveClaim` or `ClaimIdMismatch`.
- Race prerequisite Executor and lifecycle transitions against removal; enforce open-human exclusion when that state commits first, and require no acknowledgment when terminal state commits first.
- Race removal against target completion and require `TicketNotOpen` when completion commits first or require later completion to evaluate the reduced dependency set when removal commits first.
- Race prerequisite deletion against removal; require deletion's external-dependent rejection while the edge exists and permit later deletion to proceed subject to its remaining invariants when removal commits first.
- Prove the CLI establishes no reservation or preview and neither adapter nor core automatically retries a rejected race.
- In one real file-backed rollback/reopen test, inject a private failure after relationship deletion and `TicketDependencyRemoved` effects execute but before the `COMMIT` attempt; after reopen, prove target Snapshot, relationship, `updatedAt`, endpoint Claims, and Activity high-water are unchanged, no removal Activity exists, and retry succeeds.
- Do not require exhaustive dependency-removal fault injection; require complete rollback for known pre-commit failure and reread/reconciliation for unknown physical commit outcomes.
- Expose exact `RemoveTicketDependencyInput { ticketId, dependencyId, actor, claimFence, gateScope }`, `RemoveTicketDependencyResult`, and exact `removeTicketDependency(input): Effect.Effect<RemoveTicketDependencyResult, DependencyRemovalRejected | TicketNotFound | TicketInTrash | StoreMutationError, TaskManager>`; share endpoint/fence shapes with addition without making removal-only gate scope optional or valid for addition.
- Expose CLI `tm unblock <ticket-id> --by <dependency-id> --actor <identity> [--claim-id <uuid>] [--allow-human]` with `TM_ACTOR` fallback and shared Store/JSON flags; map the optional Claim fence and gate scope mechanically and make one core call.
- Omit and reject prefix IDs, `--force`, and graph-policy flags; keep lifecycle, no-op, Claim, and human-gate rules out of the CLI adapter.
- Replace current prefix, absent-relation failure, broad either-endpoint human guard, generic-message, JSONL mutation, and target-only output assertions with the approved exact-ID typed core, outcomes, open-human gate scope, endpoint data, errors, Activity, transaction, and rendering contract.

The `tm unblock` scenarios are approved.

## Implementation documentation and skill migration

- Treat `specs/lean-v1.md`, this checklist, `CONTEXT.md`, and `AGENTS.md` as the complete implementation-document authority; prove no retained project guide or historical specification presents conflicting behavior as current.
- Rebuild `skills/task-manager/SKILL.md`, creating only necessary supporting references, against the generated Lean V1 help and public JSON output.
- Prove the Task Manager skill uses exact Ticket and Claim IDs, current Actor and Claim-fence requirements, separate Claim receipts, `tm update --executor`, semantic cancellation/deletion scope, permanent Trash terminology, and the reviewed Result inputs.
- Prove the Task Manager skill contains no JSONL editing or recovery guidance, prefix-ID behavior, `tm set-executor`, `--force`, takeover or forced release, cancellation `--yes`, hard deletion, `--verification`, `--allow-no-verification`, removed message inputs, or other removed flags.
- Rebuild `skills/to-tickets/SKILL.md` against the generated Lean V1 help and public JSON output.
- Prove the ticket-planning skill uses exact IDs, explicit Executor selection, required Actor Identity for state-changing mutations, `tm update --executor`, current list/next filters, real dependency edges, and exact parent fencing when creating under an actively claimed parent.
- Prove the ticket-planning skill contains no JSONL recovery instructions, prefix-ID behavior, `tm set-executor`, generic force guidance, removed list filters, removed message inputs, empty-Context compatibility, or other pre-Lean command assumptions.
- Exercise representative skill command examples against the completed CLI in temporary Stores; require examples either to succeed with the documented JSON shape or to produce the documented typed failure.
- Regenerate end-user documentation only after core, CLI, and skill conformance. Search regenerated documentation for removed commands, flags, storage models, terminology, and bypass behavior before publication.
