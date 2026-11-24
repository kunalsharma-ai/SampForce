import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ConsoleDashboard, ConsoleKpiKey } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { ConsoleOverviewService } from '../src/operator/console-overview.service';
import { appClient, ORIGIN, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/**
 * The Console Overview (ADR 0074, C5b): Action Required, 18 KPIs with the value 30 days ago and a daily line, and the
 * charts. The database is shared with other suites, so the checks compare before and after this suite's changes.
 */
describe('Console Overview dashboard', () => {
  let app: INestApplication;
  let admin: Agent;
  let overview: ConsoleOverviewService;
  const saved: Record<string, string | undefined> = {};
  const tag = randomUUID().slice(0, 6);
  const password = 'operator-password-1';
  const post = (url: string, body: object) => admin.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body);
  const load = async () => {
    overview.forget();
    return (await admin.get('/api/v1/operator/overview/dashboard').expect(200)).body as ConsoleDashboard;
  };
  const kpi = (d: ConsoleDashboard, k: ConsoleKpiKey) => d.kpis.find((x) => x.key === k)!;
  const action = (d: ConsoleDashboard, k: string) => d.actions.find((x) => x.key === k)!.count;

  beforeAll(async () => {
    saved.OPERATOR_JWT_SECRET = process.env.OPERATOR_JWT_SECRET;
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    overview = app.get(ConsoleOverviewService);
    const db = appClient();
    await db.platformOperator.create({ data: { email: `overview-${tag}@platform.test`, name: 'Ola Overview', passwordHash: await new PasswordService().hash(password), role: 'ADMIN' } });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    await post('/login', { email: `overview-${tag}@platform.test`, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
    if (saved.OPERATOR_JWT_SECRET === undefined) delete process.env.OPERATOR_JWT_SECRET;
    else process.env.OPERATOR_JWT_SECRET = saved.OPERATOR_JWT_SECRET;
  });

  it('counts new, suspended and deactivated clients in the KPIs, Action Required and client growth', async () => {
    const before = await load();
    expect(before.kpis.map((k) => k.key)).toHaveLength(18);
    for (const k of before.kpis) expect(k.series).toHaveLength(30);
    expect(before.growth).toHaveLength(12);
    expect(before.revenue).toHaveLength(12);

    const a = await registerUser(app, `Overview A ${tag}`);
    const b = await registerUser(app, `Overview B ${tag}`);
    const c = await registerUser(app, `Overview C ${tag}`);
    await post(`/clients/${b.tenantId}/state`, { state: 'SUSPENDED', reason: 'Testing the overview' }).expect(200);
    await post(`/clients/${c.tenantId}/state`, { state: 'DEACTIVATED', reason: 'Testing the overview' }).expect(200);
    expect(a.tenantId).toBeTruthy();

    // Cached for a minute: the same figures until the cache ends.
    expect((await admin.get('/api/v1/operator/overview/dashboard').expect(200)).body.generatedAt).toBe(before.generatedAt);
    const after = await load();
    const diff = (k: ConsoleKpiKey) => kpi(after, k).value - kpi(before, k).value;
    expect(diff('clients.total')).toBe(3);
    expect(diff('clients.suspended')).toBe(1);
    expect(diff('clients.active')).toBe(1);
    expect(diff('workspaces.super')).toBe(3);
    expect(diff('people.users')).toBe(3);
    expect(diff('people.active')).toBe(3);
    expect(action(after, 'suspended') - action(before, 'suspended')).toBe(1);
    const month = (d: ConsoleDashboard) => d.growth[11]!;
    expect(month(after).new - month(before).new).toBe(3);
    expect(month(after).churned - month(before).churned).toBe(1);
    expect(month(after).active - month(before).active).toBe(2);
    // Today's point on each card's line is the value now.
    expect(kpi(after, 'clients.total').series[29]).toBe(kpi(after, 'clients.total').value);
    expect(after.workspaces.super).toBe(kpi(after, 'workspaces.super').value);
  });

  it('stores the KPI values once a day and shows the change against 30 days ago', async () => {
    const db = appClient();
    try {
      const far = new Date('2099-01-01T12:00:00Z');
      await db.platformMetricDaily.deleteMany({ where: { day: '2099-01-01' } });
      expect(await overview.snapshot(far)).toBe(1);
      expect(await overview.snapshot(far)).toBe(0);
      const row = await db.platformMetricDaily.findUniqueOrThrow({ where: { day: '2099-01-01' } });
      expect(Object.keys(row.metrics as object)).toHaveLength(18);
      await db.platformMetricDaily.delete({ where: { day: '2099-01-01' } });

      // A snapshot 30 days ago gives each card its earlier value.
      const now = await load();
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const metrics = Object.fromEntries(now.kpis.map((k) => [k.key, Math.max(0, k.value - 1)]));
      await db.platformMetricDaily.upsert({ where: { day: monthAgo }, create: { day: monthAgo, metrics, currency: now.currency }, update: { metrics, currency: now.currency } });
      const later = await load();
      const total = kpi(later, 'clients.total');
      expect(total.previous).toBe(Math.max(0, total.value - 1));
      expect(total.series[29]).toBe(total.value);
      // Money from a snapshot in another currency is not compared.
      await db.platformMetricDaily.update({ where: { day: monthAgo }, data: { currency: 'XXX' } });
      const other = await load();
      expect(kpi(other, 'revenue.mrr').previous).toBeNull();
      expect(kpi(other, 'clients.total').previous).toBe(Math.max(0, total.value - 1));
    } finally {
      await db.$disconnect();
    }
  });
});
