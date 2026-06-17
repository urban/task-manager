# Task Manager

## Tooling

- `bun run check` runs linting, typechecking, and tests.
- `bun run format` runs Oxfmt.
- `bun run lint` runs Oxfmt and OxLint with fixes.
- `bun run typecheck` runs Effect-aware TypeScript-Go project references.
- `bun run test` runs Vitest.

## TypeScript-Go + Effect diagnostics

This repo includes `@typescript/native-preview` and `@effect/tsgo`. The Effect language-service plugin is configured in `tsconfig.base.json` with all current diagnostics enabled as errors.

`bun install` runs the `prepare` script, which patches the local `tsgo` binary before Effect-aware checks run.

## Development

```bash
bun run dev
```

The current scaffold verifies workspace imports, package boundaries, config shape, and protocol/domain package seams. Turn-based HTTP contracts, browser UX, persistence, and provider integrations come in later milestones.
