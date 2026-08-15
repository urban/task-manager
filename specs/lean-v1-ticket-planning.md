<skill name="to-tickets" location="/Users/urbanfaubion/.agents/skills/to-tickets/SKILL.md">
References are relative to /Users/urbanfaubion/.agents/skills/to-tickets.

## Rules

- Use Task Manager Tickets as the only durable tracker: create and modify state with `tm` commands only; do not use GitHub, Linear, local Markdown backlogs, or any other tracker.
- Call artifacts Tickets in drafts, commands, and reports; do not substitute other tracker vocabulary.
- Do not manually edit `.tasks/tasks.jsonl`. If storage needs repair, stop and ask the user for explicit low-level recovery approval instead of bypassing `tm`.
- Require first-class Executor support before drafting or creating Tickets. Run the Executor preflight below and stop if any check fails; do not fall back to writing Executor only in Context.
- Draft the proposed hierarchy, executors, and dependency edges before running `tm create`. Wait for explicit user approval unless the user supplies an already-approved concrete breakdown and explicitly says to create it now.
- Inspect the codebase by default before drafting unless the user explicitly says not to. Keep exploration bounded to relevant files, existing architecture, project vocabulary, verification commands, and nearby patterns.
- Default to tracer-bullet vertical slices: each agent-executor task should deliver a narrow, complete, independently verifiable path through the system and fit in one fresh LLM context.
- Record real ordering with `--blocked-by` or `tm block`, not only in Markdown prose.
- Pass explicit `--executor agent` or `--executor human` to every `tm create`; child Tickets do not inherit their parent's Executor.
- Treat HITL decisions, reviews, approvals, credential entry, vendor/account changes, private UI checks, and manual-only work as human-executor work. Do not execute human-executor Tickets unattended.

## Constraints

- Ticket levels are exactly `epic`, `task`, and `subtask`.
- Executors are exactly `agent` and `human`; use `--all-executors` for read views across both Executors.
- Subjects must be 50 characters or fewer, imperative, capitalized, one line, non-empty, without leading/trailing whitespace, without trailing periods, and without Markdown markers `*`, `_`, `` ` ``, `#`, `[`, or `]`.
- A source may produce one or more root `epic`s. Use multiple epics for separate phases or independently meaningful initiatives; never create a fake root above multiple epics.
- Hierarchy is capped at `epic -> task -> subtask`. Tracer-bullet vertical slices are usually `task`s under an epic. Use `subtask`s only when a slice is too large for one fresh LLM context.
- Dependencies should be recorded at the most specific level possible, usually task-to-task. Use epic-to-epic dependencies only when an entire phase genuinely cannot start.
- Parent epics default to the `agent` Executor. Use `human` for an epic only when the epic itself is a human-owned phase or gate, such as approving a beta rollout.
- Do not use `--allow-human`, `--force`, destructive delete, or manual storage recovery unless the user explicitly approves that risky action.

## Requirements

- Accept any of these sources: a spec/PRD file path, pasted spec/PRD text, a plan in the conversation, or the current conversation when the user asks to turn it into Tickets.
- Use the current directory as the default task store unless the user specifies another target with `--cwd` or `--storage-path`.
- Before drafting or creating, verify the local CLI supports Executor:

  ```bash
  command -v tm >/dev/null
  command -v jq >/dev/null
  tm create --help | grep -q -- '--executor'
  tm set-executor --help | grep -q -- '<executor>'
  tm next --help | grep -q -- '--executor'
  tm list --help | grep -q -- '--executor'
  ```

- If any preflight command fails, stop and report that this skill requires first-class Executor support. Do not create Tickets and do not encode Executor only in text.
- Collect enough source traceability to explain where each Ticket came from: source file path, section, user story, acceptance criterion, or conversation summary.
- Identify true blockers separately from sequencing preferences. A dependency is valid only when the blocked Ticket cannot start or finish correctly without the blocker.
- Map planning vocabulary to Executors explicitly:
  - AFK / LLM-executable / safe from context -> `agent`
  - HITL / user approval / manual or private action -> `human`
- For wide mechanical refactors, use expand-migrate-contract instead of forcing vertical slices.

## Workflow

### 1. Gather and normalize the source

- Read the full referenced file or conversation material before planning. If the source is pasted text, treat it as the authoritative source.
- Summarize the goal, source sections, user stories, acceptance criteria, non-goals, known risks, and explicit phases.
- Ask focused clarification questions only when missing information would change hierarchy, dependencies, executor, or acceptance criteria.

### 2. Inspect the codebase by default

- Unless the user says not to inspect, do a bounded pass through relevant files, existing documentation, verification scripts, domain names, and similar implementation patterns.
- Use inspection to name Tickets in project vocabulary and to size agent-executor slices realistically.
- Do not let exploration become implementation. Stop once you can draft useful Tickets and verification expectations.

### 3. Decompose into tracer-bullet Tickets

- Choose one or more root epics based on real product phases or independent initiatives. Do not invent an umbrella epic solely to group multiple epics.
- Create task-level vertical slices that each deliver end-to-end behavior, such as schema/API/UI/tests together when that is what makes the behavior verifiable.
- Avoid horizontal tasks like “Add schemas”, “Build API”, or “Create UI components” unless the source truly requires a non-vertical step.
- Split a large vertical slice into subtasks only when each subtask is still independently useful and the parent task would exceed one fresh LLM context.
- Assign the `agent` or `human` Executor to every proposed Ticket. The human Executor is for actual human-required gates, not for work that an LLM could safely do but a person might prefer.

### 4. Handle wide refactors with expand-migrate-contract

Use this exception when one mechanical change has a blast radius across the codebase and no vertical slice can land green:

1. **Expand**: add the new form beside the old form so existing callers keep working.
2. **Migrate**: move call sites in batches sized by blast radius, each batch as its own Ticket blocked by the expand Ticket.
3. **Contract**: delete the old form once no callers remain, blocked by all migrate batches.

If even migration batches cannot stay green alone, use an integration branch exception: make each batch feed a final integrate-and-verify Ticket, and make green verification explicit on that final Ticket.

### 5. Draft and wait for approval

Present a numbered draft before any `tm create`. For each proposed Ticket include:

- Subject
- Level: Epic / Task / Subtask
- Executor: agent / human
- Parent, if any
- Blocked by: titles of true blockers, or none
- What it delivers: end-to-end behavior, not layer implementation
- Source traceability: source section, user story, acceptance criterion, or conversation note

Ask the user:

- Does the granularity feel right?
- Are dependencies true blockers rather than ordering preferences?
- Should any slices be merged or split?
- Are the right Tickets `agent` vs `human`?
- Are phases represented by the right epics?

Iterate on the draft until the user approves. Only skip this gate when the user provides a concrete, already-approved breakdown and explicitly says to create it now.

### 6. Create approved Tickets

After approval, run the state-changing preflight:

```bash
command -v tm >/dev/null
command -v jq >/dev/null
tm create --help | grep -q -- '--executor'
tm set-executor --help | grep -q -- '<executor>'
tm next --help | grep -q -- '--executor'
tm list --help | grep -q -- '--executor'
tm init
tm validate
```

Then create Tickets in dependency-safe order:

1. Create epics before tasks and tasks before subtasks.
2. Use `tm create --json` for every Ticket and capture IDs with `jq -r '.ticket.id'`.
3. Pass explicit `--executor agent` or `--executor human` on every `tm create`.
4. Pass `--parent <captured-id>` for children.
5. Use `--blocked-by <captured-id>` when blockers already exist; otherwise create both Tickets and then run `tm block <blocked-id> --by <dependency-id>`.
6. Prefer `--message-file`, `--description-file`, and `--context-file` for large Markdown to avoid shell quoting failures.
7. Stop on the first `tm create` or `tm block` failure, report created IDs and the failed ticket or edge, and ask before changing user-approved intent.

Use this Description shape for each created Ticket:

```markdown
## What to build

A concise end-to-end description of the behavior this Ticket delivers.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Source

Derived from ...
```

Use this Context shape for each created Ticket:

```markdown
## Execution context

What a future agent or human needs to know to start.

## Relevant project context

- Important files, constraints, domain terms, or architecture notes.

## Dependency context

- Why CLI-recorded dependencies exist, or “None.”

## Verification expectations

- Run bun run check, unless the project or source says otherwise.
```

For human-executor Tickets, make the human requirement explicit in Context: the decision, review, approval, credential entry, manual check, or external action needed, and which downstream Tickets it unblocks.

### 7. Validate and report

After all creates and dependency edges are recorded, run:

```bash
tm validate
tm list --all-executors
```

Report the created Ticket IDs, subjects, hierarchy, Executors, dependency edges, and validation result. Include suggested next commands:

```bash
tm next
tm next --executor human
tm list --all-executors
tm list --executor human
```

## Gotchas

- Agents often create Tickets too early because the source looks clear. That locks in wrong hierarchy and dependencies; always draft and wait for approval unless the user explicitly gives an approved breakdown to create now.
- Missing `--executor` silently defaults work toward agent execution and can erase HITL gates; putting “human” only in Context is unenforced. Pass an explicit Executor on every create and stop if the CLI lacks first-class Executor support.
- A fake root epic above multiple real epics hides parallelism and violates Task Manager hierarchy. Use multiple root epics when phases or initiatives are independent.
- Horizontal layer Tickets feel tidy but strand future agents with non-demoable work. Reframe as thin end-to-end behavior unless the source truly requires a mechanical layer step.
- Dependency prose is easy to write and easy for `tm next` to ignore. Record every true blocker with `--blocked-by` or `tm block` using captured IDs.
- Human approvals marked as `agent` let agents proceed without the user's decision. If work requires a person, credential, private UI, or review, create a human-executor gate and block downstream work on it.
- Giant “implement the feature” tasks exceed one fresh LLM context and fail midstream. Split into vertical slices or subtasks with their own acceptance criteria and verification.
- Wide refactors forced into vertical slices often leave every slice red. Use expand-migrate-contract, with batch Tickets sized by blast radius and a contract Ticket blocked by all migrations.
- Editing `.tasks/tasks.jsonl` directly bypasses validation and corrupts durable state. Use `tm` commands for creation, updates, dependencies, and validation.

## Deliverables

Before approval, provide a numbered draft with each proposed Ticket's Subject, Level, Executor, Parent, Blocked by, What it delivers, and Source traceability, followed by the approval questions.

After approval and creation, provide:

- Created Ticket IDs and subjects.
- Hierarchy showing epics, tasks, and subtasks without fake roots.
- Executor for every Ticket.
- Recorded dependency edges using created IDs.
- `tm validate` result and whether `tm list --all-executors` completed.
- Suggested next commands for agent work and HITL work: `tm next`, `tm next --executor human`, `tm list --all-executors`, and `tm list --executor human`.

If creation stops due to preflight or command failure, report the failed check or command, any IDs already created, and the safest next action. Do not continue by switching trackers, writing local files, or editing storage by hand.
</skill>

Use the instructions below to plan tickets for the @specs/lean-v1.md specificaiton implementation.

Break down the approved specification at <SPEC_PATHS> into Task Manager Tickets for implementation in <PROJECT_ROOT>.

Use the registered Task Manager planning skill and the intended coordination Store. Verify the coordination CLI and Store before making Ticket changes. Treat product source, generated help, existing tests, and in-repository skills as implementation evidence unless the project explicitly declares them authoritative.

Inspect the authoritative specification, verification checklist, domain/context documents, repository instructions, package structure, verification commands, and nearby implementation patterns before drafting. Do not begin implementation while planning Tickets.

Hierarchy

1. Create one real root Epic for the complete initiative unless the source genuinely defines multiple independent initiatives or phases. Do not create a fake umbrella Epic above independent Epics.
2. For a CLI product, create one Task for each public CLI command. The command Task is a feature container, not a broad implementation assignment.
3. For a non-CLI product, use one Task per user-visible public capability, endpoint, workflow, or independently meaningful feature instead of organizing Tasks by internal layer.
4. Add separate cross-cutting Tasks only for obligations that do not belong to one command or capability, such as global process contracts, final qualification, skill migration, or generated documentation.
5. Put implementation work in multiple small behavioral Subtasks under each command or capability Task. Do not stop at one large “implement core” Subtask and one large “implement CLI” Subtask.
6. Respect the hierarchy limit Epic -> Task -> Subtask. Parent Tasks summarize the complete feature and become administrative completion containers after their Subtasks finish.

Fresh-agent execution

1. Size every Subtask so one agent can complete it in one fresh LLM session and one fresh context window.
2. Record that one fresh agent session owns exactly one Subtask. It must not claim or implement sibling Subtasks in the same session.
3. If a Subtask still contains several independently meaningful behaviors, race matrices, failure families, or acceptance boundaries, split it again before creating Tickets.
4. Every Subtask must leave the branch green and produce independently verifiable progress. Avoid half-migrations that require an unfinished sibling to compile or pass tests.
5. Use explicit dependencies so each fresh agent starts only after the code and contracts it relies on have landed.

Behavioral tracer bullets

1. Decompose each command into behavior-sized slices, for example:
   - one successful core behavior through the exported public API and real persistence;
   - one boundary or invariant family;
   - one no-op or failure-precedence behavior;
   - one concurrency, expiry, or rollback behavior when required;
   - one focused real-CLI parsing/input behavior;
   - one focused real-CLI rendering/process behavior.
2. A core Subtask must cut through the public core API, domain validation, transaction/persistence behavior, and public result or typed error needed for that behavior. Do not create horizontal “add schemas”, “add tables”, or “add repositories” Tickets unless an unavoidable expand-migrate-contract refactor requires them.
3. A real-CLI Subtask must exercise the real command entrypoint and use the public core capability. It owns parsing, environment fallback, files, confirmations, human/JSON rendering, streams, and exit status as applicable. Do not duplicate core domain rules in the adapter.
4. Separate CLI input/parsing behavior from output/rendering behavior when either would exceed one fresh context.
5. Separate race matrices and rollback/reopen proofs from ordinary success/failure behavior when they are substantial.
6. Resolve dependency cycles by staging a usable base behavior first and adding the cross-feature behavior later. For example, basic Ticket creation may precede Claim acquisition, followed by a later creation Subtask that adds claimed-parent fencing.

Test-driven development

1. Every implementation Subtask is test-first.
2. Name the public seam in the Ticket Context before implementation:
   - exported core access function with its service Layer and real temporary file-backed Store; or
   - real CLI process for adapter behavior.
3. Work in repeated red -> green cycles: add one failing behavioral test from the specification, run it and confirm the expected failure, implement only enough to pass, then continue with the next listed behavior.
4. Do not bulk-write imagined tests before implementation. Do not test private helpers or mock internal collaborators when the public seam can demonstrate the behavior.
5. Use deterministic clocks, barriers, and fault controls only as private test controls for publicly observable races or rollback evidence.
6. Require focused verification during the loop and <FULL_VERIFICATION_COMMAND> before completing each Subtask.

Progressive context

Write the hierarchy so a fresh agent can load context progressively:

Epic Context must include:
- authoritative source paths and precedence;
- overall product goal and architecture boundaries;
- canonical domain vocabulary;
- important non-goals;
- repository, branch, package-manager, and verification rules;
- stable coordination-tool versus product-under-development boundaries;
- the fresh-session and test-first execution policy.

Each command or capability Task Context must include:
- the complete public feature or command purpose;
- public core operation names and relevant service boundary;
- command syntax, flags, environment fallbacks, input modes, outputs, and typed error families;
- transaction, lifecycle, Claim/concurrency, ordering, and failure-precedence invariants that apply;
- final acceptance criteria for the complete command;
- its ordered Subtask map and integration dependencies;
- source traceability to the exact specification and checklist sections.

Each Subtask Context must include:
- an imperative, bounded objective and one clear resulting capability;
- an instruction to read this Ticket, then its parent Task and root Epic before coding;
- the exact public seam under test;
- the specific behavioral scenarios to drive red -> green;
- prerequisite Tickets and the behavior assumed from them;
- in-scope and explicitly out-of-scope behavior;
- relevant source sections, project files, constraints, and nearby patterns;
- exact focused and full verification commands;
- the concrete completion evidence expected in the Ticket Result;
- a reminder to stop and correct the Ticket if it conflicts with authoritative project documents.

Dependencies

1. Record dependencies as first-class Ticket edges, never only as prose.
2. Put each edge at the most specific Subtask level possible. Do not block on a whole command Task when only one earlier behavioral Subtask is required.
3. Record only true blockers: the dependent Subtask cannot start or finish correctly without the prerequisite’s landed behavior.
4. Prefer a sequential chain within a command when successive fresh agents evolve the same code seam; permit parallel Subtasks only when they can land green independently without conflicting ownership.
5. Ensure the dependency graph has at least one actionable first Subtask and no cycles.

Ticket quality

For every proposed Ticket include:
- Subject;
- Level;
- Executor;
- Parent;
- Blocked by;
- clear behavioral outcome;
- public test seam;
- source traceability.

Use imperative, concise Subjects that satisfy the Task Manager constraints. Assign agent Executor only to work an unattended agent can complete. Use human Executor for real approvals, credentials, private checks, external actions, or decisions.

Draft before creation

1. Present the proposed Epic, command/capability Tasks, behavioral Subtasks, and dependency structure before running any create command.
2. State the total number of Epics, Tasks, Subtasks, and Tickets.
3. Ask whether the granularity fits one fresh context, whether dependencies are true blockers, whether any Subtask still needs splitting, whether the public test seams are approved, and whether the hierarchy should now be created.
4. Wait for explicit approval before creating Tickets unless I explicitly provide an already-approved concrete hierarchy and instruct you to create it immediately.
5. After approval, create parent-before-child, capture exact IDs, add dependency edges, validate the Store, and report the created hierarchy and actionable frontier.
