import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DEFAULT_HEALTH_SETTINGS, type ClientHealth } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { ConsoleHealthService } from '../src/operator/console-health.service';
import { appClient, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/**
 * Client health score (ADR 0074, C5): measured from data the platform already stores, every signal shown with the
 * figure behind it, weights changed in Settings, and the worker measuring each client once a day.
 */
describe('Console client health score', () => {
  let app: INestApplication;
  let admin: Agent;
  let support: Agent;
  let alpha: TestUser;
  let bravo: TestUser;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: `health-admin-${tag}@platform.test`, name: 'Ada Health', passwordHash, role: 'ADMIN' },
        { email: `health-sup-${tag}@platform.test`, name: 'Sam Health', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: `health-admin-${tag}@platform.test`, password }).expect(200);
    await op(support).post('/login', { email: `health-sup-${tag}@platform.test`, password }).expect(200);
    alpha = await registerUser(app, `Alpha Health ${tag}`);
    bravo = await registerUser(app, `Bravo Health ${tag}`);
  });
  afterAll(async () => {
    // Other suites share the database: put the default weights back.
    await op(admin).put('/settings/health', DEFAULT_HEALTH_SETTINGS);
    await app.close();
    if (saved.OPERATOR_JWT_SECRET === undefined) delete process.env.OPERATOR_JWT_SECRET;
    else process.env.OPERATOR_JWT_SECRET = saved.OPERATOR_JWT_SECRET;
  });

  it('measures a client from its sign-ins, CRM use, payment, support and subscription, with the figure behind each signal', async () => {
    expect((await op(admin).get(`/clients/${alpha.tenantId}/health`).expect(200)).body).toEqual({ health: null });
    const first = (await op(support).post(`/clients/${alpha.tenantId}/health`).expect(200)).body.health as ClientHealth;
    const sig = (h: ClientHealth, k: string) => h.signals.find((s) => s.key === k)!;
    expect(first.signals.map((s) => s.key)).toEqual(['login', 'workspaces', 'features', 'mobile', 'payment', 'support', 'subscription']);
    // The owner signed up, so one of one person signed in; nothing is in the CRM yet; mobile access is off.
    expect(sig(first, 'login')).toMatchObject({ applies: true, count: 1, total: 1, ratio: 1 });
    expect(sig(first, 'features')).toMatchObject({ applies: true, count: 0, total: 6, points: 0 });
    expect(sig(first, 'mobile')).toMatchObject({ applies: false, points: 0, maxPoints: 0, status: 'OFF' });
    expect(sig(first, 'support')).toMatchObject({ count: 0, ratio: 1 });
    // The weights that apply are scaled to 100, and the score is the sum of the points.
    expect(first.signals.reduce((a, s) => a + s.maxPoints, 0)).toBeCloseTo(100, 0);
    expect(first.score).toBe(Math.round(first.signals.reduce((a, s) => a + s.points, 0)));
    expect(first.band).toBe(first.score >= 70 ? 'HEALTHY' : first.score >= 40 ? 'AT_RISK' : 'CRITICAL');
    expect(first.history).toEqual([{ day: new Date().toISOString().slice(0, 10), score: first.score }]);

    // Using the CRM raises feature adoption, and the list shows the new score.
    await alpha.agent.post('/api/v1/contacts').set('origin', ORIGIN).send({ firstName: 'Asha', lastName: 'Rao' }).expect(201);
    const second = (await op(admin).post(`/clients/${alpha.tenantId}/health`).expect(200)).body.health as ClientHealth;
    expect(sig(second, 'features')).toMatchObject({ count: 1, total: 6 });
    expect(second.score).toBeGreaterThan(first.score);
    expect(second.history).toHaveLength(1);
    const page = (await op(admin).get(`/clients/page?search=${encodeURIComponent(`Alpha Health ${tag}`)}`).expect(200)).body as { items: { health: unknown }[] };
    expect(page.items[0]!.health).toEqual({ score: second.score, band: second.band });

    const log = (await op(admin).get(`/audit-log?action=client.health_measured&limit=5`).expect(200)).body as { target: { id: string } | null; before: unknown; after: unknown; operator: { name: string } }[];
    const entry = log.find((l) => l.target?.id === alpha.tenantId)!;
    expect(entry.after).toEqual({ score: second.score, band: second.band });
    expect(entry.before).toEqual({ score: first.score, band: first.band });
  });

  it('changes the weights in Settings, checks them, and measures every client again', async () => {
    expect((await op(support).get('/settings/health').expect(200)).body).toMatchObject(DEFAULT_HEALTH_SETTINGS);
    await op(support).put('/settings/health', DEFAULT_HEALTH_SETTINGS).expect(403);
    const bad = await op(admin).put('/settings/health', { ...DEFAULT_HEALTH_SETTINGS, thresholds: { healthy: 50, atRisk: 60 } }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('The At risk score must be lower than the Healthy score.');
    await op(admin).put('/settings/health', { ...DEFAULT_HEALTH_SETTINGS, weights: { login: 0, workspaces: 0, features: 0, mobile: 0, payment: 0, support: 0, subscription: 0 } }).expect(400);

    // Only feature adoption counts: Bravo has used nothing, so it scores 0 and is Critical.
    const onlyFeatures = { weights: { login: 0, workspaces: 0, features: 10, mobile: 0, payment: 0, support: 0, subscription: 0 }, thresholds: { healthy: 60, atRisk: 30 } };
    const saved = (await op(admin).put('/settings/health', onlyFeatures).expect(200)).body;
    expect(saved).toMatchObject({ ...onlyFeatures, updatedBy: 'Ada Health' });
    const log = (await op(admin).get(`/audit-log?action=settings.health_updated&limit=1`).expect(200)).body as { before: Record<string, unknown>; after: Record<string, unknown> }[];
    expect(log[0]!.after).toMatchObject({ 'weight.login': 0, 'weight.features': 10, healthyFrom: 60 });
    expect(log[0]!.before).toMatchObject({ 'weight.login': 20 });

    // The worker measures again every client measured before the change, a batch per pass.
    const health = app.get(ConsoleHealthService);
    const ours = [alpha.tenantId, bravo.tenantId];
    expect(await health.sweep(new Date(), ours)).toBe(2);
    const bravoHealth = (await op(admin).get(`/clients/${bravo.tenantId}/health`).expect(200)).body.health as ClientHealth;
    expect(bravoHealth).toMatchObject({ score: 0, band: 'CRITICAL' });
    expect(bravoHealth.signals.find((s) => s.key === 'features')).toMatchObject({ maxPoints: 100, points: 0 });
    const alphaHealth = (await op(admin).get(`/clients/${alpha.tenantId}/health`).expect(200)).body.health as ClientHealth;
    // One of six record types in use.
    expect(alphaHealth).toMatchObject({ score: 17, band: 'CRITICAL' });

    // The list filters and sorts on health.
    const list = (q: string) => op(admin).get(`/clients/page?search=${encodeURIComponent(`Health ${tag}`)}&${q}`).expect(200).then((r) => (r.body as { items: { id: string }[] }).items.map((x) => x.id));
    expect(await list('sort=health&dir=desc')).toEqual([alpha.tenantId, bravo.tenantId]);
    expect(await list('health=CRITICAL')).toHaveLength(2);
    expect(await list('health=HEALTHY')).toEqual([]);

    // A pass on a day already measured with the current weights leaves these clients alone.
    const at = bravoHealth.at;
    expect(await health.sweep(new Date(), ours)).toBe(0);
    expect(((await op(admin).get(`/clients/${bravo.tenantId}/health`).expect(200)).body.health as ClientHealth).at).toBe(at);
  });
});
