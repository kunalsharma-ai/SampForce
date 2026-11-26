import type { INestApplication } from '@nestjs/common';
import { BUILT_IN_STAGES, type EmployeeActivity, type EmployeeActivityRow, type EmployeeCommunication, type SampbidxCompanyPreview, type SampbidxCompanySendResult, stageTones, stageContrast } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SBX, startSampbidxFixture, type SampbidxFixture } from './fixtures/sampbidx-fixture';
import { api, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/*
 * RFQ contributors, employee communication stages and "Send to SampBidx" from a company (ADR 0080), with a
 * realistic client: ten employees, two of whom share RFQs. SampBidx is the local stand-in that follows
 * docs/integrations/sampbidx-api.md.
 */
describe('Employee stages, RFQ contributors and company sends to SampBidx', () => {
  let app: INestApplication;
  let sbx: SampbidxFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let companyId: string;
  let ids: string[] = [];
  const names = ['Anita Rao', 'Bilal Khan', 'Chen Wei', 'Dana Cruz', 'Eva Novak', 'Farah Ali', 'Gus Berg', 'Hana Sato', 'Ivan Petrov', 'Jia Lin'];
  let anita: string; // shares RFQs often
  let bilal: string; // shares now and then
  let chen: string; // shared RFQs before SampForce (marked by hand)
  const activity = async () => (await api(rep).get(`/companies/${companyId}/employee-activity`).expect(200)).body as EmployeeActivity;
  const rowOf = async (id: string) => (await activity()).rows.find((r) => r.id === id)!;
  const stageKey = async (id: string) => (await rowOf(id)).stage?.key ?? null;
  const stageId = async (key: string) => (await activity()).stages.find((s) => s.key === key)!.id;

  beforeAll(async () => {
    sbx = await startSampbidxFixture();
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research Fieldwork Solutions');
    rep = await inviteMember(app, owner, 'member');
    const res = (
      await api(owner)
        .post('/company-leads', {
          company: { name: 'Myfrequentrewards', country: 'IN', city: 'New Delhi', website: 'https://www.myfrequentrewards.com/', industry: 'Market Research', ownerId: rep.userId },
          employees: names.map((n, i) => {
            const [firstName, lastName] = n.split(' ');
            return { firstName, lastName, jobTitle: i === 0 ? 'Research Director' : 'Project Manager', emails: [{ value: `${firstName!.toLowerCase()}@myfrequentrewards.example` }], ...(i === 0 ? { timezone: 'Asia/Kolkata' } : {}) };
          }),
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    ids = res.employeeIds;
    [anita, bilal, chen] = [ids[0]!, ids[1]!, ids[2]!];
  });
  afterAll(async () => {
    await app.close();
    await sbx.close();
  });

  it('gives every workspace the 20 stages, each its own colour, readable in light and dark', async () => {
    const a = await activity();
    expect(a.stages.map((s) => s.key)).toEqual(BUILT_IN_STAGES.map((s) => s.key));
    expect(new Set(a.stages.map((s) => s.color)).size).toBe(20);
    for (const s of a.stages) {
      const t = stageTones(s.color);
      expect(stageContrast(t.light.fg, t.light.bg)).toBeGreaterThanOrEqual(4.5);
      // Dark chips are a 20% tint over the darkest and lightest dark card.
      for (const card of ['#0b1120', '#1f2937']) {
        const mixed = mix(card, s.color, 0.2);
        expect(stageContrast(t.dark.fg, mixed)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(a.rows).toHaveLength(10);
    expect(a.rows.every((r) => r.contributor === 'NONE' && r.rfqCount === 0 && r.stage === null)).toBe(true);
    // Stages show up in CRM configuration too, where a workspace can add its own.
    const cfg = (await api(owner).get('/crm-config/statuses?kind=STAGE').expect(200)).body as { key: string | null; phase: string }[];
    expect(cfg).toHaveLength(20);
    const own = (await api(owner).post('/crm-config/statuses', { kind: 'STAGE', name: 'Awaiting PO', color: '#0f766e', phase: 'NEGOTIATION' }).expect(201)).body;
    expect(own).toMatchObject({ key: null, phase: 'NEGOTIATION', meaning: 'ACTIVE' });
  });

  it('makes RFQ contributors from real RFQs, and from the team’s own mark', async () => {
    for (const p of ['UK snacking habits', 'Cloud buyers', 'Teen gaming']) await api(rep).post('/rfqs', { companyId, contactId: anita, projectName: p }).expect(201);
    await api(rep).post('/rfqs', { companyId, contactId: bilal, projectName: 'EU pet owners', receivedAt: new Date(Date.now() - 200 * 86_400_000).toISOString() }).expect(201);
    const a = await rowOf(anita);
    expect(a).toMatchObject({ contributor: 'ACTIVE', rfqCount: 3, rfqsOpen: 3, stage: { key: 'RFQ_RECEIVED', phase: 'RFQ' } });
    // Bilal's only RFQ is older than 90 days: a contributor, but not an active one.
    expect(await rowOf(bilal)).toMatchObject({ contributor: 'CONTRIBUTOR', rfqCount: 1 });
    // An RFQ email logged without an RFQ record counts as well.
    await api(rep).post('/interactions', { companyId, contactId: bilal, kind: 'RFQ_RECEIVED', subject: 'RFQ: Nordic banking study' }).expect(201);
    expect(await rowOf(bilal)).toMatchObject({ contributor: 'ACTIVE', rfqCount: 2, stage: { key: 'RFQ_RECEIVED' } });

    const marked = (await api(rep).patch(`/contacts/${chen}/rfq-contributor`, { marked: true }).expect(200)).body as EmployeeActivityRow;
    expect(marked).toMatchObject({ contributor: 'CONTRIBUTOR', rfqCount: 0, marked: { by: { id: rep.userId } } });
    await api(rep).patch(`/contacts/${chen}/rfq-contributor`, { marked: false }).expect(200);
    expect((await rowOf(chen)).contributor).toBe('NONE');
    const counts = (await activity()).rows.reduce((m, r) => ({ ...m, [r.contributor]: (m[r.contributor] ?? 0) + 1 }), {} as Record<string, number>);
    expect(counts).toEqual({ ACTIVE: 2, NONE: 8 });
  });

  it('moves each employee on by themselves, forward only, and keeps employees independent', async () => {
    const follow = async (contactId: string, type = 'EMAIL') => {
      const f = (await api(rep).post('/follow-ups', { companyId, contactId, type, title: 'Chase the RFQ', dueAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201)).body;
      await api(rep).post(`/follow-ups/${f.id}/complete`, { outcome: 'No reply yet' }).expect(200);
    };
    await follow(anita);
    expect(await stageKey(anita)).toBe('FOLLOW_UP_1');
    await follow(anita);
    expect(await stageKey(anita)).toBe('FOLLOW_UP_2');
    // Bilal is untouched by Anita's follow-ups.
    expect(await stageKey(bilal)).toBe('RFQ_RECEIVED');
    // A reply moves Anita to discussion; a later follow-up does not move her back.
    await api(rep).post('/interactions', { companyId, contactId: anita, kind: 'EMAIL_RECEIVED', subject: 'Re: quote' }).expect(201);
    expect(await stageKey(anita)).toBe('DISCUSSION');
    await follow(anita);
    expect(await stageKey(anita)).toBe('DISCUSSION');
    // A scheduled call, then the call, then negotiation.
    await api(rep).post('/follow-ups', { companyId, contactId: anita, type: 'CALL', title: 'Pricing call', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }).expect(201);
    expect(await stageKey(anita)).toBe('CALL_SCHEDULED');
    await api(rep).post('/interactions', { companyId, contactId: anita, kind: 'CALL_OUTGOING', subject: 'Pricing call' }).expect(201);
    expect(await stageKey(anita)).toBe('CALL_DONE');
    await api(rep).post('/interactions', { companyId, contactId: anita, kind: 'NEGOTIATION', subject: 'CPI discussion' }).expect(201);
    expect(await stageKey(anita)).toBe('NEGOTIATION');
  });

  it('lets a person pick any stage, and an RFQ outcome or a new RFQ is the latest word', async () => {
    // Won straight after the second follow-up: no fixed order.
    const won = (await api(rep).patch(`/contacts/${bilal}/stage`, { stageId: await stageId('RFQ_WON'), note: 'Client confirmed by phone' }).expect(200)).body as EmployeeActivityRow;
    expect(won.stage).toMatchObject({ key: 'RFQ_WON', phase: 'WON' });
    // Automatic moves never take an employee out of a won stage.
    await api(rep).post('/interactions', { companyId, contactId: bilal, kind: 'CALL_INCOMING', subject: 'Thanks call' }).expect(201);
    expect(await stageKey(bilal)).toBe('RFQ_WON');
    // An RFQ lost is recorded; a new RFQ starts a new cycle.
    const rfq = (await api(rep).get(`/rfqs?companyId=${companyId}`).expect(200)).body.items.find((r: { contact: { id: string } | null }) => r.contact?.id === anita);
    await api(rep).patch(`/rfqs/${rfq.id}`, { status: 'LOST', outcomeReason: 'Price too high' }).expect(200);
    expect(await stageKey(anita)).toBe('RFQ_LOST');
    expect((await rowOf(anita)).rfqsLostOrRejected).toBe(1);
    await api(rep).post('/rfqs', { companyId, contactId: anita, projectName: 'India FMCG tracker' }).expect(201);
    expect(await stageKey(anita)).toBe('RFQ_RECEIVED');
    // A retired stage cannot be picked; stages of another kind are refused.
    const anyEmployeeStatus = (await api(owner).get('/crm-config/statuses?kind=EMPLOYEE').expect(200)).body[0].id;
    await api(rep).patch(`/contacts/${bilal}/stage`, { stageId: anyEmployeeStatus }).expect(400);
  });

  it('keeps the whole history: stage changes with what moved them, interactions and follow-ups', async () => {
    const h = (await api(rep).get(`/contacts/${anita}/communication`).expect(200)).body as EmployeeCommunication;
    expect(h.employee.id).toBe(anita);
    const stages = h.events.filter((e) => e.kind === 'STAGE').reverse();
    expect(stages.map((e) => e.to?.key)).toEqual(['RFQ_RECEIVED', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'DISCUSSION', 'CALL_SCHEDULED', 'CALL_DONE', 'NEGOTIATION', 'RFQ_LOST', 'RFQ_RECEIVED']);
    expect(stages.map((e) => e.source)).toEqual(['RFQ', 'FOLLOW_UP', 'FOLLOW_UP', 'INTERACTION', 'CALL_SCHEDULED', 'INTERACTION', 'INTERACTION', 'RFQ_OUTCOME', 'RFQ']);
    expect(stages[1]).toMatchObject({ from: { key: 'RFQ_RECEIVED' }, by: { id: rep.userId } });
    expect(h.events.filter((e) => e.kind === 'FOLLOW_UP' && e.subKind === 'DONE')).toHaveLength(3);
    expect(h.events.some((e) => e.kind === 'INTERACTION' && e.subKind === 'NEGOTIATION')).toBe(true);
    // Newest first.
    expect([...h.events].sort((a, b) => b.at.localeCompare(a.at)).map((e) => e.id)).toEqual(h.events.map((e) => e.id));
  });

  describe('Send to SampBidx from the company', () => {
    let rfqId: string;
    beforeAll(async () => {
      await api(owner).post('/apps/sampbidx/keys', { baseUrl: `${sbx.url}/api`, apiKey: SBX.key }).set('origin', ORIGIN).expect(200);
      rfqId = (
        await api(rep)
          .post('/rfqs', {
            companyId,
            contactId: anita,
            projectName: 'Multi-country streaming study',
            methodology: 'Online survey',
            market: 'GB',
            sampleSize: 800,
            serviceCategory: 'QUANTITATIVE',
            service: 'CAWI',
            currency: 'GBP',
            deadlineAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            lines: [
              { country: 'GB', targetGroup: 'Gen pop 18+', quota: 500, loi: 15, ir: 30, cpi: 4.5 },
              { country: 'DE', targetGroup: 'Gen pop 18+', quota: 300, loi: 15, ir: 25 },
            ],
          })
          .expect(201)
      ).body.id;
    });

    it('previews the client, the employees (contributors first) and what is missing', async () => {
      const p = (await api(rep).get(`/apps/sampbidx/companies/${companyId}/preview?contactId=${bilal}&rfqId=${rfqId}`).expect(200)).body as SampbidxCompanyPreview;
      expect(p.connected).toBe(true);
      expect(p.company).toMatchObject({ name: { value: 'Myfrequentrewards', required: true, missing: false }, website: { value: 'https://www.myfrequentrewards.com/' }, office: { country: { value: 'IN' }, city: { value: 'New Delhi' } } });
      expect(p.employees.slice(0, 2).map((e) => e.id).sort()).toEqual([anita, bilal].sort());
      // Bilal has no time zone of his own; the company's country fills his country, marked as such.
      expect(p.contacts).toHaveLength(1);
      expect(p.contacts[0]).toMatchObject({ id: bilal, country: { value: 'IN', from: 'company', missing: false }, timeZone: { value: null, missing: true } });
      expect(p.blockers.join(' ')).toContain('time zone is required');
      expect(p.rfq).toMatchObject({ number: expect.any(String), missing: [], contactMismatch: { id: anita } });
      expect(p.rfq!.lines).toEqual([
        { country: 'GB', targetGroup: 'Gen pop 18+', quota: 500, loi: 15, ir: 30, cpi: 4.5, description: null },
        { country: 'DE', targetGroup: 'Gen pop 18+', quota: 300, loi: 15, ir: 25, cpi: null, description: null },
      ]);
    });

    it('refuses an incomplete send, saves what was typed, and sends only the picked employee', async () => {
      const bad = await api(rep).post('/apps/sampbidx/transfers/company', { companyId, contactId: bilal, rfqId }).expect(400);
      expect(bad.body.error.code).toBe('SAMPBIDX_INCOMPLETE');
      expect(sbx.clients.size).toBe(0);

      const r = (await api(rep).post('/apps/sampbidx/transfers/company', { companyId, contactId: anita, rfqId, completion: { contacts: { [anita]: { phone: '+91 98100 00000' } } } }).expect(200)).body as SampbidxCompanySendResult;
      expect(r.client).toMatchObject({ kind: 'CLIENT', delivery: 'SENT', remoteId: expect.stringMatching(/^CL-/) });
      expect(r.rfq).toMatchObject({ kind: 'RFQ', delivery: 'SENT', remoteId: expect.stringMatching(/^SBX-/) });
      const client = sbx.clients.get(companyId)!;
      expect(client.json).toMatchObject({
        externalId: companyId,
        company: { name: 'Myfrequentrewards', website: 'https://www.myfrequentrewards.com/', industry: 'Market Research' },
        offices: [{ label: 'Head office', headOffice: true, country: 'IN', city: 'New Delhi' }],
      });
      const sent = client.json.contacts as Record<string, unknown>[];
      expect(sent).toEqual([expect.objectContaining({ externalId: anita, name: 'Anita Rao', email: 'anita@myfrequentrewards.example', phone: '+91 98100 00000', country: 'IN', timeZone: 'Asia/Kolkata', mayReceiveQuotes: true, marketingConsent: false })]);
      // Nothing internal goes: no owner, remarks or other employees.
      expect(JSON.stringify(client.json)).not.toMatch(/Bilal|remarks|ownerId/);
      // The RFQ carries the client, the employee who shared it, and each country row on its own.
      const rfq = sbx.received.at(-1)!.json as { client: unknown; contact: unknown; rfq: { lines: unknown[]; countries: string[]; serviceCategory: string; service: string; contact: { id: string } } };
      expect(rfq.client).toEqual({ id: client.id, externalId: companyId });
      expect(rfq.contact).toMatchObject({ id: client.contacts[0]!.id, externalId: anita, name: 'Anita Rao' });
      expect(rfq.rfq).toMatchObject({ serviceCategory: 'QUANTITATIVE', service: 'CAWI', countries: ['GB', 'DE'], contact: { id: anita } });
      expect(rfq.rfq.lines).toHaveLength(2);
      // The typed phone was saved to Anita's record; she is now "RFQ Sent to SampBidx", not won.
      expect((await api(rep).get(`/contacts/${anita}`).expect(200)).body.phone).toBe('+91 98100 00000');
      const a = await rowOf(anita);
      expect(a).toMatchObject({ stage: { key: 'RFQ_SENT_SAMPBIDX' }, sentToSampbidx: 1, rfqsWon: 0 });
      expect((await api(rep).get(`/rfqs/${rfqId}`).expect(200)).body.status).toBe('RECEIVED');
    });

    it('never sends the same RFQ twice by accident, and updates the same client on a second send', async () => {
      const dup = await api(rep).post('/apps/sampbidx/transfers/company', { companyId, contactId: anita, rfqId }).expect(409);
      expect(dup.body.error.code).toBe('ALREADY_SENT');
      // Client only, with Bilal added (his time zone typed on the preview).
      const r = (await api(rep).post('/apps/sampbidx/transfers/company', { companyId, contactId: bilal, extraContactIds: [anita], completion: { contacts: { [bilal]: { timeZone: 'Asia/Kolkata' } } } }).expect(200)).body as SampbidxCompanySendResult;
      expect(r.rfq).toBeNull();
      expect(sbx.clients.size).toBe(1);
      const client = sbx.clients.get(companyId)!;
      expect(client.puts).toBe(2);
      expect(client.contacts.map((c) => c.externalId).sort()).toEqual([anita, bilal].sort());
      const p = (await api(rep).get(`/apps/sampbidx/companies/${companyId}/preview?contactId=${bilal}`).expect(200)).body as SampbidxCompanyPreview;
      expect(p.client).toMatchObject({ remoteId: client.id });
      expect(p.contacts[0]!.remoteId).toBe(client.contacts.find((c) => c.externalId === bilal)!.id);
    });

    it('shows the real reason when SampBidx fails, and a retry sends the same transfer', async () => {
      sbx.failNext(1);
      const r = (await api(rep).post('/apps/sampbidx/transfers/company', { companyId, contactId: bilal }).expect(200)).body as SampbidxCompanySendResult;
      expect(r.client).toMatchObject({ delivery: 'FAILED', lastError: expect.stringContaining('(503)') });
      const again = (await api(rep).post(`/apps/sampbidx/transfers/${r.client.id}/retry`).expect(200)).body;
      expect(again).toMatchObject({ id: r.client.id, delivery: 'SENT', attempts: 2 });
      expect(sbx.clients.size).toBe(1);
      // The send shows in Bilal's history.
      const h = (await api(rep).get(`/contacts/${bilal}/communication`).expect(200)).body as EmployeeCommunication;
      expect(h.events.filter((e) => e.kind === 'SAMPBIDX').map((e) => e.subKind)).toContain('CLIENT_SENT');
    });
  });
});

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
