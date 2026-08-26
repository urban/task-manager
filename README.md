# Task Manager Lean V1

This branch redevelops Task Manager as the Lean V1 local coordination kernel for people, agents, and external orchestrators.

## Implementation authority

Read these documents before implementing any slice:

1. [`AGENTS.md`](./AGENTS.md) — repository workflow and engineering constraints.
2. [`CONTEXT.md`](./CONTEXT.md) — canonical domain language.
3. [`specs/lean-v1/charter.md`](./specs/lean-v1/charter.md) and [`specs/lean-v1/user-stories.md`](./specs/lean-v1/user-stories.md) — approved scope and user outcomes.
4. [`specs/lean-v1/requirements.md`](./specs/lean-v1/requirements.md) — normative product, public-core, persistence, and CLI contract.
5. [`specs/lean-v1/technical-design.md`](./specs/lean-v1/technical-design.md) — normative architecture and mandatory evidence design.
6. [`specs/lean-v1/approval/verification-traceability.md`](./specs/lean-v1/approval/verification-traceability.md) — derived stable per-obligation scenario ledger.

The four-artifact Lean V1 specification pack is authoritative. The former top-level architecture and verification checklist, existing source code, tests, and generated help are migration evidence, while the files under [`skills/`](./skills/) are migration placeholders and targets until rebuilt against the implemented Lean V1 CLI. None may override the specification pack.

## Target shape

Lean V1 provides:

- `@urban/task-manager`, a typed Effect core package owning the domain, private Bun SQLite persistence through stock Effect SQL, transactions, Claims, permanent Trash, and Semantic Activity;
- `@urban/task-manager-cli`, a thin command adapter owning parsing, environment fallback, confirmations, file input, and rendering;
- one explicitly resolved local Bun SQLite Store shared safely by local processes;
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
