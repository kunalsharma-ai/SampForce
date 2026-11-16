import './observability/tracing';
import 'reflect-metadata';
import { loadApiEnv } from '@dealflow/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadServerSecrets } from './common/server-secrets';
import { startMetricsServer } from './observability/metrics';
import { WorkerService } from './worker/worker.service';

/** Background worker process: the same modules as the API, without an HTTP listener. */
async function main(): Promise<void> {
  // Production: ENCRYPTION_KEY and the session signing secrets live in the database (ADR 0059), so they are read first.
  await loadServerSecrets();
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const worker = app.get(WorkerService);
  worker.start();
  const env = loadApiEnv();
  // Liveness for the orchestrator: a worker whose loop has stopped finishing passes gets restarted.
  if (env.METRICS_PORT) startMetricsServer(env.METRICS_PORT, () => worker.isHealthy());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
