# Recovery and Maintenance

Read this when listing, showing, updating, blocking, unblocking, cancelling, deleting, releasing claims, or recovering from command failures.

## Inspect existing Tickets

Validate first:

```bash
tm validate
```

Common inspection commands:

```bash
tm list
tm list --all
tm list --status open
tm list --status done
tm list --status cancelled
tm list --executor human
tm list --executor agent
tm list --root "$root_id"
tm show "$id"
```

Add `--json` when you need to parse results.

## Update fields

Use `tm update`, not JSONL edits:

```bash
tm update "$id" --subject "Add login flow"
```

```bash
tm update "$id" \
  --description "Updated human-facing description." \
  --context "Updated agent execution context."
```

Use `--message` or `--message-file` when updating Subject and Description together. Do not combine `--message` / `--message-file` with explicit `--subject` or Description flags.

Use `--allow-empty-description` or `--allow-empty-context` only when intentionally clearing that field. Use `tm set-executor <id> agent|human` to correct Executor. Changes to or from `human` require explicit approval and `--allow-human`; setting the current Executor is a no-op.

## Manage dependencies

Add a dependency:

```bash
tm block "$blocked_id" --by "$dependency_id"
```

Remove a dependency:

```bash
tm unblock "$blocked_id" --by "$dependency_id"
```

If either side is human-executor, removing the dependency requires explicit approval and `--allow-human` because it may clear a human gate.

Use dependencies only for real ordering constraints. Priority, grouping, and narrative sequencing belong elsewhere.

## Manage claims

Release your own claim:

```bash
tm release "$id" --actor "$agent_name"
```

Release another active claim only with explicit user approval:

```bash
tm release "$id" --actor "$agent_name" --force
```

Use `tm claim --force` only when the user explicitly wants to replace another active claim. Use `tm claim --allow-human` only when the user explicitly wants to claim human-executor work.

## Cancel vs delete

Use `tm cancel` for real Tickets that should stop but remain part of history:

```bash
tm cancel "$id" \
  --actor "$agent_name" \
  --reason "No longer needed because the feature was removed from scope."
```

If cancellation cascades to descendants and the CLI asks for confirmation, use `--yes` only when the user intended that cascade. If the target or cascade includes human-executor Tickets, use `--allow-human` only after explicit approval.

Use `tm delete --yes` only for mistaken, duplicate, or accidental records:

```bash
tm delete "$id" --yes
```

If the target subtree includes human-executor Tickets, use `--allow-human` only after explicit approval.

Do not delete legitimate historical work just because it is obsolete; cancel it instead.

## Complete/cancel force flags

`tm complete --force` can bypass incomplete dependencies or claim conflicts. `tm cancel --force` can bypass another actor's active claim. `tm complete --force` requires `--allow-human` when bypassing an incomplete human-executor dependency. Use force or `--allow-human` only after explicit user approval, and record why in your final report.

## Failure handling

If a command fails:

1. Stop the current mutation sequence.
2. Read the exact error output.
3. Report the command, failed Ticket ID, and any mutations already completed.
4. Prefer a CLI correction (`tm update`, `tm set-executor`, `tm unblock`, `tm release`, `tm cancel`, or `tm delete`) over storage edits.
5. Ask before using `--force`, `--allow-human`, destructive delete, or low-level recovery.

If `tm validate` fails, stop and report the validation failure. Do not repair `.tasks/tasks.jsonl` manually unless the user explicitly asks for low-level recovery.

## Low-level recovery boundary

Manual edits to `.tasks/tasks.jsonl` are outside normal skill operation. Only do them when all are true:

- the user explicitly asks for low-level recovery
- CLI commands cannot express the repair
- you have reported the risk
- you validate immediately after the repair
