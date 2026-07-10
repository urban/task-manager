# Task Manager

A local-first CLI task manager for durable development work, designed for people and AI coding agents.

Task Manager stores rich, hierarchical Work Items in a Git-friendly `.tasks/tasks.jsonl` file so work can survive chat sessions, be reviewed in diffs, and be resumed by another agent without reconstructing context from memory.

## Why this exists

AI coding agents are good at keeping an in-session TODO list, but that state usually disappears when the session ends. This project makes the durable parts of development work explicit:

- what work exists,
- why it matters,
- what context an agent needs to execute it,
- how Work Items relate through hierarchy and dependencies,
- who has currently claimed work,
- which work completed or was cancelled, and
- what evidence proved completed work was actually done.

One key differentiator is **Executor**. Each Work Item records whether it is `agent` work that an LLM can execute directly or `human` work that requires human-in-the-loop (HITL) handling such as review, approval, credentials, or manual action. That keeps mixed human/agent backlogs honest: agents can filter for executable work, while work that truly needs a person stays explicit instead of being rediscovered only after an agent gets stuck.

Task Manager is an offline, repository-backed workflow for planning, handoff, and auditability.

## CLI

The CLI binary is `tm`.

Available commands:

- `tm init`: initialize `.tasks/tasks.jsonl` storage.
- `tm validate`: validate the JSONL store on disk.
- `tm create`: create an Epic, Task, or Subtask with Description, Context, Executor, and optional repeatable `--blocked-by <id>` dependencies.
- `tm update`: safely update a Work Item's Subject, Description, or Context.
- `tm set-executor`: change a Work Item's Executor; changes to or from `human` require `--allow-human`.
- `tm show`: show one Work Item by full ID or unique ID prefix.
- `tm list`: list open agent-executor work by default, optionally scoped with `--root <id>`, filtered by lifecycle (`--status done`, `--status cancelled`, `--all`) or Executor (`--executor agent|human`), or expanded with `--all-executors`.
- `tm next`: select the first actionable open agent-executor leaf Work Item in deterministic tree order, optionally scoped with `--root <id>`, filtered with `--executor human`, or expanded with `--all-executors`; it skips Work Items with incomplete dependencies and active claims unless run with `--include-claimed`.
- `tm claim` and `tm release`: manage one-hour advisory Claims using `--actor <name>` or `TM_ACTOR`.
- `tm complete`: mark an open Work Item done with a structured Result; verification evidence is required unless `--allow-no-verification` is passed.
- `tm cancel`: mark open Work Items cancelled with a structured Cancellation reason; parent cancellation cascades to open descendants only with `--yes`.
- `tm delete`: destructively delete accidental Work Items and their descendants with `--yes`, refusing to leave dangling dependencies.
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
- **Context**: execution handoff context for an AI agent.
- **Executor**: `agent` for LLM-executable work or `human` for work requiring human action, review, approval, credentials, or other HITL handling.
- **Dependency**: an ordering relationship where one Work Item is blocked by another.
- **Claim**: advisory one-hour claim that helps agents avoid duplicate work.
- **Result**: completion record with summary, details, decisions, verification evidence, timestamp, and Actor Identity.
- **Cancellation**: cancellation record with reason, timestamp, and Actor Identity for real work that intentionally stopped unfinished.

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

If you are not installing the whole skill folder, ask the agent to read `skills/task-manager/SKILL.md` before doing task-manager work. The skill teaches agents how to plan durable Work Items from PRDs/specs, record dependencies with `tm create --blocked-by` or `tm block`, separate agent and human work with `--executor`, select agent work with `tm next`, coordinate with `tm claim`, and complete work with structured verification evidence through `tm complete`.

#### Prompt workflows

Use these prompts as starting points when asking an AI coding agent to use `tm`.

Quick creation from an explicit list:

```text
Use the task-manager skill. Create these Work Items now with tm, without drafting a separate approval plan unless something is ambiguous:

1. Add login form
2. Validate login credentials
3. Add login integration tests

Make them Tasks under an Epic called “Add authentication”. Run tm validate before and after.
```

Plan a backlog from a PRD or spec:

```text
Use the task-manager skill. Turn this spec into tm Work Items.

Draft the hierarchy first and wait for my approval before creating anything. Prefer vertical slices. Include dependencies only when ordering is real.
```

Create dependent Work Items:

```text
Use the task-manager skill. Create this backlog with dependencies:

Epic: Improve task selection
- Task: Add root filtering
- Task: Add claimed-item filtering, blocked by Add root filtering
- Task: Add JSON tests, blocked by both previous tasks

Use tm create --json, capture IDs with jq, then add dependency edges with tm block if needed.
```

Execute the next actionable Work Item:

```text
Use the task-manager skill. Pick the next actionable agent-executor Work Item with tm next --json, claim it as agent “pi”, implement it, run bun run check, then complete it with a detailed Result.
```

Work under a specific root:

```text
Use the task-manager skill. Continue the next actionable Work Item under root <id>. Use tm next --root <id> --json.
```

Release, cancel, or delete Work Items:

```text
Use the task-manager skill. Release my claim on Work Item <id> as agent “pi”. Validate afterward.
```

```text
Use the task-manager skill. Cancel Work Item <id> because it is obsolete. Use a structured reason and validate afterward.
```

```text
Use the task-manager skill. Delete Work Item <id> because it was created accidentally. Confirm with --yes and validate afterward.
```

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
tm create "Ship offline CLI" \
  --level epic \
  --description "Deliver the offline CLI." \
  --context "Coordinate storage, rendering, validation, and command behavior."

tm create "Implement task listing" \
  --level task \
  --parent wi_... \
  --description "Render the open backlog tree." \
  --context "Follow existing renderer output and include JSON mode."
```

Record dependencies and refine text fields without editing storage by hand:

```sh
# When the dependency is known before creation:
tm create "Implement API endpoint" \
  --level task \
  --executor agent \
  --blocked-by wi_model... \
  --description "Build the endpoint after the model work." \
  --context "Use the completed data model and verify the endpoint."

# Or when both Work Items already exist:
tm block wi_api... --by wi_model...
tm update wi_api... --message $'Refine API work\n\nClarify the requested API behavior.'
tm set-executor wi_api... human --allow-human
tm show wi_api...
tm unblock wi_api... --by wi_model... --allow-human
```

Select, claim, and complete executable work:

```sh
tm list
tm list --executor human
tm next
tm next --executor human
tm claim wi_api... --actor codex-session
tm complete wi_api... \
  --actor codex-session \
  --summary "Implemented API endpoint" \
  --verification "bun run check: passed"

# If claimed work is abandoned before completion, release it instead:
tm release wi_other... --actor codex-session
```

Inspect lifecycle states, cancel obsolete real work, and delete accidental records only when needed:

```sh
tm list --status done
tm cancel wi_obsolete... \
  --actor codex-session \
  --reason "No longer needed after approach changed" \
  --yes
tm list --status cancelled

# Destructive cleanup for mistaken records, not real work:
tm delete wi_duplicate... --yes

tm next --include-claimed --json
tm validate --json
```

Human-executor Work Items require explicit `--allow-human` on risky mutations such as `claim`, `complete`, `cancel`, `delete`, and `unblock`. `tm list` and `tm next` default to agent-executor work; use `--executor human` for the human queue or `--all-executors` for a view across both Executors.

## Storage model

By default, Task Manager stores data under the nearest Git root. If no Git root is found, it stores data under the current working directory or the directory passed with `--cwd` / `TM_CWD`:

```text
.tasks/
  tasks.jsonl
  lock          # transient; not for Git
```

`tasks.jsonl` stores one snapshot per Work Item. Schema v3 records use `executor`, neutral `context`, and `claim.actor`. Older records must be edited manually; this breaking release intentionally provides no migration command. The file is intended to be readable, diffable, and safe to commit when the task state should travel with the repository.

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
- **context-rich**: work creation separates human Description from Context, and
- **strictly scoped**: the hierarchy is limited to Epic, Task, and Subtask.

Run `tm --help` or `tm <command> --help` for generated command help from the CLI.
