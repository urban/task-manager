# Lean V1 implementation guidance

## Authority

- The normative Lean V1 specification pack is `specs/lean-v1/charter.md`, `specs/lean-v1/user-stories.md`, `specs/lean-v1/requirements.md`, and `specs/lean-v1/technical-design.md`.
- Mandatory verification evidence is defined by the requirements and technical design in that pack; stable per-obligation scenario IDs are recorded in the derived ledger `specs/lean-v1/approval/verification-traceability.md`.
- Canonical domain terminology is defined by `CONTEXT.md`.
- `specs/lean-v1.md`, `specs/lean-v1-verification-checklist.md`, existing source code, tests, generated help, and `skills/` content are migration evidence, not normative behavior.
- Do not restore removed historical specifications, decision logs, deferred-hardening documents, or current-implementation guides as implementation authority.
- When an implementation detail conflicts with the normative Lean V1 specification pack, implement the pack and migrate or replace the conflicting detail.

## Self-hosting boundary

Lean V1 is developed using the stable pre-Lean Task Manager as an external
coordination tool. Keep the control plane and the product under development
strictly separate.

### Stable coordination control plane

- The `tm` executable used for real Ticket coordination must resolve to
  `/Volumes/Code/personal/task-manager/packages/cli/src/bin.ts`.
- Before performing Ticket work, verify the executable with
  `realpath "$(command -v tm)"`. Stop if it resolves inside this worktree.
- Use the registered `task-manager` and `to-tickets` skills from
  `/Volumes/Code/personal/task-manager/skills/`.
- Those stable skills govern Ticket planning, selection, claiming, completion,
  cancellation, and other coordination operations only. They are not authority
  for Lean V1 product behavior.
- The shared stable coordination store is
  `/Volumes/Code/personal/task-manager-next/.tasks`.
- When working outside the `next` integration worktree, pass
  `--storage-path /Volumes/Code/personal/task-manager-next/.tasks` to every
  stable `tm` invocation.
- Do not run `bun link` from this worktree or otherwise replace the globally
  linked stable `tm`.
- Do not run this worktree's CLI implementation against the real coordination
  store.

### Product under development

- Everything in this worktree, including `packages/`, `skills/`, specifications,
  tests, and documentation, belongs to the Lean V1 product under development.
- Files under `skills/task-manager/` and `skills/to-tickets/` are implementation
  artifacts. Do not treat them as active instructions while developing them.
- Exercise the Lean V1 CLI only through automated tests or disposable stores.
- Evaluate rebuilt Lean V1 skills in fresh, isolated agent sessions with
  disposable stores. Do not install them over the stable operational skills
  until the explicit cutover.
- Tickets coordinate implementation work but do not override the normative
  `specs/lean-v1/` pack or `CONTEXT.md`. If a Ticket conflicts with those
  authorities, stop and correct the Ticket rather than implementing the conflict.

## Development workflow

- The git base branch for Lean V1 development is `next`.
- Do not develop Lean V1 on `main`; `main` hosts the stable coordination tool.
- Create implementation branches and worktrees from `next`, and merge completed
  work back into `next`.
- Use `bun` as the package manager.
- Implement through the public core and CLI boundaries described by the architecture.
- After implementation changes, run `bun run check` to check linting, formatting, types, and tests.
- All work should be done in separate branches and chained work should be part of a stacked PR.

## Code quality standards

### Type imports and `tsgo` stability

`tsgo` can hang instead of exiting when this repository uses TypeScript type-only import declarations or specifiers. Do not write either of these forms:

```ts
import type { Foo } from "path/to/foo";
import { runtimeValue, type Foo } from "path/to/foo";
```

Import every external type through an import type expression alias instead:

```ts
type Foo = import("path/to/foo").Foo;
```

Keep runtime imports as ordinary imports, and declare the type alias separately. Apply this rule in source files, tests, scripts, and configuration files. Before completing TypeScript changes, search the changed files for `import type` and inline `type` import specifiers and replace them with import type expression aliases.

- Verify exact API shapes by checking signatures, parameter types, return types, setup patterns, and test usage.
- Never compromise type safety: no `any`, no non-null assertion operator (`!`), and no type assertions (`as Type`).
- Make illegal states unrepresentable with discriminated unions, schemas at boundaries, and domain types that exclude invalid states.

## Reference implementations

When executing coding tasks, use repos within `.dotai/repos/` as read-only reference implementations for architecture and coding standards.

- Before implementing a Ticket, inspect the relevant source, tests, configuration, and repository guidance in both references.
- Follow their established patterns for module boundaries, project structure, Effect usage, TypeScript style, and testing where those patterns apply.
- Do not copy repository-specific product behavior, package-manager choices, or release workflow. This repository's specifications and instructions remain authoritative whenever they differ.
- Do not edit the reference repositories or import application code from them.

## External libraries

This project vendors external repositories under `.dotai/repos/`.

- Use vendored repositories as read-only reference material when working with related libraries.
- Distrust built-in knowledge for external libraries, frameworks, and tools.
- Prefer library source and tests over documentation or generated guesses.
- Before using a third-party API, inspect `.dotai/repos/<library>`.
- If the repository is absent, clone it read-only with `git clone --depth 1 <library_url> .dotai/repos/<library>`.
- Do not edit or import application code from `.dotai/repos/`.

### Effect

When writing Effect code, inspect `.dotai/repos/effect/` for idiomatic usage, tests, module structure, and API design. Treat `.dotai/repos/effect/LLMS.md` as authoritative for Effect patterns.

## Skill migration

The two sets of skills have distinct roles:

- The registered skills under
  `/Volumes/Code/personal/task-manager/skills/` are the stable operational
  instructions used with the current `tm`.
- `skills/task-manager/` and `skills/to-tickets/` in this worktree are Lean V1
  product artifacts under development.

Do not activate or follow the skills from this worktree during ordinary Lean V1
implementation. Rebuild them only as part of the explicit skill-migration
obligations in the normative Lean V1 specification pack.

Test rebuilt skills in fresh sessions using disposable stores. Installing the
Lean V1 skills and switching the globally linked CLI are explicit cutover
actions and must not happen implicitly during implementation.
