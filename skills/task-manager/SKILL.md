---
name: task-manager
description: Use the globally installed tm CLI to initialize task storage, plan durable Work Items from PRDs/specs, and execute the backlog loop with next, claim, and complete.
---

# Task Manager

Task Manager is the public MVP product name, and `tm` is its primary CLI binary.

Use the globally installed `tm` CLI to create and execute durable, local-first Work Items. The persisted backlog is the source of truth for work that must survive handoff or session loss.

This skill teaches two workflows:

1. Plan a backlog from a PRD, specification, plan, or conversation.
2. Execute existing backlog work with `tm next`, `tm claim`, implementation, verification, and `tm complete`.

## Preflight

Before doing any task-manager work, verify both required tools are available on `PATH`:

```bash
command -v tm >/dev/null
command -v jq >/dev/null
```

If either command is missing, stop and tell the user which tool is required. Do not use a fallback command.

Sections that require commands such as `tm next`, `tm claim`, `tm complete`, `tm block`, or `tm unblock` assume the installed `tm` supports those commands. Do not fall back to manually reading or rewriting JSONL storage.

## Conservative command policy

- Only use commands and flags verified in the current implementation.
- Prefer CLI-enforced fields and commands over Markdown conventions.
- Record hierarchy with `--parent`, dependencies with `tm block`, advisory ownership with `tm claim`, and completion evidence with `tm complete` Result fields.
- Never manually edit `.tasks/tasks.jsonl` unless the user explicitly asks for low-level recovery.
- Do not invent plan import, sync, priority, auto-claim, or dependency-at-create workflows that the CLI does not enforce.

## Domain terms

Use the task-manager domain language consistently:

- **Work Item**: any persisted unit of work.
- **Epic**: a large top-level initiative.
- **Task**: the middle hierarchy level, often a complete vertical slice.
- **Subtask**: an atomic step under a Task.
- **Description**: human-facing Markdown explaining what to build.
- **Agent Context**: execution-focused Markdown for a future agent.
- **Dependency**: a CLI-recorded ordering constraint saying one Work Item should be completed before another begins.
- **Agent Claim**: an advisory signal that one agent is currently working on a Work Item.
- **Result**: structured completion evidence recorded by `tm complete`.

Do not use “Task” as the generic term. Use “Work Item” generically.

## Subject rules

Every Work Item Subject must satisfy the current CLI validation rules:

- non-empty
- 50 characters or fewer
- no leading or trailing whitespace
- one line only
- starts with a capital letter
- no trailing period
- no Markdown markers: `*`, `_`, `` ` ``, `#`, `[`, `]`

Prefer imperative phrasing, for example “Add login flow” instead of “Login flow”.

## PRD/spec to backlog planning workflow

### 1. Read the source material

Use the PRD, specification, plan, or conversation as the source of truth.

If the source is lean, ambiguous, or missing project-specific terminology, ask the user whether to explore the codebase before drafting Work Items. If the user declines exploration, draft with explicit assumptions and call out uncertainty in the proposed hierarchy.

### 2. Draft the hierarchy before creating anything

Draft the backlog and ask the user to approve it before running `tm create`.

Default mapping:

- One PRD/spec/plan becomes one root Epic.
- Major vertical slices become Task children.
- Subtasks are optional and should only appear when a Task is too large for one focused session.

Exceptions:

- If the source clearly contains several independent initiatives, draft multiple Epics and ask for explicit approval.
- If the source is tiny and atomic, draft one standalone Task and call out that no Epic is needed.

Prefer vertical slices / tracer bullets over horizontal layer work. A Task should usually produce a narrow, complete, verifiable path through the system rather than only “schemas”, only “API”, or only “UI”.

For each proposed Work Item, show:

- Subject
- Level: Epic, Task, or Subtask
- Parent, if any
- Description summary
- Agent Context summary
- Ordering notes / dependencies, if any, for human review before they are persisted with CLI dependency commands
- Source traceability

### 3. Require approval

Do not create Work Items until the user approves the hierarchy and dependency plan. If the user asks for changes, revise the draft and ask again.

### 4. Initialize and validate storage

After approval, initialize storage and validate before creating Work Items:

```bash
tm init
tm validate
```

`tm init` is safe to run for both fresh and already-initialized projects.

### 5. Create Work Items parent-before-child

Create approved Work Items in parent-before-child order.

Use `tm create --json` for every creation. After each successful create, read `.item.id` from the JSON output with `jq` and record it in an in-memory ID map keyed by the approved draft label. Use the recorded parent ID for each child’s `--parent` value.

Use `--message` for the Subject plus Description. The first line is the Subject. A blank line separates the Subject from the Description body.

Use `--context` for Agent Context.

Minimal examples:

```bash
tm create --level epic \
  --message "Add authentication

Coordinate authentication implementation work." \
  --context "## Source

Derived from specs/auth.md.

## Verification expectations

- Run the project validation command." \
  --json
```

```bash
tm create --level task --parent <parent-id> \
  --message "Add login flow

Implement the first end-to-end login slice." \
  --context "## Source

Derived from specs/auth.md.

## Relevant project context

- Parent initiative: Add authentication.

## Verification expectations

- Run the project validation command." \
  --json
```

Use `--message-file` or `--context-file` only when the user already provided suitable files or the content is too large for inline command input.

### 6. Record dependencies with CLI commands

After both Work Items in a dependency relationship exist, record the dependency with:

```bash
tm block <blocked-id> --by <dependency-id>
```

Read both IDs from the in-memory ID map built from `tm create --json` output. Do not infer IDs from subjects.

Examples:

```bash
tm block <login-flow-id> --by <user-model-id>
tm block <api-tests-id> --by <api-endpoint-id>
```

Use `tm unblock <blocked-id> --by <dependency-id>` only when removing an incorrect or obsolete dependency is part of the approved change.

Explanatory sequencing rationale may be included in Agent Context when it helps a future agent, but Markdown prose is not the source of truth for ordering. The dependency edge recorded by `tm block` is the source of truth.

### 7. Include traceability in every Work Item

Every Work Item must include source traceability in its Description or Agent Context. Prefer both when concise.

Use a section like:

```markdown
## Source

Derived from `specs/auth.md`, sections “Login”, “Session expiry”, and “Acceptance criteria”.
```

If the source came from conversation rather than a file, say so explicitly.

### 8. Final validation and report

After all approved Work Items and dependencies are created, run:

```bash
tm validate
tm list
```

Then report back to the user with:

- created Epic(s), Tasks, and Subtasks
- dependencies recorded with `tm block`
- confirmation that validation passed
- the final backlog tree from `tm list` or a concise summary of it

## Existing backlog execution workflow

Use this workflow when the user asks you to execute existing task-manager work, continue the backlog, pick the next task, or work from `tm`.

### 1. Validate storage

Run:

```bash
tm validate
```

If validation fails, stop and report the failure. Do not repair storage manually unless the user explicitly asks for low-level recovery.

### 2. Select actionable work

Run:

```bash
tm next --json
```

Use `jq` to inspect the response. If the response has no `.item.id` and reports `no-actionable-work`, stop and report that no actionable Work Items are available.

Example selection snippet:

```bash
next_json="$(tm next --json)"
next_id="$(printf '%s\n' "$next_json" | jq -r '.item.id // empty')"
if [ -z "$next_id" ]; then
  printf '%s\n' "$next_json" | jq -r '.reason // "no-actionable-work"'
fi
```

Do not choose work by manually sorting or filtering `.tasks/tasks.jsonl`.

### 3. Inspect the selected Work Item

Run:

```bash
tm show <id>
```

Read the Description, Agent Context, dependencies, current claim, and Result/Cancellation state before starting. If the selected Work Item conflicts with user instructions, stop and ask for direction.

### 4. Claim the Work Item

Use a stable, descriptive Agent Identity. Prefer `TM_AGENT` if it is already set; otherwise pass an explicit `--agent <agent-name>` and reuse the same value for completion.

```bash
tm claim <id> --agent <agent-name>
```

or:

```bash
TM_AGENT=<agent-name> tm claim <id>
```

If the Work Item is actively claimed by another agent, stop and report the conflict. Use `--force` only when the user explicitly instructs you to take over.

### 5. Implement and verify

Do the implementation work requested by the Work Item.

Run the verification requested by the Work Item. For this repository, normally run:

```bash
bun run check
```

If the Work Item specifies a different verification command, follow it and explain why.

### 6. Complete with a strong Result

Complete only after implementation and verification. Use the same Agent Identity that claimed the Work Item:

```bash
tm complete <id> \
  --agent <agent-name> \
  --summary "Describe the concrete change" \
  --verification "bun run check: passed"
```

Add `--details` and repeated `--decision` or `--verification` flags when they preserve useful handoff context.

If `TM_AGENT` is set, `--agent` may be omitted:

```bash
TM_AGENT=<agent-name> tm complete <id> \
  --summary "Describe the concrete change" \
  --verification "bun run check: passed"
```

Do not complete a Work Item with vague or unverified Results.

Bad:

```bash
tm complete <id> --agent <agent-name> --summary "Done" --verification "Looks good"
```

Good:

```bash
tm complete <id> \
  --agent <agent-name> \
  --summary "Updated task-manager skill to use dependency, claim, and completion commands" \
  --verification "bun run check: passed (lint/typecheck/tests; 44 tests)"
```

A good Result summary names what changed. Good verification records the exact command and meaningful output or status, such as test counts or build success.

### 7. Validate and report completion evidence

After completion, run:

```bash
tm validate
```

Report:

- completed Work Item ID and Subject
- Result summary
- verification command and outcome
- confirmation that `tm validate` passed

## Content templates

Use these structures when drafting Work Item content.

### Description template

```markdown
## What to build

Describe the end-to-end behavior this Work Item should deliver.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Source

Derived from ...
```

### Agent Context template

```markdown
## Execution context

Explain what a future agent needs to know to start this Work Item without prior chat history.

## Relevant project context

- Important domain terms, files, or constraints.

## Dependency context

- Optional prose explaining why CLI-recorded dependencies exist or what they unblock.

## Verification expectations

- Run ...
```

Keep Description human-facing and concise. Put implementation constraints, assumptions, sequencing rationale, and verification expectations in Agent Context. Use CLI fields and commands, not Markdown conventions, for machine-enforced state.

## Failure handling

If a `tm create` command fails validation:

1. Stop creating more Work Items.
2. Read the error output.
3. Report which approved Work Item failed and which Work Items were already created.
4. Correct the failed draft.
5. Ask the user to approve the correction before retrying.

If a dependency command fails:

1. Stop creating more dependencies.
2. Report the failed `tm block` or `tm unblock` command and error.
3. Explain which Work Items and dependencies were already created.
4. Ask the user whether to revise the dependency plan.

If `tm claim` or `tm complete` fails because of another active claim, incomplete dependencies, open children, missing verification, or validation errors, stop and report the exact error. Do not use `--force` or no-verification escape hatches unless the user explicitly approves that recovery path.

Do not manually edit `.tasks/tasks.jsonl` for recovery unless the user explicitly asks for low-level recovery.

Use `tm show <id>` to inspect a created or selected Work Item when needed:

```bash
tm show <id>
```
