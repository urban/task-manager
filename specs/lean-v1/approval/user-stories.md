# Approval View

## Change Summary

- Previous snapshot SHA-256: 748ba4eaa5ec632234eb63f74c8d8b3cf30fcd2fa3d7d9d05925793562f1f171
- Added US1.62 for privileged local diagnosis of one selected CLI command without changing product behavior.
- Added US1.62 to HLS1.3 process-contract coverage while preserving all existing story IDs and meanings.
- Defined CLI-first activation, local-only privacy-filtered export, bounded post-publication finalization, and exact Exit/Cause transparency at stakeholder level.

## Stakeholder-Level User Stories

- HLS1.1 — Establish and access a safe local coordination Store
  - Role: Store operator, core integrator, or CLI caller.
  - Relevance: Preserves typed Store initialization, validation, and access.
- HLS1.2 — Coordinate Ticket work atomically under exact Claims
  - Role: External orchestrator, agent executor, or human executor.
  - Relevance: Preserves all mutation, race, and finalization reconciliation stories.
- HLS1.3 — Consume deterministic process contracts safely
  - Role: CLI caller or external orchestrator.
  - Relevance: Adds US1.62 without changing human or JSON process behavior.
- HLS1.4 — Follow conformant Lean V1 guidance
  - Role: Implementation executor and reviewer.
  - Relevance: Keeps guidance aligned with approved public behavior.

## Capability Map and Detailed Story Anchors

- US1.1-US1.17 — Public core, Store operation, input, and identity
  - Existing typed boundaries remain unchanged.
- US1.18-US1.61 — Ticket, Claim, lifecycle, Trash, Dependency, race, atomicity, and finalization
  - Existing detailed behavior and numbering remain unchanged.
- US1.57-US1.59 — Deterministic process and acknowledgment contracts
  - Human and JSON outputs remain stable.
- US1.62 — Privileged debug observability
  - Explicit CLI or lazy environment activation enables privacy-filtered local traces/logs without changing product bytes, status, Exit/Cause, or core architecture.

## Boundary and Failure Coverage

| Focus | Detailed stories | Approval consequence |
| --- | --- | --- |
| Known rollback | US1.53 | Reopen proves established non-commit before deliberate retry. |
| Unknown transaction outcome | US1.54 | Reread and reconcile before retry. |
| Known commit, close failure | US1.61 | Reread authoritative state and do not replay. |
| Privileged debug | US1.62 | Product behavior is identical; telemetry is bounded, local-only, and best-effort. |
| Process output | US1.57-US1.58 | Human and JSON bytes, streams, and status remain exact. |

## Decisions Required for Approval

- Approve US1.62 as additive process-diagnostic behavior rather than a core operation.
- Approve explicit root debug activation with environment fallback only when CLI is absent.
- Approve fixed local OTLP traces/logs and privacy filtering after Store and product finalization.
- Approve exact output, status, and Effect Exit/Cause transparency.
- Approve unchanged US1.1-US1.61 behavior and numbering.

## Story Gaps and TODO: Confirm Items

- Story gaps: None identified against the revised charter and retained detailed story surface.
- TODO: Confirm items: None.

## Traceability Map

- [T1] Claim: HLS1.3 includes privileged debug as a deterministic process contract.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md :: High-Level Story: Consume deterministic process contracts safely
  - Evidence quote: "- Detailed story coverage: US1.57, US1.58, US1.59, US1.62"
- [T2] Claim: Debug activation is explicit CLI first with environment fallback only when absent.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md :: Story: Diagnose one selected CLI command without changing it
  - Evidence quote: "Enable the inherited root `--debug` boolean, or use `TM_DEBUG` only when no explicit CLI boolean was supplied, and allow the CLI-private observer to export privacy-filtered traces and logs to the fixed local OTLP endpoints."
- [T3] Claim: Debug does not change product output, status, or original Effect Exit/Cause.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md :: Story: Diagnose one selected CLI command without changing it
  - Evidence quote: "Debug on and off produce byte-identical product output and the same status and original Effect `Exit`/`Cause`; enabled telemetry is bounded, local-only, best-effort, flushed only after product publication and all Store/client finalizers, while disabled debug constructs no telemetry or network resource."
- [T4] Claim: Debug exposes sparse closed diagnostics without payload or transaction-time network leakage.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md :: Story: Diagnose one selected CLI command without changing it
  - Evidence quote: "The caller can inspect a sparse command-to-public-operation-to-Store topology and closed outcome classifications without exposing product or persistence payloads, introducing network activity during Store use, or changing the public core architecture."

## Validator Status

- Canonical validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-user-stories/scripts/validate_user_stories.sh specs/lean-v1/user-stories.md
  - Result: Passed
- Approval-view validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-approval-view/scripts/validate_approval_view.sh artifact-revised specs/lean-v1/user-stories.md specs/lean-v1/approval/user-stories.md
  - Result: Passed

## Downstream Impact if Approved

- FR1.72-FR1.79 and NFR2.20 become the normative detailed obligations for US1.62.
- Technical design and Ticket planning must keep debug vertical, CLI-private, transparent, local-only, and privacy-filtered.
- Final approval may proceed without renumbering or changing prior stakeholder stories.

## Snapshot Identity

- Review type: Artifact
- Approval mode: Revised
- Canonical artifact: /Volumes/Code/personal/task-manager-next/specs/lean-v1/user-stories.md
- Snapshot SHA-256: fed2dde531b3005a5e888c7eabbb5787a386a914fac0e145d6e9b1a7e4dcd35d
- Canonical updated_at: 2026-08-25T16:30:00Z
- Approval view generated_at: 2026-08-25T16:31:00Z
