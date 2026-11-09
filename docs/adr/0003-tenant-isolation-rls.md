# ADR 0003: Shared schema with PostgreSQL row-level security

**Status:** superseded by [ADR 0058](0058-mongodb.md) (2026-11-09); accepted 2026-10-30

**Decision.** All tenants share tables. Every tenant table has `tenant_id` and a FORCEd RLS policy. The
runtime role cannot bypass RLS. The API sets `app.tenant_id` per transaction via `set_config(…, true)`.
Application queries also filter by `tenant_id` (defence in depth).

**Why.** Isolation enforced by the database survives application bugs. Transaction-scoped settings are
safe with connection pooling. Cheaper and simpler to operate than schema- or database-per-tenant, while
Enterprise Plus can still get a dedicated database with the same schema.

**Consequences.** Every tenant query runs inside a short transaction. Migrations must add policies for new
tables (CI guard planned for Phase 2). Cross-tenant platform analytics use a separate, audited role.
