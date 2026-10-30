# ADR 0004: Prisma 6 as ORM, hand-written SQL for security

**Status:** accepted (2026-10-30)

**Decision.** Prisma schema is the source of truth for tables; migration SQL is generated then extended by
hand for RLS policies, grants, functions and reference data. Raw SQL uses tagged templates only.

**Why.** Typed queries and generated types speed up vertical feature work; generated SQL stays reviewable.
Prisma 6 is used rather than the newest major to avoid driver-adapter churn at this stage.

**Consequences.** Complex analytics use `$queryRaw` with typed result rows (see `DashboardService`).
