# Lean V1 implementation guidance

## Authority

- The normative product and command contract is `specs/lean-v1.md`.
- Mandatory evidence is defined by `specs/lean-v1-verification-checklist.md`.
- Canonical domain terminology is defined by `CONTEXT.md`.
- Existing source code, tests, generated help, and `skills/` content are migration evidence, not normative behavior.
- Do not restore removed historical specifications, decision logs, deferred-hardening documents, or current-implementation guides as implementation authority.
- When an implementation detail conflicts with the Lean V1 architecture, implement the architecture and migrate or replace the conflicting detail.

## Development workflow

- The git base branch is `main`.
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

`skills/task-manager/` and `skills/to-tickets/` are migration placeholders for removed pre-Lean content. Do not use them to infer Lean V1 behavior. Rebuild both only as part of the explicit skill-migration obligations in the Lean V1 architecture and checklist.
