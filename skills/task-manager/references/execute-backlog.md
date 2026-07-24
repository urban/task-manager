# Execute Backlog

Read this when selecting, claiming, implementing, releasing, or completing backlog work.

## Selection sequence

1. Validate storage:

   ```bash
   tm validate
   ```

2. Select the next actionable Ticket:

   ```bash
   next_json="$(tm next --json)"
   next_id="$(printf '%s\n' "$next_json" | jq -r '.ticket.id // empty')"
   ```

3. If `next_id` is empty, report:

   ```bash
   printf '%s\n' "$next_json" | jq -r '.reason // "no-actionable-work"'
   ```

4. Inspect the selected Ticket:

   ```bash
   tm show "$next_id"
   ```

Read the Description, Context, Executor, dependencies, claim, status, and any Result/Cancellation fields before working.

## Selection variants

Limit selection to a subtree:

```bash
tm next --root "$root_id" --json
```

Default selection is `--executor agent`. Select human-only work only when the user asks for it:

```bash
tm next --executor human --json
```

Use `tm next --all-executors --json` only when the user asks for the frontier across both Executors.

Include actively claimed tickets only when the user asks to inspect or take over claimed work:

```bash
tm next --include-claimed --json
```

Do not manually sort or filter `.tasks/tasks.jsonl` to choose work.

## Claim

Use a stable Actor Identity. Prefer an existing `TM_ACTOR`; otherwise pass `--actor` explicitly and reuse that value.

```bash
tm claim "$next_id" --actor "$agent_name"
```

If the selected Ticket is human-executor, stop unless the user explicitly asked you to handle HITL work; then use `tm claim --allow-human`. If another active claim blocks you, stop and report the conflict. Use `--force` only when the user explicitly says to take over.

## Implement and verify

Implement the selected Ticket, then run the verification requested by Context or project instructions. For this repository, normally run:

```bash
bun run check
```

If the Ticket specifies a different verification command, follow it and explain why in the completion Result.

## Complete

Complete only after implementation and verification. Include concrete evidence:

```bash
tm complete "$next_id" \
  --actor "$agent_name" \
  --summary "Describe the concrete change" \
  --verification "bun run check: passed"
```

Add details, decisions, and repeated verification when useful:

```bash
tm complete "$next_id" \
  --actor "$agent_name" \
  --summary "Added root filtering to next-ticket selection" \
  --details "Implemented CLI flag parsing and repository filtering." \
  --decision "Kept filtering in selection service to avoid duplicating tree traversal." \
  --verification "bun run check: passed" \
  --verification "Added tests for --root filtering"
```

Avoid vague Results:

```bash
# Bad
tm complete "$next_id" --actor "$agent_name" --summary "Done" --verification "Looks good"
```

Use `--allow-human` only after explicit user approval for human-executor Tickets or forced bypass of a human-executor dependency. Use `--allow-no-verification` only after explicit user approval.

## Release instead of completing

If you need to stop before completing, release the claim:

```bash
tm release "$next_id" --actor "$agent_name"
```

Use `tm release --force` only when the user explicitly approves releasing another actor's claim.

## Final report

After completion:

```bash
tm validate
```

Report:

- completed Ticket ID and Subject
- Result summary
- verification command and outcome
- confirmation that `tm validate` passed

If you released rather than completed, report the Ticket ID, reason for stopping, and release outcome.
