import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { WorkerService } from './worker/worker.service';

/** Background worker process: the same modules as the API, without an HTTP listener. */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(WorkerService).start();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
