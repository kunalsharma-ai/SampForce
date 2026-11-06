#!/usr/bin/env node
/**
 * Small HTTP load runner for SampForce's read paths. No dependencies.
 *
 *   API=http://localhost:4000/api/v1 EMAIL=load-owner@sampforce.local PASSWORD=... \
 *   CONCURRENCY=10 SECONDS=15 node scripts/load/run.mjs > result.json
 *
 * Signs in once, then for each scenario keeps CONCURRENCY requests in flight for SECONDS and reports
 * throughput and latency percentiles. Run it against a dev or staging stack only, with
 * API_RATE_LIMIT_PER_MINUTE raised for the run; the default rate limit will answer most requests with 429.
 */
const API = process.env.API ?? 'http://localhost:4000/api/v1';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const SECONDS = Number(process.env.SECONDS ?? 15);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const report = (entity, metric, groupBy, chart = 'bar') => ({ name: `report:${entity}`, method: 'POST', path: '/reports/run', body: { definition: { entity, metric, groupBy, filters: [], chart, sort: 'value_desc', limit: 20 } } });

const SCENARIOS = [
  { name: 'dashboard summary', path: '/dashboard/summary' },
  { name: 'deals list', path: '/deals?limit=50' },
  { name: 'deals list (search)', path: '/deals?limit=50&q=Deal%2012' },
  { name: 'deals board', path: '/deals/board' },
  { name: 'leads list', path: '/leads?limit=50' },
  { name: 'contacts list', path: '/contacts?limit=50' },
  { name: 'companies list', path: '/companies?limit=50' },
  { name: 'activities list', path: '/activities?limit=50' },
  { name: 'forecast', path: '/forecast' },
  { ...report('deals', { fn: 'sum', field: 'amount' }, { field: 'stage' }), name: 'report: deal value by stage' },
  { ...report('deals', { fn: 'count' }, { field: 'closedAt', bucket: 'month' }, 'line'), name: 'report: deals closed by month' },
  { ...report('activities', { fn: 'count' }, { field: 'type' }), name: 'report: activities by type' },
  { ...report('leads', { fn: 'sum', field: 'estimatedValue' }, { field: 'country' }), name: 'report: lead value by country' },
  { name: 'insights galaxy', path: '/insights/galaxy' },
  { name: 'insights globe', path: '/insights/globe' },
  { name: 'insights flow', path: '/insights/flow' },
  { name: 'insights replay', path: '/insights/replay' },
];

async function signIn() {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }) });
  const body = await res.json();
  // Tokens arrive as httpOnly cookies; the API also accepts the access token as a Bearer header.
  const access = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('df_access='));
  if (!res.ok || !access) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return access.slice('df_access='.length);
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);

async function run(token, s) {
  const init = { method: s.method ?? 'GET', headers: { authorization: `Bearer ${token}`, ...(s.body ? { 'content-type': 'application/json' } : {}) }, body: s.body ? JSON.stringify(s.body) : undefined };
  // One warm-up request, which also checks the scenario works at all.
  const warm = await fetch(API + s.path, init);
  const warmBody = await warm.text();
  if (!warm.ok) return { name: s.name, error: `${warm.status} ${warmBody.slice(0, 160)}` };
  const latencies = [];
  const statuses = {};
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < end) {
        const t0 = performance.now();
        const res = await fetch(API + s.path, init);
        await res.arrayBuffer();
        latencies.push(performance.now() - t0);
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const r = (v) => (v === null ? null : Math.round(v));
  return { name: s.name, requests: latencies.length, rps: Math.round(latencies.length / SECONDS), p50: r(pct(latencies, 50)), p95: r(pct(latencies, 95)), p99: r(pct(latencies, 99)), max: r(latencies.at(-1) ?? null), bytes: warmBody.length, statuses };
}

const token = await signIn();
const results = [];
for (const s of SCENARIOS) {
  if (ONLY && !ONLY.test(s.name)) continue;
  const r = await run(token, s);
  results.push(r);
  console.error(r.error ? `${s.name.padEnd(32)} ERROR ${r.error}` : `${s.name.padEnd(32)} ${String(r.rps).padStart(5)} req/s  p50 ${String(r.p50).padStart(5)} ms  p95 ${String(r.p95).padStart(5)} ms  p99 ${String(r.p99).padStart(5)} ms  ${JSON.stringify(r.statuses)}`);
}
console.log(JSON.stringify({ api: API, concurrency: CONCURRENCY, seconds: SECONDS, at: new Date().toISOString(), results }, null, 2));
