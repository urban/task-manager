# Lean V1 Ticket Planning

Break down the approved Lean V1 specification into Task Manager Tickets for implementation in the current Lean V1 worktree.

Use the registered Task Manager planning skill and the intended coordination Store. Plan Tickets only; do not implement product code while performing this workflow.

## Project-specific precedence

This document is the Lean V1 project overlay for the registered `/Volumes/Code/personal/task-manager/skills/to-tickets/SKILL.md` workflow. It supersedes that generic skill only where this document gives a more specific rule for hierarchy, tracer-bullet granularity, Description/Context ownership, public seams, scenario ownership, dependency placement, or Lean V1 control-plane safety. The registered skill remains authoritative for stable `tm` mechanics, subject constraints, explicit Executors, human gates, draft approval, mutation safety, and failure handling. `AGENTS.md` and the normative specification pack outrank both.

The stable control plane coordinates implementation but does not define Lean V1 product behavior. In particular, do not infer product semantics from the stable CLI. A cancelled prerequisite does not unblock a dependent in the stable coordination Store; when an approved implementation dependency becomes obsolete, remove that edge explicitly with `tm unblock <blocked-id> --by <dependency-id>` rather than cancelling the prerequisite and assuming readiness.

## Authority and boundaries

- Treat `specs/lean-v1/charter.md`, `specs/lean-v1/user-stories.md`, `specs/lean-v1/requirements.md`, and `specs/lean-v1/technical-design.md` as the normative specification pack.
- Treat `specs/lean-v1/approval/verification-traceability.md` as the stable scenario ledger for mandatory evidence planning.
- Treat `specs/lean-v1/approval/approval-record.md` as the durable stakeholder sign-off for the exact approved pack snapshot. Approval of a proposed Ticket hierarchy is a separate gate and cannot substitute for pack approval.
- Treat `CONTEXT.md` as the canonical domain vocabulary.
- Follow `AGENTS.md` for repository, branch, package-manager, verification, and coordination boundaries.
- Treat product source, generated help, existing tests, retired top-level specs/checklists, and in-repository skills as migration or implementation evidence only. Never use `skills/task-manager/` or `skills/to-tickets/` from this worktree as active operational instructions before explicit cutover.
- Use the stable coordination CLI at `/Volumes/Code/personal/task-manager/packages/cli/src/bin.ts`, never the Lean V1 CLI under development.
- Use `/Volumes/Code/personal/task-manager-next/.tasks` as the coordination Store and pass that absolute path through `--storage-path` on every `tm` invocation, including invocations from the `next` worktree.
- Never run `bun link`, replace the globally linked stable CLI, install rebuilt skills over the registered stable skills, or run the worktree CLI against the coordination Store. Rebuilt-skill evaluation uses fresh isolated sessions and disposable Stores; global CLI and skill installation are separate human-approved cutover actions.
- Stop if pack approval, the stable CLI, Store, normative specification pack, verification traceability ledger, context document, or repository instructions cannot be verified.

Use these exact control-plane constants throughout one planning or creation session:

```bash
TM_STABLE_CLI=/Volumes/Code/personal/task-manager/packages/cli/src/bin.ts
TM_COORDINATION_STORE=/Volumes/Code/personal/task-manager-next/.tasks
test "$(realpath "$(command -v tm)")" = "$TM_STABLE_CLI"
```

## Hierarchy

1. Create one real root Epic for the complete Lean V1 initiative unless the authoritative specification genuinely defines independent initiatives or phases. Never create a fake umbrella Epic.
2. Create one Task for each of the 15 Lean V1 public CLI commands defined by FR1.80: `init`, `validate`, `create`, `update`, `show`, `list`, `next`, `claim`, `renew`, `release`, `complete`, `cancel`, `delete`, `block`, and `unblock`. Do not derive this list from the stable control-plane CLI, whose command surface is different. A command Task describes the complete command contract and becomes a bounded command-level integration and acceptance assignment after its behavioral Subtasks are done.
3. Add cross-cutting Tasks only for obligations that do not belong to one command, such as global process contracts, final qualification, generated documentation, or skill migration. Each is likewise a bounded integration or closeout assignment after its children are done.
4. Put implementation work in multiple behavioral Subtasks under each Task.
5. Use only `epic -> task -> subtask`. Parent Tasks must define their final command/cross-cutting acceptance evidence and completion Result. The root Epic must define final whole-initiative qualification and closeout. This prevents a parent returned by `tm next` after its children close from becoming an undefined administrative assignment.
6. Assign every parent and child an explicit Executor. Use `agent` for implementation and mechanically verifiable integration/closeout; use `human` only for a real human decision, review, manual action, or cutover gate.

## Fresh-session contract

Each agent-executor Subtask is owned by exactly one fresh LLM session. Any agent-executor Task or Epic that can become actionable must also be a self-contained, bounded integration or closeout assignment suitable for one fresh session.

Every Subtask must:

- deliver one narrow, independently useful behavioral outcome;
- fit in one fresh context window;
- leave the branch green and independently verifiable;
- be understandable from its own Description and Context plus its cited authoritative source sections;
- state its in-scope and out-of-scope behavior explicitly;
- name the public seam used to prove the behavior;
- identify prerequisite Tickets and the exact landed behavior assumed from them;
- exclude sibling work, speculative cleanup, and unrelated command behavior.

Do not require the executor to read the parent Epic, parent Task, or sibling Tickets to discover its assignment. Parent Tickets may provide orientation, but the selected Subtask must be a self-contained execution packet.

If a proposed Subtask contains multiple independently meaningful behaviors, race matrices, failure families, or acceptance boundaries, split it before creating Tickets.

## Description and Context ownership

Description defines **what the Ticket must accomplish**. Context defines **how a fresh executor should perform that work well**.

Do not duplicate the same material across both fields. Do not hide required scope or acceptance criteria only in Context.

### Epic and Task fields

For an Epic or Task:

- Description states the complete initiative or public capability, its observable final acceptance criteria, exact source traceability, and the bounded integration or closeout outcome performed after its children finish.
- Acceptance criteria name the final evidence to reconcile across children and the completion Result expected from the parent executor; they do not ask the executor to reimplement child scope.
- Context contains only shared architecture, command contracts, constraints, terminology, integration dependencies, the child Subtask map, and the exact closeout procedure needed to coordinate and finish the parent.

### Subtask Description

Use this shape:

```markdown
## Outcome

One sentence stating the independently useful behavior to implement.

## In scope

- Specific behavior included in this Ticket.
- Specific boundary, invariant, or failure behavior included in this Ticket.
- Specific core, persistence, or CLI behavior included when applicable.

## Out of scope

- Related behavior owned by another Ticket.
- Cleanup or refactoring not required for this outcome.
- Later concurrency, compatibility, or adapter behavior.

## Acceptance criteria

- [ ] Observable behavior through the named public seam.
- [ ] Required boundary or failure behavior.
- [ ] The branch remains green after focused and full verification.

## Source

- Exact canonical `specs/lean-v1/` artifact, section, and requirement identifier.
- `specs/lean-v1/approval/verification-traceability.md`, every exact stable scenario ID owned or contributed to by this Ticket.
```

Keep the Outcome to one sentence. Prefer two to six precise bullets in each remaining section. Every acceptance criterion must belong to this Subtask alone.

### Subtask Context

Use this shape:

```markdown
## Execution approach

State the Ticket-specific development approach. Require repeated red -> green cycles through the public seam: add one failing behavioral test, confirm the expected failure, implement only enough to pass, and repeat.

## Public seam

- Core behavior: name the exported core operation, service Layer, and real temporary file-backed Store.
- CLI behavior: name the real CLI process entrypoint and the public core capability it must use.

## Prerequisites

- Ticket <id or draft subject> provides <specific landed behavior>.
- None, when the Subtask has no prerequisite.

## Relevant project context

- `path/to/file` — why this file or nearby pattern matters.
- Ticket-specific architecture, domain, transaction, lifecycle, or failure-precedence constraints.
- Deterministic clock, barrier, or fault control needed to prove observable behavior, when applicable.

## Verification

- Focused: `<focused command>`
- Full: `bun run check`

## Result evidence

Record the implemented behaviors, tests added, exact verification commands and outcomes, scenario IDs evidenced, and any authoritative conflict discovered. Never replace scenario-level evidence with only `bun run check`.
```

Context must contain only information that changes how this Subtask is executed. Do not include narrative history, full-spec summaries, complete sibling behavior, generic advice, or unrelated files and invariants.

## Behavioral tracer bullets

Decompose each command into small vertical slices rather than internal layers.

For privileged debug observability, create exactly one global cross-cutting debug Task as the ownership and closeout boundary. Do not create a horizontal telemetry-framework phase, sibling tracer/logger/transport/privacy Tasks, or repeat global flag implementation under command Tasks. Split its implementation into bounded behavioral Subtasks rather than one oversized debug assignment:

1. activation precedence, duplicate handling, early-path bypass, and disabled-resource absence;
2. resource-free AppLive factory ownership and exact transparent Exit/Cause observation;
3. fixed numeric-loopback trace/log transport, queue bounds, and final-byte default-deny projection;
4. product-publication ordering, one total 250 ms finalization deadline, and refusal/status/redirect/hang loss behavior;
5. global architecture, topology, cardinality, logging, privacy, and no-transaction-network evidence reconciliation.

Under the `init` command Task, add an initial end-to-end `tm init --debug` Subtask that lands one usable success path through the sole Effect CLI parser, public initialization access, Store acquisition/publication, product publication, and bounded telemetry finalization. Keep its acceptance to success-path topology plus debug-off/on byte, status, and original Exit equality. Add separate bounded `init` privacy-canary and transport/outage matrix Subtasks when those cases are needed to establish the reusable path. Record true prerequisite edges from those Subtasks to the relevant global-debug Subtasks.

Then add vertical command tracer Subtasks to the applicable command Tasks. Each lands one usable command path through parsing, one genuine public access function, persistence when applicable, product publication, bounded telemetry finalization, and the command-specific equality/classification evidence assigned to it. These Subtasks depend on the landed global behavior and own only command-specific spans and classifications; they do not reimplement activation, transport, wrappers, privacy projection, or finalization.

- A core Subtask cuts through the exported public core API, domain validation, transaction and persistence behavior, and public result or typed error required for its outcome.
- A CLI Subtask exercises the real command entrypoint and uses the public core capability. It owns only the relevant parsing, environment fallback, files, confirmation, rendering, streams, and exit status behavior.
- Separate CLI input and parsing from rendering and process behavior when either slice would exceed one fresh context.
- Separate substantial race matrices, expiry behavior, rollback proofs, and reopen proofs from ordinary success and failure behavior.
- Stage cross-feature behavior to avoid dependency cycles. Land a usable base behavior first, then add the behavior that depends on another command.
- Do not create horizontal “add schemas,” “add repositories,” “implement core,” or “implement CLI” Subtasks.

Use expand-migrate-contract only when a wide mechanical refactor cannot land as green vertical slices:

1. Expand with a compatible new form.
2. Migrate call sites in independently green batches.
3. Contract only after every migration batch lands.

## Test-first execution contract

Every implementation Subtask must require:

1. Testing through an exported core access function with its service Layer and real temporary file-backed Store, or through the real CLI process for adapter behavior.
2. Repeated red -> green cycles, one specified behavior at a time.
3. No bulk-written speculative tests, private-helper tests, or mocked internal collaborators when the public seam can prove the behavior.
4. Focused verification during development and `bun run check` before completion.
5. Concrete test and command evidence in the Ticket Result.

## Dependencies

- Record every true blocker as a first-class Ticket edge with `--blocked-by` or `tm block`.
- Put edges at the most specific Subtask level possible.
- Add an edge only when the blocked Subtask cannot start or finish correctly without the prerequisite's landed behavior.
- Prefer a sequential chain when fresh agents must evolve the same code seam.
- Permit parallel Subtasks only when they can land green independently without conflicting ownership.
- Ensure the graph has at least one actionable first Subtask and no cycles.
- In Context, explain only the behavior assumed from each prerequisite; do not rely on dependency prose instead of the CLI edge.
- Stable control-plane dependencies are satisfied only by `done` prerequisites. If an approved edge becomes obsolete, remove it explicitly; cancellation alone does not make the dependent actionable.

## Verification scenario ownership

Before requesting hierarchy approval, present an exhaustive coverage matrix derived from `specs/lean-v1/approval/verification-traceability.md`. Keep it in the proposed plan rather than creating a second backlog. Use these columns:

| Scenario ID | Obligation | Required evidence boundary | Accountable Ticket | Contributing Tickets | Final evidence or manifest owner |
| --- | --- | --- | --- | --- | --- |

The matrix must satisfy all of these rules:

- Every ledger row appears once with its unchanged stable scenario ID and required evidence family.
- Every scenario has exactly one accountable Ticket; zero or multiple accountable owners are invalid.
- A scenario may name multiple contributing Tickets only when its evidence is intentionally split. Every contributor cites the same stable scenario ID in its Description and Result evidence.
- No Ticket may downgrade a required public-core, real Store, real-process, multi-process, reopen, debug, skill-session, architecture, or qualification boundary to a private helper, source inspection, generated help, or aggregate gate.
- The final cross-suite evidence Task owns `EVIDENCE-NFR2-13` and reconciles every named scenario to exact tests or qualification artifacts.
- After creation, the Ticket fields are the durable ownership record; do not maintain a separate Markdown backlog.

## Definition of ready

Do not propose or create a Subtask unless all answers are yes:

- Does it have exactly one clear behavioral outcome?
- Can one fresh LLM session complete it?
- Are in-scope and out-of-scope behaviors explicit in Description?
- Does every acceptance criterion belong only to this Subtask?
- Can it land green without unfinished sibling work?
- Is the public test seam named?
- Are prerequisite behaviors explicit and represented by Ticket edges?
- Does Context contain the development method, relevant constraints, files, and exact verification commands?
- Can the executor understand the assignment without reading parent or sibling Tickets?
- Is every cited verification scenario assigned to exactly one accountable Ticket without weakening its evidence boundary?
- Has unrelated history, generic guidance, speculative cleanup, and future behavior been removed?

## Planning workflow

### 0. Verify pack approval

Before drafting anything:

- verify `specs/lean-v1/approval/approval-record.md` approves the exact current hashes of all four canonical artifacts and the exact pack snapshot recorded by `specs/lean-v1/approval/final-pack.md`;
- rerun or verify the recorded canonical and approval-view validators against those unchanged bytes;
- verify the traceability ledger contains every normative `FR`, `NFR`, `TC`, `DR`, `IR`, and `DEP` identifier exactly once;
- confirm no unresolved P0 or P1 specification finding remains.

Stop on any mismatch. Ticket-hierarchy approval later in this workflow does not repair or replace missing specification-pack approval.

### 1. Verify and inspect

Before drafting:

- load only the registered `/Volumes/Code/personal/task-manager/skills/to-tickets/SKILL.md` planning skill, not the in-repository Lean V1 skill artifact;
- verify exact executable equality with the control-plane constants above;
- verify Executor support and validate the intended coordination Store using an explicit storage path;
- inventory the Store with `tm --storage-path "$TM_COORDINATION_STORE" list --all-executors --json` before drafting;
- stop and reconcile with the user if an existing or partial Lean V1 hierarchy is present; never create a duplicate root or replay already-created Tickets;
- read the complete normative four-artifact specification pack, the verification traceability ledger, `CONTEXT.md`, and `AGENTS.md`;
- inspect the package structure, verification commands, public boundaries, and only the nearby implementation patterns needed to size Tickets.

Use this read-only/store-validation preflight:

```bash
test "$(realpath "$(command -v tm)")" = "$TM_STABLE_CLI"
command -v jq >/dev/null
tm --storage-path "$TM_COORDINATION_STORE" create --help | grep -q -- '--executor'
tm --storage-path "$TM_COORDINATION_STORE" set-executor --help | grep -q -- '<executor>'
tm --storage-path "$TM_COORDINATION_STORE" next --help | grep -q -- '--executor'
tm --storage-path "$TM_COORDINATION_STORE" list --help | grep -q -- '--executor'
tm --storage-path "$TM_COORDINATION_STORE" validate
tm --storage-path "$TM_COORDINATION_STORE" list --all-executors --json
```

Stop exploring when enough evidence exists to draft bounded Tickets. Do not begin implementation.

### 2. Draft the hierarchy

Present the Epic, command and cross-cutting Tasks, behavioral Subtasks, and dependency edges before running `tm create`.

For every proposed Ticket include:

- Subject;
- Level;
- Executor;
- Parent;
- Blocked by;
- Description;
- concise Context;
- public test seam for each implementation Subtask;
- exact source traceability.

State the total number of Epics, Tasks, Subtasks, and Tickets. Include the exhaustive verification scenario ownership matrix. Confirm that every agent Subtask and every actionable agent parent passes the Definition of ready.

### 3. Request approval

Ask:

- Does every Subtask fit one fresh LLM context?
- Are the in-scope and out-of-scope boundaries clear?
- Does any Subtask still contain multiple independently meaningful behaviors?
- Are all dependencies true blockers?
- Are the public test seams correct?
- Are the Executors correct?
- Should the hierarchy now be created?

Wait for explicit approval unless the user supplied an already-approved concrete hierarchy and explicitly requested immediate creation.

### 4. Create and validate

After approval:

1. Recheck exact CLI resolution and rerun the registered skill's state-changing preflight with `--storage-path "$TM_COORDINATION_STORE"` on every command.
2. Re-inventory the Store immediately before the first create. Stop if it differs from the approved starting inventory or already contains any proposed Lean V1 Ticket.
3. Treat the approved draft labels, fields, hierarchy, scenario ownership, and edges as an immutable creation manifest. Create parents before children and capture exact IDs from each `tm create --json` result with `jq -r '.ticket.id'`.
4. Pass an explicit `--executor agent` or `--executor human` to every create. Write substantial approved Markdown through `--description-file` and `--context-file`.
5. Verify each returned Ticket against the approved Subject, level, Executor, parent, Description, and Context before continuing.
6. Add every approved dependency edge using captured exact IDs.
7. Stop on the first create, verification, or dependency failure instead of changing or replaying approved intent. Report the draft-label-to-ID map and failed step. Resume only from that map after explicit user approval; never rerun the whole creation sequence.
8. Inspect every created Ticket with `tm --storage-path "$TM_COORDINATION_STORE" show <id> --json`.
9. Run scoped validation and listing, then report the created hierarchy, IDs, Executors, dependency edges, scenario ownership, validation result, and actionable frontier.

Use these command forms:

```bash
tm --storage-path "$TM_COORDINATION_STORE" init
tm --storage-path "$TM_COORDINATION_STORE" validate
tm --storage-path "$TM_COORDINATION_STORE" create "<root-subject>" \
  --level epic \
  --executor <agent|human> \
  --description-file <path> \
  --context-file <path> \
  --json
tm --storage-path "$TM_COORDINATION_STORE" create "<child-subject>" \
  --level <task|subtask> \
  --executor <agent|human> \
  --parent <parent-id> \
  --description-file <path> \
  --context-file <path> \
  --json
tm --storage-path "$TM_COORDINATION_STORE" block <blocked-id> --by <dependency-id>
tm --storage-path "$TM_COORDINATION_STORE" show <id> --json
tm --storage-path "$TM_COORDINATION_STORE" list --all-executors
```
