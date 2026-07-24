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
- `tm create [<subject>]`: create a Ticket. Key flags: `--level epic|task|subtask`, `--executor agent|human`, `--parent <id>`, `--blocked-by <id>`, `--description`, `--description-file`, `--context`, `--context-file`, `--message`, `--message-file`, `--allow-empty-description`, `--allow-empty-context`.
- `tm update <id>`: update Subject, Description, or Context. Key flags: `--subject`, `--description`, `--description-file`, `--context`, `--context-file`, `--message`, `--message-file`, `--allow-empty-description`, `--allow-empty-context`.
- `tm set-executor <id> agent|human`: change Executor. Key flag: `--allow-human`, required for changes to or from `human`.
- `tm show <id>`: show one Ticket. Uses common flags.
- `tm list`: list Tickets. Key flags: `--root <id>`, `--status open|done|cancelled`, `--all`, `--executor agent|human`, `--all-executors`.
- `tm next`: select the next actionable Ticket. Key flags: `--root <id>`, `--include-claimed`, `--executor agent|human`, `--all-executors`.
- `tm claim <id>`: claim an open Ticket. Key flags: `--actor <name>`, `--force`, `--allow-human`.
- `tm release <id>`: release a Claim. Key flags: `--actor <name>`, `--force`.
- `tm complete <id>`: complete an open Ticket. Key flags: `--actor <name>`, `--summary`, `--details`, repeatable `--decision`, repeatable `--verification`, `--result-message`, `--result-message-file`, `--allow-no-verification`, `--force`, `--allow-human`.
- `tm cancel <id>`: cancel open Tickets. Key flags: `--reason`, `--reason-file`, `--actor <name>`, `--force`, `--yes`, `--allow-human`.
- `tm delete <id>`: delete accidental Tickets and descendants. Key flags: `--yes`, `--allow-human`.
- `tm block <id>`: add a dependency to a Ticket. Key flag: `--by <dependency-id>`.
- `tm unblock <id>`: remove a dependency from a Ticket. Key flags: `--by <dependency-id>`, `--allow-human`.

## JSON fields to rely on

Common successful state-changing commands return an object with `ok: true` and often `.ticket`.

Useful selectors:

```bash
jq -r '.ticket.id'
jq -r '.ticket.subject'
jq -r '.ticket.status'
jq -r '.ticket.executor'
jq -r '.reason // empty'
```

`tm next --json` returns `.ticket` when actionable work exists. If no work is available, `.ticket` is absent and `.reason` is usually `no-actionable-work`. `tm delete --json` returns `.deleted[]` objects with `id`, `subject`, and `executor`.

## Command-specific notes

- Canonical Ticket IDs are six-character lowercase alphanumeric strings. Commands emit full canonical IDs and accept a full ID or unique prefix as an ID argument.
- `tm create --message` and `tm update --message` use the first line as Subject, then a blank line, then Description.
- `tm create --executor` defaults to `agent`; pass `--executor human` only for human-required decisions, reviews, approvals, credential entry, private/manual checks, or other HITL work.
- Do not combine `--message` / `--message-file` with explicit `--subject` or Description flags on `tm update`.
- `--blocked-by` on `tm create` can be repeated when multiple already-known dependencies block the new Ticket.
- `tm block <blocked-id> --by <dependency-id>` adds an ordering edge after both tickets exist.
- `tm unblock <blocked-id> --by <dependency-id>` removes an existing edge.
- Plain `tm list` includes open, done, and cancelled Tickets across both Executors. Use `--status` or `--executor` for a narrower view; `--all` and `--all-executors` remain explicit all-value filters.
- `tm next` defaults to open agent-executor work. Use `--executor human` for HITL work and `--all-executors` for the actionable frontier across both Executors.
- `--executor` and `--all-executors` cannot be combined.
- `tm next --include-claimed` includes actively claimed Tickets; do not use it to bypass another actor unless the user intends that.
- `--allow-human` is required to claim, complete, cancel, delete, unblock, or force past human-executor Tickets/gates; use it only with explicit user approval.
- `tm claim --force`, `tm release --force`, `tm complete --force`, and `tm cancel --force` require explicit user approval.
