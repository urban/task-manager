# Execute Backlog

Read this when selecting, claiming, implementing, releasing, or completing backlog work.

## Selection sequence

1. Validate storage:

   ```bash
   tm validate
   ```

2. Select the next actionable Work Item:

   ```bash
   next_json="$(tm next --json)"
   next_id="$(printf '%s\n' "$next_json" | jq -r '.item.id // empty')"
   ```

3. If `next_id` is empty, report:

   ```bash
   printf '%s\n' "$next_json" | jq -r '.reason // "no-actionable-work"'
   ```

4. Inspect the selected Work Item:

   ```bash
   tm show "$next_id"
   ```

Read the Description, Agent Context, dependencies, claim, status, and any Result/Cancellation fields before working.

## Selection variants

Limit selection to a subtree:

```bash
tm next --root "$root_id" --json
```

Include actively claimed items only when the user asks to inspect or take over claimed work:

```bash
tm next --include-claimed --json
```

Do not manually sort or filter `.tasks/tasks.jsonl` to choose work.

## Claim

Use a stable Agent Identity. Prefer an existing `TM_AGENT`; otherwise pass `--agent` explicitly and reuse that value.

```bash
tm claim "$next_id" --agent "$agent_name"
```

If another active claim blocks you, stop and report the conflict. Use `--force` only when the user explicitly says to take over.

## Implement and verify

Implement the selected Work Item, then run the verification requested by Agent Context or project instructions. For this repository, normally run:

```bash
bun run check
```

If the Work Item specifies a different verification command, follow it and explain why in the completion Result.

## Complete

Complete only after implementation and verification. Include concrete evidence:

```bash
tm complete "$next_id" \
  --agent "$agent_name" \
  --summary "Describe the concrete change" \
  --verification "bun run check: passed"
```

Add details, decisions, and repeated verification when useful:

```bash
tm complete "$next_id" \
  --agent "$agent_name" \
  --summary "Added root filtering to next-item selection" \
  --details "Implemented CLI flag parsing and repository filtering." \
  --decision "Kept filtering in selection service to avoid duplicating tree traversal." \
  --verification "bun run check: passed" \
  --verification "Added tests for --root filtering"
```

Avoid vague Results:

```bash
# Bad
tm complete "$next_id" --agent "$agent_name" --summary "Done" --verification "Looks good"
```

Use `--allow-no-verification` only after explicit user approval.

## Release instead of completing

If you need to stop before completing, release the claim:

```bash
tm release "$next_id" --agent "$agent_name"
```

Use `tm release --force` only when the user explicitly approves releasing another agent's claim.

## Final report

After completion:

```bash
tm validate
```

Report:

- completed Work Item ID and Subject
- Result summary
- verification command and outcome
- confirmation that `tm validate` passed

If you released rather than completed, report the Work Item ID, reason for stopping, and release outcome.
