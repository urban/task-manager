# Approval View

## Change Summary

- Accepted Bun SQLite through stock `@effect/sql-sqlite-bun` as the sole Lean V1 persistence architecture while keeping the public core vendor-neutral.
- Removed every Lean V1 reference to the retired database engine and added no compatibility, testing, or future-adapter exception.
- Retired the former top-level architecture and verification checklist as implementation authorities; the four-artifact `specs/lean-v1/` pack is normative through `AGENTS.md`.
- Added final-pack verification traceability and explicit self-hosting/cutover evidence obligations.
- Stakeholder decision status: accepted for incorporation; final whole-pack approval remains pending the completed reconciliation review.

- Previous snapshot SHA-256: 15567989adb9c5fa59734a9b7d4b5a5a56c75c63fb99fe5e7ec64e4a3a7928d8
- Added privileged local debug traces and logs as an explicit Lean V1 goal while preserving exact product behavior and the closed core.
- Added telemetry non-goals for metrics, remote or environment-selected destinations, periodic export, and public-core telemetry.
- Added SC1.10 for deterministic activation, transparency, topology, ordering, 250 ms finalization, privacy, log deduplication, and transport-failure evidence.

## Goals and Non-Goals

- Goals:
  - Provide explicitly activated local trace and log diagnostics for one selected CLI command.
  - Preserve byte-identical output, exact Effect Exit/Cause, and the existing public core boundary.
- Non-Goals:
  - Do not add metrics, remote or environment-selected destinations, periodic export, or telemetry to the public core API.
  - Do not add workflow policy, automatic mutation replay, migration, backup, or lifecycle scope.

## Actors and Personas in Scope

- CLI caller
  - Role: Explicitly activates privileged local diagnostics for a selected command.
  - Relevance: Must receive identical product bytes and status whether debug is on or off.
- Store operator
  - Role: Uses bounded local telemetry to diagnose command and Store boundaries.
  - Relevance: Must not receive SQL, paths, payloads, credentials, or ambient resource values in OTLP data.
- Core package integrator
  - Role: Uses the exact public Task Manager capability directly.
  - Relevance: Debug must not change the public service, Layer options, or core requirements.
- Implementation executor and reviewer
  - Role: Implements and verifies the approved pack.
  - Relevance: Needs deterministic public and real-process evidence for every privileged-debug invariant.

## Success Criteria that Define Done

- Complete `--debug`, generated negation, and `TM_DEBUG` activation evidence passes.
- Debug on/off preserves bytes, status, and original Effect Exit/Cause identity.
- Traces and logs use sparse topology, fixed loopback endpoints, strict final-byte privacy, and deduplicated error classification.
- Store/client closure and product publication precede one bounded 250 ms telemetry finalization.

## Decisions Required for Approval

- Approve privileged local debug observability as an explicitly activated CLI-only capability.
- Approve strict output and Exit/Cause transparency as non-negotiable product boundaries.
- Approve default-deny final serialized OTLP privacy and fixed numeric-loopback transport.
- Approve silent telemetry loss and no retry under one total 250 ms finalization deadline.
- Approve preservation of every unrelated Lean V1 behavior and public architecture seam.

## Scope Risks and Open Questions

- Exact Effect RC 111 CLI, Cause, Tracer, Logger, OTLP, and HTTP behavior requires requalification on any participating Effect upgrade.
- Privileged telemetry remains operationally sensitive even after allowlist projection and requires separate review.
- Open questions: None.

## Traceability Map

- [T1] Claim: Privileged debug observability is an explicit product goal with public-behavior transparency.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md :: Goals
  - Evidence quote: "Provide explicitly activated, privileged local debug traces and logs for a selected CLI command while preserving byte-identical product output, exact Effect Exit/Cause transparency, the closed public core architecture, and default-deny privacy."
- [T2] Claim: Remote destinations, metrics, periodic export, and core telemetry are out of scope.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md :: Non-Goals
  - Evidence quote: "Lean V1 does not include backup, restore, automatic or Effect SQL migration, revision guards, durable retry receipts, Ticket reparenting or reopening, Trash recovery or purge, whole-Store destruction, broad platform qualification, exhaustive crash and physical power-loss hardening, telemetry metrics, remote or environment-selected telemetry destinations, periodic telemetry export, or telemetry in the public core API."
- [T3] Claim: Done requires activation, transparency, topology, ordering, bounded finalization, privacy, logging, and outage evidence.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md :: Success Criteria
  - Evidence quote: "SC1.10: Deterministic public and real-process evidence proves the complete `--debug`/`TM_DEBUG` activation matrix, absence of disabled resources, byte-and-status equality on every representative outcome, exact Exit/Cause identity, sparse span topology and cardinality, transaction/client/final-output/export order, one bounded 250 ms finalization deadline, final serialized OTLP privacy, required log classification and deduplication, and silent loss under every telemetry transport or observer failure."

## Validator Status

- Canonical validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-charter/scripts/validate_charter.sh specs/lean-v1/charter.md
  - Result: Passed
- Approval-view validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-approval-view/scripts/validate_approval_view.sh artifact-revised specs/lean-v1/charter.md specs/lean-v1/approval/charter.md
  - Result: Passed

## Downstream Impact if Approved

- US1.62 and its requirements become the stakeholder and normative basis for implementation.
- Technical design must keep telemetry CLI-private and use exact RC 111 behavior behind allowlist wrappers.
- Verification and implementation planning must retain the complete activation, transparency, privacy, and finalization matrix.

## Snapshot Identity

- Review type: Artifact
- Approval mode: Revised
- Canonical artifact: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md
- Snapshot SHA-256: 3c9db31e4748e7b7d9975e1ec13e8f36853ffd84b5c71c6623047631f25f5009
- Canonical updated_at: 2026-08-26T18:45:00Z
- Approval view generated_at: 2026-08-26T18:46:00Z
