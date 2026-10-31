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
import { httpMetricsMiddleware } from './observability/metrics';
import { buildOpenApiDocument } from './openapi/document';

export async function createApp(): Promise<INestApplication> {
  const env = loadApiEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.use(httpMetricsMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  // Replaces Nest's default JSON parser so SCIM clients' application/scim+json bodies are parsed too.
  // 1 MB fits a pasted meeting transcript (up to 200,000 characters); recordings stream past the parsers.
  app.useBodyParser('json', { type: ['application/json', 'application/scim+json'], limit: '1mb' });
  // The website tracking script posts JSON as text/plain so browsers send it without a CORS preflight. Only on its
  // routes: elsewhere text/plain bodies (portal document uploads) must reach their handlers as raw streams.
  app.use('/api/v1/public/track', trackingTextBody);
  app.enableCors({ origin: env.WEB_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
  // Express runs behind the Next.js proxy / load balancer; trust one hop for client IPs.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  app.enableShutdownHooks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SwaggerModule.setup('api/v1/docs', app, buildOpenApiDocument() as any, { jsonDocumentUrl: 'api/v1/openapi.json' });
  return app;
}

type RawRequest = NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined>; body?: unknown };

/** Reads a text/plain body of up to 32 KB into req.body as a string; larger bodies get 413. */
function trackingTextBody(req: RawRequest, res: { statusCode: number; end: () => void }, next: (err?: unknown) => void) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('text/plain')) return next();
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 32 * 1024 && !done) {
      done = true;
      res.statusCode = 413;
      res.end();
    } else if (!done) chunks.push(c);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    req.body = Buffer.concat(chunks).toString('utf8');
    next();
  });
  req.on('error', (e) => {
    if (!done) {
      done = true;
      next(e);
    }
  });
}
