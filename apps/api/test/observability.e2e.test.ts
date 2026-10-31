import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMetricsServer } from '../src/observability/metrics';
import { ORIGIN, registerUser, startApp } from './helpers';

describe('metrics and health', () => {
  let app: INestApplication;
  let metrics: Server;
  let base: string;
  beforeAll(async () => {
    app = await startApp();
    let healthy = true;
    metrics = startMetricsServer(0, () => healthy);
    await new Promise((r) => metrics.once('listening', r));
    base = `http://127.0.0.1:${(metrics.address() as AddressInfo).port}`;
    (globalThis as { setHealthy?: (v: boolean) => void }).setHealthy = (v) => (healthy = v);
  });
  afterAll(async () => {
    await app.close();
    await new Promise((r) => metrics.close(r));
  });

  it('exports request durations by route template, never by raw URL or id', async () => {
    const u = await registerUser(app, 'Metrics Co');
    await u.agent.get('/api/v1/contacts').expect(200);
    await u.agent.get('/api/v1/contacts/00000000-0000-0000-0000-000000000000').expect(404);
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: u.email, password: 'wrong-password-1' }).expect(401);
    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toMatch(/dealflow_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/contacts",status="2xx"\} \d+/);
    expect(text).toMatch(/route="\/api\/v1\/contacts\/:id",status="4xx"/);
    expect(text).not.toContain('00000000-0000-0000-0000-000000000000');
    expect(text).toMatch(/dealflow_auth_events_total\{event="login_failure"\} [1-9]/);
    expect(text).toContain('dealflow_process_cpu_seconds_total');
  });

  it('answers liveness from the health callback, and 404 for anything else', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    (globalThis as { setHealthy?: (v: boolean) => void }).setHealthy!(false);
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('keeps readiness tied to the database', async () => {
    expect((await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200)).body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });
});
