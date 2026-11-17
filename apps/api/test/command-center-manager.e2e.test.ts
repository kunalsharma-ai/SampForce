import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/**
 * Phase 5 of the company-centric CRM (ADR 0063): the Manager dashboard counted from the team's real records, manager
 * instructions, client concerns with escalation, and notifications that carry who sent them.
 */
describe('manager command center', () => {
  let app: INestApplication;
  let owner: TestUser & { userId: string };
  let http: ReturnType<typeof api>;
  let manager: TestUser & { userId: string };
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let outsider: TestUser & { userId: string };
  let companyId: string;
  let otherCompanyId: string;
  const q = (extra = '') => `period=this_month&tz=UTC${extra}`;

  beforeAll(async () => {
    app = await startApp();
    const o = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(o);
    owner = { ...o, userId: (await http.get('/auth/me').expect(200)).body.user.id };
    manager = await inviteMember(app, owner, 'manager');
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    outsider = await inviteMember(app, owner, 'member');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; tier: string }>;
    const bde = designations.find((d) => d.tier === 'EXECUTIVE')!;
    const mgr = designations.find((d) => d.tier === 'MANAGER')!;
    await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { designationId: mgr.id, reportingManagerId: owner.userId }).expect(200);
    for (const u of [rep, other]) await http.patch(`/tenants/current/members/${mId(u.userId)}/org`, { reportingManagerId: manager.userId, designationId: bde.id }).expect(200);
    await http.patch(`/tenants/current/members/${mId(outsider.userId)}/org`, { designationId: bde.id }).expect(200);

    // The rep: two leads, an email with no reply, an overdue follow-up and a won deal. The other rep: one lead.
    const lead = (await api(rep).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN' }, employees: [{ firstName: 'Priya', lastName: 'Nair' }] }).expect(201)).body;
    companyId = lead.company.id;
    await api(rep).post('/company-leads', { company: { name: 'Bolt Surveys', country: 'IN' } }).expect(201);
    otherCompanyId = (await api(other).post('/company-leads', { company: { name: 'Crest Insights', country: 'GB' } }).expect(201)).body.company.id;
    await api(outsider).post('/company-leads', { company: { name: 'Outside Co', country: 'US' } }).expect(201);
    await api(rep).post('/interactions', { companyId, contactId: lead.employeeIds[0], kind: 'EMAIL_SENT', subject: 'Panel proposal' }).expect(201);
    await api(rep).post('/follow-ups', { companyId, type: 'CALL', title: 'Chase the proposal', dueAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(201);
    const stages = (await http.get('/pipelines').expect(200)).body[0].stages as { id: string; category: string }[];
    const deal = (await api(rep).post('/deals', { name: 'Panel study', amount: 8000, companyId, stageId: stages.find((s) => s.category === 'OPEN')!.id }).expect(201)).body;
    await api(rep).post(`/deals/${deal.id}/move`, { stageId: stages.find((s) => s.category === 'WON')!.id }).expect(200);
    await api(other).post('/deals', { name: 'Crest tracker', amount: 5000, companyId: otherCompanyId }).expect(201);
    // An unowned lead for the unassigned list.
    await asTenant(owner.tenantId, async (tx) => {
      await tx.company.create({ data: { tenantId: owner.tenantId, name: 'Nobody Owns Me Ltd', createdById: owner.userId } });
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('counts the team (the manager and their reports) from real records, and leaves others out', async () => {
    const d = (await api(manager).get(`/command-center/manager?${q()}`).expect(200)).body;
    expect(d.person.id).toBe(manager.userId);
    expect(d.teamSize).toBe(2);
    const kpi = (key: string) => d.kpis.find((k: { key: string }) => k.key === key)?.value;
    expect(kpi('leadsGenerated')).toBe(3);
    expect(kpi('followUpsOverdue')).toBe(1);
    expect(kpi('revenue')).toBe(8000);
    expect(kpi('openOpportunities')).toBe(5000);
    expect(d.kpis).toHaveLength(16);
    // The team table: the manager first, then the rep with the business.
    expect(d.team.map((r: { person: { id: string } }) => r.person.id)).toEqual([manager.userId, rep.userId, other.userId]);
    const row = d.team.find((r: { person: { id: string } }) => r.person.id === rep.userId);
    expect(row).toMatchObject({ direct: true, leads: 2, emailsSent: 1, followUpsOverdue: 1, business: 8000, wonDeals: 1, target: null, status: 'NO_TARGET', responseRate: 0 });
    // The rows add up to the team total.
    expect(d.team.reduce((a: number, r: { business: number }) => a + r.business, 0)).toBe(kpi('revenue'));
    // Funnel with people per stage and the revenue won.
    const won = d.funnel.find((f: { stage: string }) => f.stage === 'WON');
    expect(won).toMatchObject({ companies: 1, people: 1, wonRevenue: 8000 });
    // Monitoring: the overdue follow-up with its assignee, the email awaiting a reply, the unassigned lead.
    const bucket = (id: string) => d.monitor.find((b: { id: string }) => b.id === id);
    expect(bucket('teamOverdue').items[0]).toMatchObject({ title: 'Chase the proposal', assignee: { id: rep.userId } });
    expect(bucket('teamAwaiting').items[0]).toMatchObject({ title: 'Priya Nair', assignee: { id: rep.userId } });
    expect(bucket('unassigned').items.map((i: { title: string }) => i.title)).toContain('Nobody Owns Me Ltd');
    // Revenue: each person's share and the team total, each deal once.
    expect(d.revenue.team.month).toBe(8000);
    expect(d.revenue.people.find((p: { person: { id: string } }) => p.person.id === rep.userId).month).toBe(8000);
  });

  it('sums the team target and drills into the same records', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await http.put('/command-center/targets', { period: month, userId: rep.userId, amount: 10_000 }).expect(200);
    await http.put('/command-center/targets', { period: month, userId: other.userId, amount: 6_000 }).expect(200);
    const d = (await api(manager).get(`/command-center/manager?${q()}`).expect(200)).body;
    expect(d.month).toEqual({ target: 16_000, achieved: 8000, percent: 50 });
    expect(d.team.find((r: { person: { id: string } }) => r.person.id === rep.userId)).toMatchObject({ target: 10_000, achievement: 80 });
    const drill = (await api(manager).get(`/command-center/drill?${q('&metric=leadsGenerated&scope=team')}`).expect(200)).body;
    expect(drill.total).toBe(3);
    expect(drill.rows.map((r: { title: string }) => r.title).join(' ')).not.toContain('Outside Co');
  });

  it('opens a report’s team for their manager, and refuses people outside it', async () => {
    const d = (await http.get(`/command-center/manager?${q(`&userId=${manager.userId}`)}`).expect(200)).body;
    expect(d.team).toHaveLength(3);
    // The owner's own team covers the manager's team too: managers within it get their own revenue line.
    const mine = (await http.get(`/command-center/manager?${q()}`).expect(200)).body;
    expect(mine.revenue.managers.find((m: { person: { id: string } }) => m.person.id === manager.userId)).toMatchObject({ teamSize: 3, month: 8000 });
    await api(rep).get(`/command-center/manager?${q(`&userId=${other.userId}`)}`).expect(403);
  });

  it('sends instructions down the reporting lines, which the recipient acknowledges and completes', async () => {
    await api(rep).post('/instructions', { toUserId: other.userId, message: 'Help me' }).expect(403);
    await api(manager).post('/instructions', { toUserId: outsider.userId, message: 'Not my team' }).expect(403);
    const ins = (await api(manager).post('/instructions', { toUserId: rep.userId, message: 'Follow up with Priya today', companyId, priority: 'HIGH' }).expect(201)).body;
    expect(ins).toMatchObject({ status: 'OPEN', priority: 'HIGH', to: { id: rep.userId }, from: { id: manager.userId }, company: { id: companyId }, canCancel: true });
    // The recipient's bell names the sender and the company, and asks for action.
    const bell = (await api(rep).get('/notifications').expect(200)).body.items.find((n: { type: string }) => n.type === 'manager.instruction');
    expect(bell).toMatchObject({ sender: { id: manager.userId }, priority: 'HIGH', company: { id: companyId }, actionRequired: true });
    expect((await api(rep).get('/instructions?box=received').expect(200)).body.map((r: { id: string }) => r.id)).toContain(ins.id);
    await api(manager).post(`/instructions/${ins.id}/progress`, { action: 'DONE' }).expect(403);
    await api(rep).post(`/instructions/${ins.id}/progress`, { action: 'ACKNOWLEDGE' }).expect(200);
    const done = (await api(rep).post(`/instructions/${ins.id}/progress`, { action: 'DONE', note: 'Called her' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'DONE', completionNote: 'Called her' });
    expect(done.acknowledgedAt).toBeTruthy();
    const told = (await api(manager).get('/notifications').expect(200)).body.items.map((n: { type: string }) => n.type);
    expect(told).toEqual(expect.arrayContaining(['manager.instruction_acknowledged', 'manager.instruction_done']));
    await api(manager).post(`/instructions/${ins.id}/cancel`).expect(400);
    expect((await api(manager).get('/instructions?box=sent&status=open').expect(200)).body).toHaveLength(0);
  });

  it('raises client concerns, escalates them up the reporting lines and resolves them', async () => {
    const c = (await api(rep).post('/client-concerns', { companyId, category: 'PRICING', title: 'Price is above budget', severity: 'HIGH' }).expect(201)).body;
    expect(c).toMatchObject({ category: 'PRICING', owner: { id: rep.userId }, manager: { id: manager.userId }, status: 'OPEN', canEscalate: true });
    // It shows on the manager's dashboard, in the team box.
    const d = (await api(manager).get(`/command-center/manager?${q()}`).expect(200)).body;
    expect(d.monitor.find((b: { id: string }) => b.id === 'teamConcerns').items[0]).toMatchObject({ id: c.id, assignee: { id: rep.userId } });
    expect((await api(manager).get('/client-concerns?box=team').expect(200)).body.map((r: { id: string }) => r.id)).toContain(c.id);
    // Someone outside the team cannot see or change it.
    await api(outsider).post(`/client-concerns/${c.id}/resolve`, { resolution: 'x' }).expect(404);
    // The rep escalates: it goes to their manager first; the manager escalates on to the owner.
    expect((await api(rep).post(`/client-concerns/${c.id}/escalate`, {}).expect(200)).body.escalatedTo.id).toBe(manager.userId);
    const up = (await api(manager).post(`/client-concerns/${c.id}/escalate`, { note: 'Needs a pricing decision' }).expect(200)).body;
    expect(up).toMatchObject({ escalatedTo: { id: owner.userId }, escalationNote: 'Needs a pricing decision' });
    const senior = (await http.get(`/command-center/manager?${q()}`).expect(200)).body;
    expect(senior.monitor.find((b: { id: string }) => b.id === 'intervention').items.map((i: { id: string }) => i.id)).toContain(c.id);
    const resolved = (await http.post(`/client-concerns/${c.id}/resolve`, { resolution: 'Agreed a 5% discount' }).expect(200)).body;
    expect(resolved).toMatchObject({ status: 'RESOLVED', resolution: 'Agreed a 5% discount', resolvedBy: { id: owner.userId } });
    await http.post(`/client-concerns/${c.id}/resolve`, { resolution: 'again' }).expect(400);
    expect((await api(rep).get('/notifications').expect(200)).body.items.map((n: { type: string }) => n.type)).toContain('client_concern.resolved');
  });

  it('keeps the manager dashboard, instructions and concerns to plans that include them', async () => {
    await asTenant(owner.tenantId, async (tx) => {
      for (const feature of ['manager_dashboard', 'instructions', 'client_concerns'])
        await tx.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, feature, enabled: false, reason: 'test', updatedBy: 'test' } });
    });
    await api(manager).get(`/command-center/manager?${q()}`).expect(403);
    await api(manager).post('/instructions', { toUserId: rep.userId, message: 'x' }).expect(403);
    await api(rep).get('/client-concerns').expect(403);
    expect((await api(manager).get('/command-center/context').expect(200)).body.views).toEqual(['executive', 'analytics']);
  });
});
