# Recovery and Maintenance

Read this when listing, showing, updating, blocking, unblocking, cancelling, deleting, releasing claims, or recovering from command failures.

## Inspect existing Work Items

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
tm list --root "$root_id"
tm show "$id"
```

Add `--json` when you need to parse results.

## Update text fields

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

Use `--allow-empty-description` or `--allow-empty-context` only when intentionally clearing that field.

## Manage dependencies

Add a dependency:

```bash
tm block "$blocked_id" --by "$dependency_id"
```

Remove a dependency:

```bash
tm unblock "$blocked_id" --by "$dependency_id"
```

Use dependencies only for real ordering constraints. Priority, grouping, and narrative sequencing belong elsewhere.

## Manage claims

Release your own claim:

```bash
tm release "$id" --agent "$agent_name"
```

Release another active claim only with explicit user approval:

```bash
tm release "$id" --agent "$agent_name" --force
```

Use `tm claim --force` only when the user explicitly wants to replace another active claim.

## Cancel vs delete

Use `tm cancel` for real Work Items that should stop but remain part of history:

```bash
tm cancel "$id" \
  --agent "$agent_name" \
  --reason "No longer needed because the feature was removed from scope."
```

If cancellation cascades to descendants and the CLI asks for confirmation, use `--yes` only when the user intended that cascade.

Use `tm delete --yes` only for mistaken, duplicate, or accidental records:

```bash
tm delete "$id" --yes
```

Do not delete legitimate historical work just because it is obsolete; cancel it instead.

## Complete/cancel force flags

`tm complete --force` can bypass incomplete dependencies or claim conflicts. `tm cancel --force` can bypass another agent's active claim. Use either only after explicit user approval, and record why in your final report.

## Failure handling

If a command fails:

1. Stop the current mutation sequence.
2. Read the exact error output.
3. Report the command, failed Work Item ID, and any mutations already completed.
4. Prefer a CLI correction (`tm update`, `tm unblock`, `tm release`, `tm cancel`, or `tm delete`) over storage edits.
5. Ask before using `--force`, destructive delete, or low-level recovery.

If `tm validate` fails, stop and report the validation failure. Do not repair `.tasks/tasks.jsonl` manually unless the user explicitly asks for low-level recovery.

## Low-level recovery boundary

Manual edits to `.tasks/tasks.jsonl` are outside normal skill operation. Only do them when all are true:

- the user explicitly asks for low-level recovery
- CLI commands cannot express the repair
- you have reported the risk
- you validate immediately after the repair
