import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { loadApiEnv } from '@dealflow/config';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './openapi/document';

export async function createApp(): Promise<INestApplication> {
  const env = loadApiEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  // Replaces Nest's default JSON parser so SCIM clients' application/scim+json bodies are parsed too.
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'] });
  app.enableCors({ origin: env.WEB_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
  // Express runs behind the Next.js proxy / load balancer; trust one hop for client IPs.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  app.enableShutdownHooks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SwaggerModule.setup('api/v1/docs', app, buildOpenApiDocument() as any, { jsonDocumentUrl: 'api/v1/openapi.json' });
  return app;
}
