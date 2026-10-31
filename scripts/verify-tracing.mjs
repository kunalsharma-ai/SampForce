// Starts the built API with OpenTelemetry pointed at a local OTLP/HTTP receiver, makes a few requests and
// reports what arrived. Usage: node scripts/verify-tracing.mjs (needs `pnpm build` and the dev database).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const received = [];
const receiver = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/v1/traces') received.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
}).listen(4318);

const api = spawn('node', ['apps/api/dist/main.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: '4010',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://dealflow_app:dealflow_app_dev@localhost:5432/dealflow',
    JWT_ACCESS_SECRET: 'tracing-check-secret-at-least-32-characters',
    LOG_LEVEL: 'warn',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
    OTEL_BSP_SCHEDULE_DELAY: '300',
    OTEL_SERVICE_NAME: 'dealflow-api',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) {
  if (await fetch('http://127.0.0.1:4010/api/v1/health/live').then((r) => r.ok, () => false)) break;
  await sleep(200);
}
await fetch('http://127.0.0.1:4010/api/v1/health/ready');
await fetch('http://127.0.0.1:4010/api/v1/public/pricing');
await fetch('http://127.0.0.1:4010/api/v1/auth/sso/callback?code=secret-code&state=secret-state', { redirect: 'manual' });
await fetch('http://127.0.0.1:4010/api/v1/auth/invitations/secret-invite-token');
await sleep(2500);
api.kill('SIGTERM');
await sleep(1000);
receiver.close();

const spans = received.flatMap((p) => p.resourceSpans ?? []).flatMap((rs) => (rs.scopeSpans ?? []).flatMap((ss) => (ss.spans ?? []).map((s) => ({ scope: ss.scope?.name, name: s.name, attrs: Object.fromEntries((s.attributes ?? []).map((a) => [a.key, Object.values(a.value ?? {})[0]])) }))));
const service = received[0]?.resourceSpans?.[0]?.resource?.attributes?.find((a) => a.key === 'service.name')?.value?.stringValue;
const text = JSON.stringify(received);
const report = {
  exports: received.length,
  service,
  spans: spans.length,
  scopes: [...new Set(spans.map((s) => s.scope))].sort(),
  httpRoutes: [...new Set(spans.filter((s) => s.scope?.includes('http')).map((s) => s.attrs['http.target'] ?? s.attrs['url.path']).filter(Boolean))].sort(),
  healthTraced: text.includes('/health/'),
  secretsLeaked: ['secret-code', 'secret-state', 'secret-invite-token'].filter((s) => text.includes(s)),
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.spans > 0 && report.secretsLeaked.length === 0 && !report.healthTraced ? 0 : 1);
