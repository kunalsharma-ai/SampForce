// Tracing must load before anything it instruments.
import './observability/tracing';
import { loadApiEnv } from '@dealflow/config';
import { createApp } from './bootstrap';
import { loadServerSecrets } from './common/server-secrets';
import { startMetricsServer } from './observability/metrics';

async function main(): Promise<void> {
  // Production: ENCRYPTION_KEY and the session signing secrets live in the database (ADR 0059), so they are read first.
  await loadServerSecrets();
  const env = loadApiEnv();
  const app = await createApp();
  await app.listen(env.API_PORT);
  if (env.METRICS_PORT) startMetricsServer(env.METRICS_PORT);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
