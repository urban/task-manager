# Task Manager Lean V1

This branch redevelops Task Manager as the Lean V1 local coordination kernel for people, agents, and external orchestrators.

## Implementation authority

Read these documents before implementing any slice:

1. [`AGENTS.md`](./AGENTS.md) — repository workflow and engineering constraints.
2. [`CONTEXT.md`](./CONTEXT.md) — canonical domain language.
3. [`specs/lean-v1.md`](./specs/lean-v1.md) — normative product, core-package, persistence, and CLI contract.
4. [`specs/lean-v1-verification-checklist.md`](./specs/lean-v1-verification-checklist.md) — mandatory conformance evidence.

The Lean V1 architecture is authoritative. Existing source code, tests, and generated help are migration evidence, while the files under [`skills/`](./skills/) are migration placeholders and targets until rebuilt against the implemented Lean V1 CLI. None may override the architecture.

## Target shape

Lean V1 provides:

- `@urban/task-manager`, a typed Effect core package owning the domain, libSQL persistence, transactions, Claims, permanent Trash, and Semantic Activity;
- `@urban/task-manager-cli`, a thin command adapter owning parsing, environment fallback, confirmations, file input, and rendering;
- one explicitly resolved local libSQL Store shared safely by local processes;
- exact Claim-ID fencing without force or takeover paths; and
- the reviewed command contracts defined in the architecture.

Task Manager coordinates durable work facts. Assignment, execution, review, and workflow policy belong to external orchestrators.

## Development

Use Bun for dependency and script execution:

```sh
bun install
bun run check
```

Implement and verify behavior through public core and CLI boundaries. Consult vendored third-party source under `.dotai/repos/` as required by `AGENTS.md`.
