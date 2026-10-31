import { createServer, type Server } from 'node:http';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Prometheus metrics, served on METRICS_PORT by a listener separate from the public API (so the ingress
 * never exposes them). Labels are bounded: route templates, never raw URLs, ids or tenant names.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'dealflow_' });

export const httpDuration = new Histogram({
  name: 'dealflow_http_request_duration_seconds',
  help: 'API request duration by route template and status class.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const authEvents = new Counter({
  name: 'dealflow_auth_events_total',
  help: 'Sign-in outcomes: login_success, login_failure, mfa_failure, lockout, sso_success, sso_failure.',
  labelNames: ['event'] as const,
  registers: [registry],
});

export const workerTicks = new Counter({
  name: 'dealflow_worker_ticks_total',
  help: 'Worker passes over the queues, by outcome.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const workerItems = new Counter({
  name: 'dealflow_worker_items_total',
  help: 'Items processed by the worker, by queue.',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const workerLastTick = new Gauge({
  name: 'dealflow_worker_last_tick_timestamp_seconds',
  help: 'Unix time the worker last finished a pass.',
  registers: [registry],
});

/** Express-style middleware recording request duration once the response finishes. */
export function httpMetricsMiddleware(req: { method: string; baseUrl?: string; route?: { path?: string } }, res: { statusCode: number; on: (e: 'finish', cb: () => void) => void }, next: () => void): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` });
  });
  next();
}

/** Starts the metrics/health listener. `healthy` decides /healthz (the worker uses it for its liveness probe). */
export function startMetricsServer(port: number, healthy: () => boolean = () => true): Server {
  const server = createServer((req, res) => {
    if (req.url === '/metrics') {
      void registry.metrics().then(
        (body) => {
          res.writeHead(200, { 'content-type': registry.contentType });
          res.end(body);
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
      return;
    }
    if (req.url === '/healthz') {
      const ok = healthy();
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'stalled' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port);
  return server;
}
