# ADR 0001: pnpm workspace monorepo

**Status:** accepted (2026-10-30)

**Decision.** One repository with pnpm workspaces: `apps/*` (api, web; later admin, marketing, worker) and
`packages/*` (types, config, database, ui; later ai, automation, integrations, analytics, billing).

**Why.** Shared Zod schemas validate API input, power web forms and generate OpenAPI from one definition.
Atomic changes across API and UI. pnpm's strict dependency isolation catches undeclared imports.

**Consequences.** Packages compile to CommonJS `dist/` for Node; `@dealflow/ui` ships source and is
transpiled by Next.js. A task runner (Turborepo) can be added when build times warrant it.
