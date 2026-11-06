/**
 * OpenTelemetry tracing, on only when an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT or
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, read by the exporter itself). Import this module first in each
 * entry point so the instrumentations patch http, express, pino and Prisma before they load.
 */
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrismaInstrumentation } from '@prisma/instrumentation';
import { redactUrl } from './redact';

export function tracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) && env.OTEL_SDK_DISABLED !== 'true';
}

let sdk: NodeSDK | undefined;

if (tracingEnabled()) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'sampforce-api',
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? 'dev',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // Probes and scrapes would drown real traffic.
        ignoreIncomingRequestHook: (req) => /^\/api\/v1\/health\//.test(req.url ?? ''),
        requestHook: (span, req) => {
          const url = 'url' in req ? redactUrl(req.url) : undefined;
          if (url) {
            span.setAttribute('http.target', url);
            span.setAttribute('url.path', url.split('?')[0]!);
            const q = url.split('?')[1];
            if (q) span.setAttribute('url.query', q);
          }
        },
      }),
      new ExpressInstrumentation(),
      new PinoInstrumentation(),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  const stop = () => void sdk?.shutdown().catch(() => undefined);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

export {};
