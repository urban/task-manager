# Plan From Spec

Read this when decomposing a PRD, specification, plan, or conversation into an approved backlog before creation.

## Planning sequence

1. Read the source material.
2. If terminology, codebase constraints, or acceptance criteria are ambiguous, ask whether to inspect the codebase before drafting.
3. Draft the hierarchy and dependency plan before creating anything.
4. Ask for explicit approval.
5. After approval, create using [`create-work-items.md`](./create-work-items.md).

## Default hierarchy

- One PRD/spec/plan usually becomes one root Epic.
- Major vertical slices become Task children.
- Subtasks are optional; use them only when a Task is too large for one focused session.
- Default Execution Mode is `agent`; use `human` for decisions, reviews, approvals, credential entry, private/manual checks, or other HITL work.

Exceptions:

- If the source contains several independent initiatives, draft multiple Epics and ask for explicit approval.
- If the source is tiny and atomic, draft one standalone Task and explain that no Epic is needed.

## Vertical-slice rule

Prefer tracer-bullet Tasks over horizontal layers. A Task should usually produce a narrow, complete, verifiable path through the system.

Prefer:

- `Add login form submission`
- `Persist completed Work Item result`
- `Show cancelled items in list filter`

Avoid standalone layer work unless the source truly requires it:

- `Add schemas`
- `Build API`
- `Create UI components`

## Draft format

For each proposed Work Item, show:

- Subject
- Level: Epic, Task, or Subtask
- Execution Mode: agent or human
- Parent, if any
- Description summary
- Agent Context summary
- Dependencies or ordering notes
- Source traceability

Example:

```markdown
1. Add authentication
   - Level: Epic
   - Execution Mode: agent
   - Description: Coordinate login and session work.
   - Agent Context: Source spec, verification command, project constraints.
   - Source: specs/auth.md, sections Login and Session expiry.

2. Add login form submission
   - Level: Task
   - Execution Mode: agent
   - Parent: Add authentication
   - Description: Implement the first end-to-end login slice.
   - Agent Context: Relevant files, expected tests, verification.
   - Dependencies: none
   - Source: specs/auth.md, Login acceptance criteria.
```

## Approval gate

Do not run `tm create` until the user approves the hierarchy and dependency plan. If the user requests changes, revise the draft and ask again.

After approval:

1. Run `tm init` and `tm validate`.
2. Create parent-before-child with `tm create --json --mode agent|human`.
3. Capture IDs from `.item.id`.
4. Record dependencies with `--blocked-by` or `tm block`.
5. Run `tm validate` and `tm list`.

## Traceability

Every created Work Item should include source traceability in Description, Agent Context, or both:

```markdown
## Source

Derived from `specs/auth.md`, sections “Login”, “Session expiry”, and “Acceptance criteria”.
```

If the source came from conversation rather than a file, say so explicitly.

## Dependency planning

Use dependencies only for true ordering constraints. Do not encode preference, priority, or grouping as dependencies.

Good dependency:

- `Add login integration tests` blocked by `Add login API endpoint` because tests require the endpoint.

Weak dependency:

- `Add settings page` blocked by `Add profile page` only because both are in the same Epic.

When dependency IDs are unknown during creation, create both Work Items first, then record the edge with:

```bash
tm block "$blocked_id" --by "$dependency_id"
```
