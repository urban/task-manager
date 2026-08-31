# Decisions

This file records durable project decisions, including the rationale, consequences, and risks that future contributors and AI agents need to preserve.

## 1. Reconcile Tickets to explicitly accepted current behavior

Date: 2026-08-31  
Status: Accepted

**Decision:** When an implementation change has been intentionally accepted as the project's current behavior and supersedes an earlier specification, reconcile affected Tickets against that accepted behavior. Do not classify the work as incomplete solely because obsolete Ticket acceptance criteria still describe the superseded design.

**Why:** The privileged-debug implementation intentionally replaced a bespoke telemetry lifecycle and transport with scoped Effect OTLP Layers. The existing debug Tickets still required the earlier private tracer/logger, no-retry transport, shared-deadline, privacy-projection, and topology design. Judging the implementation only against those stale criteria incorrectly left implemented activation and Exit-observation work open.

**Consequences:**

- Ticket review must establish whether an apparent specification conflict is an accepted supersession or an implementation defect before changing lifecycle state.
- Tickets whose core objective is implemented under the accepted design may be completed with Result evidence that names the accepted scope.
- Obsolete acceptance criteria and scenario ownership must be revised or retired instead of being carried into new implementation work.
- The accepted supersession must remain explicit; implementation alone does not silently override an approved specification.

**Risks:**

- Treating unapproved code drift as an intentional supersession could bypass product review and erase required behavior.
- Leaving the specification and Ticket text stale can cause future agents to recreate obsolete work or report false gaps.
- TODO: Confirm which durable artifact and approval mechanism is authoritative for recording an intentional implementation supersession before Ticket reconciliation.

## 2. Complete a satisfied parent objective while cancelling obsolete subtasks

Date: 2026-08-31  
Status: Accepted

**Decision:** A parent Ticket may be completed when its accepted parent-level objective is satisfied even when some child Tickets are cancelled as obsolete. Verified child work remains completed, obsolete child work remains cancelled, and the parent Result must explain the mixed child outcomes and accepted scope.

**Why:** `Build privileged debug observability` was satisfied by the accepted simplified Effect OTLP implementation, including verified activation and exact Exit observation. Three remaining children described superseded bespoke transport, finalization, and topology work. Cancelling the parent together with those obsolete children incorrectly represented the delivered parent capability as abandoned.

**Consequences:**

- Child lifecycle states describe the disposition of each planned slice; they do not automatically determine the parent lifecycle when the plan itself changed.
- Parent completion evidence must identify the completed children, cancelled obsolete children, and the decision that made the obsolete work unnecessary.
- Cancellation remains historical evidence that a child was intentionally retired rather than implemented.
- Low-level Store repair requires explicit authorization when the operational CLI cannot correct an erroneous terminal parent state.

**Risks:**

- Completing a parent with cancelled children can overstate delivery if the cancelled work was still necessary for the accepted objective.
- Mixed terminal states can be misread unless the parent Result clearly distinguishes obsolete scope from missing implementation.
- Repeated low-level lifecycle repair can corrupt coordination history if used instead of supported CLI transitions and immediate validation.

## 3. Express cross-branch dependencies between parent tasks

Date: 2026-08-31  
Status: Accepted

**Decision:** When one task branch depends on another task branch, record the dependency between their parent task Tickets. Do not make a subtask depend directly on a subtask in an external sibling branch. The prerequisite parent represents the complete branch-level capability, and the dependency on the dependent parent blocks every subtask in that branch until the prerequisite parent is complete. Subtask-to-subtask dependencies remain appropriate for ordering work within the same parent branch.

**Why:** Sixteen open Tickets in sibling command branches depended on the cancelled debug-topology subtask even though those branches required the delivered privileged-debug capability as a whole. Coupling external branches to one implementation subtask made cancellation of that obsolete slice strand the entire backlog and made `tm next` return `no-actionable-work`. Parent-to-parent dependencies express the actual branch-level prerequisite and remain stable when internal subtasks are completed, replaced, split, or cancelled.

**Consequences:**

- Spec-to-Ticket planning must add cross-branch dependencies to dependent parent tasks, not distribute the same external edge across their subtasks.
- Every subtask in a dependent branch inherits the parent branch gate; internal ordering remains encoded with dependencies among siblings under that parent.
- Refactoring or cancelling a prerequisite branch's internal subtasks does not require rewiring external sibling branches as long as the prerequisite parent still represents the accepted capability.
- Existing external subtask dependency edges must be migrated to parent-to-parent edges when the affected backlog is reconciled.
- Dependency changes must preserve unrelated prerequisites and be followed by Store validation and an actionable-frontier check.

**Risks:**

- Parent-to-parent gating is intentionally coarse and can reduce safe parallelism when only part of a prerequisite branch is actually required.
- A parent with vague scope or completion evidence can become an unsafe catch-all prerequisite.
- Allowing exceptions for external subtask edges would reintroduce lifecycle coupling to implementation decomposition and can strand sibling branches after replanning.
