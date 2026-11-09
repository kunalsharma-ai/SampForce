# ADR 0058: MongoDB in place of PostgreSQL, with workspace isolation in the database client

- Status: Accepted
- Date: 2026-11-09
- Supersedes: ADR 0003 (row-level security) and the claim mechanism of ADR 0007 (`FOR UPDATE SKIP LOCKED`). ADR 0002 (NestJS on Express) stands unchanged.

## Context

Kunal asked for "expressjs and mongodb in place of fastify and pg". The API already ran NestJS on Express
(`@nestjs/platform-express`); Fastify appeared only as an optional peer dependency in the lockfile, so the HTTP side
needed no change. This ADR is about the database.

The PostgreSQL design leaned on database features MongoDB does not have: forced row-level security on every
workspace table (93 policies), `set_config` for the workspace and user of each transaction, advisory locks,
sequences, `FOR UPDATE SKIP LOCKED` queue claims, a trigger that filed email into inbox conversations, `NUMERIC`
money, partial and expression indexes, `pg_trgm` similarity search and about a hundred raw SQL queries.

## Decision

**Prisma stays, on its MongoDB connector.** The 125 models keep their names, fields and relations, so ~1,000 Prisma
calls in the API did not change. MongoDB 8 runs as a replica set (one member is enough), because SampForce relies on
multi-document transactions.

**Workspace isolation moves into the database client** (`packages/database/src/scope.ts`, the "workspace guard").
Every query made through the client the API uses passes through a Prisma extension that reads the current context
(workspace, user and a few named exceptions) from AsyncLocalStorage, set by `withDbContext` as `set_config` was:

- reads on workspace collections get `tenant_id = <workspace>` added to their filter, including nested to-many
  `include`/`select`, `findRaw` and `aggregateRaw` (a leading `$match`);
- creates must carry the context's workspace (nested creates included); updates may not write another
  `tenant_id`; updates and deletes only match the workspace's documents;
- personal collections (navigation, next-action decisions, notifications, private saved views) also match the user;
- with no context, nothing is visible and nothing can be written;
- the old narrow policies become named exceptions: token lookups for public pages (one model and its token field
  only), the worker's cross-workspace scan of queue collections, and the operator console's read-only scan;
- the append-only collections (audit logs, AI usage, domain events, form submissions...) refuse updates or deletes.

`withDbContext(..., { system: true })` skips the guard; only scripts and test set-up use it.

**What replaced the other PostgreSQL features:**

| PostgreSQL | MongoDB |
| --- | --- |
| Migrations (56 SQL files) | `pnpm db:setup` (`src/setup.ts`): creates collections and the indexes the schema declares, plus partial and case-insensitive ones it cannot, drops stale ones, seeds the plan catalogue. Idempotent. |
| `FOR UPDATE SKIP LOCKED` | A conditional `updateMany` per due document that writes the lease (`apps/api/src/worker/queue.ts`): exactly one worker's update matches. |
| Advisory locks, sequences | A `counters` collection: writing a lock document makes a concurrent transaction fail with a write conflict, which `withDbContext` retries. |
| Lock waits | MongoDB aborts a conflicting transaction at once; `withDbContext` retries up to 12 times with jittered back-off, so callers still see "one after the other". |
| `NUMERIC(18,2)` | Doubles rounded to the old scale on every write (`src/money.ts`). |
| Partial unique indexes on optional columns | Partial indexes on `{ field: { $gte: '' } }`; creates store omitted optional fields as explicit nulls so `field: null` filters match. |
| Enum order in `ORDER BY` | Rank fields kept beside the enum (`status_rank`, ...), maintained by the client. |
| `NULLS LAST` | `nullsLast()` in `orderBy`: the client runs the non-null and null parts as two queries. |
| `ILIKE` | Regex filters, with the user's text escaped by the client. |
| `pg_trgm` search | Every word must match some field; hits ranked by a JavaScript port of `word_similarity`. |
| Email threading trigger | `storeEmail` (`apps/api/src/integrations/threading.ts`) when an email is stored. |
| SQL reports and analytics | Aggregation pipelines (`apps/api/src/reports/report-pipeline.ts`) or batched queries joined in the API. |

## Consequences

- **Isolation is enforced by the application, not the database.** A bug in the guard, or code that uses a raw
  MongoDB driver instead of the guarded client, could cross workspaces; PostgreSQL would have refused. Mitigations:
  the API has one way to reach the database (`PrismaService`, the guarded client); `test/workspace-guard.e2e.test.ts`
  and the existing isolation suites exercise every rule; the MongoDB user the API connects as can only read and write
  documents in the SampForce database (a custom role; it cannot drop or change indexes or collections). Enterprise Plus can still get a dedicated database.
- Transactions are optimistic: hot documents (a counter, a popular deal) cause retries rather than waits. `fn` passed
  to `withDbContext` must not have side effects outside the database that cannot run twice (this was already true).
- Several reports and dashboards now load the matching documents and aggregate them in the API. Fine at the sizes
  we test (the load seed: 20,000 deals); revisit with pipelines if a workspace grows far beyond that.
- Backups are `mongodump` archives with a manifest of document counts; restores go into a new database and switching
  points SampForce at it (MongoDB cannot rename a database). Point-in-time recovery needs MongoDB's own tooling.
- There is no tool to copy an existing PostgreSQL install's data into MongoDB. No production install existed when
  this was decided; one would need writing before migrating a live deployment.
