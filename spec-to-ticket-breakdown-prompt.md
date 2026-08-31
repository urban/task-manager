---
type: note
status: active
maturity: budding
created: 2026-08-14
updated: 2026-08-28
summary: "Reusable prompt for capability-grouped Tickets with scope-prefixed Subjects, setup-only foundations, early debug/telemetry, sequential core/CLI/verification gates, and matching visible tree order."
aliases:
  - "Spec to Ticket breakdown prompt"
  - "Fresh-agent Ticket decomposition"
  - "Command-oriented Ticket hierarchy"
tags:
  - planning
  - tickets
  - tdd
  - agents
sources: []
comes_from: []
similar_to: []
leads_to: []
competes_with: []
---

# Spec-to-Ticket breakdown prompt

Explicit user preference (2026-08-14): large implementation specifications should be decomposed for progressive disclosure and fresh-agent execution. Use a command or public-capability Task as the feature container, then create multiple small, test-first behavioral Subtasks rather than one broad core Subtask and one broad adapter Subtask.

## Lean V1 sequencing clarification

Explicit user direction (2026-08-27, Task Manager Lean V1 backlog review): begin with empty core/CLI packages, dependencies, linting, type checking, and test setup, without product implementation. Follow with reusable debug/telemetry, then `tm init`: core behavior → CLI integration → correctness and telemetry verification. Repeat that pairing for each next capability, with recorded dependencies preventing the next capability from starting before the preceding acceptance gate. A displayed command hierarchy alone does not establish this order. Necessary behavior spanning later commands should have explicit follow-up ownership, not silently pull those commands' core implementations ahead of their CLI pairing.

This clarification initially applied specifically to Lean V1. On 2026-08-28 the user explicitly approved the resulting breakdown and requested it as reusable guidance for similar future projects; the prompt below now incorporates that preference.

Explicit follow-up: the hierarchy displayed by plain `tm list` must also follow the intended execution order. Correct dependencies alone do not satisfy this requirement. The user authorized archiving the existing Store and rebuilding active Tickets with new IDs when the stable CLI could not reorder existing siblings.

## Accepted reusable defaults — 2026-08-28

### Deliver one complete capability at a time

**Decision:** Use setup-only foundation → reusable debug/telemetry → capability core → CLI integration → correctness/telemetry verification → acceptance, then repeat for the next capability. Retain small Subtasks within each phase.

**Why:** The user explicitly preferred this grouping and sequence over broad implementation foundations and interleaved core work across unfinished commands.

**Consequences:** Enforce acceptance gates with dependencies. Introduce shared implementation only when a capability needs it. Assign behavior involving later commands to explicit follow-up capabilities without dropping specification obligations.

**Risks:** Early telemetry infrastructure cannot prove behavior of product operations that do not yet exist; command and final conformance checks must supply that evidence later.

### Make the displayed hierarchy agree with execution

**Decision:** Both plain `tm list` and the dependency graph must reflect the approved order.

**Why:** The user rejected a dependency-only correction because the displayed hierarchy still appeared out of order.

**Consequences:** Inspect the CLI's ordering behavior before creation, create siblings in the intended display order, and verify the actual unfiltered tree as well as readiness.

**Risks:** A CLI without reorder/reparent support may require rebuilding existing Tickets, changing IDs. Archive history, remap references, and obtain explicit approval before doing so; this conversation's rebuild authorization is not standing permission.

### Put scope in the Subject

**Decision:** Use concise scope prefixes such as `Core:`, `CLI:`, and `Verify:` on implementation and verification Subtasks, adapted to the actual project's packages and boundaries.

**Why:** The user can identify each Ticket's scope directly in the list without opening it.

**Consequences:** Keep parent Tasks grouped by public capability. A prefix communicates package or verification scope; it does not justify creating a new package or grouping the entire backlog by architectural layer.

**Risks:** No additional risk was identified in the discussion.

## Reusable prompt

```text
Break down the approved specification at <SPEC_PATHS> into Task Manager Tickets for implementation in <PROJECT_ROOT>.

Use the registered Task Manager planning skill and the intended coordination Store. Verify the coordination CLI and Store before making Ticket changes. Treat product source, generated help, existing tests, and in-repository skills as implementation evidence unless the project explicitly declares them authoritative.

Inspect the authoritative specification, verification checklist, domain/context documents, repository instructions, package structure, verification commands, and nearby implementation patterns before drafting. Do not begin implementation while planning Tickets.

Hierarchy

1. Create one real root Epic for the complete initiative unless the source genuinely defines multiple independent initiatives or phases. Do not create a fake umbrella Epic above independent Epics.
2. For a CLI product, create one Task for each public CLI command or bounded command capability. The Task is a feature container, not a broad implementation assignment. A later extension may have its own explicitly named capability Task when it needs commands that do not yet exist.
3. For a non-CLI product, use one Task per user-visible public capability, endpoint, workflow, or independently meaningful feature instead of organizing Tasks by internal layer.
4. Use separate Tasks for setup-only foundations, reusable debugging/telemetry infrastructure, and required final integration/conformance, qualification, guidance, or documentation. Do not hide command implementation or end-of-project audits under the initial foundation Task.
5. Put implementation work in multiple small behavioral Subtasks under each command or capability Task. Do not stop at one large “implement core” Subtask and one large “implement CLI” Subtask.
6. Respect the hierarchy limit Epic -> Task -> Subtask. Express core, CLI, and verification phases through ordered Subtasks and scope prefixes, not an unsupported fourth hierarchy level. Parent Tasks become acceptance gates after their active children finish.

Delivery sequence

1. Start with a foundation Task that initializes the actual packages, entrypoints/export boundaries, dependency versions/lockfile, linting/formatting, type checking, and test runner. No domain behavior, operation handlers, persistence implementation, telemetry implementation, or dummy public methods belong here. In an existing repo, assess and adapt the setup without discarding unrelated work.
2. Foundation Subtasks verify the setup they introduce and preserve working inherited checks; do not demand a tool or script that a later setup Subtask has yet to introduce. The foundation acceptance gate must pass <FULL_VERIFICATION_COMMAND> with no product implementation hidden in the setup work.
3. Next establish reusable debugging/telemetry and the minimal application host needed to exercise it. Verify activation, output transparency, resource ownership, safe transport/privacy, and cleanup as required by the specification. Controlled mechanism tests must not be presented as proof of product operations that do not exist. Do not preimplement every command, schema, or service to unblock this stage.
4. Deliver the first usable capability, such as init when the product defines it: focused core behavior Subtasks -> corresponding CLI integration Subtasks -> correctness and telemetry verification Subtasks -> parent acceptance. This entire accepted capability precedes the next capability's core work.
5. Repeat that sequence for each next capability. Every core and CLI implementation step remains test-first; the later verification phase reconciles integration evidence rather than postponing all tests until the end.
6. Introduce schemas, codecs, persistence, and shared helpers with their first consuming capability, scoped to its needs. Complete contract/grammar/architecture reconciliation belongs at the end, not in an upfront all-product implementation barrier.
7. If a complete behavior needs a later capability, stage a useful bounded base capability and name the later extension. Give that extension its own core -> CLI -> verification -> acceptance sequence. Do not pull another command's core implementation ahead of its CLI pairing to satisfy the dependency.
8. Keep all specification-required cross-command races, final architecture/telemetry conformance, qualification, guidance, and evidence work in explicit final stages. A base-capability acceptance gate must identify its later obligations and must not claim the full specification has been delivered.
9. Adapt the sequence to the actual product: replace CLI with API/UI/worker integration when appropriate, and do not invent init commands, packages, telemetry requirements, or release steps absent from the approved scope.

Subject scope prefixes

1. Use <Scope>: <imperative behavior> for implementation and verification Subtasks. Examples: "Core: Create root Tickets", "CLI: Render create outcomes", "Verify: Check create telemetry".
2. Choose concise prefixes that match real ownership. Core: and CLI: identify package/boundary scope; Verify: identifies integration or acceptance evidence, not a package. Use an owning-package prefix when a verification Ticket is specifically package-local and that distinction matters.
3. Keep parent Task Subjects capability-oriented, such as "Implement and accept init". Foundation/setup Subjects may describe tooling directly. Do not create separate all-core and all-CLI parent Tasks.
4. Keep the complete Subject, including its prefix, within the CLI's length and syntax constraints. For the current stable tm, this means at most 50 characters, an initial capital, no Markdown markers, and no trailing period. Shorten the behavior wording rather than silently dropping its scope.

Fresh-agent execution

1. Size every Subtask so one agent can complete it in one fresh LLM session and one fresh context window.
2. Record that one fresh agent session owns exactly one Subtask. It must not claim or implement sibling Subtasks in the same session.
3. If a Subtask still contains several independently meaningful behaviors, race matrices, failure families, or acceptance boundaries, split it again before creating Tickets.
4. Every Subtask must leave the branch green and produce independently verifiable progress. Avoid half-migrations that require an unfinished sibling to compile or pass tests.
5. Use explicit dependencies so each fresh agent starts only after the code and contracts it relies on have landed.

Behavioral tracer bullets

1. Decompose each command into behavior-sized slices, for example:
   - one successful core behavior through the exported public API and real persistence;
   - one boundary or invariant family;
   - one no-op or failure-precedence behavior;
   - one concurrency, expiry, or rollback behavior when required;
   - one focused real-CLI parsing/input behavior;
   - one focused real-CLI rendering/process behavior.
2. A core Subtask should cut through the public API, domain validation, persistence, and result or typed error needed for one behavior. If a bounded contract/probe/helper Subtask is necessary, keep it under its first consuming capability and limit it to that capability's needs. Do not create an all-product schemas/tables/repositories implementation phase.
3. A real-CLI Subtask must exercise the real command entrypoint and use the public core capability. It owns parsing, environment fallback, files, confirmations, human/JSON rendering, streams, and exit status as applicable. Do not duplicate core domain rules in the adapter.
4. Separate CLI input/parsing behavior from output/rendering behavior when either would exceed one fresh context.
5. Separate race matrices and rollback/reopen proofs from ordinary success/failure behavior when they are substantial.
6. Resolve dependency cycles by staging a usable base behavior first and adding the cross-feature capability later. For example, finish basic creation through the CLI before implementing Claim commands, then add claimed-parent creation through core, CLI and verification. Preserve every deferred case under a named later owner.

Test-driven development

1. Every implementation Subtask is test-first.
2. Name the public seam in the Ticket Context before implementation:
   - exported core access function with its service Layer and real temporary file-backed Store; or
   - real CLI process for adapter behavior.
3. Work in repeated red -> green cycles: add one failing behavioral test from the specification, run it and confirm the expected failure, implement only enough to pass, then continue with the next listed behavior.
4. Do not bulk-write imagined tests before implementation. Do not test private helpers or mock internal collaborators when the public seam can demonstrate the behavior.
5. Use deterministic clocks, barriers, and fault controls only as private test controls for publicly observable races or rollback evidence.
6. Require focused verification during the loop and <FULL_VERIFICATION_COMMAND> before completing each Subtask.

Progressive context

Write the hierarchy so a fresh agent can load context progressively:

Epic Context must include:
- authoritative source paths and precedence;
- overall product goal and architecture boundaries;
- canonical domain vocabulary;
- important non-goals;
- repository, branch, package-manager, and verification rules;
- stable coordination-tool versus product-under-development boundaries;
- the fresh-session and test-first execution policy.
- the full ordered stage map, acceptance-gate policy, scope-prefix convention, and required visible tree order.

Each command or capability Task Context must include:
- the complete public feature or command purpose;
- public core operation names and relevant service boundary;
- command syntax, flags, environment fallbacks, input modes, outputs, and typed error families;
- transaction, lifecycle, Claim/concurrency, ordering, and failure-precedence invariants that apply;
- final acceptance criteria for the bounded capability, with explicit later-extension ownership where applicable;
- its ordered Subtask map and integration dependencies;
- source traceability to the exact specification and checklist sections.

Each Subtask Context must include:
- an imperative, bounded objective and one clear resulting capability;
- an instruction to read this Ticket, then its parent Task and root Epic before coding;
- the exact public seam under test;
- the specific behavioral scenarios to drive red -> green;
- prerequisite Tickets and the behavior assumed from them;
- in-scope and explicitly out-of-scope behavior;
- relevant source sections, project files, constraints, and nearby patterns;
- exact focused and full verification commands;
- the concrete completion evidence expected in the Ticket Result;
- a reminder to stop and correct the Ticket if it conflicts with authoritative project documents.

Dependencies

1. Record dependencies as first-class Ticket edges, never only as prose.
2. Within each capability, chain the small core Subtasks, then CLI Subtasks, then correctness/telemetry verification Subtasks. Make its parent acceptance depend on the final verification and require all active children to be complete.
3. Make the first Subtask of each next capability depend on the preceding capability's completed parent acceptance. This is an intentional delivery gate, even when a narrower code prerequisite already exists. Do not relax it to enable interleaved core implementation across commands.
4. Distinguish technical prerequisites from acceptance prerequisites in Context. Keep technical edges specific, but preserve the user's sequential delivery policy. Do not substitute ordering prose for either kind of edge.
5. By default there should be exactly one actionable implementation/verification Subtask at a time, with parent acceptance between capabilities. Do not introduce parallel execution unless explicitly approved for the project.
6. Ensure the graph is acyclic and simulate completion through the intended sequence without modifying real Ticket states. Confirm no later capability becomes actionable before its predecessor's acceptance.

Visible hierarchy and creation order

1. Inspect the current CLI's actual list ordering, filtering, and reorder/reparent capabilities before creating Tickets. Do not assume dependencies or Subject prefixes change display order.
2. Create the approved tree in display preorder: root Epic, first capability Task, all of that Task's children in core/CLI/verification order, next capability Task and its ordered children, and so on. Capture IDs and add forward dependency references after their targets exist.
3. For a creation-time-sorted CLI, preserve genuine creation timestamps by creating siblings in the correct order initially. Do not falsify timestamps or manually rearrange storage lines as a substitute for supported ordering.
4. Verify plain `tm list` as the user will run it, not only a filtered/custom-sorted view. The displayed Task order and each Task's displayed child order must match the approved plan. Verify the machine-readable tree too when available.
5. When revising an existing backlog, use supported reorder/reparent operations if available. If the CLI cannot represent the requested order, explain the limitation and obtain explicit approval before archiving/rebuilding or changing IDs. Cancellation alone may leave obsolete Tickets interleaved in the default list.
6. An authorized rebuild must preserve the original Store intact, recreate active Tickets in order through the CLI, remap hierarchy/dependencies/text references, retain an old-to-new ID map, validate the staged tree before replacement, and recheck the actual live list and next selection afterward. Never silently delete history or claim a dependency-only edit fixed the visible hierarchy.

Coverage preservation

1. Map every specification requirement and mandatory verification obligation to accountable Ticket ownership. Use the project's existing scenario ledger when available; do not invent a different source of authority.
2. When splitting or staging a behavior, identify the exact later Ticket that owns each deferred case. Preserve source references, public test seams, and acceptance evidence; a convenient sequence must not reduce the approved scope.
3. Reconcile all obligations at final acceptance. Where a ledger assigns one accountable owner per scenario, check for missing or duplicate ownership and distinguish contributing evidence from complete acceptance.

Ticket quality

For every proposed Ticket include:
- Subject;
- Level;
- Executor;
- Parent;
- Blocked by;
- clear behavioral outcome;
- public test seam;
- source traceability.

Use imperative, concise Subjects that satisfy the Task Manager constraints. Assign agent Executor only to work an unattended agent can complete. Use human Executor for real approvals, credentials, private checks, external actions, or decisions.

Draft before creation

1. Present the proposed Epic, command/capability Tasks, behavioral Subtasks, and dependency structure before running any create command.
2. State the total number of Epics, Tasks, Subtasks, and Tickets.
3. Ask whether the granularity fits one fresh context, the capability order and acceptance gates are correct, the scope prefixes are useful, later extensions preserve coverage, and the hierarchy should now be created.
4. Wait for explicit approval before creating Tickets unless I explicitly provide an already-approved concrete hierarchy and instruct you to create it immediately.
5. After approval, create in the specified display preorder, capture exact IDs, and add dependency edges. Validate the Store, plain list order, parent/child scopes, scenario ownership, and the simulated execution sequence. Confirm the real next selection is the first intended Subtask.
6. Report the Epic ID, Ticket counts, actual first executable Ticket, verification results, and any archive/ID map from an authorized rebuild. Do not report completion while only the dependencies, but not the visible tree, are correct.
```

## Adaptation rule

Keep parent Tasks grouped by public capability and use Subject prefixes to expose package or boundary scope within them. For APIs, UIs, libraries, or services, adapt the delivery boundary and prefix names while retaining setup-only foundations, required early observability, small test-first Subtasks, complete capability acceptance before the next capability, and agreement between the displayed hierarchy and executable dependencies. Do not assume Lean V1's exact packages, command set, runtime versions, or scenario count applies to another project.
