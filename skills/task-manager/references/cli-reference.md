# tm CLI Reference

Read this when you need exact command names, flags, filters, or global options. Prefer `tm <command> --help` if the installed CLI may differ.

## Global shape

```bash
tm <subcommand> [flags]
```

Common flags accepted by commands:

| Flag                         | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `--cwd <directory>`          | Resolve storage relative to a directory |
| `--storage-path <directory>` | Use a custom `.tasks` directory         |
| `--json`                     | Emit machine-readable JSON              |

Global flags:

- `--help`, `-h`: show help.
- `--version`: show version.
- `--completions <shell>`: print shell completions. Choices: `bash`, `zsh`, `fish`, `sh`.
- `--log-level <level>`: set minimum log level. Choices: `all`, `trace`, `debug`, `info`, `warn`, `warning`, `error`, `fatal`, `none`.

## Commands

- `tm init`: initialize storage. Uses common flags.
- `tm validate`: validate storage. Uses common flags.
- `tm create [<subject>]`: create a Work Item. Key flags: `--level epic|task|subtask`, `--mode agent|human`, `--parent <id>`, `--blocked-by <id>`, `--description`, `--description-file`, `--context`, `--context-file`, `--message`, `--message-file`, `--allow-empty-description`, `--allow-empty-context`.
- `tm update <id>`: update Subject, Description, Agent Context, or Execution Mode. Key flags: `--subject`, `--description`, `--description-file`, `--context`, `--context-file`, `--message`, `--message-file`, `--mode agent|human`, `--allow-empty-description`, `--allow-empty-context`.
- `tm show <id>`: show one Work Item. Uses common flags.
- `tm list`: list Work Items. Key flags: `--root <id>`, `--status open|done|cancelled`, `--all`, `--mode agent|human|any`.
- `tm next`: select the next actionable Work Item. Key flags: `--root <id>`, `--include-claimed`, `--mode agent|human|any`.
- `tm claim <id>`: claim an open Work Item. Key flags: `--agent <name>`, `--force`, `--allow-human`.
- `tm release <id>`: release an Agent Claim. Key flags: `--agent <name>`, `--force`.
- `tm complete <id>`: complete an open Work Item. Key flags: `--agent <name>`, `--summary`, `--details`, repeatable `--decision`, repeatable `--verification`, `--result-message`, `--result-message-file`, `--allow-no-verification`, `--force`, `--allow-human`.
- `tm cancel <id>`: cancel open Work Items. Key flags: `--reason`, `--reason-file`, `--agent <name>`, `--force`, `--yes`, `--allow-human`.
- `tm delete <id>`: delete accidental Work Items and descendants. Key flags: `--yes`, `--allow-human`.
- `tm block <id>`: add a dependency to a Work Item. Key flag: `--by <dependency-id>`.
- `tm unblock <id>`: remove a dependency from a Work Item. Key flags: `--by <dependency-id>`, `--allow-human`.

## JSON fields to rely on

Common successful state-changing commands return an object with `ok: true` and often `.item`.

Useful selectors:

```bash
jq -r '.item.id'
jq -r '.item.subject'
jq -r '.item.status'
jq -r '.item.executionMode'
jq -r '.reason // empty'
```

`tm next --json` returns `.item` when actionable work exists. If no work is available, `.item` is absent and `.reason` is usually `no-actionable-work`. `tm delete --json` returns `.deleted[]` objects with `id`, `subject`, and `executionMode`.

## Command-specific notes

- `tm create --message` and `tm update --message` use the first line as Subject, then a blank line, then Description.
- `tm create --mode` defaults to `agent`; pass `--mode human` only for human-required decisions, reviews, approvals, credential entry, private/manual checks, or other HITL work.
- Do not combine `--message` / `--message-file` with explicit `--subject` or Description flags on `tm update`.
- `--blocked-by` on `tm create` can be repeated when multiple already-known dependencies block the new Work Item.
- `tm block <blocked-id> --by <dependency-id>` adds an ordering edge after both items exist.
- `tm unblock <blocked-id> --by <dependency-id>` removes an existing edge.
- `tm list` defaults to open Work Items across all modes. Use `--all` to include done and cancelled items. Use `--mode human|agent|any` for execution-mode filtering.
- `tm next` defaults to `--mode agent`. Use `--mode human` for HITL work and `--mode any` for the frontier across both modes.
- `tm next --include-claimed` includes actively claimed Work Items; do not use it to bypass another agent unless the user intends that.
- `--allow-human` is required to claim, complete, cancel, delete, unblock, or force past human-mode Work Items/gates; use it only with explicit user approval.
- `tm claim --force`, `tm release --force`, `tm complete --force`, and `tm cancel --force` require explicit user approval.
