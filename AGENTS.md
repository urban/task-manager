## Development Workflow

- The git base branch is `main`
- Use `bun` as the package manager

After making changes, run `bun run check` to run all validations. This will check
for linting errors, formatting issues, type errors, and run test.

## Code Quality Standards

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

- Always verify the exact API shape by checking signatures, parameter types, return types, setup patterns and test usage.
- **Never compromise type safety**: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- **Make illegal states unrepresentable**: Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it

## External Libraries

This project vendors external repositories under `.dotai/repos/`

- Use vendored repositories as read-only reference material when working with related libraries
- Distrust your built-in knowledge for external libraries, frameworks, and tools.
- Prefer library source and tests over docs.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results
- Before using a third party API, check the source code in `.dotai/repos/<library>` first.
- If `.dotai/repos/<library>` does not exist, run `git clone --depth 1 <library_url> .dotai/repos/<library>` to clone the library.
- Do not edit files under `.dotai/repos/`
- Do not import from `.dotai/repos/` - application code should continue importing from normal package dependencies

### Effect

When writing Effect code, inspect `.dotai/repos/effect/` for examples of idiomatic usage, tests, module structure, and API design. The `.dotai/repos/effect/LLMS.md` is an authoritative source for information about Effect patterns. Treat it as the source of truth for Effect patterns.
