# Approval View

## Change Summary

- Previous snapshot SHA-256: 765111a370cda49c277daa5512dc09784a5fbf1bd51b4f9f0fab495a9360d601
- Accepted stock `@effect/sql-sqlite-bun` with Bun's embedded SQLite engine as the sole Lean V1 persistence architecture while preserving a vendor-neutral public core.
- Removed all Lean V1 references to the former database backend and added no compatibility, testing, production, or future-adapter exception.
- Made the public `layer(options)` constructor requirement-free by providing all platform and private implementation dependencies internally.
- Added FR1.80 as the exhaustive CLI grammar.
- Closed first-run Store-directory creation, Claim reservation, Claim-ID collision, and human-completion pre-read gaps.
- Added individual-obligation verification traceability and explicit self-hosting/cutover evidence.
- Retired the former top-level architecture and verification checklist as implementation authorities through the repository guidance referenced by the canonical pack.

## Cross-Artifact Coherence

- The charter selects stock Effect SQL with Bun SQLite behind a vendor-neutral core; requirements TC3.5 and DEP6.2 define the exact backend, and the technical design qualifies the same pinned driver/runtime profile.
- Requirements TC3.2 fixes the public Layer contract; the technical composition graph provides FileSystem, Path, Clock, Crypto, Reactivity, checkpoint defaults, and every private service without exposing them to callers.
- FR1.80 defines the complete product grammar; the technical-design real-process suite binds generated help, argv parsing, defaults, conflicts, occurrence bounds, output bytes, and status to that same matrix.
- FR1.4, DR4.32, and the completion requirements align with the technical initialization, reservation-validation, collision-allocation, and pre-read sequences.
- The technical design makes individual obligation rows, public evidence boundaries, and stable-control-plane separation mandatory before implementation completion and cutover.

## Scope Continuity Matrix

| Focus | Detail | Notes |
| --- | --- | --- |
| Persistence | Stock `@effect/sql-sqlite-bun` and pinned Bun embedded SQLite | Sole Lean V1 backend; public core remains vendor-neutral |
| Public Layer | `layer(options)` provides `TaskManager` without caller requirements | Deterministic substitutes remain package-private |
| CLI | FR1.80 closed grammar for all 15 commands | Every singular option rejects duplicates; only `create --blocked-by` repeats |
| Initialization | Missing Store directory chain created with owner-only permissions | Existing permissions preserved; path preparation maps to `StoreOpenFailed` |
| Claim identity | Missing reservations are integrity issues; extra valid reservations are tombstones | Claim collision resampling is bounded to 16 attempts |
| Completion adapter | One decoded-input pre-read followed by at most one mutation call | Exact human confirmation ordering remains adapter-only |
| Verification | Every requirement identifier has one stable planned scenario | Evidence fidelity cannot be replaced by aggregate gate success |
| Cutover | Stable coordination, disposable product Stores, and isolated skill sessions remain separate | CLI and skill switching are explicit actions |

## Decision Gates before Implementation

- Stakeholder final whole-pack approval of this exact snapshot is still required before implementation Ticket recreation.
- Every canonical artifact and derived artifact approval view must pass its validator against the recorded snapshot hash.
- `specs/lean-v1/approval/verification-traceability.md` must contain every requirement identifier exactly once with no missing or duplicate row.
- Final adversarial review must report no unresolved P0 or P1 specification finding.
- Operational Ticket coordination must continue to resolve to `/Volumes/Code/personal/task-manager/packages/cli/src/bin.ts`; the worktree CLI may use only disposable Stores.
- Global CLI switching and rebuilt-skill installation remain separate explicit cutover actions.

## Unresolved Cross-Artifact Pressure Points

- None. The final whole-pack approval action remains intentionally open and is not a specification ambiguity.

## Downstream Impact if Approved

- Implementation Tickets can be recreated from the four canonical artifacts and the stable verification scenario ledger without consulting retired authorities.
- Core implementation must use the requirement-free public Layer and stock Bun SQLite persistence profile.
- CLI implementation and generated help must conform exactly to FR1.80.
- Initialization, reservation validation, collision allocation, completion confirmation, and self-hosting safety must be implemented and evidenced as specified.
- Every implementation handoff must attach named evidence to the stable scenario IDs rather than relying only on aggregate `bun run check` success.

## Traceability Map

- [T1] Claim: Bun SQLite through stock Effect SQL is behind a vendor-neutral core boundary.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md :: Goals
  - Evidence quote: "Provide one typed Effect core package and one thin CLI package with stable public seams, explicit Store configuration, and no persistence or domain-policy leakage into callers, while using stock Effect SQL with Bun SQLite entirely behind the vendor-neutral core boundary."
- [T2] Claim: The public Layer provides and hides every implementation dependency.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Technical Constraints
  - Evidence quote: "It shall provide and hide FileSystem, Path, Crypto, Clock, Reactivity, the disabled checkpoint reference, and every private persistence or feature service so callers provide no implementation requirement."
- [T3] Claim: The CLI grammar is closed and exhaustive.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "FR1.80: The CLI grammar shall be closed and exhaustive."
- [T4] Claim: Initialization creates and protects an absent Store directory before artifact creation.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "Before artifact creation, initialization shall create an absent canonical Store Location and missing parents through Effect FileSystem, assign `0700` to every directory Task Manager creates, never chmod a pre-existing directory, and treat concurrent `AlreadyExists` as success only after verifying the resulting path is a directory."
- [T5] Claim: Extra valid Claim reservations are conservative tombstones rather than integrity failures.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Data Requirements
  - Evidence quote: "The reservation reason shall apply to a safely decoded current Claim or durable Claim Activity whose Claim ID lacks the permanent private reservation; extra valid reservations are conservative tombstones and are not integrity issues."
- [T6] Claim: Claim-ID collision handling is bounded and deterministic.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/technical-design.md :: Private Deterministic Controls
  - Evidence quote: "Claim allocation samples and attempts permanent UUIDv4 reservation inside the writer transaction; a reservation collision resamples, with exactly 16 total attempts."
- [T7] Claim: Human completion performs one mandatory adapter pre-read with exact confirmation behavior.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/technical-design.md :: CLI Preparation Capabilities
  - Evidence quote: "Human completion has one mandatory adapter pre-read: after syntax, source, file, JSON, identity, Actor, and complete Result decoding, the already provided capability calls `getTicketDetails(ticketId)` exactly once."
- [T8] Claim: Every normative identifier receives an individual stable evidence row.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/technical-design.md :: Verification Traceability and Self-Hosting Cutover
  - Evidence quote: "It enumerates every individual `FR`, `NFR`, `TC`, `DR`, `IR`, and `DEP` identifier and assigns one stable scenario ID, setup class, controlled action, public observation, and evidence family."
- [T9] Claim: Stable coordination and the worktree product remain separated until explicit cutover.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/technical-design.md :: Verification Traceability and Self-Hosting Cutover
  - Evidence quote: "The worktree CLI must run only through automated tests or disposable Stores and never against `/Volumes/Code/personal/task-manager-next/.tasks`; this worktree must not run `bun link` or replace the globally linked stable CLI."

## Validator Status

- Canonical validator:
  - Command: `bash ../agent-skills-spec-pack/skills/write-charter/scripts/validate_charter.sh specs/lean-v1/charter.md && bash ../agent-skills-spec-pack/skills/write-user-stories/scripts/validate_user_stories.sh specs/lean-v1/user-stories.md && bash ../agent-skills-spec-pack/skills/write-requirements/scripts/validate_requirements.sh specs/lean-v1/requirements.md && bash ../agent-skills-spec-pack/skills/write-technical-design/scripts/validate_technical_design.sh specs/lean-v1/technical-design.md`
  - Result: Passed
- Approval-view validator:
  - Command: `bash ../agent-skills-spec-pack/skills/write-approval-view/scripts/validate_approval_view.sh pack-revised specs/lean-v1/approval/final-pack.md specs/lean-v1/charter.md specs/lean-v1/user-stories.md specs/lean-v1/requirements.md specs/lean-v1/technical-design.md`
  - Result: Passed

## Snapshot Identity

- Review type: Pack
- Approval mode: Revised
- Spec-pack root: /Volumes/Code/personal/task-manager-next/specs/lean-v1
- Pack snapshot SHA-256: ad9d90db557e8f7aa8b937777b5c560e3cdf3a966f6875d30363cfacdb3ab6bf
- Approval view generated_at: 2026-08-26T18:46:00Z
- Included snapshots:
  - /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md | SHA-256: 3c9db31e4748e7b7d9975e1ec13e8f36853ffd84b5c71c6623047631f25f5009 | updated_at: 2026-08-26T18:45:00Z
  - /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md | SHA-256: c9c1285b4a38cf2e558ddf09a96aeace7d9eed1cb9a079e8294bba9a33857e74 | updated_at: 2026-08-26T18:45:00Z
  - /Volumes/Code/personal/task-manager-next/specs/lean-v1/technical-design.md | SHA-256: 11e4819bca50dc0d5c58f4ff2bc105b8bce108d44bf2d4ebd15274e1d4950cac | updated_at: 2026-08-26T18:45:00Z
  - /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md | SHA-256: fed2dde531b3005a5e888c7eabbb5787a386a914fac0e145d6e9b1a7e4dcd35d | updated_at: 2026-08-25T16:30:00Z
