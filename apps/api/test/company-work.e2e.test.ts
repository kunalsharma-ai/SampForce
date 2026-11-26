import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/** Phase 3 of the company-centric CRM (ADR 0060): company dashboard, interactions, follow-ups and RFQs. */
describe('company work', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let manager: TestUser & { userId: string };
  let companyId: string;
  let priyaId: string;
  let ravId: string;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    http = api(owner);
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    manager = await inviteMember(app, owner, 'manager');
    const members = (await http.get('/tenants/current/members').expect(200)).body as Array<{ membershipId: string; userId: string }>;
    const mId = (u: string) => members.find((m) => m.userId === u)!.membershipId;
    await http.patch(`/tenants/current/members/${mId(rep.userId)}/org`, { reportingManagerId: manager.userId }).expect(200);
    const res = (
      await http
        .post('/company-leads', {
          company: { name: 'Acme Panels', country: 'IN', ownerId: rep.userId },
          employees: [
            { firstName: 'Priya', lastName: 'Nair', jobTitle: 'Procurement Lead', emails: [{ value: 'priya@acmepanels.example' }] },
            { firstName: 'Ravi', lastName: 'Kumar', jobTitle: 'Research Director' },
          ],
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    [priyaId, ravId] = res.employeeIds;
  });
  afterAll(async () => {
    await app.close();
  });

  it('logs interactions of every kind, schedules the follow-up, and merges synced emails marked as synced', async () => {
    const r = api(rep);
    const sent = (
      await r
        .post('/interactions', {
          companyId, contactId: priyaId, kind: 'EMAIL_SENT', subject: 'Panel capabilities deck', sender: 'rep@sampforce.test', recipient: 'priya@acmepanels.example',
          outcome: 'Asked for India B2B feasibility', nextAction: 'Send feasibility', followUpAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body;
    expect(sent).toMatchObject({ source: 'LOGGED', kind: 'EMAIL_SENT', contact: { id: priyaId, name: 'Priya Nair' }, createdBy: { id: rep.userId } });
    await r.post('/interactions', { companyId, contactId: priyaId, kind: 'EMAIL_RECEIVED', subject: 'Re: Panel capabilities deck' }).expect(201);
    await r.post('/interactions', { companyId, contactId: ravId, kind: 'CALL_OUTGOING', subject: 'Intro call' }).expect(201);
    await r.post('/interactions', { companyId, contactId: ravId, kind: 'MEETING', subject: 'Capabilities meeting' }).expect(201);
    await r.post('/interactions', { companyId, kind: 'WHATSAPP', subject: 'Shared office address' }).expect(201);
    // An employee of another company is refused.
    const elsewhere = (await http.post('/company-leads', { company: { name: 'Other Co' }, employees: [{ firstName: 'Zed' }] }).expect(201)).body;
    const bad = await r.post('/interactions', { companyId, contactId: elsewhere.employeeIds[0], kind: 'MEETING', subject: 'x' }).expect(400);
    expect(bad.body.error.details[0].path).toBe('contactId');

    // A synced email from a connected mailbox shows as SYNCED, apart from the logged ones.
    await asTenant(owner.tenantId, async (tx) => {
      const conn = await tx.integrationConnection.create({ data: { tenantId: owner.tenantId, userId: (await tx.membership.findFirstOrThrow({ where: { tenantId: owner.tenantId, role: { key: 'owner' } } })).userId, provider: 'GOOGLE', accountEmail: 'owner@sampforce.test', scopes: [], credentialsEncrypted: 'x' } });
      await tx.emailMessage.create({ data: { tenantId: owner.tenantId, connectionId: conn.id, providerMessageId: 'm1', direction: 'INBOUND', fromAddress: 'priya@acmepanels.example', toAddresses: ['owner@sampforce.test'], ccAddresses: [], subject: 'Feasibility question', sentAt: new Date(), contactId: priyaId } });
    });
    const list = (await r.get(`/companies/${companyId}/interactions`).expect(200)).body as Array<{ source: string; kind: string; subject: string }>;
    expect(list[0]).toMatchObject({ source: 'SYNCED', kind: 'EMAIL_RECEIVED', subject: 'Feasibility question' });
    expect(list.filter((i) => i.source === 'LOGGED')).toHaveLength(5);
    const calls = (await r.get(`/companies/${companyId}/interactions?kind=CALL_OUTGOING`).expect(200)).body;
    expect(calls.map((i: { subject: string }) => i.subject)).toEqual(['Intro call']);

    // The follow-up was scheduled for the lead owner, with the reporting manager.
    const ups = (await r.get(`/follow-ups?companyId=${companyId}&bucket=upcoming`).expect(200)).body;
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ type: 'EMAIL', title: 'Send feasibility', assignee: { id: rep.userId }, manager: { id: manager.userId }, due: 'UPCOMING', contact: { id: priyaId } });
  });

  it('counts the company dashboard and employee directory from real records', async () => {
    const d = (await http.get(`/companies/${companyId}/dashboard`).expect(200)).body;
    expect(d.kpis).toMatchObject({ employees: 2, employeesContacted: 2, emailsSent: 1, responsesReceived: 2, calls: 1, meetings: 1, followUpsPending: 1, rfqsReceived: 0 });
    expect(d.syncedEmails).toEqual({ sent: 0, received: 1 });
    expect(d.latestUpdate).toMatchObject({ kind: 'EMAIL_SYNCED', subject: 'Feasibility question' });
    expect(d.nextAction).toMatchObject({ kind: 'FOLLOW_UP', title: 'Send feasibility' });
    const dir = (await http.get(`/companies/${companyId}/employees`).expect(200)).body as Array<{ id: string; emailsSent: number; responsesReceived: number; nextFollowUpAt: string | null }>;
    const priya = dir.find((e) => e.id === priyaId)!;
    expect(priya).toMatchObject({ emailsSent: 1, responsesReceived: 2 });
    expect(priya.nextFollowUpAt).not.toBeNull();
    // Someone who cannot see the company gets nothing.
    await api(other).get(`/companies/${companyId}/dashboard`).expect(404);
    await api(other).get(`/companies/${companyId}/interactions`).expect(404);
  });

  it('sorts follow-ups into today, overdue, upcoming, rescheduled, completed and cancelled, for me and my team', async () => {
    const r = api(rep);
    const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const make = async (title: string, dueAt: string) => (await r.post('/follow-ups', { companyId, contactId: ravId, type: 'CALL', title, dueAt, priority: 'HIGH', summary: 'Discussed timelines' }).expect(201)).body;
    const overdue = await make('Call about missed deadline', hours(-30));
    // Due later today in UTC, whatever the time now: a minute from now is still today unless it is 23:59.
    const soon = new Date(Date.now() + 60_000);
    const today = soon.getUTCDate() === new Date().getUTCDate() ? await make('Call later today', soon.toISOString()) : null;
    const moved = await make('Call to confirm sample', hours(72));
    const done = await make('Call to say thanks', hours(5 * 24));
    const dropped = await make('Call nobody needs', hours(6 * 24));
    expect(overdue.due).toBe('OVERDUE');
    if (today) expect(today.due).toBe('TODAY');

    await r.post(`/follow-ups/${moved.id}/reschedule`, { dueAt: hours(96), reason: 'Client travelling' }).expect(200);
    const completed = (await r.post(`/follow-ups/${done.id}/complete`, { outcome: 'Thanked them' }).expect(200)).body;
    expect(completed).toMatchObject({ status: 'DONE', due: 'COMPLETED', outcome: 'Thanked them' });
    await r.post(`/follow-ups/${dropped.id}/cancel`).expect(200);
    await r.post(`/follow-ups/${dropped.id}/complete`, {}).expect(400);

    const counts = (await r.get('/follow-ups/counts?scope=mine&tz=UTC').expect(200)).body;
    // Cancelled: the one dropped here, and the cadence follow-up the reply above stopped (ADR 0083).
    expect(counts).toMatchObject({ overdue: 1, rescheduled: 1, completed: 1, cancelled: 2, today: today ? 1 : 0 });
    expect(counts.upcoming).toBe(2); // the rescheduled one and the one from the interaction
    const re = (await r.get('/follow-ups?bucket=rescheduled').expect(200)).body;
    expect(re[0]).toMatchObject({ title: 'Call to confirm sample', rescheduleCount: 1 });
    expect(re[0].remarks).toContain('Rescheduled: Client travelling');

    // The manager sees the rep's follow-ups in "team"; another rep sees none of them.
    const team = (await api(manager).get('/follow-ups/counts?scope=team').expect(200)).body;
    expect(team.overdue).toBe(1);
    expect((await api(manager).get('/follow-ups/counts?scope=mine').expect(200)).body.overdue).toBe(0);
    expect((await api(other).get('/follow-ups/counts?scope=team').expect(200)).body.overdue).toBe(0);
    await api(other).post(`/follow-ups/${overdue.id}/complete`, {}).expect(404);
    // Assigning to someone else tells them.
    await http.post('/follow-ups', { companyId, type: 'MEETING', title: 'Quarterly review', dueAt: hours(48), assigneeId: manager.userId }).expect(201);
    const notes = (await api(manager).get('/notifications').expect(200)).body.items as Array<{ type: string; title: string }>;
    expect(notes.find((n) => n.type === 'followup.assigned')?.title).toBe('Follow-up assigned to you: Quarterly review');
    await r.get('/follow-ups?tz=Not/AZone').expect(400);
  });

  it('records RFQs with LOI, IR and CPI, numbers them, logs them and moves them through their statuses', async () => {
    const r = api(rep);
    const rfq = (
      await r
        .post('/rfqs', {
          companyId, contactId: priyaId, projectName: 'India B2B IT decision makers', methodology: 'Online survey', market: 'IN', targetAudience: 'IT decision makers',
          sampleSize: 400, loi: 15, ir: 20, cpi: 12.5, currency: 'usd', deadlineAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body;
    expect(rfq).toMatchObject({ number: 'RFQ-0001', status: 'RECEIVED', totalQuotation: 5000, currency: 'USD', owner: { id: rep.userId }, contact: { id: priyaId }, company: { id: companyId } });
    const second = (await r.post('/rfqs', { companyId, projectName: 'Doctors in Germany', sampleSize: 100, cpi: 80, currency: 'EUR' }).expect(201)).body;
    expect(second.number).toBe('RFQ-0002');
    await http.post('/rfqs', { companyId, projectName: '' }).expect(400);

    // A new CPI keeps the computed total in step; submitting logs the interaction and stamps the date.
    const priced = (await r.patch(`/rfqs/${rfq.id}`, { cpi: 14, status: 'QUOTATION_SUBMITTED' }).expect(200)).body;
    expect(priced).toMatchObject({ totalQuotation: 5600, status: 'QUOTATION_SUBMITTED' });
    expect(priced.submittedAt).not.toBeNull();
    const kinds = ((await r.get(`/companies/${companyId}/interactions?limit=200`).expect(200)).body as Array<{ kind: string; rfq: { number: string } | null }>).filter((i) => i.rfq);
    expect(kinds.map((i) => i.kind).sort()).toEqual(['RFQ_RECEIVED', 'RFQ_RECEIVED', 'RFQ_SUBMITTED']);

    // Losing the German one, winning the Indian one by converting it to a deal.
    await r.patch(`/rfqs/${second.id}`, { status: 'LOST', outcomeReason: 'Price too high' }).expect(200);
    await r.post(`/rfqs/${second.id}/convert`, {}).expect(400);
    const won = (await r.patch(`/rfqs/${rfq.id}`, { status: 'WON', actualRevenue: 5400 }).expect(200)).body;
    expect(won.status).toBe('WON');
    const converted = (await r.post(`/rfqs/${rfq.id}/convert`, {}).expect(200)).body;
    expect(converted.deal.name).toBe('RFQ-0001 India B2B IT decision makers');
    const deal = (await http.get(`/deals/${converted.deal.id}`).expect(200)).body;
    expect(deal).toMatchObject({ amount: 5400, currency: 'USD' });
    await r.post(`/rfqs/${rfq.id}/convert`, {}).expect(400);

    // Files can belong to the RFQ.
    await rep.agent.post(`/api/v1/companies/${companyId}/files?name=brief.pdf&rfqId=${rfq.id}`).set('origin', ORIGIN).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 brief')).expect(201);
    expect((await r.get(`/rfqs/${rfq.id}`).expect(200)).body.files).toMatchObject([{ name: 'brief.pdf' }]);

    // Dashboard: received 2, submitted 2 (submitted then won, and lost), won 1, lost 1. The won RFQ became a deal, so
    // the business generated is the deal (still open here: it was not won in the pipeline) and nothing is counted twice.
    const d = (await http.get(`/companies/${companyId}/dashboard`).expect(200)).body;
    expect(d.kpis).toMatchObject({ rfqsReceived: 2, rfqsSubmitted: 2, rfqsWon: 1, rfqsLost: 1 });
    expect(d.kpis.businessGenerated).toEqual([]);
    expect(d.business).toMatchObject({ opportunities: 1, open: 1 });
    expect(d.business.quotedValue).toEqual([{ currency: 'EUR', amount: 8000 }, { currency: 'USD', amount: 5600 }]);
    expect(d.business.outstanding).toEqual([{ currency: 'USD', amount: 5400 }]);

    const byCompany = (await http.get('/rfqs/report?by=company').expect(200)).body;
    expect(byCompany[0]).toMatchObject({ label: expect.stringContaining('Acme Panels'), received: 2, won: 1, lost: 1, open: 0 });
    const byOwner = (await http.get('/rfqs/report?by=owner').expect(200)).body;
    expect(byOwner[0]).toMatchObject({ key: rep.userId, received: 2 });
    const open = (await http.get('/rfqs?open=true').expect(200)).body;
    expect(open.total).toBe(0);
    // Another rep cannot see RFQs of a company they cannot see.
    expect((await api(other).get('/rfqs').expect(200)).body.total).toBe(0);
    await api(other).get(`/rfqs/${rfq.id}`).expect(404);
  });

  it('refuses RFQs when the super admin withholds the feature from the workspace', async () => {
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.create({ data: { tenantId: owner.tenantId, feature: 'rfqs', enabled: false, reason: 'test', updatedBy: 'test' } }));
    try {
      const res = await http.get('/rfqs').expect(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    } finally {
      await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.deleteMany({ where: { tenantId: owner.tenantId, feature: 'rfqs' } }));
    }
  });
});
