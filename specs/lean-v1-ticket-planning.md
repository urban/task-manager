# Lean V1 Ticket Planning

Break down the approved Lean V1 specification into Task Manager Tickets for implementation in the current Lean V1 worktree.

Use the registered Task Manager planning skill and the intended coordination Store. Plan Tickets only; do not implement product code while performing this workflow.

## Authority and boundaries

- Treat `specs/lean-v1/charter.md`, `specs/lean-v1/user-stories.md`, `specs/lean-v1/requirements.md`, and `specs/lean-v1/technical-design.md` as the normative specification pack.
- Treat `specs/lean-v1/approval/verification-traceability.md` as the stable scenario ledger for mandatory evidence planning.
- Treat `CONTEXT.md` as the canonical domain vocabulary.
- Follow `AGENTS.md` for repository, branch, package-manager, verification, and coordination boundaries.
- Treat product source, generated help, existing tests, and in-repository skills as implementation evidence unless an authoritative project document says otherwise.
- Use the stable coordination CLI at `/Volumes/Code/personal/task-manager/packages/cli/src/bin.ts`, never the Lean V1 CLI under development.
- Use `/Volumes/Code/personal/task-manager-next/.tasks` as the coordination Store. Pass it with `--storage-path` when required by `AGENTS.md`.
- Stop if the stable CLI, Store, normative specification pack, verification traceability ledger, context document, or repository instructions cannot be verified.

## Hierarchy

1. Create one real root Epic for the complete Lean V1 initiative unless the authoritative specification genuinely defines independent initiatives or phases. Never create a fake umbrella Epic.
2. Create one Task for each public CLI command. A command Task describes the complete command contract and is an administrative feature container, not a single implementation assignment.
3. Add cross-cutting Tasks only for obligations that do not belong to one command, such as global process contracts, final qualification, generated documentation, or skill migration.
4. Put implementation work in multiple behavioral Subtasks under each Task.
5. Use only `epic -> task -> subtask`. Parent Epics and Tasks are complete only after their child work and final acceptance criteria are satisfied.

## Fresh-session contract

Each agent-executor Subtask is owned by exactly one fresh LLM session.

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

- Description states the complete initiative or public capability, its observable final acceptance criteria, and exact source traceability.
- Context contains only shared architecture, command contracts, constraints, terminology, integration dependencies, and the child Subtask map needed to coordinate the feature.

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
- `specs/lean-v1/approval/verification-traceability.md`, exact stable scenario ID.
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

Record the implemented behaviors, tests added, exact verification commands and outcomes, and any authoritative conflict discovered.
```

Context must contain only information that changes how this Subtask is executed. Do not include narrative history, full-spec summaries, complete sibling behavior, generic advice, or unrelated files and invariants.

## Behavioral tracer bullets

Decompose each command into small vertical slices rather than internal layers.

For privileged debug observability, create exactly one global cross-cutting activation/privacy/transport Task. It owns the single inherited root `debug` flag declaration and lazy `TM_DEBUG` policy; private AppLive resource ownership; fixed numeric-loopback trace/log transport; queue cap and shutdown deadline; final-byte default-deny projection; transparent Exit/Cause observation; and global architecture/disabled-resource evidence. Do not create a horizontal telemetry-framework phase, separate tracer/logger/transport/privacy Tasks, or repeat global flag implementation under command Tasks.

Then add vertical command tracer bullets to the applicable command Tasks. Each bullet must land a usable command path through parsing, one genuine public access function, persistence, product publication, bounded telemetry finalization, and real-process equality/privacy/outage evidence. Later command bullets own only their command-specific spans and classifications and depend on the landed global Task; they do not reimplement activation, transport, wrappers, or finalization.

The first tracer bullet is `tm init --debug` and must cover the complete initial path: sole Effect CLI parser and root boolean/generated negation/environment precedence; fixed trace/log endpoints and disabled resource absence; `CliApplication.run` -> public Task Manager initialization access -> `CoordinationStore.runInitialization` -> `StoreSqlClient.acquire` -> init-only `CoordinationStore.publishInitialization` -> `ProcessOutput.publish` -> one bounded traces-plus-logs flush/shutdown after all Store/client scopes. Its acceptance includes privacy canaries, exporter refusal/status/redirect/hang, and byte/status/original-Exit equality with debug off. This first vertical slice establishes the shared implementation used by later command tracers without becoming a horizontal telemetry-framework phase.

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
- Has unrelated history, generic guidance, speculative cleanup, and future behavior been removed?

## Planning workflow

### 1. Verify and inspect

Before drafting:

- verify the registered Task Manager planning skill;
- verify `realpath "$(command -v tm)"` resolves to the stable coordination CLI;
- verify Executor support and validate the intended coordination Store;
- read the complete normative four-artifact specification pack, the verification traceability ledger, `CONTEXT.md`, and `AGENTS.md`;
- inspect the package structure, verification commands, public boundaries, and only the nearby implementation patterns needed to size Tickets.

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

State the total number of Epics, Tasks, Subtasks, and Tickets. Confirm that every agent Subtask passes the Definition of ready.

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

1. Run the registered skill's state-changing preflight against the intended Store.
2. Create parents before children and capture exact IDs from `tm create --json`.
3. Pass an explicit `--executor agent` or `--executor human` to every create.
4. Write the approved content through `--description-file` and `--context-file` when Markdown is substantial.
5. Add every approved dependency edge using captured IDs.
6. Stop on the first create or dependency failure instead of changing approved intent.
7. Run `tm validate` and `tm list --all-executors` against the intended Store.

Report the created hierarchy, IDs, Executors, dependency edges, validation result, and actionable frontier.
