# Product Decisions

This document captures confirmed product decisions for Task Manager in human-readable form. It explains the reasoning behind the behavior so future contributors and AI agents do not accidentally redesign intentional choices.

## 1. Standalone Tasks are allowed

**Decision:** A Task may exist without an Epic.

**Why:** Most development work is small enough that requiring an Epic would create fake hierarchy. Epics are useful for larger initiatives, but the task manager should not force ceremony onto a single meaningful unit of work.

**Consequence:** `tm create --level task ...` is valid without `--parent`.

## 2. Storage uses current snapshots for MVP

**Decision:** `.tasks/tasks.jsonl` stores one current snapshot per Work Item, not an append-only event stream.

**Why:** Snapshots are easier for humans and agents to read, validate, edit, diff, and recover. Git already provides enough history for the MVP.

**Consequence:** The current file answers "what is the current state?" directly. If audit history beyond Git becomes necessary, add a separate `events.jsonl` later.

## 3. Public MVP naming stays Task Manager and `tm`

**Decision:** The public MVP product name remains Task Manager, repository and package names continue to use `task-manager`, and the primary CLI binary remains `tm`.

**Why:** The `work-order` direction was considered because it describes executable packets for AI agents, but it would create churn across docs, package metadata, the skill, and existing workflows before the core local-first workflow is proven. The domain already uses Work Item for generic records and Agent Context for execution handoff, so the product can keep the familiar Task Manager name while still describing its agent-focused purpose in subtitles and docs. The `tm` binary is short, script-friendly, and easy for agents to type.

**Consequence:** README, human docs, package metadata, skill content, and examples use Task Manager, `task-manager`, and `tm` as durable MVP names. Reconsider naming only if a concrete publication issue appears, such as a package or repository search conflict that blocks release.

## 4. The storage directory is `.tasks/`

**Decision:** Default repository storage lives in `.tasks/`.

**Why:** `.tasks/` is obvious to humans reading a repository and describes the contents better than `.tm/`. The binary can be short while the on-disk directory stays self-explanatory.

**Consequence:** The default file is `.tasks/tasks.jsonl`.

## 5. Work Item IDs are long ULID-style IDs

**Decision:** Work Item IDs use long, stable, ULID-style strings with a `wi_` prefix.

**Why:** Short random IDs are convenient but risk collisions and become fragile during Git merges, imports, exports, or future sync. ULID-style IDs are safer and roughly creation-sortable.

**Consequence:** Storage always contains full IDs such as `wi_01JZ7Q4E8K8M9N0P1Q2R3S4T5V`. CLI commands may accept unique prefixes for convenience.

## 6. Description and Agent Context are required by default

**Decision:** Normal Work Item creation requires both Description and Agent Context.

**Why:** The product exists to preserve context across sessions. If context is optional by default, agents will create vague Work Items that are hard to resume.

**Consequence:** Quick capture needs explicit escape hatches such as `--allow-empty-description` or `--allow-empty-context` so low-quality Work Items are intentional.

## 7. There is no `in_progress` state

**Decision:** Work Items have only three lifecycle states: `open`, `done`, and `cancelled`.

**Why:** `in_progress` overlaps with Agent Claims. If an agent crashes, a Work Item could stay `in_progress` forever. An expiring Agent Claim communicates active work and recovers naturally.

**Consequence:** A Work Item remains `open` while it is being worked on. Use an Agent Claim to signal current activity.

## 8. Agent Claims are in MVP

**Decision:** MVP includes advisory, expiring Agent Claims.

**Why:** The task manager is explicitly for AI agents as well as a human developer. Claims reduce duplicate work when multiple agents operate on the same repository.

**Consequence:** Claims are not hard locks. They guide `tm next`, expire automatically, and can be overridden when necessary.

## 9. `tm next` returns leaf Work Items by default

**Decision:** `tm next` selects only actionable leaf Work Items by default.

**Why:** Agents should execute atomic work, not broad containers. Parent Work Items are useful for organization and roll-up, but they should not distract from concrete executable work while they still have open children.

**Consequence:** A Task with open Subtasks is skipped by `tm next`. A parent becomes actionable only when it has no open children, unless a future option such as `--include-parents` is added.

## 10. Results require structured verification

**Decision:** Completion Results include structured verification evidence as a list.

**Why:** Future readers and agents need to know not only what changed, but how it was verified. A structured list is easy to validate, render, and sync later.

**Consequence:** Completion requires at least one verification item unless the caller passes the dedicated `--allow-no-verification` escape hatch.

## 11. Cancellation is separate from Result

**Decision:** Cancelled Work Items use a structured `cancellation` field rather than `result`.

**Why:** Result means completed work. A cancelled Work Item was intentionally stopped without completion, so using Result would blur the lifecycle language.

**Consequence:** `status: "done"` requires `result`; `status: "cancelled"` requires `cancellation`.

## 12. Cancelling a parent cascades to open descendants

**Decision:** Cancelling a parent Work Item cancels its open descendants after preview and confirmation or `--yes`.

**Why:** If a parent Epic or Task is cancelled, its children usually no longer make sense. But cascading changes are risky, so the CLI must make the effect visible before applying it.

**Consequence:** Agents can use `--yes` only when they intentionally accept the cascade.

## 13. Deletion is allowed but discouraged

**Decision:** Destructive deletion is allowed with confirmation or `--yes`, but agents should prefer Cancellation.

**Why:** This is a local personal tool, so cleanup matters. But deletion removes history, while Cancellation preserves intent.

**Consequence:** Use `delete` for mistakes, duplicates, or accidental records. Use `cancel` for real work that is no longer needed.

## 14. Dependencies may cross hierarchy boundaries

**Decision:** Any Work Item can depend on any other Work Item, as long as it does not create a self-dependency or cycle.

**Why:** Hierarchy and ordering are different ideas. A Work Item may belong to one Epic but depend on work in another area.

**Consequence:** The graph validator must check dependency cycles separately from parent/child hierarchy.

## 15. Dependencies are soft enforcement

**Decision:** Dependencies guide order but are not hard locks.

**Why:** Development work changes. Sometimes a dependency becomes obsolete, is satisfied another way, or was recorded too conservatively. The tool should prevent accidental mistakes without trapping the user.

**Consequence:** `tm next` skips blocked Work Items. `tm complete` warns and requires `--force` when dependencies are incomplete.

## 16. GitHub Issues sync is not in MVP

**Decision:** GitHub Issues sync is deferred until after the local workflow is stable.

**Why:** Sync introduces authentication, formatting, conflict handling, issue closure semantics, pushed-commit detection, and recovery paths. That would expand MVP scope too much.

**Consequence:** The schema may include `externalRefs` for future compatibility, but MVP implementation remains offline and local-first.

## 17. Human docs live in `docs/`

**Decision:** The `docs/` directory targets human readers.

**Why:** The PRD is a planning artifact. Human docs should explain how the task manager works, why it behaves that way, and how people should use it with AI agents.

**Consequence:** `docs/README.md` is the guide. This file records the decision rationale. Implementation details that are only relevant to code should stay in specs or source comments, not be the main focus of human docs.

## 18. No plan import command in MVP

**Decision:** MVP does not include `tm plan <file>` or any plan-file import command.

**Why:** An LLM can already read a plan and create individual Work Items through explicit CLI commands. A plan import command would require designing and supporting a second structured task language before the core workflow is proven.

**Consequence:** Planning remains deterministic because the task manager only applies explicit CLI mutations. Agents may use Markdown plans as input to their own reasoning, but they must record the Backlog with `tm create`, `tm block`, and related commands.

## 19. Agent Context is one Markdown string in MVP

**Decision:** Agent Context is stored as a single Markdown string in MVP, not as separate structured fields such as `files`, `constraints`, `acceptanceCriteria`, or `implementationNotes`.

**Why:** A single Markdown string is flexible for humans and agents, simple to pass through CLI flags or files, and avoids premature schema design. The exact structure of useful context should emerge from real use.

**Consequence:** Users can still organize Agent Context with Markdown headings, but the task manager treats it as one field. More structured metadata can be added later if repeated patterns justify it.

## 20. Description supports Markdown

**Decision:** Description is a human-facing Markdown string.

**Why:** Work descriptions often need bullets, links, code names, or short snippets. Markdown keeps this readable in the JSONL-backed workflow without introducing more schema fields.

**Consequence:** Description should stay concise and human-facing. Longer execution details belong in Agent Context.

## 21. Subject follows Git-style subject-line rules

**Decision:** Subject is plain text, limited to 50 characters, written in imperative mood, capitalized at the first letter, and does not end with a period.

**Why:** The Subject appears in tree views, lists, filters, and future sync targets. Git-style subject rules keep it concise, action-oriented, and easy to scan.

**Consequence:** Markdown belongs in Description and Agent Context, not Subject. Mechanical rules such as length and trailing punctuation can be validated directly; imperative mood may need documentation or lint-style guidance unless deterministic validation is chosen later.

## 22. Subject and Description can use Git-style message input

**Decision:** Work Item creation may accept a Git commit message-like input where the first line is Subject, a blank line separates it from the body, and the rest of the message is Description.

**Why:** Developers already understand commit subject/body structure. It gives humans and agents a compact way to provide a concise Subject and richer Description without many flags.

**Consequence:** Agent Context remains separate from the Git-style message body because it serves a different purpose: execution handoff, not human-facing description.

## 23. Deterministic Subject rules are hard errors

**Decision:** Subject length, capitalization, trailing punctuation, newlines, and obvious Markdown markers are hard validation errors. Imperative mood is a lint-style warning.

**Why:** Mechanical rules can be enforced consistently. Imperative mood is valuable, but detecting it perfectly would require language inference and would create false positives.

**Consequence:** The CLI can reject subjects that break deterministic formatting rules while still nudging users toward imperative wording.

## 24. MVP input is non-interactive

**Decision:** MVP commands use flags and file inputs only. The CLI does not open an editor or prompt interactively for missing fields.

**Why:** The primary workflow must be scriptable and reliable for AI agents. Non-interactive input is easier to test, automate, document, and recover from.

**Consequence:** Editor-based composition can be added later, but MVP examples should use command flags such as `--description`, `--context`, `--message`, and file variants such as `--description-file`, `--context-file`, and `--message-file`.

## 25. Completion accepts Git-style result message input

**Decision:** `tm complete` accepts Git-style result message input in addition to structured flags.

**Why:** Completion needs to be ergonomic for humans and agents, but Result data still needs structured verification for validation and future rendering. A message format gives users a natural way to write a summary and details while preserving parseable `Decisions:` and `Verification:` sections.

**Consequence:** The first line becomes Result summary, the freeform body becomes optional details, `Decisions:` bullets become structured decisions, and `Verification:` bullets become structured verification evidence. Verification remains required unless the caller passes `--allow-no-verification`.

## 26. JSONL uses `agentContext`; CLI uses `--context`

**Decision:** The storage field is named `agentContext`, while CLI flags use the shorthand `--context` and `--context-file`.

**Why:** `agentContext` matches the domain term and avoids vague data-model naming. `--context` is shorter and more ergonomic at the command line.

**Consequence:** Code and JSONL should use `agentContext`; CLI help should explain that `--context` populates Agent Context.

## 27. Claim TTL is 1 hour and leaf Work Items should fit it

**Decision:** Agent Claims default to a 1-hour TTL. Actionable leaf Work Items should be scoped to complete within 1 hour.

**Why:** The task manager should encourage small, focused, executable work. A shorter claim window makes abandoned work recover quickly and signals that oversized Work Items should be split before execution.

**Consequence:** Agents may refresh claims while actively working, but if they expect work to take longer than 1 hour, they should split the Work Item or create Subtasks instead of claiming it as-is. The 1-hour sizing rule is guidance only in MVP, not CLI validation, because duration is not objectively knowable by the tool.

## 28. Claims are explicit in MVP

**Decision:** `tm next` is read-only and does not automatically create Agent Claims. Agents must run `tm claim <id> --agent <name>` explicitly.

**Why:** Inspecting the Backlog should not mutate state. This keeps `tm next` safe for humans, scripts, and agents that are only surveying available work.

**Consequence:** A future convenience flag such as `tm next --claim --agent codex` can be added later, but MVP workflows should use `tm next` followed by `tm claim`.

## 29. Active claim conflicts require force on lifecycle changes

**Decision:** Completing or cancelling a Work Item with another agent's active claim warns and requires `--force`. Expired claims do not require `--force`.

**Why:** Claims are advisory, but overwriting another active agent's work should be intentional. Requiring `--force` prevents accidental duplicate or conflicting completion while keeping recovery possible.

**Consequence:** `complete` and `cancel` should check active claims before mutating lifecycle state. Successful completion or cancellation clears the claim.

## 30. Replacing another active claim requires force

**Decision:** `tm claim` requires `--force` to replace another agent's active claim. The same agent can refresh its own claim, and any agent can replace an expired claim without `--force`.

**Why:** Claims are advisory but should still prevent accidental duplicate work. Refreshing your own claim is normal; taking over another active claim should be explicit.

**Consequence:** Claim logic must compare the current claim's agent and expiration before deciding whether `--force` is required.

## 31. Releasing another active claim requires force

**Decision:** `tm release` clears the same agent's claim by default. Releasing another agent's active claim requires `--force`; expired claims can be released by anyone.

**Why:** Releasing someone else's active claim is effectively taking coordination authority away from another agent. That should be intentional, while cleanup of expired claims should be frictionless.

**Consequence:** `release` needs the caller's agent identity when a claim is active. It can clear expired claims without matching the original agent.

## 32. There is no agent registry in MVP

**Decision:** MVP has no agent registration command or persistent agent registry. Agent Identity is a caller-provided string supplied with `--agent` or the `TM_AGENT` environment variable. There is no OS-user fallback.

**Why:** Agent identity is coordination and audit metadata, not authentication or authorization. A registry would add extra concepts such as agent records, renames, stale agents, and deletion behavior before they are needed. OS users usually identify the human account, not the specific agent session.

**Consequence:** Agents should choose stable, descriptive names for a session, such as `codex-auth-session` or `claude-refactor-2026-06-15`, and reuse that name for claim, release, complete, and cancel commands.

## 33. Lifecycle-affecting commands require Agent Identity

**Decision:** `claim`, `release`, `complete`, and `cancel` require Agent Identity via `--agent` or `TM_AGENT`.

**Why:** These commands coordinate active work or change lifecycle state. The resulting records should always say who acted, whether that actor is an AI agent or a human using an identity such as `human-urban`.

**Consequence:** `complete` writes `completedBy`, `cancel` writes `cancelledBy`, and claim conflict checks have a reliable caller identity.

## 34. Reopen clears prior lifecycle records in MVP

**Decision:** `tm reopen` clears the previous Result or Cancellation after confirmation.

**Why:** MVP storage is current-snapshot JSONL, not an event log. Preserving prior lifecycle records would complicate the schema before audit history is needed.

**Consequence:** If `.tasks/` is committed, Git history preserves the old Result or Cancellation. A future `events.jsonl` can preserve explicit reopen history if audit needs grow.

## 35. List shows open Work Items by default

**Decision:** `tm list` shows open Work Items by default.

**Why:** The default list view should represent the active Backlog and stay focused on remaining work.

**Consequence:** Completed or cancelled Work Items require explicit filters such as `--status done`, `--status cancelled`, or `--all`.

## 36. Show includes all direct children by default

**Decision:** `tm show <id>` shows all direct children by default, including open, done, and cancelled children.

**Why:** `show` is an inspection command, not a Backlog filter. When inspecting a parent Work Item, readers need full child state to understand what happened.

**Consequence:** The default `list` view stays focused on open work, while `show` gives a complete local view of the selected Work Item's immediate children.

## 37. List supports subtree views in MVP

**Decision:** `tm list --root <id>` is part of MVP.

**Why:** Epics and parent Tasks need focused views. A subtree list lets humans and agents inspect one area of work without scanning the entire Backlog.

**Consequence:** Subtree listing follows normal list filters: open descendants by default, with `--all` or `--status` to include other lifecycle states.

## 38. Next supports scoped selection in MVP

**Decision:** `tm next --root <id>` is part of MVP.

**Why:** Agents may be assigned an Epic or parent Task and need to find the next actionable leaf Work Item within that scope, without considering unrelated Backlog items.

**Consequence:** Scoped next selection uses the same rules as global `next`: open, unblocked, unclaimed, actionable leaf Work Items only by default.

## 39. Next has deterministic ordering and no priority field in MVP

**Decision:** MVP has no priority field. `tm next` selects from eligible Work Items using deterministic ordering: current tree order first, then sibling creation time.

**Why:** Priority introduces another planning dimension and more update churn before the core workflow is proven. Deterministic ordering keeps agent behavior predictable without adding prioritization semantics.

**Consequence:** Users express intended execution order through hierarchy, dependencies, and creation order. A priority field can be reconsidered later if real Backlog use shows it is needed.

## 40. Dependency arrays are sorted full IDs

**Decision:** `blockedBy` stores resolved full Work Item IDs sorted lexicographically.

**Why:** Users may add dependencies by full ID or unique prefix and in any order. Sorting full IDs keeps JSONL diffs deterministic and avoids hidden meaning in array insertion order.

**Consequence:** Dependency order is not semantic. Execution order should be expressed by the dependency graph, hierarchy, and creation order rather than by the order of IDs inside `blockedBy`.
