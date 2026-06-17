---
name: task-manager
description: Use the globally installed tm CLI to initialize local task storage and turn PRDs, specs, or plans into hierarchical Work Items. Use when creating an Epic/Task/Subtask backlog for implementation with tm.
---

# Task Manager

Use the globally installed `tm` CLI to create durable, local-first Work Items from a PRD, specification, or plan.

This skill teaches the current `tm` workflow: initialize storage, validate storage, create Work Items, inspect Work Items, and list the backlog tree.

## Preflight

Before doing any task-manager work, verify both required tools are available on `PATH`:

```bash
command -v tm >/dev/null
command -v jq >/dev/null
```

If either command is missing, stop and tell the user which tool is required. Do not use a fallback command.

## Domain terms

Use the task-manager domain language consistently:

- **Work Item**: any persisted unit of work.
- **Epic**: a large top-level initiative.
- **Task**: the middle hierarchy level, often a complete vertical slice.
- **Subtask**: an atomic step under a Task.
- **Description**: human-facing Markdown explaining what to build.
- **Agent Context**: execution-focused Markdown for a future agent.

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

## PRD/spec to backlog workflow

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
- Ordering notes, if any
- Source traceability

### 3. Require approval

Do not create Work Items until the user approves the hierarchy. If the user asks for changes, revise the draft and ask again.

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

## Ordering notes

- Parent: Add authentication.

## Verification expectations

- Run the project validation command." \
  --json
```

Use `--message-file` or `--context-file` only when the user already provided suitable files or the content is too large for inline command input.

### 6. Include traceability in every Work Item

Every Work Item must include source traceability in its Description or Agent Context. Prefer both when concise.

Use a section like:

```markdown
## Source

Derived from `specs/auth.md`, sections “Login”, “Session expiry”, and “Acceptance criteria”.
```

If the source came from conversation rather than a file, say so explicitly.

### 7. Encode ordering notes in Agent Context

When the PRD/spec implies ordering, record it in Agent Context:

```markdown
## Ordering notes

- Should be done after: Add data model
- Unblocks: Add API endpoint tests
```

Create Work Items in the same logical order.

### 8. Final validation and report

After all approved Work Items are created, run:

```bash
tm validate
tm list
```

Then report back to the user with:

- created Epic(s), Tasks, and Subtasks
- any ordering notes encoded in Agent Context
- confirmation that validation passed
- the final backlog tree from `tm list` or a concise summary of it

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

## Ordering notes

- Should be done after: ...
- Unblocks: ...

## Verification expectations

- Run ...
```

Keep Description human-facing and concise. Put implementation constraints, assumptions, ordering notes, and verification expectations in Agent Context.

## Failure handling

If a `tm create` command fails validation:

1. Stop creating more Work Items.
2. Read the error output.
3. Report which approved Work Item failed and which Work Items were already created.
4. Correct the failed draft.
5. Ask the user to approve the correction before retrying.

Do not manually edit `.tasks/tasks.jsonl` for recovery unless the user explicitly asks for low-level recovery.

Use `tm show <id>` to inspect a created Work Item when needed:

```bash
tm show <id>
```
