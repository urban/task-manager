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

## Current implementation

The CLI binary is `tm`.

Available commands:

- `tm init`: initialize `.tasks/tasks.jsonl` storage.
- `tm validate`: validate the JSONL store on disk.
- `tm create`: create an Epic, Task, or Subtask with Description and Agent Context.
- `tm update`: safely update a Work Item's Subject, Description, or Agent Context.
- `tm show`: show one Work Item by full ID or unique ID prefix.
- `tm list`: list the open backlog tree, optionally scoped with `--root <id>`.
- `tm next`: select the first actionable open leaf Work Item in deterministic tree order; it skips Work Items with incomplete dependencies and skips active claims unless scoped with `--root <id>` or run with `--include-claimed`.
- `tm claim` and `tm release`: manage one-hour advisory Agent Claims using `--agent <name>` or `TM_AGENT`.
- `tm complete`: mark an open Work Item done with a structured Result; verification evidence is required unless `--allow-no-verification` is passed.
- `tm block` and `tm unblock`: add or remove dependency relationships between Work Items.

Shared flags:

- `--json`: emit machine-readable JSON.
- `--cwd <dir>` or `TM_CWD`: resolve storage from a specific working directory.
- `--storage-path <dir>` or `TM_STORAGE_PATH`: use a custom `.tasks` directory.

Writes are guarded by a transient lock file and persisted by writing a temporary file, then renaming it into place.

## Core concepts

- **Work Item**: any persisted unit of work.
- **Epic**: top-level container for larger work.
- **Task**: significant executable work; may be standalone or under an Epic.
- **Subtask**: atomic step under a Task.
- **Subject**: short, scannable title using Git-style subject-line rules.
- **Description**: human-facing Markdown explaining the requested work.
- **Agent Context**: execution handoff context for an AI agent.
- **Dependency**: an ordering relationship where one Work Item is blocked by another.
- **Agent Claim**: advisory one-hour claim that helps agents avoid duplicate work.
- **Result**: completion record with summary, details, decisions, verification evidence, timestamp, and Agent Identity.

See [`CONTEXT.md`](./CONTEXT.md) for the project vocabulary.

## Quick start

Requires [Bun](https://bun.sh/).

```sh
git clone <this-repo>
cd task-manager
bun install
```

### Put `tm` on your PATH

Register the CLI package with Bun. This creates a `tm` executable in Bun's global bin directory:

```sh
(cd packages/cli && bun link)
```

Make sure Bun's global bin directory is on your `PATH`. For the current shell:

```sh
BUN_GLOBAL_BIN="$(bun pm bin -g)"
export PATH="$BUN_GLOBAL_BIN:$PATH"
```

To make it persistent, add the same directory to your shell profile. For zsh:

```sh
BUN_GLOBAL_BIN="$(bun pm bin -g)"
printf '\nexport PATH="%s:$PATH"\n' "$BUN_GLOBAL_BIN" >> ~/.zshrc
```

For bash, use `~/.bashrc` instead of `~/.zshrc`.

Verify that `tm` is globally available:

```sh
command -v tm
tm --help
```

All examples below assume `tm` is on your `PATH`.

### Use with an AI coding agent

This repo includes an agent skill at [`skills/task-manager/SKILL.md`](./skills/task-manager/SKILL.md). If your coding agent supports skill folders, add or copy the whole [`skills/task-manager/`](./skills/task-manager/) directory to its configured skills path.

If your agent does not have a formal skill system, ask it to read `skills/task-manager/SKILL.md` before doing task-manager work. The skill teaches agents how to plan durable Work Items from PRDs/specs, record dependencies with `tm block`, select work with `tm next`, coordinate with `tm claim`, and complete work with structured verification evidence through `tm complete`.

Initialize task storage in the current Git repository:

```sh
tm init
```

Create a standalone Task:

```sh
tm create "Add JWT authentication" \
  --level task \
  --description "Implement JWT-based authentication for the API." \
  --context "Add login token generation, verification middleware, refresh flow, and tests."
```

Create an Epic and a child Task:

```sh
tm create "Ship MVP CLI" \
  --level epic \
  --description "Deliver the first offline CLI." \
  --context "Coordinate storage, rendering, validation, and command behavior."

tm create "Implement task listing" \
  --level task \
  --parent wi_... \
  --description "Render the open backlog tree." \
  --context "Follow existing renderer output and include JSON mode."
```

Record an ordering dependency and inspect the backlog:

```sh
tm block wi_api... --by wi_model...
tm update wi_api... --message $'Refine API work\n\nClarify the requested API behavior.'
tm show wi_api...
tm unblock wi_api... --by wi_model...
tm list
tm next
tm claim wi_api... --agent codex-session
tm complete wi_api... \
  --agent codex-session \
  --summary "Implemented API endpoint" \
  --verification "bun run check: passed"
tm next --include-claimed --json
tm release wi_api... --agent codex-session
tm validate --json
```

## Storage model

By default, Task Manager stores data under the nearest Git root. If no Git root is found, it stores data under the current working directory or the directory passed with `--cwd` / `TM_CWD`:

```text
.tasks/
  tasks.jsonl
  lock          # transient; not for Git
```

`tasks.jsonl` stores one current snapshot per Work Item. It is intended to be readable, diffable, and safe to commit when the task state should travel with the repository.

You can override storage with:

```sh
TM_STORAGE_PATH=/custom/path/.tasks tm list
tm --storage-path /custom/path/.tasks list
```

## Design notes

Task Manager is intentionally:

- **local-first**: no network is required for core workflows,
- **Git-native**: `.tasks/tasks.jsonl` should produce useful diffs,
- **agent-friendly**: commands are non-interactive and support JSON output,
- **context-rich**: work creation separates human Description from Agent Context, and
- **strictly scoped**: the hierarchy is limited to Epic, Task, and Subtask.

Run `tm --help` or `tm <command> --help` for generated command help from the current CLI.
