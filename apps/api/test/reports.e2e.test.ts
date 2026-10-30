import type { INestApplication } from '@nestjs/common';
import type { ReportDefinition, ReportResult } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

const def = (d: Partial<ReportDefinition> & Pick<ReportDefinition, 'entity'>): ReportDefinition => ({
  metric: { fn: 'count' }, groupBy: null, filters: [], chart: 'table', sort: 'value_desc', limit: 20, ...d,
});

/** Report builder, dashboards and the immersive data endpoints, with exact numbers. */
describe('reports and dashboards', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let viewer: TestUser & { userId: string };
  let other: TestUser;
  let base: string;
  let foreign: string;
  let third: string;
  let stages: { id: string; name: string; category: string }[];

  const run = async (who: TestUser, d: ReportDefinition, status = 200) => (await api(who).post('/reports/run', { definition: d }).expect(status)).body as ReportResult;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Reports Co');
    other = await registerUser(app, 'Other Reports Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'professional', seats: 10 } }));
    member = await inviteMember(app, owner, 'member');
    viewer = await inviteMember(app, owner, 'viewer');
    const o = api(owner);
    base = (await o.get('/tenants/current').expect(200)).body.defaultCurrency;
    foreign = base === 'EUR' ? 'GBP' : 'EUR';
    third = base === 'JPY' ? 'CHF' : 'JPY';
    await o.put('/analytics/exchange-rates', { currency: foreign, rate: 2, effectiveDate: ymd(0) }).expect(200);
    stages = (await o.get('/pipelines').expect(200)).body[0].stages;
    const open = stages.filter((s) => s.category === 'OPEN');
    const won = stages.find((s) => s.category === 'WON')!;
    const acme = (await o.post('/companies', { name: 'Acme', country: 'DE' }).expect(201)).body.id;
    const globex = (await o.post('/companies', { name: 'Globex', country: 'IN', parentCompanyId: acme }).expect(201)).body.id;
    await o.post('/contacts', { firstName: 'Ada', lastName: 'Lovelace', companyId: acme }).expect(201);
    const deal = async (body: object, as: TestUser = owner) => (await api(as).post('/deals', { stageId: open[0]!.id, ...body }).expect(201)).body.id as string;
    await deal({ name: 'A1', amount: 1000, companyId: acme });
    await deal({ name: 'A2', amount: 500, companyId: acme, stageId: open[1]!.id });
    await deal({ name: 'G1 foreign', amount: 100, currency: foreign, companyId: globex });
    await deal({ name: 'No rate', amount: 70, currency: third });
    await deal({ name: '100% sure_thing', amount: 250 }, member);
    const w = await deal({ name: 'Won one', amount: 4000, companyId: globex });
    await o.post(`/deals/${w}/move`, { stageId: open[1]!.id }).expect(200);
    await o.post(`/deals/${w}/move`, { stageId: won.id }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('sums open pipeline by stage in the workspace currency and reports what it could not convert', async () => {
    const r = await run(member, def({ entity: 'deals', metric: { fn: 'sum', field: 'amount' }, groupBy: { field: 'stage' }, filters: [{ field: 'status', op: 'eq', value: 'OPEN' }], chart: 'bar' }));
    const open = stages.filter((s) => s.category === 'OPEN');
    expect(r.currency).toBe(base);
    // 1000 + 200 (100 foreign at 2) + 250 in the first stage, 500 in the second; 70 in a currency with no rate.
    expect(r.rows).toEqual([
      { key: open[0]!.name, label: open[0]!.name, value: 1450 },
      { key: open[1]!.name, label: open[1]!.name, value: 500 },
    ]);
    expect(r.total).toBe(1950);
    expect(r.records).toBe(5);
    expect(r.excluded).toEqual({ records: 1, currencies: [third] });
  });

  it('counts, buckets dates and labels members', async () => {
    const byOwner = await run(owner, def({ entity: 'deals', groupBy: { field: 'owner' } }));
    expect(byOwner.rows.map((x) => [x.label, x.value])).toEqual([['User Reports Co', 5], ['Member member', 1]]);
    const byMonth = await run(owner, def({ entity: 'deals', groupBy: { field: 'createdAt', bucket: 'month' }, chart: 'line', sort: 'label_asc' }));
    expect(byMonth.rows).toHaveLength(1);
    expect(byMonth.rows[0]!.value).toBe(6);
    expect(byMonth.rows[0]!.key).toMatch(/^\d{4}-\d{2}-01$/);
    const single = await run(owner, def({ entity: 'companies', chart: 'number' }));
    expect(single.rows).toEqual([{ key: null, label: 'All', value: 2 }]);
    const countries = await run(owner, def({ entity: 'companies', groupBy: { field: 'country' }, sort: 'label_asc' }));
    expect(countries.rows.map((x) => x.label)).toEqual(['Germany', 'India']);
    const avg = await run(owner, def({ entity: 'deals', metric: { fn: 'max', field: 'amount' }, filters: [{ field: 'status', op: 'eq', value: 'WON' }], chart: 'number' }));
    expect(avg.total).toBe(4000);
  });

  it('treats filter values as data: wildcards are literal and SQL text matches nothing', async () => {
    const pct = await run(owner, def({ entity: 'deals', filters: [{ field: 'name', op: 'contains', value: '100%' }], chart: 'number' }));
    expect(pct.total).toBe(1);
    const underscore = await run(owner, def({ entity: 'deals', filters: [{ field: 'name', op: 'contains', value: 'n_o' }], chart: 'number' }));
    expect(underscore.total).toBe(0);
    const inj = await run(owner, def({ entity: 'deals', filters: [{ field: 'name', op: 'eq', value: "x' OR '1'='1" }], chart: 'number' }));
    expect(inj.total).toBe(0);
    const recent = await run(owner, def({ entity: 'deals', filters: [{ field: 'createdAt', op: 'last_n_days', value: 1 }, { field: 'amount', op: 'gte', value: 1000 }], chart: 'number' }));
    expect(recent.total).toBe(2);
  });

  it('rejects definitions outside the catalogue', async () => {
    const bad = [
      def({ entity: 'deals', groupBy: { field: 'tenant_id' } }),
      def({ entity: 'deals', metric: { fn: 'sum', field: 'name' } }),
      def({ entity: 'deals', filters: [{ field: 'amount; DROP TABLE deals', op: 'eq', value: 1 }] }),
      def({ entity: 'deals', filters: [{ field: 'status', op: 'eq', value: 'PAID' }] }),
      def({ entity: 'deals', groupBy: { field: 'closedAt' } }),
      def({ entity: 'deals', chart: 'pie' }),
    ];
    for (const d of bad) {
      const res = await api(owner).post('/reports/run', { definition: d }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('saves private and shared reports; only authors and report managers edit them', async () => {
    const mine = (await api(member).post('/reports', { name: 'My pipeline', definition: def({ entity: 'deals' }) }).expect(201)).body;
    expect(mine.editable).toBe(true);
    const shared = (await api(member).post('/reports', { name: 'Team pipeline', visibility: 'WORKSPACE', definition: def({ entity: 'deals', chart: 'number' }) }).expect(201)).body;
    const viewerList = (await api(viewer).get('/reports').expect(200)).body as { id: string; editable: boolean }[];
    expect(viewerList.map((r) => r.id)).toEqual([shared.id]);
    expect(viewerList[0]!.editable).toBe(false);
    await api(viewer).get(`/reports/${mine.id}`).expect(404);
    await api(viewer).post('/reports', { name: 'Nope', definition: def({ entity: 'deals' }) }).expect(403);
    const res = (await api(viewer).get(`/reports/${shared.id}/result`).expect(200)).body as ReportResult;
    expect(res.total).toBe(6);
    // The owner (reports:manage) may edit the shared report but not hide it from its author.
    await api(owner).put(`/reports/${shared.id}`, { name: 'Team pipeline v2', visibility: 'WORKSPACE', definition: def({ entity: 'deals', chart: 'number' }) }).expect(200);
    await api(owner).put(`/reports/${shared.id}`, { name: 'Hidden', visibility: 'PRIVATE', definition: def({ entity: 'deals' }) }).expect(400);
    await api(owner).get(`/reports/${mine.id}`).expect(404);
    await api(other).get(`/reports/${shared.id}`).expect(404);
  });

  it('exports CSV only with data:export, and audits it', async () => {
    const r = (await api(owner).post('/reports', { name: 'Deals by status', visibility: 'WORKSPACE', definition: def({ entity: 'deals', groupBy: { field: 'status' } }) }).expect(201)).body;
    await api(member).get(`/reports/${r.id}/export`).expect(403);
    const csv = await api(owner).get(`/reports/${r.id}/export`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.trim().split(/\r?\n/)).toEqual(['Status,Number of deals', 'Open,5', 'Won,1']);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, action: 'report.exported' } }));
    expect(audit).toHaveLength(1);
  });

  it('needs read access to the records a report covers', async () => {
    const role = (await api(owner).post('/tenants/current/roles', { name: 'Leads only', permissions: ['reports:read', 'reports:write', 'leads:read'] }).expect(201)).body;
    const limited = await inviteMember(app, owner, role.key);
    await run(limited, def({ entity: 'leads', chart: 'number' }));
    const denied = await api(limited).post('/reports/run', { definition: def({ entity: 'deals', chart: 'number' }) }).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await api(limited).post('/reports', { name: 'Sneaky', definition: def({ entity: 'deals' }) }).expect(403);
    await api(limited).get('/insights/flow').expect(403);
  });

  it('builds dashboards from visible reports and drops deleted reports from them', async () => {
    const a = (await api(member).post('/reports', { name: 'Private A', definition: def({ entity: 'deals', chart: 'number' }) }).expect(201)).body;
    const b = (await api(member).post('/reports', { name: 'Shared B', visibility: 'WORKSPACE', definition: def({ entity: 'leads', chart: 'number' }) }).expect(201)).body;
    const ownerPrivate = (await api(owner).post('/reports', { name: 'Owner private', definition: def({ entity: 'deals' }) }).expect(201)).body;
    await api(member).post('/dashboards', { name: 'Bad', widgets: [{ reportId: ownerPrivate.id }] }).expect(400);
    await api(member).post('/dashboards', { name: 'Bad shared', visibility: 'WORKSPACE', widgets: [{ reportId: a.id }] }).expect(400);
    await api(member).post('/dashboards', { name: 'Dup', widgets: [{ reportId: a.id }, { reportId: a.id }] }).expect(400);
    const board = (await api(member).post('/dashboards', { name: 'Mine', widgets: [{ reportId: a.id, size: 'sm' }, { reportId: b.id, size: 'lg' }] }).expect(201)).body;
    expect(board.widgets).toEqual([{ reportId: a.id, size: 'sm' }, { reportId: b.id, size: 'lg' }]);
    await api(member).del(`/reports/${a.id}`).expect(204);
    const after = (await api(member).get(`/dashboards/${board.id}`).expect(200)).body;
    expect(after.widgets).toEqual([{ reportId: b.id, size: 'lg' }]);
    await api(viewer).get(`/dashboards/${board.id}`).expect(404);
    await api(other).get('/dashboards').expect(200).expect([]);
  });

  it('records stage history and serves flow, replay, galaxy and globe data', async () => {
    const flow = (await api(member).get('/insights/flow').expect(200)).body;
    const open = stages.filter((s) => s.category === 'OPEN');
    const won = stages.find((s) => s.category === 'WON')!;
    expect(flow.stages.find((s: { id: string }) => s.id === open[0]!.id).openDeals).toBe(4);
    expect(flow.transitions).toEqual(expect.arrayContaining([{ from: open[0]!.id, to: open[1]!.id, deals: 1 }, { from: open[1]!.id, to: won.id, deals: 1 }]));
    const replay = (await api(member).get('/insights/replay?days=30').expect(200)).body;
    expect(replay.deals).toHaveLength(6);
    expect(replay.events).toHaveLength(8);
    expect(replay.reconstructed).toBe(false);
    const galaxy = (await api(member).get('/insights/galaxy').expect(200)).body;
    expect(galaxy.nodes.filter((n: { kind: string }) => n.kind === 'company')).toHaveLength(2);
    expect(galaxy.nodes.filter((n: { kind: string }) => n.kind === 'contact')).toHaveLength(1);
    expect(galaxy.nodes.filter((n: { kind: string }) => n.kind === 'deal')).toHaveLength(4);
    expect(galaxy.edges).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'parent' })]));
    const globe = (await api(member).get('/insights/globe').expect(200)).body;
    expect(globe.countries).toEqual([
      { country: 'DE', companies: 1, openDeals: 2, openValue: 1500, wonValue: 0 },
      { country: 'IN', companies: 1, openDeals: 1, openValue: 200, wonValue: 4000 },
    ]);
    expect(globe.unplaced).toEqual({ companies: 0, openDeals: 2 });
    // Nothing leaks across workspaces.
    const elsewhere = (await api(other).get('/insights/globe').expect(200)).body;
    expect(elsewhere.countries).toEqual([]);
    const otherReplay = (await api(other).get('/insights/replay').expect(200)).body;
    expect(otherReplay.events).toEqual([]);
  });

  it('keeps stage history append-only for the application role', async () => {
    await expect(asTenant(owner.tenantId, (tx) => tx.dealStageEvent.updateMany({ where: { tenantId: owner.tenantId }, data: { reconstructed: true } }))).rejects.toThrow();
  });
});
