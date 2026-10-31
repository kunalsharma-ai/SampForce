// Tracing must load before anything it instruments.
import './observability/tracing';
import { loadApiEnv } from '@dealflow/config';
import { createApp } from './bootstrap';
import { startMetricsServer } from './observability/metrics';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const app = await createApp();
  await app.listen(env.API_PORT);
  if (env.METRICS_PORT) startMetricsServer(env.METRICS_PORT);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
