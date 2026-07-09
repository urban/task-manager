# Create Work Items

Read this when creating direct or bulk Work Items, capturing IDs, writing content, setting parents, or adding dependencies.

## Direct-create decision

Create immediately when the user gives concrete Work Items and asks to create/add/record them. Ask first only when one of these is unclear:

- target task store (`cwd` or storage path)
- hierarchy or parent
- true dependency ordering
- required level (`epic`, `task`, `subtask`)
- execution mode (`agent` for LLM-executable work, `human` for HITL/manual work)
- source/acceptance criteria needed for useful handoff

If the user gives a PRD/spec/plan and asks you to break it down, switch to [`plan-from-spec.md`](./plan-from-spec.md).

## Create sequence

1. Verify tools:

   ```bash
   command -v tm >/dev/null
   command -v jq >/dev/null
   ```

2. Initialize and validate:

   ```bash
   tm init
   tm validate
   ```

3. Create parent items before children.
4. Pass `--mode agent` or `--mode human` explicitly when planning from source; default create behavior is `agent`.
5. Capture every created ID from `tm create --json`.
6. Use captured IDs for `--parent`, `--blocked-by`, and `tm block`.
7. Run `tm validate` and `tm list` after creation.

## Subject rules

Every Subject must be:

- non-empty
- 50 characters or fewer
- one line only
- capitalized at the start
- free of leading/trailing whitespace
- free of a trailing period
- free of Markdown markers `*`, `_`, `` ` ``, `#`, `[`, `]`

Prefer imperative phrasing: `Add login flow`, not `Login flow`.

## Minimal create forms

Use explicit fields for short content:

```bash
created_json="$(tm create "Add login flow" \
  --level task \
  --mode agent \
  --description "Implement the first end-to-end login slice." \
  --context $'## Source\n\nDerived from the user request.\n\n## Verification expectations\n\n- Run bun run check.' \
  --json)"
created_id="$(printf '%s\n' "$created_json" | jq -r '.item.id')"
```

Use `--message` when Subject and Description are naturally drafted together:

```bash
created_json="$(tm create --level epic \
  --mode agent \
  --message "Add authentication

Coordinate authentication implementation work." \
  --context "## Source

Derived from specs/auth.md.

## Verification expectations

- Run bun run check." \
  --json)"
epic_id="$(printf '%s\n' "$created_json" | jq -r '.item.id')"
```

Use file flags for large Markdown or tricky shell quoting:

```bash
tm create --level task \
  --mode agent \
  --message-file /tmp/work-item-message.md \
  --context-file /tmp/work-item-context.md \
  --json
```

## Parent and dependency examples

Create child under a captured parent:

```bash
task_json="$(tm create "Add login form" \
  --level task \
  --mode agent \
  --parent "$epic_id" \
  --description "Build the login form UI and submit path." \
  --context $'## Verification expectations\n\n- Run bun run check.' \
  --json)"
task_id="$(printf '%s\n' "$task_json" | jq -r '.item.id')"
```

Record dependencies during creation only when IDs are already known:

```bash
tm create "Add login tests" \
  --level task \
  --mode agent \
  --parent "$epic_id" \
  --blocked-by "$api_id" \
  --blocked-by "$ui_id" \
  --description "Add integration coverage for login." \
  --context $'## Dependency context\n\nBlocked by API and UI slices.' \
  --json
```

Record dependencies after creation when needed:

```bash
tm block "$blocked_id" --by "$dependency_id"
```

Do not infer IDs from subjects. Keep an in-memory map from draft label to `.item.id`.

## Content template

Description should explain the human-facing work:

```markdown
## What to build

Describe the end-to-end behavior this Work Item should deliver.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Source

Derived from ...
```

Agent Context should help a future agent start without chat history:

```markdown
## Execution context

Explain what a future agent needs to know.

## Relevant project context

- Important files, constraints, or domain terms.

## Execution mode

- `agent` for LLM-executable work, or `human` for HITL/manual work.

## Dependency context

- Why CLI-recorded dependencies exist.

## Verification expectations

- Run ...
```

Keep implementation constraints, assumptions, sequencing rationale, and verification expectations in Agent Context. Use CLI dependencies, not Markdown, for machine-enforced ordering.

## Corrections after creation

Use `tm update`, not storage edits:

```bash
tm update "$id" \
  --subject "Improve login context" \
  --description "Clarify requested login behavior." \
  --context "Updated execution notes for the agent."

tm update "$id" --mode human
```

Use `--allow-empty-description` or `--allow-empty-context` only when intentionally clearing that field.

## Create failure handling

If `tm create` fails:

1. Stop creating more Work Items.
2. Read the error output.
3. Report which Work Item failed and which IDs were already created.
4. Correct the failed draft.
5. Ask for approval only if the correction changes user intent or hierarchy.

If `tm block` or `tm unblock` fails, stop dependency changes and report the failed edge plus already-recorded edges.
