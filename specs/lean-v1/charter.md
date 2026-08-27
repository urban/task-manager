---
name: lean-v1-charter
created_at: 2026-08-18T15:03:13Z
updated_at: 2026-08-27T18:45:00Z
generated_by:
  root_skill: specification-authoring
  producing_skill: charter
  skills_used:
    - specification-authoring
    - charter
    - write-charter
  skill_graph:
    specification-authoring:
      - charter
    charter:
      - write-charter
    write-charter: []
source_artifacts: {}
---

# Charter

## Goals

- Deliver Lean V1 as a local, orchestrator-facing coordination kernel for durable Tickets, Claims, permanent Trash, and Semantic Activity while leaving assignment, execution, review, and progress policy to external orchestrators.
- Provide one typed Effect core package and one thin CLI package with stable public seams, explicit Store configuration, and no persistence or domain-policy leakage into callers, while using stock Effect SQL with Bun SQLite entirely behind the vendor-neutral core boundary.
- Support safe coordination by multiple local processes sharing one embedded Store through atomic, transaction-current behavior and exact Claim fencing.
- Preserve the accepted Ticket lifecycle, hierarchy, dependency, Claim, Activity, Trash, Store-validation, typed-failure, human-output, and JSON-output semantics as one coherent Lean V1 product contract.
- Produce one approved and internally consistent four-artifact specification pack from which implementation and fresh execution Tickets can be derived without consulting the retired top-level Lean V1 architecture or verification checklist.
- Make every accepted product obligation traceable to deterministic evidence through the public typed core interface or the real CLI process.
- Provide explicitly activated, privileged local debug traces and logs for a selected CLI command while preserving byte-identical product output, exact Effect Exit/Cause transparency, the closed public core architecture, and default-deny privacy.

## Non-Goals

- Task Manager does not become a workflow engine and does not own assignment, execution, review, progress, or agent-orchestration policy.
- Lean V1 does not include backup, restore, automatic or Effect SQL migration, revision guards, durable retry receipts, Ticket reparenting or reopening, Trash recovery or purge, whole-Store destruction, broad platform qualification, exhaustive crash and physical power-loss hardening, telemetry metrics, remote or environment-selected telemetry destinations, periodic telemetry export, or telemetry in the public core API.
- The specification-authoring process does not change an accepted Lean V1 behavior merely to simplify how the new artifacts are organized; any substantive behavior change requires an explicit decision and approval.
- The charter does not determine implementation modules, source folders, internal abstractions, or coding patterns; those decisions belong to the approved technical design.
- The specification-authoring process does not create or execute implementation Tickets before final pack approval.
- The retired top-level architecture and verification checklist remain migration evidence only and do not act as parallel implementation authorities.
- `CONTEXT.md` remains the canonical domain glossary, and `specs/lean-v1-ticket-planning.md` remains the planning workflow used to recreate implementation Tickets after pack approval.

## Personas / Actors

- **External orchestrator:** Applies workflow, selection, assignment, review, and progress policy while relying on Task Manager for durable coordination facts and atomic state transitions.
- **Agent executor:** Performs agent-executor Ticket work under an explicit Actor Identity and the applicable exact Claim fence.
- **Human executor:** Performs human-executor Ticket work while remaining visible to Executor filtering and explicit human-work acknowledgments.
- **Store operator:** Resolves, initializes, validates, and diagnoses one local Store without depending on private database structure or vendor failures.
- **Core package integrator:** Uses the public typed `TaskManager` capability directly and must not depend on SQL clients, connections, statements, rows, SQL errors, SQLite engine details, platform handles, or connection lifecycle.
- **CLI caller:** Uses deterministic human output or compact structured JSON to inspect and mutate Task Manager state through the supported command surface.
- **Implementation executor and reviewer:** Uses the approved specification pack, `CONTEXT.md`, repository instructions, and a self-contained Ticket to implement and verify one bounded behavioral outcome without inventing conflicting product or implementation architecture.

## Success Criteria

- SC1.1: The approved pack accounts for every accepted Lean V1 obligation with no unexplained omission or contradiction; `specs/lean-v1.md` and `specs/lean-v1-verification-checklist.md` are retired migration evidence rather than implementation authority.
- SC1.2: The approved pack defines the complete public core capability, Store model, CLI command surface, domain invariants, typed failures, and mandatory verification evidence for Lean V1.
- SC1.3: Every core behavior is verifiable through exported access functions requiring the `TaskManager` capability and a Layer backed by a real temporary file-based Store.
- SC1.4: Every CLI behavior is verifiable through the real process entrypoint, including parsing, environment fallback, file input, output streams, exit status, human rendering, and JSON framing where applicable.
- SC1.5: The mandatory evidence includes bounded multi-process writing, Claim acquisition races, atomic Activity and Trash behavior, deterministic failure precedence, successful stock Effect SQL commit and reopen, proven stock rollback and deliberate retry, unknown-transaction-outcome reconciliation, and known commit followed by isolated outer mutation-client finalization failure through real public mutations. The known-commit case must prove authoritative committed state after reread and no automatic replay.
- SC1.6: The approved technical design gives a fresh implementation executor an unambiguous implementation structure, ownership boundaries, allowed dependency direction, resource and composition strategy, public export policy, and testing architecture without contradicting the public product contract or requiring the charter to select internal modules, abstractions, or coding patterns.
- SC1.7: `charter.md`, `user-stories.md`, `requirements.md`, `technical-design.md`, every artifact approval view, the verification traceability ledger, and the final pack approval view pass their validators with no unresolved confirmation markers.
- SC1.8: Repository guidance names the four-artifact pack as normative and the former top-level architecture and checklist as retired migration evidence; no implementation Ticket may treat the retired files as authority.
- SC1.9: New implementation Tickets are recreated only after final pack approval, using `specs/lean-v1-ticket-planning.md` to produce self-contained behavioral tracer bullets with explicit public seams, prerequisites, verification, and source traceability.
- SC1.10: Deterministic public and real-process evidence proves the complete `--debug`/`TM_DEBUG` activation matrix, absence of disabled resources, byte-and-status equality on every representative outcome, exact Exit/Cause identity, sparse span topology and cardinality, transaction/client/final-output/export order, one bounded 250 ms finalization deadline, final serialized OTLP privacy, required log classification and deduplication, and silent loss under every telemetry transport or observer failure.
