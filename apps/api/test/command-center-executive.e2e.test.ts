import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/**
 * Phase 4 of the company-centric CRM (ADR 0063): revenue records with attribution, lead transfer requests, deals scoped
 * to each role's record visibility, and the Executive dashboard counted from real records.
 */
describe('executive command center', () => {
  let app: INestApplication;
  let owner: TestUser & { userId: string };
  let http: ReturnType<typeof api>;
  let manager: TestUser & { userId: string };
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let companyId: string;
  let wonStage: string;
  let openStage: string;
  let dealId: string;
  const tz = 'Asia/Kolkata';
  const q = (extra = '') => `period=this_month&tz=${encodeURIComponent(tz)}${extra}`;

  beforeAll(async () => {
    app = await startApp();
    const o = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(o);
    owner = { ...o, userId: (await http.get('/auth/me').expect(200)).body.user.id };
    manager = await inviteMember(app, owner, 'manager');
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    const designations = (await http.get('/crm-config/designations').expect(200)).body as Array<{ id: string; name: string; tier: string }>;
    const bde = designations.find((d) => d.tier === 'EXECUTIVE')!;
    const mgr = designations.find((d) => d.tier === 'MANAGER')!;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { reportingManagerId: manager.userId, designationId: bde.id }).expect(200);
    await http.patch(`/tenants/current/members/${mId(other.userId)}/org`, { reportingManagerId: manager.userId, designationId: bde.id }).expect(200);
    await http.patch(`/tenants/current/members/${mId(manager.userId)}/org`, { designationId: mgr.id }).expect(200);

    const lead = (await api(rep).post('/company-leads', { company: { name: 'Acme Panels', country: 'IN' }, employees: [{ firstName: 'Priya', lastName: 'Nair' }] }).expect(201)).body;
    companyId = lead.company.id;
    const pipeline = (await http.get('/pipelines').expect(200)).body[0];
    wonStage = pipeline.stages.find((s: { category: string }) => s.category === 'WON').id;
    openStage = pipeline.stages.find((s: { category: string }) => s.category === 'OPEN').id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('gives each person the dashboards of their designation tier', async () => {
    const r = (await api(rep).get('/command-center/context').expect(200)).body;
    expect(r).toMatchObject({ tier: 'EXECUTIVE', tierSource: 'designation', views: ['executive', 'analytics'], recordScope: 'OWN', reportingManager: { id: manager.userId } });
    const m = (await api(manager).get('/command-center/context').expect(200)).body;
    expect(m).toMatchObject({ tier: 'MANAGER', views: ['manager', 'executive', 'analytics'], defaultView: 'manager' });
    expect(m.reports.map((p: { id: string }) => p.id).sort()).toEqual([rep.userId, other.userId].sort());
    // The owner has no designation: their role makes them senior management.
    const o = (await http.get('/command-center/context').expect(200)).body;
    expect(o).toMatchObject({ tier: 'SENIOR', tierSource: 'role', views: ['senior', 'manager', 'executive', 'analytics'] });
  });

  it('numbers deals, copies the lead creator and manager, and scopes deals to record visibility', async () => {
    const deal = (await api(rep).post('/deals', { name: 'India B2B panel', amount: 10_000, companyId }).expect(201)).body;
    dealId = deal.id;
    expect(deal.dealNumber).toMatch(/^DEAL-\d{4}$/);
    expect(deal).toMatchObject({ leadCreatorId: rep.userId, managerId: manager.userId });
    // Another rep (own records only) cannot see it; the manager (team) and the owner can.
    await api(other).get(`/deals/${dealId}`).expect(404);
    expect((await api(other).get('/deals').expect(200)).body.items).toHaveLength(0);
    await api(manager).get(`/deals/${dealId}`).expect(200);
    await api(other).post(`/deals/${dealId}/move`, { stageId: wonStage }).expect(404);
    // Supporting people must be workspace members, and see the deal once named.
    await api(rep).patch(`/deals/${dealId}`, { supportingUserIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    await api(rep).patch(`/deals/${dealId}`, { supportingUserIds: [other.userId] }).expect(200);
    await api(other).get(`/deals/${dealId}`).expect(200);
  });

  it('keeps one revenue record per won deal and splits it by the rule without counting twice', async () => {
    // Shared credit: 30% lead creator, 50% closer, 20% account owner. The rep created and owns the lead, the owner closes.
    await asTenant(owner.tenantId, (tx) => tx.tenant.update({ where: { id: owner.tenantId }, data: { revenueAttribution: { model: 'SHARED', leadCreatorPct: 30, closerPct: 50, accountOwnerPct: 20, supportersPct: 0 } } }));
    await http.patch(`/deals/${dealId}`, { ownerId: owner.userId, supportingUserIds: [] }).expect(200);
    await http.post(`/deals/${dealId}/move`, { stageId: wonStage }).expect(200);
    const recs = (await http.get('/revenue-records').expect(200)).body;
    expect(recs).toHaveLength(1);
    const credits = Object.fromEntries(recs[0].credits.map((c: { user: { id: string }; percent: number }) => [c.user.id, c.percent]));
    expect(credits).toEqual({ [rep.userId]: 50, [owner.userId]: 50 });
    expect(recs[0]).toMatchObject({ value: 10_000, source: 'DEAL', leadCreator: { id: rep.userId }, manager: { id: manager.userId } });

    const repDash = (await api(rep).get(`/command-center/executive?${q()}`).expect(200)).body;
    const kpi = (d: { kpis: Array<{ key: string; value: number }> }, key: string) => d.kpis.find((k) => k.key === key)?.value;
    expect(kpi(repDash, 'revenue')).toBe(5000);
    expect(repDash.revenue.periods.find((p: { period: string }) => p.period === 'this_month')).toMatchObject({ amount: 5000, dealValue: 10_000, deals: 1 });
    expect(repDash.revenue.lines[0]).toMatchObject({ project: 'India B2B panel', percent: 50, contribution: 5000, roles: expect.arrayContaining(['LEAD_GENERATION', 'ACCOUNT_OWNERSHIP']) });
    expect(kpi(repDash, 'clientsConverted')).toBe(1);
    const ownerDash = (await http.get(`/command-center/executive?${q()}`).expect(200)).body;
    expect(kpi(ownerDash, 'revenue')).toBe(5000);

    // Reopening the deal voids the record, and the revenue goes with it; winning it again brings one record back.
    await http.post(`/deals/${dealId}/move`, { stageId: openStage }).expect(200);
    expect((await http.get('/revenue-records').expect(200)).body).toHaveLength(0);
    expect(kpi((await api(rep).get(`/command-center/executive?${q()}`).expect(200)).body, 'revenue')).toBe(0);
    await http.post(`/deals/${dealId}/move`, { stageId: wonStage }).expect(200);
    expect((await http.get('/revenue-records').expect(200)).body).toHaveLength(1);
  });

  it('takes a split by hand that sums to 100%, and keeps it when the rule changes', async () => {
    const [rec] = (await http.get('/revenue-records').expect(200)).body;
    const bad = await http.put(`/revenue-records/${rec.recordId}/credits`, { credits: [{ userId: rep.userId, percent: 60 }, { userId: owner.userId, percent: 30 }] }).expect(400);
    expect(bad.body.error.message).toBeTruthy();
    await api(rep).put(`/revenue-records/${rec.recordId}/credits`, { credits: [{ userId: rep.userId, percent: 100 }] }).expect(403);
    const set = (await http.put(`/revenue-records/${rec.recordId}/credits`, { credits: [{ userId: rep.userId, percent: 70 }, { userId: other.userId, percent: 30 }] }).expect(200)).body;
    expect(set.manual).toBe(true);
    await asTenant(owner.tenantId, (tx) => tx.tenant.update({ where: { id: owner.tenantId }, data: { revenueAttribution: { model: 'DEAL_CLOSURE' } } }));
    await http.post('/revenue-records/recalculate').expect(200);
    const after = (await http.get(`/revenue-records/${rec.recordId}`).expect(200)).body;
    expect(after.credits.map((c: { percent: number }) => c.percent)).toEqual([70, 30]);
    // A rep sees records they hold a share of, never others'.
    expect((await api(rep).get('/revenue-records').expect(200)).body).toHaveLength(1);
    await api(manager).get(`/revenue-records/${rec.recordId}`).expect(200);
    // Recognised and collected amounts cannot exceed the won value.
    await http.patch(`/revenue-records/${rec.recordId}`, { collectedAmount: 20_000 }).expect(400);
    expect((await http.patch(`/revenue-records/${rec.recordId}`, { recognisedAmount: 10_000, collectedAmount: 4000, paymentStatus: 'PARTIAL' }).expect(200)).body).toMatchObject({ recognised: 10_000, collected: 4000, paymentStatus: 'PARTIAL' });
    // Back on the rule: the closer (the owner) gets it all.
    const reset = (await http.post(`/revenue-records/${rec.recordId}/credits/reset`).expect(200)).body;
    expect(reset.updated).toBeGreaterThan(0);
    const ruled = (await http.get(`/revenue-records/${rec.recordId}`).expect(200)).body;
    expect(ruled).toMatchObject({ manual: false, credits: [{ user: { id: owner.userId }, percent: 100 }] });
  });

  it('moves a lead to a manager through a transfer request, keeping the creator', async () => {
    const r = api(rep);
    await r.post('/lead-transfers', { companyId, reason: 'REASSIGNED' }).expect(400);
    const t = (await r.post('/lead-transfers', { companyId, toUserId: manager.userId, reason: 'HIGH_VALUE', opportunityValue: 50_000, currency: 'USD', remarks: 'Needs a senior on the pricing call' }).expect(201)).body;
    expect(t).toMatchObject({ status: 'PENDING', from: { id: rep.userId }, proposed: { id: manager.userId }, creator: { id: rep.userId }, canDecide: false });
    await r.post('/lead-transfers', { companyId, reason: 'TECHNICAL' }).expect(400); // one pending at a time
    // Only someone above the requester decides; a peer cannot.
    await api(other).post(`/lead-transfers/${t.id}/decision`, { action: 'APPROVE' }).expect(403);
    const inbox = (await api(manager).get('/lead-transfers?box=toDecide').expect(200)).body;
    expect(inbox.map((x: { id: string; canDecide: boolean }) => [x.id, x.canDecide])).toEqual([[t.id, true]]);
    const managerNotes = (await api(manager).get('/notifications').expect(200)).body.items;
    expect(managerNotes.some((n: { type: string }) => n.type === 'lead_transfer.requested')).toBe(true);

    const done = (await api(manager).post(`/lead-transfers/${t.id}/decision`, { action: 'APPROVE', instructions: 'I will take the pricing call' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'APPROVED', newOwner: { id: manager.userId }, decidedBy: { id: manager.userId } });
    await api(manager).post(`/lead-transfers/${t.id}/decision`, { action: 'REJECT' }).expect(400);
    const company = (await http.get(`/companies/${companyId}`).expect(200)).body;
    expect(company).toMatchObject({ owner: { id: manager.userId }, createdBy: { id: rep.userId } });
    const history = (await http.get(`/companies/${companyId}/owner-history`).expect(200)).body;
    expect(history[0]).toMatchObject({ from: { id: rep.userId }, to: { id: manager.userId }, reason: 'HIGH_VALUE' });
    const repNotes = (await r.get('/notifications').expect(200)).body.items;
    expect(repNotes.some((n: { type: string; title: string }) => n.type === 'lead_transfer.approved' && n.title.includes('Acme Panels'))).toBe(true);

    const dash = (await r.get(`/command-center/executive?${q()}`).expect(200)).body;
    expect(dash.kpis.find((k: { key: string }) => k.key === 'transfersToSenior').value).toBe(1);
    const drill = (await r.get(`/command-center/drill?${q('&metric=transfersToSenior')}`).expect(200)).body;
    expect(drill.rows).toMatchObject([{ kind: 'transfer', subtitle: 'HIGH_VALUE', person: { id: manager.userId } }]);
  });

  it('counts the executive cards from real records, and each card opens the same records', async () => {
    const r = api(rep);
    const lead = (await r.post('/company-leads', { company: { name: 'Beta Insights', country: 'GB' }, employees: [{ firstName: 'Sam', lastName: 'Lee' }] }).expect(201)).body;
    const cid = lead.company.id;
    const sam = lead.employeeIds[0];
    await r.post('/interactions', { companyId: cid, contactId: sam, kind: 'EMAIL_SENT', subject: 'Intro' }).expect(201);
    await r.post('/interactions', { companyId: cid, contactId: sam, kind: 'EMAIL_RECEIVED', subject: 'Re: Intro', sentiment: 'POSITIVE' }).expect(201);
    await r.post('/follow-ups', { companyId: cid, contactId: sam, type: 'CALL', title: 'Overdue call', dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }).expect(201);
    const rfq = (await r.post('/rfqs', { companyId: cid, contactId: sam, projectName: 'UK B2B study', sampleSize: 200, cpi: 25, currency: 'USD', deadlineAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }).expect(201)).body;

    const d = (await r.get(`/command-center/executive?${q()}`).expect(200)).body;
    const kpi = (key: string) => d.kpis.find((k: { key: string }) => k.key === key)?.value;
    expect(kpi('leadsGenerated')).toBe(2);
    expect(kpi('activeCompanies')).toBe(1); // Acme went to the manager
    expect(kpi('emailsSent')).toBe(1);
    expect(kpi('responses')).toBe(1);
    expect(kpi('positiveResponses')).toBe(1);
    expect(kpi('employeesContacted')).toBe(1);
    expect(kpi('followUpsOverdue')).toBe(1);
    expect(kpi('rfqsReceived')).toBe(1);
    expect(d.kpis).toHaveLength(15);
    for (const key of ['leadsGenerated', 'emailsSent', 'responses', 'followUpsOverdue', 'rfqsReceived', 'activeCompanies']) {
      const drill = (await r.get(`/command-center/drill?${q(`&metric=${key}`)}`).expect(200)).body;
      expect(drill.total, key).toBe(kpi(key));
    }
    // My Work: the overdue call and the RFQ deadline; the funnel puts Beta at RFQ received.
    expect(d.work.find((w: { id: string }) => w.id === 'overdue').items[0]).toMatchObject({ title: 'Overdue call', overdue: true });
    expect(d.work.find((w: { id: string }) => w.id === 'rfqDeadlines').items[0]).toMatchObject({ id: rfq.id });
    expect(d.work.find((w: { id: string }) => w.id === 'awaiting').total).toBe(0); // they replied
    const stage = d.funnel.find((f: { stage: string }) => f.stage === 'RFQ_RECEIVED');
    expect(stage).toMatchObject({ companies: 1, opportunities: 1, potentialValue: 5000 });
    const st = (await r.get(`/command-center/drill?${q('&metric=stage:RFQ_RECEIVED')}`).expect(200)).body;
    expect(st.rows.map((x: { id: string }) => x.id)).toEqual([cid]);
    expect(d.performance).toMatchObject({ rfqsReceived: 1, leads: { month: 2, year: 2 } });
  });

  it('shows a target and the achievement against it', async () => {
    const month = new Date().toLocaleString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).slice(0, 7);
    await api(rep).put('/command-center/targets', { period: month, userId: rep.userId, amount: 1000 }).expect(403);
    await api(manager).put('/command-center/targets', { period: month, userId: rep.userId, amount: 1000 }).expect(200);
    // A manager cannot set a target for someone outside their team (the owner).
    await api(manager).put('/command-center/targets', { period: month, userId: owner.userId, amount: 1000 }).expect(403);
    const d = (await api(rep).get(`/command-center/executive?${q()}`).expect(200)).body;
    expect(d.month).toMatchObject({ target: 1000 });
    expect(d.performance.target).toBe(1000);
  });

  it('opens a report’s dashboard for their manager only, and keeps each person’s layout', async () => {
    await api(other).get(`/command-center/executive?${q(`&userId=${rep.userId}`)}`).expect(403);
    const viaManager = (await api(manager).get(`/command-center/executive?${q(`&userId=${rep.userId}`)}`).expect(200)).body;
    expect(viaManager.person.id).toBe(rep.userId);
    const layout = { sections: [{ id: 'exec.revenue', hidden: false }, { id: 'exec.kpis', hidden: true }], workSections: [{ id: 'overdue', hidden: false }, { id: 'today', hidden: true }], categories: [{ id: 'rfq-calls', label: 'RFQ calls', followUpType: 'RFQ', priority: null }] };
    await api(rep).put('/command-center/layout/EXECUTIVE', { layout }).expect(200);
    expect((await api(rep).get('/command-center/layout/EXECUTIVE').expect(200)).body).toEqual({ layout });
    expect((await api(other).get('/command-center/layout/EXECUTIVE').expect(200)).body).toEqual({ layout: null });
    const d = (await api(rep).get(`/command-center/executive?${q()}`).expect(200)).body;
    expect(d.work[0].id).toBe('overdue');
    expect(d.work.some((w: { id: string }) => w.id === 'today')).toBe(false);
    expect(d.work.find((w: { id: string }) => w.id === 'cat:rfq-calls')).toMatchObject({ label: 'RFQ calls' });
  });

  it('switches transfers and revenue off with their plan features', async () => {
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.createMany({ data: [{ tenantId: owner.tenantId, feature: 'lead_transfers', enabled: false, reason: 'test', updatedBy: 'test' }, { tenantId: owner.tenantId, feature: 'revenue_attribution', enabled: false, reason: 'test', updatedBy: 'test' }] }));
    await api(rep).get('/lead-transfers').expect(403);
    await http.get('/revenue-records').expect(403);
    const d = (await api(rep).get(`/command-center/executive?${q()}`).expect(200)).body;
    expect(d.features).toEqual({ revenueAttribution: false, leadTransfers: false });
    expect(d.revenue).toBeNull();
    expect(d.kpis.map((k: { key: string }) => k.key)).not.toContain('revenue');
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.deleteMany({ where: { tenantId: owner.tenantId } }));
  });
});
