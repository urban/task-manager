# Task Manager

A local-first CLI task manager for durable development work, designed for people and AI coding agents.

Task Manager stores rich, hierarchical Work Items in a Git-friendly `.tasks/tasks.jsonl` file so work can survive chat sessions, be reviewed in diffs, and be resumed by another agent without reconstructing context from memory.

## Why this exists

AI coding agents are good at keeping an in-session TODO list, but that state usually disappears when the session ends. This project makes the durable parts of development work explicit:

- what work exists,
- why it matters,
- what context an agent needs to execute it,
- how Work Items relate to one another, and
- what evidence proved completed work was actually done.

Task Manager is an offline, repository-backed workflow for planning, handoff, and auditability.

## Current status

The public MVP product name is Task Manager, and the CLI binary is `tm`.

Implemented today:

- initialize and validate local JSONL storage,
- create Epics, Tasks, and Subtasks,
- require Description and Agent Context by default,
- validate Git-style Subjects,
- enforce the three-level hierarchy (`Epic -> Task -> Subtask`),
- show a Work Item by full ID or unique prefix,
- list the open backlog tree,
- emit JSON output with `--json`, and
- perform atomic writes with a transient lock file.

Planned but not fully implemented yet: dependencies, `tm next`, agent claims, completion Results, cancellation, update, move, delete, and external issue sync.

## Core concepts

- **Work Item**: any persisted unit of work.
- **Epic**: top-level container for larger work.
- **Task**: significant executable work; may be standalone or under an Epic.
- **Subtask**: atomic step under a Task.
- **Subject**: short, scannable title using Git-style subject-line rules.
- **Description**: human-facing Markdown explaining the requested work.
- **Agent Context**: execution handoff context for an AI agent.
- **Result**: planned completion record with summary, decisions, and verification evidence.

See [`CONTEXT.md`](./CONTEXT.md) for the project vocabulary and [`docs/README.md`](./docs/README.md) for the longer user guide.

## Quick start

Requires [Bun](https://bun.sh/).

```sh
git clone <this-repo>
cd task-manager
bun install
```

Run the development CLI directly:

```sh
bun packages/cli/src/bin.ts --help
```

Initialize task storage in the current Git repository:

```sh
bun packages/cli/src/bin.ts init
```

Create a standalone Task:

```sh
bun packages/cli/src/bin.ts create "Add JWT authentication" \
  --level task \
  --description "Implement JWT-based authentication for the API." \
  --context "Add login token generation, verification middleware, refresh flow, and tests."
```

Create an Epic and a child Task:

```sh
bun packages/cli/src/bin.ts create "Ship MVP CLI" \
  --level epic \
  --description "Deliver the first offline CLI." \
  --context "Coordinate storage, rendering, validation, and command behavior."

bun packages/cli/src/bin.ts create "Implement task listing" \
  --level task \
  --parent wi_... \
  --description "Render the open backlog tree." \
  --context "Follow existing renderer output and include JSON mode."
```

Inspect the backlog:

```sh
bun packages/cli/src/bin.ts list
bun packages/cli/src/bin.ts show wi_...
bun packages/cli/src/bin.ts validate --json
```

## Storage model

By default, Task Manager stores data at the Git root:

```text
.tasks/
  tasks.jsonl
  lock          # transient; not for Git
```

`tasks.jsonl` stores one current snapshot per Work Item. It is intended to be readable, diffable, and safe to commit when the task state should travel with the repository.

You can override storage with:

```sh
TM_STORAGE_PATH=/custom/path/.tasks bun packages/cli/src/bin.ts list
bun packages/cli/src/bin.ts --storage-path /custom/path/.tasks list
```

## Development

Common commands:

```sh
bun run check      # lint, typecheck, and test
bun run format     # format with oxfmt
bun run lint       # oxfmt + oxlint
bun run typecheck  # Effect-aware TypeScript-Go project build
bun run test       # Vitest tests
```

Project layout:

```text
packages/cli/      Effect + Bun CLI implementation
docs/              Human guide and product decisions
specs/             PRD and planning artifacts
CONTEXT.md         Domain language
TODO.md            Near-term implementation notes
```

## Design notes

Task Manager is intentionally:

- **local-first**: no network is required for core workflows,
- **Git-native**: `.tasks/tasks.jsonl` should produce useful diffs,
- **agent-friendly**: commands are non-interactive and support JSON output,
- **context-rich**: work creation separates human Description from Agent Context, and
- **strictly scoped**: the hierarchy is limited to Epic, Task, and Subtask.

For detailed rationale, read [`docs/decisions.md`](./docs/decisions.md).
