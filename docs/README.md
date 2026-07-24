# Task Manager Guide

This document explains Task Manager. The goal is to make development work durable enough that a person or AI agent can stop, resume, hand off, and audit work without relying on chat history.

The CLI binary is `tm`. The persisted data lives in `.tasks/tasks.jsonl` by default so it can be committed with the repository.

The CLI is non-interactive: use flags and file inputs instead of editor prompts. This keeps the tool scriptable and predictable for AI agents. Actor-aware commands (`claim`, `release`, `complete`, and `cancel`) use `--actor <name>` or the `TM_ACTOR` environment variable.

Commands are `init`, `validate`, `create`, `update`, `set-executor`, `show`, `list`, `next`, `claim`, `release`, `complete`, `cancel`, `delete`, `block`, and `unblock`. Together they support durable planning, recording dependencies, separating agent-executable and human-only work with Executor, selecting and claiming executable work, completing with evidence, safely refining fields, cancelling obsolete real work, filtering lifecycle and Executors, and destructively deleting only accidental records. Run `tm --help` or `tm <command> --help` to confirm the command set in your installed version.

## Why this exists

AI coding agents often have short-lived working memory. They can track TODOs inside one session, but that state disappears when the session ends. This task manager stores the durable version of that state in the repo:

- what work exists,
- why it matters,
- what context an agent needs,
- what order work should happen in,
- who has claimed what work,
- what completed or was cancelled, and
- how completion was verified.

Use it for work that spans sessions, needs handoff, or benefits from a permanent record. Do not use it for trivial one-off scratchpad notes.

## Core concepts

### Ticket

A **Ticket** is any persisted unit of work. Every Ticket has one of three levels:

1. **Epic** — a large top-level initiative.
2. **Task** — a significant executable unit of work.
3. **Subtask** — an atomic step under a Task.

The word **Task** is intentionally reserved for the middle hierarchy level. When speaking generically, use **Ticket**.

### Hierarchy

The hierarchy is limited to three levels:

```text
Epic
└── Task
    └── Subtask
```

Rules:

- Epics cannot have parents.
- Tasks may be standalone or may belong to an Epic.
- Subtasks must belong to a Task.
- Subtasks cannot have children.
- The CLI rejects creates with invalid level/parent combinations.

Standalone Tasks are allowed so small work does not need fake Epics.

### Executor

Every Ticket has an **Executor**:

- `agent` — LLM-executable work. This is the default for new Tickets.
- `human` — work that must not be executed unattended by an LLM, such as decisions, reviews, approvals, credential entry, private/manual checks, or physical-world actions.

Executor is not a lifecycle state, priority, assignment, or claim. It only says which kind of actor may safely execute the Ticket. Parent Executor does not inherit to children and does not gate descendants; each Ticket has its own explicit Executor.

`tm next` defaults to `agent` work only so AI agents do not accidentally receive human-only tasks. Use `tm next --executor human` for the human queue and `tm next --all-executors` to inspect the true frontier regardless of executor.

Commands that could accidentally mutate human-only work require `--allow-human` when the target Ticket, affected subtree, or bypassed human dependency is human-executor. This applies to `claim`, `complete`, `cancel`, `delete`, and `unblock`. The flag is accepted as a harmless no-op for agent-executor work.

### Subject, Description, and Context

Every normal Ticket creation requires:

- **Subject** — a short, plain-text Git-style subject line.
- **Description** — a human-facing Markdown body explaining the requested work.
- **Context** — the Markdown execution packet an AI agent needs to do the work later.

Validated Subject rules:

- non-empty,
- maximum 50 characters,
- no leading or trailing whitespace,
- one line only,
- first letter capitalized,
- no trailing period, and
- no Markdown formatting markers.

Imperative mood is recommended for readability, but it is guidance rather than CLI validation.

Subject and Description can be entered like a Git commit message: the first line is the Subject, then a blank line, then the Description body.

Deterministic Subject rules are hard validation errors.

Context is one Markdown string, not separate fields for files, constraints, acceptance criteria, or implementation notes. If structure is useful, put Markdown headings inside the string.

In JSONL storage this field is named `context` so its purpose is explicit. The CLI uses shorter flags, `--context` and `--context-file`, for ergonomics.

Good Context includes:

- what needs to be done,
- why it is needed,
- relevant files or patterns,
- constraints and decisions already made,
- acceptance criteria, and
- verification expectations.

A Ticket with vague context is hard to resume. The CLI provides explicit escape hatches for quick capture, such as `--allow-empty-description` and `--allow-empty-context`, but empty fields should be intentional.

## Lifecycle

A Ticket in storage has one of three lifecycle states:

- `open`
- `done`
- `cancelled`

The public CLI creates `open` Tickets, can move open Tickets with no open children to `done` using `tm complete`, and can move open Tickets to `cancelled` using `tm cancel`.

There is no `in_progress` state. Active work is represented by a **Claim** instead.

### Done and Result

A Ticket is `done` only when it has a structured **Result**. A Result records completed work, not intentions.

A good Result includes:

- summary of what changed,
- optional details about the implementation,
- important decisions and why they were made,
- verification evidence such as test counts, build output, or manual checks.

Example:

```json
{
  "summary": "Added JWT middleware and login endpoint.",
  "details": "Implemented middleware, login response handling, and route protection.",
  "decisions": ["Used short-lived access tokens plus refresh tokens."],
  "verification": ["pnpm test: 64 passing", "pnpm build: success"],
  "completedAt": "2026-06-15T13:00:00.000Z",
  "completedBy": "codex-auth-session"
}
```

`tm complete` can accept structured flags or a Git-style result message. In result message input, the first line becomes the summary, freeform body text becomes details, `Decisions:` bullets become decisions, and `Verification:` bullets become verification evidence.

Weak Results such as "done" or "should work" are not acceptable because they do not help a future reader understand whether the work was actually verified.

### Cancelled and Cancellation

A Ticket is `cancelled` when real work intentionally stops unfinished. Cancellation is separate from completion: cancelled Tickets were not done, so they store a structured **Cancellation** record instead of a Result.

A Cancellation records:

- reason the work stopped,
- cancellation timestamp, and
- Actor Identity that cancelled it.

Example:

```json
{
  "reason": "No longer needed after the approach changed.",
  "cancelledAt": "2026-06-15T13:00:00.000Z",
  "cancelledBy": "codex-auth-session"
}
```

Use `tm cancel <id> --actor <name> --reason <text>` to cancel an open Ticket. Use `--reason-file <path>` for longer reasons. Parent cancellation previews the open descendants that would also be cancelled and requires `--yes` before mutating storage:

```sh
tm cancel abc123 \
  --actor codex-auth-session \
  --reason "No longer needed after the approach changed"
```

Cascading cancellation applies only to open descendants. Done and already-cancelled descendants are left unchanged. Successful cancellation clears claims on each Ticket it cancels. Cancelling a Ticket with another actor's active claim requires `--force`; expired claims do not require force. Cancelling a human-executor Ticket or a subtree containing human-executor Tickets requires `--allow-human`.

### Delete

`tm delete` is a destructive cleanup command for mistaken, duplicate, or accidental records. Prefer `tm cancel` for real work that is no longer needed, and use `tm release` only when clearing an abandoned claim while leaving unfinished Tickets open.

Because the CLI is non-interactive, destructive deletion requires `--yes` before storage is mutated:

```sh
tm delete abc123 --yes
```

Deleting a human-executor Ticket or subtree requires `--allow-human` in addition to `--yes`.

Running without `--yes` previews the Tickets that would be permanently deleted and exits without mutation. If the selected Ticket has descendants, the entire subtree is deleted together.

Deletion refuses to leave dangling dependencies. If any remaining Ticket depends on a Ticket that would be deleted, first `tm unblock` the dependency, `tm cancel` the dependent Ticket, or include the dependent Ticket in the deleted subtree.

The lifecycle is intentionally one-way: there is no `tm reopen` command.

## Dependencies

A **Dependency** says one Ticket should be completed before another begins.

Dependencies are separate from hierarchy:

- hierarchy means "belongs to",
- dependency means "should happen before".

Dependencies may cross hierarchy boundaries. For example, a Subtask in one Epic may depend on a standalone Task, or a Task in one Epic may depend on a Task in another Epic.

Use repeatable `tm create --blocked-by <dependency-id>` when dependencies are known before creating the blocked Ticket. Use `tm block <id> --by <dependency-id>` to record a dependency after both Tickets already exist, and `tm unblock <id> --by <dependency-id>` when the ordering constraint is no longer needed. IDs may be full IDs or unique prefixes, and storage always keeps the resolved full dependency IDs. Removing a dependency where either side is human-executor requires `tm unblock --allow-human` because it can clear a human gate.

```sh
tm create "Add API endpoint" \
  --level task \
  --blocked-by <model-id> \
  --blocked-by <auth-config-id> \
  --description "Build the endpoint." \
  --context "Use the completed model and auth config."
tm block <api-id> --by <model-id>
tm show <api-id>
tm unblock <api-id> --by <model-id>
```

Dependency enforcement is soft:

- `tm next` skips blocked Tickets by default,
- `tm complete` refuses to complete a blocked Ticket unless `--force` is used,
- `tm complete --force` also requires `--allow-human` when it bypasses an incomplete human-executor dependency,
- self-dependencies, duplicate dependencies, and dependency cycles are invalid.

This prevents accidental order violations while still allowing humans to recover when a dependency becomes obsolete.

## Actor Identity and Claims

An **Actor Identity** is a caller-provided string used for coordination and audit fields. There is no actor registry. A human or AI agent chooses a name and uses it consistently through `--actor` or `TM_ACTOR`.

Actor Identity is required for `claim`, `release`, `complete`, and `cancel` so the task manager can record who coordinated or changed lifecycle state. Humans can use names like `human-urban`.

Good Actor Identity examples:

- `codex-auth-session`
- `claude-refactor-2026-06-15`
- `human-urban`
- `cursor-ui-agent`

Avoid vague names like `agent`, `me`, or `test`.

A **Claim** is an advisory signal that an actor is actively working on a Ticket.

Example idea:

```json
{
  "actor": "codex-session-123",
  "claimedAt": "2026-06-15T14:00:00.000Z",
  "expiresAt": "2026-06-15T15:00:00.000Z"
}
```

Claims are:

- **advisory** — they guide other agents but are not hard locks,
- **lightweight** — just fields in the JSONL record,
- **expiring** — abandoned work does not stay claimed forever.

The default claim window is 1 hour. Actionable leaf Tickets should be scoped to complete within that hour. This is guidance, not CLI validation, because the tool cannot objectively know how long a Ticket will take. If an agent expects the work to take longer, it should split the Ticket before starting or create Subtasks.

`tm next` skips actively claimed Tickets unless `--include-claimed` is used. It is read-only and does not create claims. Agents should explicitly claim work after selecting it.

## Storage

Default layout:

```text
.tasks/
  tasks.jsonl
  lock               # transient advisory write lock, not for Git
```

By default, Task Manager stores data under the nearest Git root. If no Git root is found, it stores data under the working directory or the directory passed with `--cwd` / `TM_CWD`. Use `--storage-path <dir>` or `TM_STORAGE_PATH` to override the `.tasks` directory.

`tasks.jsonl` stores one snapshot per Ticket. It is not an append-only event log. Records use `schemaVersion: 3` and require `executor` and neutral `context` fields; Claim records use `actor`. Older records must be edited manually because the CLI intentionally provides no migration command.

Why snapshots:

- easier for humans and agents to inspect,
- simpler to validate,
- friendlier for Git diffs,
- enough history is available through Git.

## IDs

Ticket IDs are stable, random six-character lowercase base-36 strings. They contain only `a`-`z` and `0`-`9`.

Example:

```text
abc123
```

Storage and public output always use the canonical six-character ID unchanged. CLI commands accept a canonical ID or a shorter unique leading fragment for convenience. ID collisions are resolved during creation and duplicate IDs remain invalid.

## Planning workflow

There is no `tm plan <file>` command. Planning stays explicit: a human or AI agent creates Tickets one at a time with CLI commands.

This means an agent may read a Markdown plan or discuss a plan with you, but it records the Backlog through ordinary commands:

```sh
tm create "Authentication system" \
  --level epic \
  --description "Add first-party authentication." \
  --context "Coordinate user model, login, middleware, and verification work."

tm create "Create user model" \
  --level task \
  --executor agent \
  --parent <epic-id> \
  --description "Create a user model that supports login." \
  --context "Add password hash storage and helper functions. Follow existing schema patterns."

tm create "Add login endpoint" \
  --level task \
  --executor agent \
  --parent <epic-id> \
  --blocked-by <user-model-id> \
  --description "Add POST /auth/login." \
  --context "Accept email/password, verify with bcrypt, return token pair, and test invalid credentials."
```

Why planning stays explicit:

- no second Markdown task language to design,
- no surprising parser behavior,
- no hidden inference from prose,
- easier testing and documentation,
- agents can already translate a plan into explicit CLI mutations.

## Agent skill

This repository includes an agent-facing skill at [`../skills/task-manager/SKILL.md`](../skills/task-manager/SKILL.md). If your coding agent supports skill directories, add or copy the whole [`../skills/task-manager/`](../skills/task-manager/) directory to its configured skills path.

If you are not installing the whole skill folder, ask the agent to read `../skills/task-manager/SKILL.md` before planning or executing task-manager work. The skill teaches conservative CLI use: create Tickets, record dependencies with `tm create --blocked-by` or `tm block`, select work with `tm next`, coordinate with `tm claim`, and complete with strong `tm complete` Results.

## Common workflows

### Create a standalone Task

```sh
tm create "Add JWT authentication" \
  --level task \
  --description "Implement JWT-based authentication for the API." \
  --context "Add login token generation, verification middleware, refresh flow, and tests."
```

Or use Git-style message input:

```sh
tm create \
  --level task \
  --message $'Add JWT authentication\n\nImplement JWT-based authentication for the API.' \
  --context "Add login token generation, verification middleware, refresh flow, and tests."
```

For longer Markdown, keep the Subject and Description together in a message file, and keep Context in a separate context file:

```sh
cat > ticket-message.md <<'EOF'
Add JWT authentication

Implement JWT-based authentication for the API.
EOF

cat > agent-context.md <<'EOF'
## Execution context

Add login token generation, verification middleware, refresh flow, and tests.
EOF

tm create \
  --level task \
  --message-file ./ticket-message.md \
  --context-file ./agent-context.md
```

### Create hierarchy

```sh
tm create "Authentication system" \
  --level epic \
  --description "Add first-party authentication." \
  --context "Coordinate user model, login, middleware, and verification work."

tm create "Implement login endpoint" \
  --level task \
  --parent <epic-id> \
  --description "Add POST /auth/login." \
  --context "Accept email/password, verify with bcrypt, return token pair."
```

### Refine Tickets

Use `tm update <id>` to correct or clarify the text fields on an existing Ticket without manually editing `.tasks/tasks.jsonl`:

```sh
tm update abc123 --subject "Implement login flow"
tm update abc123 --description "Clarify the human-facing request."
tm update abc123 --context-file ./agent-context.md
tm update abc123 --message $'Implement login flow\n\nClarify the requested login behavior.'
tm set-executor abc123 human --allow-human
```

`--message` and `--message-file` follow the same Git-style format as `tm create`: the first line is the Subject, then a blank line, then the Description. Do not combine message input with `--subject` or Description flags (`--description`, `--description-file`). Description and Context cannot be cleared accidentally; pass `--allow-empty-description` or `--allow-empty-context` with the matching empty update when clearing is intentional.

Updates do not change Executor, lifecycle status, dependencies, claims, Result, or Cancellation data. Done and cancelled Tickets can still be updated for typo or context corrections. Use `tm set-executor <id> agent|human` for Executor changes. Any change to or from `human` requires `--allow-human`; setting the current Executor is a no-op and does not change `updatedAt`.

### Record dependencies

```sh
tm create "Add API endpoint" \
  --level task \
  --blocked-by <model-id> \
  --description "Build the endpoint." \
  --context "Use the completed model."
tm block <api-id> --by <model-id>
tm unblock <api-id> --by <model-id>
```

Use repeatable `--blocked-by <id>` during creation when dependency IDs are already known. Use `tm block` for dependencies discovered after creation. Dependencies are independent of hierarchy, so a Ticket can be blocked by any other Ticket as long as the edge does not duplicate an existing dependency, point at itself, or create a cycle.

### Show Ticket details

```sh
tm show abc123
```

`tm show` is an inspection command. In human mode it shows the selected Ticket's status, Executor, parent ID, dependencies, current claim, Description, Context, Result, and Cancellation. In JSON mode it returns the encoded Ticket. Use `tm list --root <id>` when you need a subtree view.

### List the Backlog

```sh
tm list
```

`tm list` shows the complete hierarchy across all lifecycle states and both Executors by default. Use lifecycle and Executor flags when you need a narrower view; `--all` and `--all-executors` remain available as explicit all-value filters:

```sh
tm list --status done
tm list --status cancelled
tm list --all
```

Use `--executor agent`, `--executor human`, or `--all-executors` to filter by Executor. Executor filters compose with lifecycle filters. `--executor` and `--all-executors` cannot be combined:

```sh
tm list --executor human
tm list --status done --executor human
tm list --all --executor human
```

Filtered lists include matching Tickets plus any ancestors needed for hierarchy context. Human output renders roots as `[marker] id: title` and descendants with four-space tree indentation. The markers are `[ ]` for open, `[x]` for done, `[-]` for cancelled, and `[/]` for an open parent containing completed work. JSON tree nodes keep lifecycle `status`, `executor`, and `matchesFilter` fields so scripts can distinguish matching nodes from context-only ancestors.

Use `--root <id>` for a focused subtree view. Root scoping composes with lifecycle and Executor filters:

```sh
tm list --root abc123
tm list --root abc123 --status cancelled
tm list --root abc123 --all
```

`--all` includes open, done, and cancelled Tickets, which is also the lifecycle default. `--status` accepts one lifecycle state per invocation. `--all` and `--status` cannot be combined, but either can compose with `--executor`. In JSON mode, list output keeps the same tree node shape and reflects the selected filters.

### Find work for an agent

```sh
tm next
```

By default this returns the first actionable open agent-executor leaf Ticket in deterministic tree order. Parent Tickets are skipped while they still contain open children; a parent with only done or cancelled children can be returned if it matches the requested Executor.

Human output uses the same detailed Ticket rendering as `tm show`. JSON output includes the encoded Ticket:

```json
{ "ok": true, "ticket": { "id": "abc123" } }
```

When no work is available, human output is:

```text
No actionable Tickets.
```

JSON output is:

```json
{ "ok": true, "reason": "no-actionable-work" }
```

There is no priority field. `tm next` chooses deterministically by hierarchy order, with root Epics before root Tasks and siblings ordered by creation time with ID as a tie-breaker.

Use `--root <id>` to choose the next actionable Ticket inside a specific open Epic, Task, or Subtask subtree:

```sh
tm next --root abc123
```

Use `--executor human` for the next human-only Ticket, or `--all-executors` for the true deterministic frontier regardless of Executor. Executor is a hard filter; `tm next --executor human` does not fall back to agent work. `--executor` and `--all-executors` cannot be combined.

`tm next` is read-only and does not claim the Ticket. It skips actively claimed Tickets by default; use `--include-claimed` to include them in selection. Expired claims do not block selection.

### Claim work

```sh
tm claim abc123 --actor codex-auth-session
```

A claim tells other agents to choose something else unless they intentionally override. Claiming a Ticket already claimed by another active agent requires `--force`. The same agent can refresh its own active claim, and expired claims can be replaced without `--force`. Claiming a human-executor Ticket requires `--allow-human`.

Use `TM_ACTOR` instead of `--actor` when it is more convenient:

```sh
TM_ACTOR=codex-auth-session tm claim abc123
```

Release a claim when abandoning or handing off work:

```sh
tm release abc123 --actor codex-auth-session
```

Releasing another actor's active claim requires `--force`; expired claims can be released by anyone. Completing a Ticket claimed by another active actor also requires `--force`; expired claims do not require `--force`.

### Complete work

```sh
tm complete abc123 \
  --actor codex-auth-session \
  --summary "Added POST /auth/login with bcrypt credential verification." \
  --details "Implemented handler validation, login response handling, and tests." \
  --decision "Used generic 401 response for invalid credentials." \
  --verification "pnpm test: 64 passing" \
  --verification "pnpm build: success"
```

`--decision` and `--verification` may be repeated. `--actor` can be omitted when `TM_ACTOR` is set.

Use either structured result flags or Git-style result message input, not both:

```sh
tm complete abc123 \
  --actor codex-auth-session \
  --result-message $'Add login endpoint verification\n\nImplemented POST /auth/login with bcrypt checks.\n\nDecisions:\n- Return generic 401 for invalid credentials\n\nVerification:\n- pnpm test: 64 passing\n- pnpm build: success'
```

For longer messages, write the same format to a file and pass `--result-message-file <path>`.

Only open Tickets can be completed. Before completing, the CLI rejects open children, incomplete dependencies, and another actor's active claim. Use `--force` only to override incomplete dependencies or another active claim. Completing a human-executor Ticket requires `--allow-human`; forcing past an incomplete human-executor dependency also requires `--allow-human`. Verification evidence is required by default; use the explicit `--allow-no-verification` escape hatch when no verification can be recorded.

### Cancel work

```sh
tm cancel abc123 \
  --actor codex-auth-session \
  --reason "No longer needed after approach changed"
```

Use `--reason-file <path>` for longer reasons. Do not pass both `--reason` and `--reason-file`.

Cancelling a parent with open descendants previews the cascade and fails without mutation unless `--yes` is passed:

```sh
tm cancel epic01 \
  --actor codex-auth-session \
  --reason "Initiative replaced by a different approach" \
  --yes
```

Only open Tickets are cancelled by a cascade. Done and already-cancelled descendants are preserved. Cancelling another actor's active claim requires `--force`; expired claims and claims held by the same actor do not. Cancelling a human-executor Ticket or a cascade containing a human-executor descendant requires `--allow-human`. Successful cancellation clears claims on the cancelled Tickets.

### Delete accidental records

Use deletion only for mistaken, duplicate, or accidental records. Prefer `tm cancel` when a Ticket represented real work that intentionally stopped unfinished.

Preview the destructive operation without mutating storage:

```sh
tm delete abc123
```

Confirm deletion explicitly with `--yes`:

```sh
tm delete abc123 --yes
```

If the deleted Ticket or subtree includes human-executor work, pass `--allow-human` as well.

If the selected Ticket has descendants, the full subtree is deleted. The command refuses to delete a Ticket when any remaining Ticket would still depend on it; unblock, cancel, or delete the dependent Tickets first.

In JSON mode, successful deletion returns the deleted IDs, subjects, and Executors:

```json
{
  "ok": true,
  "deleted": [{ "id": "abc123", "subject": "Accidental Ticket", "executor": "agent" }]
}
```

## CLI scope

The CLI supports:

- local JSONL storage,
- non-interactive CLI input through flags and files,
- Ticket creation, Executor, safe field updates, validation, inspection, and filtered backlog listing,
- hierarchy validation for Epics, Tasks, and Subtasks,
- dependencies through repeatable `tm create --blocked-by`, `tm block`, and `tm unblock`,
- deterministic work selection through `tm next`,
- advisory Claims through `tm claim` and `tm release`,
- structured completion through `tm complete`,
- structured cancellation through `tm cancel`, and
- destructive accidental-record cleanup through `tm delete`.

Task Manager is local and repository-backed. It does not include `tm reopen` or external GitHub/Shortcut/Linear sync.
