# Performance (Phase 8 load test)

Measured on the build machine (4 vCPU, PostgreSQL 16 on the same host, one API process, no CDN), so absolute
numbers will differ in production. What matters is relative cost and the regressions the test found.

## Method

- `pnpm --filter @dealflow/api seed:load` creates a labelled demo workspace ("Load Test Workspace"); it refuses to
  run when `NODE_ENV=production`. Scale 1 = 5,000 companies, 25,000 contacts, 25,000 leads, 20,000 deals with
  stage history and 100,000 activities. Scale 10 is ten times that (1.95 million rows).
- `scripts/load/run.mjs` signs in once and, for each of 17 read scenarios (lists, board, dashboard, forecast,
  four reports, four immersive views), keeps N requests in flight for S seconds. Raise
  `API_RATE_LIMIT_PER_MINUTE` for the run, on a non-production stack only.
- Raw results: `phase8-load-c1.*` (1 in flight), `phase8-load-c10.*` (10 in flight), `phase8-load-x10-c1.*`
  (scale 10, 1 in flight).

## What the test found and fixed

| Problem | Cause | Fix | Before → after |
|---|---|---|---|
| Pipeline replay took 6–20 s and starved the connection pool (500s elsewhere) | After five executions Postgres switched the prepared statement to a generic plan that assumed one row per tenant and chose nested loops | `plan_cache_mode = force_custom_plan` in every tenant transaction | p95 20 s → 152 ms (10 in flight) |
| Lead value by country report ~420 ms | JIT compilation (390 ms) triggered by high cost estimates | `jit = off` in every tenant transaction | p95 ~460 ms → 64 ms (1 in flight) |
| Revenue Globe 243 ms | All open and won deals loaded into Node | Aggregate per country, status and currency in SQL | p50 243 ms → 22 ms |
| Forecast 400 ms and a 1.9 MB response | Every open deal loaded, then filtered by quarter in Node; every line returned | Period filter in SQL, only needed columns, at most 300 lines returned (totals still cover all deals; snapshots keep every line) | p50 403 ms → 141 ms |
| `pg_dump` refused to run | Forced RLS applies to the owner role too | `dealflow_backup` role with BYPASSRLS | Backup works |

## Results at scale 1, 10 requests in flight (p95, ms)

Lists: deals 77, leads 53, contacts 75, companies 113, activities 69. Deals board 237. Dashboard 153.
Reports 131–306. Galaxy 208, Globe 80, Flow 490, Replay 152. Forecast 947 (CPU-bound: about 6,600 deals in the
quarter are priced in Node; at 1 in flight it is 153).

## Known limits (not fixed in Phase 8)

At scale 10 with 1 request in flight: forecast 2.6 s (about 66,000 deals in one quarter), pipeline flow 1.0 s,
dashboard 0.32 s, most reports 0.3–0.4 s, lists 0.1–0.3 s. A tenant of that size needs the forecast to aggregate in
SQL and page its lines, and flow medians to be pre-computed. The per-request numbers above are for one API process;
the chart runs at least two and scales on CPU.
