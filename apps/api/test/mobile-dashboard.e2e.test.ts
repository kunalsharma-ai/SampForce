import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, type MobileAppConfig, type MobileDashboard, type MobileDashboardCardData, type MobileTargetRow } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/**
 * The phone's home screen figures and Sales targets (ADR 0072, M5): the cards the configuration chose for the level,
 * counted from the same records and dashboards as the web.
 */
describe('mobile dashboard', () => {
  let app: INestApplication;
  let owner: TestUser;
  let exec: TestUser & { userId: string; workspaceId: string };
  let ownerToken = '';
  let execToken = '';
  const http = () => request(app.getHttpServer());
  const signIn = (u: { email: string; password: string }) =>
    http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: u.email, password: u.password, device: { platform: 'ANDROID', installId: `dash-${randomUUID().slice(0, 8)}`, model: 'Pixel 10', osVersion: '17', appVersion: '1.0.0' } });
  const get = (token: string, url: string) => http().get(`/api/v1/mobile${url}`).set('authorization', `Bearer ${token}`);
  const dashboard = async (token: string, period = 'MONTH') => (await get(token, `/dashboard?period=${period}`).expect(200)).body as MobileDashboard;
  const card = (d: MobileDashboard, key: string) => d.cards.find((c) => c.card === key) as MobileDashboardCardData;
  const statOf = (c: MobileDashboardCardData, label: string) => c.stats.find((s) => s.label === label)?.value;
  const publish = async (change: (c: MobileAppConfig) => void) => {
    const draft = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
    change(draft);
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', { note: 'Dashboard test' }).expect(200);
  };
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Dashboard Org');
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Field Exec');
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    ownerToken = (await signIn(owner).expect(200)).body.accessToken;
    execToken = (await signIn(exec).expect(200)).body.accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('gives each level the cards its configuration chose, in order', async () => {
    const config = (await get(execToken, '/config').expect(200)).body.config as { dashboard: { card: string }[] };
    const d = await dashboard(execToken);
    expect(d.cards.map((c) => c.card)).toEqual(config.dashboard.map((c) => c.card));
    expect(d.cards.map((c) => c.card)).toContain('todays_target');
    const s = await dashboard(ownerToken);
    expect(s.cards.map((c) => c.card)).toContain('organisation_performance');
    expect(s.cards.map((c) => c.card)).not.toContain('todays_target');
  });

  it('counts today’s leads against the daily target, as the web does', async () => {
    let t = card(await dashboard(execToken), 'todays_target');
    expect(t.empty).toBe('No daily lead target is set for you.');
    await api(owner).post('/targets', { workspaceId: exec.workspaceId, metric: 'LEADS', period: 'DAILY', startsOn: today, amount: 5 }).expect(201);
    await http().post('/api/v1/mobile/records/companies').set('authorization', `Bearer ${execToken}`).send({ name: 'Morning Lead' }).expect(201);
    t = card(await dashboard(execToken), 'todays_target');
    expect(t.empty).toBeNull();
    expect(statOf(t, 'Leads today')).toBe(1);
    expect(statOf(t, 'Target')).toBe(5);
    expect(statOf(t, 'Still needed')).toBe(4);
    expect(t.bars[0]?.percent).toBe(20);
    // The web's own dashboard agrees.
    const web = (await api(exec).get('/workspace-dashboard?period=TODAY').expect(200)).body as { today: { leads: number; leadTarget: number } };
    expect(web.today).toMatchObject({ leads: 1, leadTarget: 5 });
    // The organisation sees the lead too.
    const org = card(await dashboard(ownerToken), 'leads_today');
    expect(statOf(org, 'Leads today')).toBe(1);
  });

  it('lists open tasks and follow-ups on their cards', async () => {
    const soon = new Date(Date.now() - 60_000).toISOString();
    await http().post('/api/v1/mobile/records/tasks').set('authorization', `Bearer ${execToken}`).send({ title: 'Overdue call', dueAt: soon }).expect(201);
    const c = card(await dashboard(execToken), 'my_tasks');
    expect(statOf(c, 'Open')).toBe(1);
    expect(statOf(c, 'Overdue')).toBe(1);
    expect(c.bars[0]).toMatchObject({ label: 'Overdue call', overdue: true });
    expect(c.opens).toBe('tasks');
  });

  it('shows the pipeline, with amounts only for levels that may see them', async () => {
    await api(owner).post('/deals', { name: 'Big order', amount: 12000, currency: 'USD' }).expect(201);
    const s = card(await dashboard(ownerToken), 'pipeline_summary');
    expect(statOf(s, 'Open deals')).toBeGreaterThanOrEqual(1);
    expect(statOf(s, 'Pipeline value')).toBeGreaterThanOrEqual(12000);
    // Deal amounts are hidden from Executives by default.
    const e = card(await dashboard(execToken), 'pipeline_summary');
    expect(e.stats.map((x) => x.label)).toEqual(['Open deals']);
    expect(e.bars.every((b) => b.amount === undefined)).toBe(true);
  });

  it('follows a new card choice once published', async () => {
    await publish((c) => {
      c.dashboard.EXECUTIVE = [
        { card: 'my_tasks', showChart: false },
        { card: 'todays_target', showChart: true },
      ];
    });
    const d = await dashboard(execToken);
    expect(d.cards.map((c) => [c.card, c.showChart])).toEqual([
      ['my_tasks', false],
      ['todays_target', true],
    ]);
  });

  it('lists the targets the person can see, and refuses when the module is off', async () => {
    const rows = (await get(execToken, '/targets').expect(200)).body as MobileTargetRow[];
    expect(rows).toEqual([expect.objectContaining({ metric: 'LEADS', period: 'DAILY', amount: 5, achieved: 1, workspace: 'Field Exec' })]);
    await publish((c) => {
      c.modules.targets.enabled = false;
    });
    expect((await get(execToken, '/targets').expect(403)).body.error.code).toBe('MOBILE_MODULE_OFF');
    // The card that needs targets goes with it; the rest stay.
    expect((await dashboard(execToken)).cards.map((c) => c.card)).not.toContain('todays_target');
    await publish(() => {});
  });

  it('rejects a period it does not know and callers without a phone session', async () => {
    await get(execToken, '/dashboard?period=YEAR').expect(400);
    await http().get('/api/v1/mobile/dashboard').expect(401);
  });
});
