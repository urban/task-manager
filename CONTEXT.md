# Task Manager

## Coordination

**Task Manager**:
The coordination kernel that persists active Tickets, Claims, Trash, and Semantic Activity without deciding how work should be assigned, reviewed, or executed.
_Avoid_: Workflow engine, orchestrator

**Orchestrator**:
An external caller that applies workflow, assignment, review, progress, and agent-execution policy using Task Manager's coordination facts.
_Avoid_: Task Manager

**Ticket**:
A durable record of work and its current lifecycle facts within a Store. A Ticket is open, done with a Result and completion metadata, or cancelled with a reason and cancellation metadata.
_Avoid_: Work Item, job, run, deleted Ticket

**Result**:
The required completion account attached when a Ticket becomes done. It contains a human-readable summary, optional human-readable details, and optional application-owned JSON data whose schema and workflow meaning belong to the consuming or wrapping application. Completion time and Actor Identity are lifecycle facts alongside Result, not part of Result. Open and cancelled Tickets do not have a Result.
_Avoid_: Progress, Activity, completion metadata, universally interpreted workflow outcome

**Cancellation**:
The terminal lifecycle transition represented directly on a cancelled Ticket by its required reason, cancellation time, and Actor Identity. The reason is bounded, non-blank human-readable text that may span lines. Cancellation may target one Ticket only or explicitly cascade across every open descendant present at the operation's occurrence; done and already-cancelled descendants remain unchanged. Open and done Tickets have no cancellation fields.
_Avoid_: Deletion, Result, nested Cancellation record

**Dependency**:
A directed prerequisite relation in which one Ticket prevents another from becoming ready or done while the prerequisite remains open. A done or cancelled prerequisite satisfies the relation. If the prerequisite is no longer valid, callers remove the relation or cancel that work rather than force completion through an open dependency.
_Avoid_: Priority, hierarchy, advisory link

**Claim**:
A separate coordination record containing the one permitted active expiring lease by an Actor Identity on an open Ticket. Mutation activity is determined at the operation's single occurrence time: a Claim active then may be consumed even if wall-clock expiry passes before physical commit, while a Claim expired by then is inactive. While active, it fences direct mutations of that Ticket with its Actor Identity and Claim ID and categorically prevents moving that Ticket to Trash, not derived readiness or relationship effects on other Tickets; creating a child beneath it is the explicit structural exception. It also freezes the Ticket's Executor: changing the kind of executor requires release or expiry, an unclaimed update, and a fresh Claim. Completion always requires and consumes the target's exact active Claim, cancellation may also act on an unclaimed target, and deletion requires the target and every selected descendant to be unclaimed. Actor mismatch cannot be waived, and the Claim cannot be transferred or reassigned. Sequential handoff uses holder release followed by ordinary acquisition, or logical expiry when the holder cannot cooperate. It is not part of the Ticket Snapshot, although read models may present it alongside a Ticket. A Ticket may have many historical Claims recorded in Semantic Activity but never multiple active Claims. A Claim coordinates concurrent intent; it is not assignment, authorization, ownership, a participant list, or a Ticket field.
_Avoid_: Assignment, authorization, ownership, participant, Ticket state

**In Progress**:
A derived presentation state for an open Ticket with an active Claim. It is not a persisted lifecycle status.
_Avoid_: Ticket status, workflow stage

**Claim ID**:
The opaque fencing identity of one Claim incarnation, distinct from the Actor Identity holding it. Supplying one is an exact state guard: it prevents stale holders from mutating through a replaced, released, or expired Claim and is never silently ignored for a real Ticket mutation. It is not a credential.
_Avoid_: Actor ID, authentication token

**Claim Consumption**:
The completion- or cancellation-Activity fact that its target was unclaimed or that the operation atomically removed one exact fenced Claim incarnation. Completion always records a consumed Claim; the unclaimed state applies only to cancellation. Claim Consumption is part of the ordinary terminal event, not a separate Claim release. Soft deletion records none because every selected Ticket must be unclaimed.
_Avoid_: Forced release, implicit Claim cleanup, unclaimed completion

**Actor Identity**:
An opaque caller-asserted label required for every state-changing Ticket or Claim operation and recorded in its Semantic Activity. It is not a credential or authorization proof.
_Avoid_: Authenticated principal

## Persistence

**Store**:
One durable coordination domain containing authoritative active Tickets, Claims, Trash, and Semantic Activity.
_Avoid_: Repository, backlog file

**Store Identity**:
The UUIDv4 identity of one Store, generated at initialization and independent of Store Location.
_Avoid_: Store Location, repository path

**Store Location**:
The resolved canonical local directory containing one Store and shared by every participating local process and worktree in that coordination domain. It may be derived from project scope or selected explicitly.
_Avoid_: Current working directory, Store Identity

**Snapshot**:
The authoritative current state of a Ticket in active coordination, excluding its separate Claim coordination record. Soft deletion moves the Snapshot into Trash rather than destroying it or adding a deleted active-lifecycle status.
_Avoid_: Event projection, Claim state, hard-deleted record

**Trash**:
The durable collection holding self-contained entries for Ticket Snapshots removed from active coordination by soft deletion. Each entry preserves the complete final open, done, or cancelled Snapshot plus deletion time and Actor Identity. Trash preserves entries indefinitely for future recovery, permanently reserves their Ticket IDs, never purges them, and remains disjoint from active Tickets. Trashed Snapshots do not appear in ordinary active Ticket reads.
_Avoid_: Deletion Tombstone, hard deletion, purge queue

## Activity

**Semantic Activity**:
A typed durable fact describing one changed Ticket in one successful state-changing transaction. A multi-Ticket mutation emits one ordered item per changed Ticket; reads, failures, and no-ops emit none. Activity is audit and observation history, not authoritative current state.
_Avoid_: Debug log, storage diff, event-sourced Snapshot

**Activity Cursor**:
The Store-global positive integer position of one Semantic Activity item. It provides stable item ordering and supports Activity integrity validation.
_Avoid_: Ticket progress
