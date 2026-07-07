---
name: task-manager
description: "Use when managing tm CLI Work Items: create, update, list, show, select, claim, release, complete, cancel, delete, block, and unblock local Work Items from specs, plans, or direct requests."
---

# Task Manager

Task Manager is the product name; `tm` is the CLI. Use it as the source of truth for durable, local-first Work Items.

## Rules

- Use `tm` commands for all state changes; do not manually edit `.tasks/tasks.jsonl` unless the user explicitly asks for low-level recovery.
- Run `command -v tm >/dev/null` before `tm` work. Run `command -v jq >/dev/null` before parsing `--json` output.
- Prefer `--json` whenever you need an ID or machine-readable state; capture IDs from `.item.id` with `jq`.
- Create hierarchy parent-before-child with `--parent`; record ordering with `--blocked-by` or `tm block`, not Markdown prose.
- Use `tm update` for text corrections, `tm release` when abandoning claimed work, `tm cancel` for real work that should stop, and `tm delete --yes` only for accidental records.
- Use `--force`, `--allow-no-verification`, destructive delete, or manual storage recovery only after explicit user approval.
- If command behavior is uncertain, verify with `tm <command> --help`; do not invent flags or fallback storage edits.

## Constraints

- Work Item levels are exactly `epic`, `task`, and `subtask`.
- Subjects must be non-empty, 50 characters or fewer, one line, start with a capital letter, have no surrounding whitespace, have no trailing period, and avoid Markdown markers `*`, `_`, `` ` ``, `#`, `[`, `]`.
- Description is human-facing Markdown. Agent Context is execution-focused Markdown for future agents. Result is structured completion evidence recorded by `tm complete`.
- Dependencies require existing Work Item IDs or unique prefixes. Prefer full IDs captured from JSON output when creating or modifying dependencies.
- Agent identity comes from `--agent <name>` or `TM_AGENT`; reuse the same identity for claim, release, complete, or cancel.

## Requirements

Determine the user intent before running commands:

| Intent                                                                 | Use this path                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| User gives concrete Work Items and says create/add/record them         | Direct create; ask only about missing high-impact fields                |
| User gives a PRD, spec, plan, or conversation to decompose             | Plan from source; draft hierarchy and wait for approval before creation |
| User says continue, pick next, work from tm, or complete backlog work  | Execute backlog                                                         |
| User asks to inspect, edit, release, cancel, delete, block, or unblock | Manage backlog                                                          |

State-changing paths need a target task store. Use the current directory by default, or pass `--cwd <directory>` / `--storage-path <directory>` when the user specifies another store.

## Workflow

### 1. Preflight

```bash
command -v tm >/dev/null
command -v jq >/dev/null
```

If either command required for the path is missing, stop and tell the user. For creates or other state changes, initialize and validate first:

```bash
tm init
tm validate
```

For read-only work, run `tm validate` before selecting or inspecting existing Work Items.

### 2. Command inventory

| Need                        | Command                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Initialize storage          | `tm init`                                                          |
| Validate storage            | `tm validate`                                                      |
| Create Work Item            | `tm create [<subject>] --level <level> ...`                        |
| Update text fields          | `tm update <id> ...`                                               |
| Show one item               | `tm show <id>`                                                     |
| List tree                   | `tm list [--root <id>] [--status <status>] [--all]`                |
| Select next actionable item | `tm next [--root <id>] [--include-claimed]`                        |
| Claim work                  | `tm claim <id> --agent <name>`                                     |
| Release claim               | `tm release <id> --agent <name>`                                   |
| Complete work               | `tm complete <id> --agent <name> --summary ... --verification ...` |
| Cancel real work            | `tm cancel <id> --agent <name> --reason ... [--yes]`               |
| Delete accidental work      | `tm delete <id> --yes`                                             |
| Add dependency              | `tm block <blocked-id> --by <dependency-id>`                       |
| Remove dependency           | `tm unblock <blocked-id> --by <dependency-id>`                     |

Read [`references/cli-reference.md`](./references/cli-reference.md) when you need exact flags, JSON options, list/next filters, or destructive command details.

### 3. Direct create fast path

Use this when the user supplied concrete Work Items and wants them created now. Do not spend tokens drafting a separate approval plan unless fields, hierarchy, or dependencies are ambiguous.

Create parent items first, capture IDs, then create children and dependencies:

```bash
created_json="$(tm create "Add login flow" \
  --level task \
  --description "Implement the first end-to-end login slice." \
  --context $'## Source\n\nDerived from the user request.\n\n## Verification expectations\n\n- Run bun run check.' \
  --json)"
created_id="$(printf '%s\n' "$created_json" | jq -r '.item.id')"
```

Use repeatable `--blocked-by <id>` only when dependency IDs already exist; otherwise create the items and then run `tm block`. After creation, run:

```bash
tm validate
tm list
```

Read [`references/create-work-items.md`](./references/create-work-items.md) when creating multiple items, using message files, building parent/child ID maps, or writing Description and Agent Context.

### 4. Plan from source path

Use this when converting a PRD/spec/plan/conversation into a backlog. Read the source, draft a vertical-slice hierarchy, show dependencies, and wait for user approval before running `tm create`. After approval, follow the Direct create fast path.

Read [`references/plan-from-spec.md`](./references/plan-from-spec.md) for the drafting shape, approval gate, traceability, and vertical-slice rules.

### 5. Execute backlog path

```bash
next_json="$(tm next --json)"
next_id="$(printf '%s\n' "$next_json" | jq -r '.item.id // empty')"
```

If `next_id` is empty, report `.reason // "no-actionable-work"` and stop. Otherwise:

1. `tm show <id>` and read Description, Agent Context, dependencies, claim, and status.
2. `tm claim <id> --agent <agent-name>`.
3. Implement the Work Item.
4. Run the requested verification command. In this repository, normally run `bun run check` unless the Work Item says otherwise.
5. Complete with concrete evidence:

```bash
tm complete <id> \
  --agent <agent-name> \
  --summary "Describe the concrete change" \
  --verification "bun run check: passed"
```

If you stop before completion, release the claim with `tm release <id> --agent <agent-name>`.

Read [`references/execute-backlog.md`](./references/execute-backlog.md) when selecting under a root, handling claimed work, completing with decisions/details, or reporting execution evidence.

### 6. Manage backlog path

Use the narrow command that matches the request:

- inspect with `tm list`, `tm list --all`, `tm list --status <status>`, or `tm show <id>`
- revise text with `tm update <id>`
- add/remove dependencies with `tm block` / `tm unblock`
- release stale claims with `tm release`
- cancel obsolete real work with `tm cancel`
- delete accidental records with `tm delete --yes`

Read [`references/recovery-and-maintenance.md`](./references/recovery-and-maintenance.md) when managing existing items, handling command failures, or choosing between release, cancel, delete, and low-level recovery.

## Gotchas

- Agents often over-plan explicit create requests. If the user already gave concrete Work Items and asked to create them, run the direct create path and ask only about ambiguous hierarchy or dependencies.
- Dependency prose in Description or Agent Context is not enforced. Always record real ordering with `--blocked-by` or `tm block`.
- Inferring IDs from subjects creates wrong edges when subjects change or collide. Capture `.item.id` from `tm create --json` and use that ID map.
- Starting work without `tm claim` hides concurrency conflicts; abandoning claimed work without `tm release` blocks other agents until expiry.
- `tm complete` with vague verification damages handoff. Record the exact command and outcome, or ask before using `--allow-no-verification`.
- `tm cancel` and `tm delete` solve different problems. Cancel obsolete real work; delete only mistaken records.
- Large inline Markdown can break shell quoting. Use `--message-file`, `--description-file`, or `--context-file` for large content.
- Manual JSONL edits bypass validation and can corrupt the task store. Use CLI recovery first; edit storage only when the user explicitly requests low-level repair.

## Deliverables

- For creation/planning: report created IDs, subjects, hierarchy, recorded dependencies, and `tm validate` result.
- For execution: report completed Work Item ID and Subject, Result summary, verification evidence, and final `tm validate` result.
- For management: report the command outcome, affected Work Item IDs, and validation status after state changes.
- Every created Work Item should include useful Description, Agent Context, and source traceability when the source is a spec, plan, file, or conversation.

## References

- [`references/cli-reference.md`](./references/cli-reference.md): Read when: you need the complete command/flag surface or global `--cwd`, `--storage-path`, `--json`, completions, or log-level options.
- [`references/create-work-items.md`](./references/create-work-items.md): Read when: creating direct or bulk Work Items, capturing IDs, writing content, setting parents, or adding dependencies.
- [`references/plan-from-spec.md`](./references/plan-from-spec.md): Read when: decomposing a PRD/spec/plan/conversation into an approved backlog before creation.
- [`references/execute-backlog.md`](./references/execute-backlog.md): Read when: selecting, claiming, implementing, releasing, or completing backlog work.
- [`references/recovery-and-maintenance.md`](./references/recovery-and-maintenance.md): Read when: listing, showing, updating, blocking, unblocking, cancelling, deleting, releasing claims, or recovering from command failures.
