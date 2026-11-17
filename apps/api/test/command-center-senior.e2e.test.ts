import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

type Slice = { key: string; amount: number; link: { kind: string; id: string } | null };
type Person = { person: { id: string }; business: number; leads: number; leadsConverted: number; score: number | null };

/**
 * Phase 6 of the company-centric CRM (ADR 0063): the Senior Management dashboard. Organisation KPIs, departments and
 * teams, rankings that weigh quality as well as volume, revenue breakdowns that add up to the total with each deal
 * counted once, and insights drawn from the records.
 */
describe('senior management command center', () => {
  let app: INestApplication;
  let owner: TestUser & { userId: string };
  let http: ReturnType<typeof api>;
  let manager: TestUser & { userId: string };
  let a: TestUser & { userId: string };
  let b: TestUser & { userId: string };
  let s: TestUser & { userId: string };
  let bd: string;
  let sales: string;
  let acme: string;
  const q = (extra = '') => `period=this_month&tz=UTC${extra}`;
  const sum = (list: { amount: number }[]) => Math.round(list.reduce((x, y) => x + y.amount, 0) * 100) / 100;

  beforeAll(async () => {
    app = await startApp();
    const o = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(o);
    owner = { ...o, userId: (await http.get('/auth/me').expect(200)).body.user.id };
    manager = await inviteMember(app, owner, 'manager');
    a = await inviteMember(app, owner, 'member');
    b = await inviteMember(app, owner, 'member');
    s = await inviteMember(app, owner, 'member');
    const dept = async (name: string) => {
      const list = (await http.get('/crm-config/departments').expect(200)).body as Array<{ id: string; name: string }>;
      return list.find((d) => d.name === name)?.id ?? (await http.post('/crm-config/departments', { name }).expect(201)).body.id;
    };
    bd = await dept('Business Development');
    sales = await dept('Sales');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; tier: string }>;
    const exec = designations.find((d) => d.tier === 'EXECUTIVE')!.id;
    const mgr = designations.find((d) => d.tier === 'MANAGER')!.id;
    await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { designationId: mgr, departmentId: bd, reportingManagerId: owner.userId }).expect(200);
    for (const u of [a, b]) await http.patch(`/tenants/current/members/${mId(u.userId)}/org`, { designationId: exec, departmentId: bd, reportingManagerId: manager.userId }).expect(200);
    await http.patch(`/tenants/current/members/${mId(s.userId)}/org`, { designationId: exec, departmentId: sales, reportingManagerId: owner.userId }).expect(200);

    const stages = (await http.get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    const openStage = stages.find((x) => x.category === 'OPEN')!.id;
    const wonStage = stages.find((x) => x.category === 'WON')!.id;
    const win = async (who: TestUser, name: string, amount: number, companyId: string) => {
      const deal = (await api(who).post('/deals', { name, amount, companyId, stageId: openStage }).expect(201)).body;
      await api(who).post(`/deals/${deal.id}/move`, { stageId: wonStage }).expect(200);
      return deal.id as string;
    };

    // A: six leads, one of them won (10,000), two RFQs from it, five overdue follow-ups, a 20,000 monthly target.
    acme = (await api(a).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN', industry: 'Market research' } }).expect(201)).body.company.id;
    for (const n of ['Bolt', 'Cobalt', 'Dune', 'Ember', 'Flint']) await api(a).post('/company-leads', { company: { name: `${n} Surveys`, country: 'IN' } }).expect(201);
    await win(a, 'Acme tracker', 10000, acme);
    for (const p of ['Wave 1', 'Wave 2']) await api(a).post('/rfqs', { companyId: acme, projectName: p, methodology: 'CATI' }).expect(201);
    for (let i = 0; i < 5; i++) await api(a).post('/follow-ups', { companyId: acme, type: 'CALL', title: `Chase ${i}`, dueAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() }).expect(201);
    // B: one lead won for 3,000, shared 50/50 with S. S: one lead won for 2,000.
    const bCo = (await api(b).post('/company-leads', { company: { name: 'Gamma Field', country: 'GB', industry: 'Healthcare' } }).expect(201)).body.company.id;
    const sCo = (await api(s).post('/company-leads', { company: { name: 'Helix Data', country: 'DE' } }).expect(201)).body.company.id;
    await win(b, 'Gamma study', 3000, bCo);
    await win(s, 'Helix panel', 2000, sCo);
    const rec = ((await http.get('/revenue-records').expect(200)).body as Array<{ recordId: string; project: string }>).find((r) => r.project === 'Gamma study')!;
    await http.put(`/revenue-records/${rec.recordId}/credits`, { credits: [{ userId: b.userId, percent: 50 }, { userId: s.userId, percent: 50 }] }).expect(200);

    const month = new Date().toISOString().slice(0, 7);
    await http.put('/command-center/targets', { period: month, userId: a.userId, amount: 20000 }).expect(200);
    await http.put('/command-center/targets', { period: month, userId: null, amount: 50000 }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('opens on the senior dashboard and counts the organisation from its records, each deal once', async () => {
    expect((await http.get('/command-center/context').expect(200)).body.defaultView).toBe('senior');
    const d = (await http.get(`/command-center/senior?${q()}`).expect(200)).body;
    expect(d.coverage).toBe('ORG');
    expect(d.people).toBe(5);
    const kpi = (key: string) => d.kpis.find((k: { key: string }) => k.key === key)?.value;
    expect(kpi('leadsGenerated')).toBe(8);
    expect(kpi('rfqsReceived')).toBe(2);
    expect(kpi('clientsConverted')).toBe(3);
    expect(kpi('revenue')).toBe(15000);
    // 3 of the 8 leads are clients now; 15,000 of the 50,000 workspace target.
    expect(kpi('conversionRate')).toBe(37.5);
    expect(kpi('targetAchievement')).toBe(30);
    expect(d.target).toEqual({ target: 50000, achieved: 15000, percent: 30 });
    expect(d.kpis).toHaveLength(15);
    // The conversion card opens the converted leads themselves.
    const drill = (await http.get(`/command-center/drill?${q('&metric=conversionRate&scope=org')}`).expect(200)).body;
    expect(drill.total).toBe(3);
  });

  it('adds departments and teams up from their people, without counting a shared deal twice', async () => {
    const d = (await http.get(`/command-center/senior?${q()}`).expect(200)).body;
    const dept = (id: string | null) => d.departmentRows.find((r: { department: { id: string } | null }) => (r.department?.id ?? null) === id);
    expect(dept(bd)).toMatchObject({ people: 3, leads: 7, rfqsReceived: 2, clientsConverted: 2, business: 11500, managers: [expect.objectContaining({ person: expect.objectContaining({ id: manager.userId }), reports: 2, business: 11500 })] });
    expect(dept(sales)).toMatchObject({ people: 1, leads: 1, business: 3500 });
    expect(dept(null)).toMatchObject({ people: 1, business: 0 });
    expect(d.departmentRows.reduce((x: number, r: { business: number }) => x + r.business, 0)).toBe(15000);
    // The owner heads everyone: their team holds every share once, 15,000, though B and S share Gamma.
    expect(dept(null).managers).toEqual([expect.objectContaining({ person: expect.objectContaining({ id: owner.userId }), reports: 4, business: 15000 })]);
    expect(d.revenue.byManager.find((x: Slice) => x.key === owner.userId).amount).toBe(15000);
  });

  it('ranks on quality as well as volume and names the leaders', async () => {
    const d = (await http.get(`/command-center/senior?${q()}`).expect(200)).body;
    const row = (id: string) => d.ranking.people.find((p: Person) => p.person.id === id) as Person & { achievement: number; leadConversion: number; status: string };
    expect(row(a.userId)).toMatchObject({ leads: 6, leadsConverted: 1, business: 10000, achievement: 50, leadConversion: 16.7 });
    expect(row(s.userId).business).toBe(3500);
    expect(row(manager.userId).score).toBeNull();
    const leader = (c: string) => d.ranking.leaders.find((l: { category: string }) => l.category === c);
    expect(leader('revenue')).toMatchObject({ person: { id: a.userId }, value: 10000, detail: { label: 'target', value: 50 } });
    expect(leader('leads')).toMatchObject({ person: { id: a.userId }, value: 6, detail: { label: 'leadConversion', value: 16.7 } });
    expect(leader('targetAchievement').person.id).toBe(a.userId);
    // Nobody sent five emails, so no one leads on response rate.
    expect(leader('responseRate').person).toBeNull();
    // The order follows the balanced score, not lead count alone.
    const scores = d.ranking.people.map((p: Person) => p.score ?? -1);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });

  it('breaks revenue down by person, team, department, client, country, industry and service, each adding up', async () => {
    const r = (await http.get(`/command-center/senior?${q()}`).expect(200)).body.revenue;
    expect(r.total).toBe(15000);
    for (const k of ['byEmployee', 'byDepartment', 'byClient', 'byCountry', 'byIndustry', 'byService']) expect(sum(r[k])).toBe(15000);
    expect(r.byEmployee.find((x: Slice) => x.key === b.userId).amount).toBe(1500);
    expect(r.byClient[0]).toMatchObject({ key: acme, amount: 10000, link: { kind: 'company', id: acme } });
    expect(r.byCountry.map((x: Slice) => [x.key, x.amount])).toEqual([['IN', 10000], ['GB', 3000], ['DE', 2000]]);
    // The won deal has no RFQ, so its service is not recorded.
    expect(r.byService).toEqual([expect.objectContaining({ key: 'none', amount: 15000 })]);
    expect(r.periods.find((p: { key: string }) => p.key === 'month')).toEqual({ key: 'month', amount: 15000, target: 50000 });
    const month = new Date().toISOString().slice(0, 7);
    expect(r.trend.find((p: { month: string }) => p.month === month)).toEqual({ month, revenue: 15000, target: 50000 });
    // Drill: from a department to its records.
    const drill = (await http.get(`/command-center/drill?${q(`&metric=revenue&scope=org&departmentId=${sales}`)}`).expect(200)).body;
    expect(drill.rows.map((x: { title: string }) => x.title).sort()).toEqual(['Gamma study', 'Helix panel']);
  });

  it('flags what needs attention from the records', async () => {
    const d = (await http.get(`/command-center/senior?${q()}`).expect(200)).body;
    const ins = (k: string) => d.insights.find((i: { kind: string }) => i.kind === k);
    expect(ins('overdueFollowUps').items[0]).toMatchObject({ id: a.userId, value: 5 });
    expect(ins('lowConversion').items.map((i: { id: string }) => i.id)).toEqual([a.userId]);
    expect(ins('repeatRfqs').items[0]).toMatchObject({ id: acme, value: 2 });
    expect(ins('revenueConcentration').items[0]).toMatchObject({ id: acme, value: 66.7 });
    expect(ins('teamsBehind').count).toBe(0);
    expect(ins('stuckNegotiation').count).toBe(0);
    // A concern on Acme shows until it is resolved.
    const concern = (await api(a).post('/client-concerns', { companyId: acme, category: 'PRICING', severity: 'HIGH', title: 'Too expensive' }).expect(201)).body;
    const again = (await http.get(`/command-center/senior?${q()}`).expect(200)).body;
    expect(again.insights.find((i: { kind: string }) => i.kind === 'unresolvedConcerns').items[0]).toMatchObject({ id: acme, value: 1 });
    await api(a).post(`/client-concerns/${concern.id}/resolve`, { resolution: 'Agreed a discount' }).expect(200);
  });

  it('filters to one department, and keeps the dashboard to senior management on plans that include it', async () => {
    const d = (await http.get(`/command-center/senior?${q(`&departmentId=${sales}`)}`).expect(200)).body;
    expect(d).toMatchObject({ coverage: 'VISIBLE', departmentId: sales, people: 1 });
    expect(d.kpis.find((k: { key: string }) => k.key === 'revenue').value).toBe(3500);
    expect(d.revenue.total).toBe(3500);
    await api(manager).get(`/command-center/senior?${q()}`).expect(403);
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, feature: 'senior_dashboard', enabled: false, reason: 'test', updatedBy: 'test' } }));
    await http.get(`/command-center/senior?${q()}`).expect(403);
    expect((await http.get('/command-center/context').expect(200)).body.views).not.toContain('senior');
  });
});
