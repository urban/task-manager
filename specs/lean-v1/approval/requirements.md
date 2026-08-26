# Approval View

## Change Summary

- Accepted the exact requirement-free public `layer(options)` constructor providing `TaskManager`, with all platform and persistence dependencies hidden inside the live graph.
- Added FR1.80 as the exhaustive CLI grammar, including shared flags, every positional and command option, defaults, conflicts, occurrence bounds, Actor fallback, and the sole repeatable option.
- Added first-run Store-directory creation, `0700` ownership, concurrent-create verification, and `StoreOpenFailed` mapping.
- Added `ClaimIdNotReserved`; extra valid reservations are accepted as conservative tombstones.
- Bounded Claim-ID collision resampling to 16 attempts followed by an implementation/entropy defect.
- Removed every reference to the retired database engine; Bun SQLite through stock `@effect/sql-sqlite-bun` is the persistence contract.
- Stakeholder decision status: accepted for incorporation; final whole-pack approval remains pending the completed reconciliation review.

- Previous snapshot SHA-256: 430ff66fe69f44c1a058efd08b163a1a7ef01e9894b662e393b498fbcb2ae4b3
- Replaced the imprecise bare debug boolean declaration with exact RC 111 `Flag.boolean("debug").pipe(Flag.atMost(1))` retention semantics for zero, one, repeated, and mixed occurrences.
- Explicitly prohibited `Flag.withFallbackConfig` so help, version, completion, and parse-failure paths cannot evaluate `TM_DEBUG`.
- Clarified that `AppLive` provides only a resource-free debug-session factory before parsing, while `CliApplication.run` conditionally acquires the enabled command-scoped session after successful selection and activation.
- Preserved all telemetry transparency, transport, privacy, finalization, transaction-classification, and public-core obligations.

## Highest-Impact Obligations

- Exact occurrence handling — FR1.72
  - `Flag.atMost(1)` retains parser occurrences so absence remains distinguishable from explicit false and duplicate/mixed argv remains `DuplicateOption`.
- Lazy environment bypass — FR1.72
  - Debug must not use parser-owned fallback Config; `TM_DEBUG` is evaluated only after command selection when no explicit boolean exists.
- Resource-free pre-parse composition — FR1.74
  - `AppLive` provides a factory but allocates no exporter, queue, timer, projector, HttpClient, or network resource.
- Command-scoped enabled acquisition — FR1.74
  - `CliApplication.run` invokes enabled acquisition only after selection and activation and owns the resulting session inside the command scope.
- Retained privileged-debug contract — FR1.73-FR1.79
  - Exact Exit/Cause, fixed transport, sparse topology, strict privacy, required logs, and one 250 ms finalization deadline remain unchanged.

## Canonical Domain Language and Requirement Consequences

| Term group | Settled meaning | Requirement consequences |
| --- | --- | --- |
| Root debug parameter | `Flag.boolean` wrapped by `Flag.atMost(1)` | FR1.72; TC3.4 |
| No explicit debug value | Zero-element bounded parser result | FR1.72 |
| Explicit debug value | One-element bounded parser result, including explicit false | FR1.72 |
| Environment fallback | Manual lazy activation after selection; never `Flag.withFallbackConfig` | FR1.72; IR5.3 |
| Debug session factory | Resource-free private capability supplied by AppLive before parsing | FR1.74; TC3.10 |
| Enabled command session | Acquired conditionally by CliApplication.run after activation | FR1.74; FR1.79 |
| Public architecture | Exact 15-method service and one-field Layer options unchanged | FR1.1; FR1.66; FR1.72 |

## Data, Integration, and Validation Hotspots

| Focus | Revised contract hotspot | Approval check |
| --- | --- | --- |
| Occurrence retention | `Flag.atMost(1)` preserves zero/one distinction and detects repeated/mixed forms | FR1.72 |
| Fallback timing | `Flag.withFallbackConfig` prohibited | FR1.72 |
| Help/parse bypass | No `TM_DEBUG` read or debug resource construction | FR1.72 |
| AppLive | Provides resource-free `DebugTelemetrySessionFactory` before parsing | FR1.74 |
| CliApplication.run | Acquires enabled command session only after selection/activation | FR1.74 |
| Disabled mode | Skips enabled acquisition and allocates no telemetry/network resource | FR1.74 |
| Retained safety | Exact Exit/Cause, endpoints, privacy, transaction classification, and 250 ms deadline | FR1.73-FR1.79; NFR2.20 |

## Constraints that Shape Design

- Use the exact RC 111 occurrence-bound wrapper rather than assuming `Flag.boolean` rejects duplicate argv.
- Keep Config fallback outside the parser so explicit false suppresses environment evaluation and early parser exits never read it.
- Keep AppLive provision resource-free; no enabled telemetry object may exist before successful command selection and activation.
- Acquire and finalize the enabled session inside one command scope without changing product bytes or the original Exit/Cause.
- Preserve fixed numeric-loopback transport, strict final-byte privacy, and the closed public core.

## Decisions Required for Approval

- Approve `Flag.boolean("debug").pipe(Flag.atMost(1))` as the exact root parameter construction.
- Approve the explicit prohibition on `Flag.withFallbackConfig` for debug.
- Approve the resource-free AppLive factory and conditional CliApplication command-session acquisition boundary.
- Approve unchanged US1.62 product behavior, telemetry safety, and public architecture.

## Requirement Risks and TODO: Confirm Items

- RC 111 occurrence-bound and fallback behavior remains version-sensitive and requires requalification on upgrade.
- Factory construction must remain genuinely resource-free; eager Layer acquisition would violate help/parse bypass and disabled absence.
- The bounded enabled session deliberately permits telemetry loss to preserve product transparency.
- TODO: Confirm items: None.

## Traceability Map

- [T1] Claim: Exact duplicate handling uses the RC 111 occurrence-bound debug parameter.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "FR1.72: The CLI shall expose exactly one shared inherited root boolean parameter built from `Flag.boolean("debug").pipe(Flag.atMost(1))`, with no alias and no `GlobalFlag.LogLevel`, and Effect CLI shall remain the sole argv parser."
- [T2] Claim: Parser-owned Config fallback is prohibited for debug.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "The product shall not use `Flag.withFallbackConfig` for debug."
- [T3] Claim: AppLive provides only a resource-free pre-parse debug-session factory.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "`AppLive` shall be the sole assembly point for a private, resource-free debug-session factory; it is provided before parsing but shall allocate no telemetry resource."
- [T4] Claim: CliApplication.run conditionally acquires the enabled session after selection and activation.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "Only after successful command selection and debug resolution shall `CliApplication.run` use that factory in its command scope to acquire the enabled private debug session."
- [T5] Claim: Observation preserves the exact original Exit and Cause.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "Observation shall re-emit the exact original Effect `Exit` and `Cause` without catch, map, retry, recovery, reclassification, reconstruction, or re-fail, preserving success identity, failure/defect object identity, Cause reason order and annotations, interruptor IDs, and RC 111 flat composite reasons."
- [T6] Claim: Final serialized telemetry remains default deny.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "FR1.78: Final serialized traces and logs shall be default deny."
- [T7] Claim: Telemetry finalization remains one deterministic total 250 ms deadline after product completion.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "Finalization order shall be every Store and client finalizer; preservation of the original Exit; exactly-once product publication; completion of `CliApplication.run`; then one traces-plus-logs force-flush and shutdown under one deterministic total 250 ms deadline; then return of the original Exit."
- [T8] Claim: The public capability remains exactly 15 methods.
  - Source: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md :: Functional Requirements
  - Evidence quote: "FR1.66: `TaskManagerService` shall be the closed service shape containing exactly the 15 methods named in FR1.1."

## Validator Status

- Canonical validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-requirements/scripts/validate_requirements.sh specs/lean-v1/requirements.md
  - Result: Passed
- Approval-view validator:
  - Command: bash ../agent-skills-spec-pack/skills/write-approval-view/scripts/validate_approval_view.sh artifact-revised specs/lean-v1/requirements.md specs/lean-v1/approval/requirements.md
  - Result: Passed

## Downstream Impact if Approved

- CLI implementation must retain occurrence arrays until the public duplicate-option projection is complete.
- Debug environment resolution must occur manually after successful selection rather than through parser fallback Config.
- AppLive and CliApplication tests must distinguish resource-free factory provision from enabled command-session acquisition.

## Snapshot Identity

- Review type: Artifact
- Approval mode: Revised
- Canonical artifact: /Volumes/Code/personal/task-manager-next/specs/lean-v1/requirements.md
- Snapshot SHA-256: c9c1285b4a38cf2e558ddf09a96aeace7d9eed1cb9a079e8294bba9a33857e74
- Canonical updated_at: 2026-08-26T18:45:00Z
- Approval view generated_at: 2026-08-26T18:46:00Z
