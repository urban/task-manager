---
name: lean-v1-user-stories
created_at: 2026-08-18T21:07:51Z
updated_at: 2026-08-27T18:45:00Z
generated_by:
  root_skill: specification-authoring
  producing_skill: user-story-authoring
  skills_used:
    - specification-authoring
    - user-story-authoring
    - write-user-stories
    - visual-diagramming
  skill_graph:
    specification-authoring:
      - user-story-authoring
    user-story-authoring:
      - write-user-stories
      - visual-diagramming
    write-user-stories: []
    visual-diagramming: []
source_artifacts:
  charter: /Volumes/Code/personal/task-manager-next/specs/lean-v1/charter.md
---

# User Stories

## High-Level User Stories

### High-Level Story: Establish and access a safe local coordination Store
- Story ID: HLS1.1
- Actor: Store operator, core package integrator, or CLI caller
- Goal: Resolve, initialize, validate, and access one canonical Store through typed public boundaries without persistence leakage.
- Value: Local callers can trust Store identity, format, health, input, and lookup behavior before coordinating work.
- Detailed story coverage: US1.1, US1.2, US1.3, US1.4, US1.5, US1.6, US1.7, US1.8, US1.9, US1.10, US1.11, US1.12, US1.13, US1.14, US1.15, US1.16, US1.17

### High-Level Story: Coordinate Ticket work atomically under exact Claims
- Story ID: HLS1.2
- Actor: External orchestrator, agent executor, or human executor
- Goal: Author, inspect, select, claim, complete, cancel, move, and relate Tickets with transaction-current fencing and all-or-nothing outcomes.
- Value: Multiple local processes can coordinate durable work without stale holders, partial cascades, duplicate mutations, or hidden workflow policy.
- Detailed story coverage: US1.18, US1.19, US1.20, US1.21, US1.22, US1.23, US1.24, US1.25, US1.26, US1.27, US1.28, US1.29, US1.30, US1.31, US1.32, US1.33, US1.34, US1.35, US1.36, US1.37, US1.38, US1.39, US1.40, US1.41, US1.42, US1.43, US1.44, US1.45, US1.46, US1.47, US1.48, US1.49, US1.50, US1.51, US1.52, US1.53, US1.54, US1.55, US1.56, US1.61

### High-Level Story: Consume deterministic process contracts safely
- Story ID: HLS1.3
- Actor: CLI caller or external orchestrator
- Goal: Use exact human or JSON process output while explicitly acknowledging defined human-work impact.
- Value: People and automation can branch on stable public outcomes without parsing storage details or bypassing coordination invariants.
- Detailed story coverage: US1.57, US1.58, US1.59, US1.62

### High-Level Story: Follow conformant Lean V1 guidance
- Story ID: HLS1.4
- Actor: Implementation executor and reviewer
- Goal: Use shipped skills and documentation that match the implemented public core and CLI.
- Value: Planning, execution, and review remain aligned with the approved product contract rather than superseded internals.
- Detailed story coverage: US1.60

## Capability Area: Public Core and Store Resolution

### Story: Use the typed Task Manager capability
- Story ID: US1.1
- Actor: Core package integrator
- Situation: An application needs to coordinate work through Lean V1 without taking ownership of persistence or domain policy.
- Action: Invoke the complete public typed Task Manager capability against one explicitly configured Store.
- Outcome: Application code can use stable domain operations and typed outcomes without depending on storage internals.
- Observation: Each operation returns its documented typed success or failure while database clients, rows, platform handles, and connection lifecycle remain absent from the public boundary.

### Story: Resolve one canonical Store
- Story ID: US1.2
- Actor: CLI caller
- Situation: A command is run from a project, linked worktree, alternate working directory, or explicit Store Location.
- Action: Select the command's working-directory basis and optional Store Location through the supported CLI or environment settings.
- Outcome: Every equivalent canonical project or explicit path coordinates through the intended single Store.
- Observation: Canonically equivalent inputs resolve the same Store Location, linked worktrees share their project Store, and explicit higher-precedence settings determine the selected location.

### Story: Reject an unsafe Store path
- Story ID: US1.3
- Actor: Store operator
- Situation: A selected working directory, Store Location, or required home-directory basis cannot be safely resolved.
- Action: Run a command using that path configuration.
- Outcome: No Task Manager operation runs against an unintended or ambiguous location.
- Observation: The command reports which path setting failed and why before constructing the Store capability.

## Capability Area: Store Initialization and Validation

### Story: Initialize a fresh Store
- Story ID: US1.4
- Actor: Store operator
- Situation: The resolved Store Location has no Task Manager Store.
- Action: Initialize the Store.
- Outcome: A fresh compatible Store with a stable Store Identity becomes available for coordination.
- Observation: The command reports a created outcome, canonical Store and database paths, and the new Store metadata.

### Story: Reuse an existing Store
- Story ID: US1.5
- Actor: Store operator
- Situation: The resolved Store Location already contains a compatible Task Manager Store.
- Action: Initialize the Store again.
- Outcome: The existing Store remains authoritative and unchanged.
- Observation: The command reports an existing outcome with the same Store Identity and current metadata rather than claiming that a new Store was created.

### Story: Protect incompatible Store data
- Story ID: US1.6
- Actor: Store operator
- Situation: The resolved database is corrupt, unrelated, partial, or uses an incompatible Task Manager format.
- Action: Attempt to initialize it as a Lean V1 Store.
- Outcome: Existing data is not replaced or partially modified.
- Observation: Initialization reports the applicable invalid-database, application, format, or structure reason with safe diagnostic evidence.

### Story: Validate a healthy Store
- Story ID: US1.7
- Actor: Store operator
- Situation: A Store exists and its health and inventory need confirmation.
- Action: Validate the Store.
- Outcome: The operator receives a read-only, transaction-consistent account of Store identity, format, lifecycle counts, Claim records, Trash, and Semantic Activity.
- Observation: Human and JSON output report successful validation and the same complete Store metadata and counts without changing the Store.

### Story: Diagnose Store integrity problems
- Story ID: US1.8
- Actor: Store operator
- Situation: A safely inspectable Store contains structural, record, hierarchy, dependency, Claim, Activity, or Trash inconsistencies.
- Action: Validate the Store.
- Outcome: The operator receives deterministic evidence sufficient to identify every safely discoverable problem from that validation pass.
- Observation: Validation reports the applicable gate failure or a canonically ordered collection of integrity issues and never mixes issues with a success report.

### Story: Distinguish an absent Store
- Story ID: US1.9
- Actor: Store operator
- Situation: A command other than initialization resolves a location where no Store database exists.
- Action: Run the command.
- Outcome: Store absence is not confused with corruption or an access failure.
- Observation: The command reports that the Store is not initialized and directs the operator to initialize it.

### Story: Distinguish Store open failure
- Story ID: US1.10
- Actor: Store operator
- Situation: A Store database exists but cannot be opened.
- Action: Run a read or mutation command.
- Outcome: The operator can diagnose access or database-open problems separately from Store absence.
- Observation: The command reports an open failure for the canonical database path with a bounded safe diagnostic.

### Story: Distinguish Store query failure
- Story ID: US1.11
- Actor: Store operator
- Situation: The Store opens but the requested read cannot complete.
- Action: Run a read command.
- Outcome: The operator can distinguish an operational read failure from absence and open failure.
- Observation: The command reports a query failure for the canonical database path and directs the operator to validate the Store.

## Capability Area: Input and Identity Boundaries

### Story: Correct a malformed invocation
- Story ID: US1.12
- Actor: CLI caller
- Situation: Command syntax is malformed or a syntactically accepted value violates its domain boundary.
- Action: Invoke the command.
- Outcome: The caller can correct the responsible command input without risking a partial product operation.
- Observation: The command reports the first applicable parse fact or identifies the rejected input source and structural issues before mutation.

### Story: Use file-backed input safely
- Story ID: US1.13
- Actor: CLI caller
- Situation: A supported command value is supplied through a file.
- Action: Select the file through the applicable input option.
- Outcome: Inline and file-backed input enforce the same product boundary while filesystem problems remain actionable.
- Observation: A valid regular UTF-8 file produces the same canonical value as inline input, while missing, non-file, unreadable, or invalid-text input fails before mutation.

### Story: Require mutation attribution
- Story ID: US1.14
- Actor: CLI caller
- Situation: A state-changing Ticket or Claim command has no Actor Identity from either supported source.
- Action: Invoke the command.
- Outcome: No unattributed mutation or Store read is attempted.
- Observation: The command reports that Actor Identity is required, while read-only commands, Store initialization, Store validation, and deletion preview remain available without it.

### Story: Reject a malformed exact identity
- Story ID: US1.15
- Actor: CLI caller
- Situation: A supplied Ticket ID or Claim ID does not have its canonical complete form.
- Action: Invoke an operation with that identity.
- Outcome: Malformed input is not mistaken for an unknown domain record or matched by prefix.
- Observation: Boundary validation rejects the identity before Ticket or Claim lookup.

### Story: Report an unknown Ticket
- Story ID: US1.16
- Actor: CLI caller
- Situation: A canonical Ticket ID is absent from both active coordination and permanent Trash.
- Action: Invoke an operation for that Ticket ID.
- Outcome: The caller knows that no active or trashed record reserves the identity.
- Observation: The operation reports the Ticket as not found without returning unrelated Ticket data.

### Story: Report a Ticket in Trash
- Story ID: US1.17
- Actor: CLI caller
- Situation: A canonical Ticket ID is absent from active coordination because permanent Trash reserves it.
- Action: Invoke an ordinary active-Ticket operation for that ID.
- Outcome: The caller can distinguish prior soft deletion from an unknown Ticket.
- Observation: The operation reports that the Ticket is in Trash with deletion time and Actor Identity but does not expose the preserved Snapshot through the error.

## Capability Area: Ticket Creation and Update

### Story: Create durable work
- Story ID: US1.18
- Actor: External orchestrator
- Situation: New work must be recorded with its level, Executor, subject, Description, optional Context, and prerequisites.
- Action: Create a Ticket.
- Outcome: The work is durably represented as a canonical open Ticket with a permanent generated identity.
- Observation: The command returns the complete committed Ticket and confirms its full Subject and ID.

### Story: Create hierarchical work
- Story ID: US1.19
- Actor: External orchestrator
- Situation: New work belongs beneath an open parent at a valid next hierarchy level.
- Action: Create the child beneath that parent using the applicable parent Claim fence.
- Outcome: The hierarchy gains the intended child without bypassing active coordination on the parent's decomposition.
- Observation: The committed child identifies its parent and later inspection places it in the canonical Ticket tree.

### Story: Update open work atomically
- Story ID: US1.20
- Actor: External orchestrator
- Situation: An open Ticket's Subject, Description, Context, or Executor needs correction.
- Action: Submit one or more edits using the transaction-current target Claim fence and applicable Executor scope.
- Outcome: All effective edits are applied together or none are applied.
- Observation: A successful update returns the complete current open Ticket with every accepted edit and one updated timestamp.

### Story: Recognize an unchanged update
- Story ID: US1.21
- Actor: External orchestrator
- Situation: Every requested edit already equals the current canonical value on an open Ticket.
- Action: Submit the update.
- Outcome: The caller can safely retry or normalize updates without manufacturing a mutation.
- Observation: The operation reports an unchanged outcome, preserves timestamps, and does not require a current Claim fence merely for the proven no-op.

### Story: Confirm an intentionally empty Description
- Story ID: US1.22
- Actor: CLI caller
- Situation: Ticket creation or update intentionally supplies a Description that normalizes to empty.
- Action: Provide the dedicated empty-Description acknowledgment.
- Outcome: Intentional stubs are possible without letting accidental blank input pass silently.
- Observation: The command rejects the empty Description before Store access when acknowledgment is absent and accepts it when present, subject to every ordinary invariant.

## Capability Area: Ticket Inspection and Selection

### Story: Inspect one active Ticket
- Story ID: US1.23
- Actor: CLI caller
- Situation: The caller knows an active Ticket ID and needs its current lifecycle and direct relationship facts.
- Action: Inspect the Ticket.
- Outcome: The caller receives one transaction-consistent detail view without depending on Semantic Activity or storage internals.
- Observation: The result shows the complete lifecycle-appropriate Ticket, effective active Claim when present, parent, direct prerequisites, and direct dependents.

### Story: Browse the Ticket hierarchy
- Story ID: US1.24
- Actor: External orchestrator
- Situation: The orchestrator needs an overview of active coordination work within optional lifecycle, Executor, or subtree scope.
- Action: List Tickets using the desired filters.
- Outcome: Matching work remains understandable in its structural context.
- Observation: The result is a deterministic tree that retains needed ancestors and visibly distinguishes lifecycle, effective Claim, and progressed-descendant states.

### Story: Select the next actionable Ticket
- Story ID: US1.25
- Actor: External orchestrator
- Situation: The orchestrator needs the next eligible leaf within an optional subtree, Executor scope, and Claim-inclusion policy.
- Action: Select next work.
- Outcome: The deterministic highest-priority actionable Ticket is identified according to hierarchy and prerequisite readiness.
- Observation: The result contains the complete selected open Ticket and an effective active Claim only when claimed Tickets were explicitly included.

### Story: Observe that no work is actionable
- Story ID: US1.26
- Actor: External orchestrator
- Situation: No Ticket satisfies the selected actionability scope.
- Action: Select next work.
- Outcome: The absence of actionable work is a successful, explicit observation rather than an error or ambiguous missing value.
- Observation: Human output states that no Tickets are actionable and JSON returns the no-actionable-work reason with a successful process result.

### Story: Treat selection as non-reserving
- Story ID: US1.27
- Actor: External orchestrator
- Situation: A Ticket has been returned by next-work selection but another process may act before the orchestrator does.
- Action: Attempt to acquire the selected Ticket's Claim.
- Outcome: Successful Claim acquisition, not the earlier read, determines who coordinates the work.
- Observation: Selection changes no Ticket or Claim, and a lost acquisition race returns the transaction-current Claim conflict.

## Capability Area: Claim Coordination and Exact Fencing

### Story: Acquire the one active Claim
- Story ID: US1.28
- Actor: Agent executor or Human executor
- Situation: An open Ticket has no effective active Claim and the executor wants to coordinate work on it.
- Action: Acquire a Claim with an explicit Actor Identity and applicable human-work acknowledgment.
- Outcome: The executor receives the single active expiring Claim for that Ticket.
- Observation: The result keeps the unchanged Ticket and complete Claim separate and reports the holder, Claim ID, acquisition time, and expiry.

### Story: Observe an active Claim conflict
- Story ID: US1.29
- Actor: Agent executor or Human executor
- Situation: Any effective active Claim already exists on the open Ticket, including one held by the same Actor Identity.
- Action: Attempt to acquire another Claim.
- Outcome: The Ticket never gains two active holders or an implicit takeover.
- Observation: Acquisition fails with the complete current active Claim and leaves Ticket, Claim, and Semantic Activity unchanged.

### Story: Renew the exact Claim incarnation
- Story ID: US1.30
- Actor: Agent executor or Human executor
- Situation: The executor holds the exact effective active Claim and needs another lease window.
- Action: Renew it using the current Claim ID and matching Actor Identity.
- Outcome: A fresh Claim incarnation replaces the prior one without changing the Ticket Snapshot.
- Observation: The result reports a new Claim ID and lease while the prior Claim ID no longer fences mutations.

### Story: Release a Claim cooperatively
- Story ID: US1.31
- Actor: Agent executor or Human executor
- Situation: The exact current holder no longer needs the Claim or wants another executor to compete for it.
- Action: Release the Claim using its Claim ID and matching Actor Identity.
- Outcome: The Ticket becomes unclaimed without changing its Snapshot.
- Observation: The operation reports released when it removes the Claim and already inactive when no effective active Claim remains.

### Story: Acquire after logical expiry
- Story ID: US1.32
- Actor: Agent executor or Human executor
- Situation: A prior Claim's lease has logically expired even if its stale representation remains persisted.
- Action: Acquire a Claim normally.
- Outcome: Work can resume without takeover, transfer, or background cleanup.
- Observation: The expired Claim is treated as inactive and successful acquisition returns a fresh Claim incarnation.

### Story: Reject a stale Claim ID
- Story ID: US1.33
- Actor: Agent executor or Human executor
- Situation: Renewal or replacement has superseded the Claim ID held by a stale process, even when Actor Identity is unchanged.
- Action: Attempt an exact-fenced mutation with the old Claim ID.
- Outcome: Actor equality alone cannot let stale work mutate coordinated state.
- Observation: The operation reports a Claim ID mismatch and does not reveal or silently adopt the current Claim ID.

### Story: Reject an inactive supplied Claim
- Story ID: US1.34
- Actor: Agent executor or Human executor
- Situation: A supplied Claim ID refers to a Claim that was released or is logically expired and no active Claim now exists.
- Action: Attempt an operation that requires that exact Claim.
- Outcome: The request is not silently degraded into an unclaimed mutation.
- Observation: The operation reports that no active Claim matches the supplied ID and leaves state unchanged.

### Story: Reject the wrong Actor
- Story ID: US1.35
- Actor: Agent executor or Human executor
- Situation: The supplied Claim ID exactly matches the active Claim but the command Actor Identity does not match its holder.
- Action: Attempt the fenced operation.
- Outcome: Knowing a Claim ID cannot waive holder identity or act as authorization.
- Observation: The operation reports the Actor mismatch with the exactly matched active Claim and performs no mutation.

### Story: Hand off without Claim transfer
- Story ID: US1.36
- Actor: External orchestrator
- Situation: Work should pass from one executor to another.
- Action: Coordinate holder release followed by ordinary acquisition, or wait for logical expiry when release is unavailable.
- Outcome: Handoff preserves the single-holder race boundary without unilateral reassignment.
- Observation: No transfer operation exists, another claimant may legitimately win between release and acquisition, and every acquisition receives its own Claim ID.

## Capability Area: Completion and Result Evidence

### Story: Complete eligible claimed work
- Story ID: US1.37
- Actor: Agent executor or Human executor
- Situation: An open Ticket has the executor's exact active Claim, no open descendants, and no open direct prerequisites.
- Action: Complete it with a canonical Result.
- Outcome: The Ticket becomes done with durable completion evidence and attribution.
- Observation: The returned done Ticket contains the Result and completion metadata, the exact Claim is consumed, and no active Claim remains.

### Story: Understand open descendant blockers
- Story ID: US1.38
- Actor: Agent executor or Human executor
- Situation: The executor attempts to complete a Ticket while one or more descendants remain open.
- Action: Submit completion with a valid exact Claim fence.
- Outcome: Parent work cannot be marked done while decomposed child work remains open.
- Observation: Completion reports every open descendant and leaves the Ticket, Claim, timestamps, and Semantic Activity unchanged.

### Story: Understand open prerequisite blockers
- Story ID: US1.39
- Actor: Agent executor or Human executor
- Situation: The executor attempts to complete a Ticket while one or more direct prerequisites remain open.
- Action: Submit completion with a valid exact Claim fence after descendant eligibility is satisfied.
- Outcome: Work cannot be marked done while an active prerequisite still blocks it.
- Observation: Completion reports every open direct prerequisite and leaves the Ticket, Claim, timestamps, and Semantic Activity unchanged.

### Story: Acknowledge direct human completion
- Story ID: US1.40
- Actor: CLI caller
- Situation: Completion directly targets an observed open human-executor Ticket.
- Action: Supply the dedicated human-work acknowledgment before completing with the exact active Claim.
- Outcome: Human work is not completed accidentally, while acknowledgment remains distinct from authorization or force.
- Observation: Missing acknowledgment is reported before mutation, and supplying it does not bypass Claim, lifecycle, hierarchy, prerequisite, Result, or Store invariants.

## Capability Area: Cancellation

### Story: Cancel one open Ticket
- Story ID: US1.41
- Actor: External orchestrator
- Situation: One open Ticket should be intentionally abandoned and no open descendant is selected for change.
- Action: Cancel the target with a reason and its transaction-current unclaimed or exact-Claim fence.
- Outcome: The Ticket becomes terminal with durable cancellation reason, time, and Actor Identity.
- Observation: The returned cancelled Ticket preserves its ordinary Snapshot facts, contains cancellation metadata, and consumes only a permitted target Claim.

### Story: Cancel an open subtree
- Story ID: US1.42
- Actor: External orchestrator
- Situation: A parent and all transaction-current open descendant work should be abandoned together.
- Action: Cancel with explicit cascade and applicable human-work scope.
- Outcome: The target and every eligible open descendant become cancelled atomically while done and already-cancelled descendants remain unchanged.
- Observation: The result identifies exactly the changed Tickets with one shared reason, occurrence time, and Actor Identity.

### Story: Resolve claimed cancellation descendants
- Story ID: US1.43
- Actor: External orchestrator
- Situation: A cancellation cascade includes descendants with effective active Claims.
- Action: Attempt the cascade.
- Outcome: No holder's coordinated descendant work is cancelled implicitly, even when the command Actor matches those holders.
- Observation: The operation reports every claimed descendant with complete Claim recovery details and commits no partial cancellation.

## Capability Area: Permanent Trash

### Story: Preview a Trash move safely
- Story ID: US1.44
- Actor: CLI caller
- Situation: A Ticket may have descendants and permanent removal from active coordination has not been confirmed.
- Action: Request deletion without confirmation.
- Outcome: The caller can inspect the observed impact without Actor Identity or mutation authority.
- Observation: A read-only preview lists the target and observed descendants, reports the required confirmation flags, and states that it reserves or fixes nothing.

### Story: Revalidate confirmed Trash scope
- Story ID: US1.45
- Actor: External orchestrator
- Situation: Store state may have changed since a deletion preview or other pre-read.
- Action: Confirm the Trash move with the intended target-only or cascade scope.
- Outcome: Permanent mutation uses transaction-current Tickets and blockers rather than trusting stale preview state.
- Observation: A newly present descendant, Claim, human-executor Ticket, parent fence, or external dependent changes the confirmed result or rejection according to current state.

### Story: Move one accidental Ticket to Trash
- Story ID: US1.46
- Actor: External orchestrator
- Situation: An unclaimed transaction-current leaf should permanently leave active coordination.
- Action: Confirm its move to Trash with Actor Identity and any required surviving-parent fence and human-work scope.
- Outcome: The complete final Ticket Snapshot and deletion attribution are preserved while the Ticket leaves active reads.
- Observation: The result returns the complete Trash entry, ordinary active lookup reports the Ticket in Trash, and its ID remains permanently reserved.

### Story: Move a subtree to Trash
- Story ID: US1.47
- Actor: External orchestrator
- Situation: An unclaimed Ticket and all transaction-current descendants across every lifecycle state should leave active coordination together.
- Action: Confirm deletion with explicit cascade and applicable parent and human-work scope.
- Outcome: The selected subtree moves atomically to permanent Trash without rewriting its hierarchy, lifecycle history, Results, Cancellations, or internal prerequisites.
- Observation: The result identifies the target and every moved descendant and returns each complete Trash entry.

### Story: Resolve Claim blockers before Trash
- Story ID: US1.48
- Actor: External orchestrator
- Situation: The explicit target or any selected descendant has an effective active Claim.
- Action: Attempt the confirmed Trash move.
- Outcome: Permanent removal cannot consume or bypass active coordinated work.
- Observation: The operation reports the active target or every claimed descendant and moves no Ticket until those Claims are released or expire.

### Story: Preserve external dependency integrity
- Story ID: US1.49
- Actor: External orchestrator
- Situation: An active Ticket outside the selected Trash set depends on one or more selected Tickets.
- Action: Attempt the confirmed Trash move.
- Outcome: Deletion never silently leaves an active external dependent pointing into Trash.
- Observation: The operation reports every external dependent and the selected prerequisite IDs it references, and no partial Trash state is created.

## Capability Area: Dependency Management

### Story: Add a direct prerequisite
- Story ID: US1.50
- Actor: External orchestrator
- Situation: An open Ticket must wait for another active Ticket.
- Action: Add the prerequisite using the target Ticket's transaction-current Claim fence.
- Outcome: Readiness and eventual completion reflect the explicit directed Dependency without fencing the prerequisite merely as an observer.
- Observation: The operation returns the updated target and prerequisite summary, or rejects a self-dependency or cycle without changing state.

### Story: Remove a direct prerequisite
- Story ID: US1.51
- Actor: External orchestrator
- Situation: An open Ticket should no longer wait for an existing prerequisite.
- Action: Remove the prerequisite using the target Claim fence and applicable acknowledgment for an open human-executor gate.
- Outcome: Readiness can be recalculated without silently removing protected human work.
- Observation: The operation returns the updated target and prerequisite summary while preserving every unrelated relationship and Claim.

### Story: Recognize unchanged Dependency requests
- Story ID: US1.52
- Actor: External orchestrator
- Situation: The requested prerequisite already exists or the requested removal is already absent.
- Action: Add or remove that exact Dependency again.
- Outcome: Relationship commands are safely repeatable after active endpoint and target-lifecycle checks.
- Observation: The operation reports already blocked or already unblocked, preserves timestamps, emits no Semantic Activity, and does not require a fresh Claim fence for the proven no-op.

## Capability Area: Atomicity and Race Reconciliation

### Story: Retry a known pre-commit failure safely
- Story ID: US1.53
- Actor: External orchestrator
- Situation: A Store mutation fails in a way that proves no commit occurred.
- Action: Inspect the typed failure and retry from the unchanged state when appropriate.
- Outcome: The caller can rely on complete rollback rather than repairing partial product state.
- Observation: Tickets, Claims, Trash, timestamps, Semantic Activity, and Store high-water remain unchanged after reopening the Store.

### Story: Reconcile an unknown transaction outcome
- Story ID: US1.54
- Actor: External orchestrator
- Situation: Stock Effect SQL transaction finalization failed and the durable transaction outcome cannot be established through its public abstraction.
- Action: Reread and reconcile transaction-current state before deciding whether to retry.
- Outcome: The caller avoids duplicating a mutation that may already have committed.
- Observation: `StoreTransactionOutcomeUnknown` explicitly distinguishes the unknown transaction outcome from US1.53's proven rollback and never claims that blind retry is safe.

### Story: Lose a mutation race explicitly
- Story ID: US1.55
- Actor: External orchestrator
- Situation: Selection, preview, a human-gate pre-read, or another observation becomes stale before a mutation reaches its writer position.
- Action: Submit the mutation without an automatic retry.
- Outcome: Transaction-current state, not the earlier read, determines the product result.
- Observation: The operation commits according to current state or returns the applicable typed race rejection, after which the caller may reread and choose a deliberate next action.

### Story: Observe all-or-nothing multi-Ticket change
- Story ID: US1.56
- Actor: External orchestrator
- Situation: A cancellation or Trash cascade affects several Tickets and their coordination facts.
- Action: Submit the cascade while another process or invariant may block part of it.
- Outcome: Callers never observe a partially changed subtree.
- Observation: The transaction commits every selected Snapshot, Claim effect, Trash entry, timestamp, and Semantic Activity item together or commits none of them.

## Capability Area: Human and JSON CLI Processes

### Story: Use deterministic human output
- Story ID: US1.57
- Actor: CLI caller
- Situation: A person or shell invokes a supported command without JSON mode.
- Action: Run the command and consume its process result.
- Outcome: Success and expected failure are readable and separable without inspecting storage or debug logs.
- Observation: Success appears only on stdout, expected failure only on stderr beginning with `Error:`, complete Subjects are preserved, process status reflects success or failure, and Task Manager output has deterministic framing.

### Story: Use machine-readable JSON
- Story ID: US1.58
- Actor: External orchestrator
- Situation: Automation needs stable structured command output.
- Action: Run a supported command in JSON mode.
- Outcome: The orchestrator can branch on product outcomes and typed failures without parsing human prose.
- Observation: One compact success or failure object is written to stdout, stderr remains empty, and expected failures preserve typed fields without a generic prose message.

## Capability Area: Human-Work Acknowledgments

### Story: Acknowledge direct human-work impact
- Story ID: US1.59
- Actor: CLI caller
- Situation: A transaction-current operation would move work from human to agent Executor, acquire a human-executor Ticket, complete one directly, cancel or move human-executor Tickets to Trash, or remove an open human-executor prerequisite.
- Action: Supply the operation's dedicated human-work acknowledgment.
- Outcome: Human work is not changed accidentally and acknowledgment remains a narrow expression of intent rather than authorization or force.
- Observation: Omitted acknowledgment produces a visible rejection for the affected operation, while supplied acknowledgment never bypasses input, Store, lifecycle, hierarchy, Dependency, Claim, Result, cancellation, or Trash invariants.

## Capability Area: Skill and Documentation Conformance

### Story: Follow accurate Lean V1 guidance
- Story ID: US1.60
- Actor: Implementation executor and reviewer
- Situation: An executor or reviewer uses the shipped Task Manager skills and end-user documentation to plan, perform, or verify Lean V1 work.
- Action: Follow the documented public core, CLI, Store, Claim, lifecycle, Dependency, Result, and Trash guidance.
- Outcome: Work can proceed from public contracts without relying on superseded architecture or implementation-private storage details.
- Observation: Skill examples and generated documentation match the implemented command help and public JSON behavior and do not redefine Lean V1 invariants.

## Capability Area: Atomicity Finalization Reconciliation

### Story: Reconcile a committed mutation whose client finalization failed
- Story ID: US1.61
- Actor: External orchestrator
- Situation: Stock `withTransaction` has returned success, proving commit, but the isolated outer mutation-client close then fails.
- Action: Treat the committed Store state as authoritative, reread it, and reconcile without automatically replaying the mutation.
- Outcome: The caller avoids duplicating an already committed mutation while distinguishing this known-commit condition from unknown commit or rollback finalization.
- Observation: `StoreMutationCommittedButFinalizationFailed` reports the known-commit outer-finalizer failure; a reopen shows the exactly-once committed state, and no automatic retry occurs.

## Capability Area: Privileged Debug Observability

### Story: Diagnose one selected CLI command without changing it
- Story ID: US1.62
- Actor: CLI caller or Store operator
- Situation: A selected Task Manager command needs privileged local diagnostic observability while its product behavior must remain unchanged.
- Action: Enable the inherited root `--debug` boolean, or use `TM_DEBUG` only when no explicit CLI boolean was supplied, and allow the CLI-private observer to export privacy-filtered traces and logs to the fixed local OTLP endpoints.
- Outcome: The caller can inspect a sparse command-to-public-operation-to-Store topology and closed outcome classifications without exposing product or persistence payloads, introducing network activity during Store use, or changing the public core architecture.
- Observation: Debug on and off produce byte-identical product output and the same status and original Effect `Exit`/`Cause`; enabled telemetry is bounded, local-only, best-effort, flushed only after product publication and all Store/client finalizers, while disabled debug constructs no telemetry or network resource.
