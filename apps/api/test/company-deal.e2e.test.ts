import type { INestApplication } from '@nestjs/common';
import type { CompanyRow, CompanyWonResult, DealRow } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/*
 * Company to Deal (redesign R4, ADR 0084): a company that becomes a client gets its deal, made from its RFQs or closed
 * from its open deal, once per win; and a deal marked won makes its company a client.
 */
describe('Company to Deal', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let statuses: { id: string; name: string; meaning: string | null }[];
  let wonStageId: string;
  let openStageId: string;
  const statusNamed = (name: string) => statuses.find((s) => s.name === name)!.id;
  const company = async (name: string, contacts = ['Priya Shah']) => {
    const res = (
      await api(rep)
        .post('/company-leads', {
          company: { name, country: 'GB', ownerId: rep.userId },
          employees: contacts.map((n) => {
            const [firstName, lastName] = n.split(' ');
            return { firstName, lastName, ownerId: rep.userId, emails: [{ value: `${firstName!.toLowerCase()}@${name.split(' ')[0]!.toLowerCase()}.example` }] };
          }),
        })
        .expect(201)
    ).body;
    return { id: res.company.id as string, contactIds: res.employeeIds as string[] };
  };
  const dealsOf = async (companyId: string) => ((await api(owner).get(`/deals?companyId=${companyId}&limit=100`).expect(200)).body.items as DealRow[]).filter((d) => d.company?.id === companyId);
  const companyRow = async (id: string) => (await api(rep).get(`/companies/${id}`).expect(200)).body as CompanyRow;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Deal Automation Research');
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    statuses = (await api(owner).get('/crm-config/statuses?kind=COMPANY').expect(200)).body;
    const pipeline = ((await api(owner).get('/pipelines').expect(200)).body as { isDefault: boolean; stages: { id: string; category: string }[] }[]).find((p) => p.isDefault)!;
    wonStageId = pipeline.stages.find((s) => s.category === 'WON')!.id;
    openStageId = pipeline.stages.find((s) => s.category === 'OPEN')!.id;
  });
  afterAll(async () => app.close());

  it('makes a won deal from the won RFQs when the company becomes a client, links them, and tells the owner', async () => {
    const c = await company('Northwind Panels Ltd');
    const lost = (await api(rep).post('/rfqs', { companyId: c.id, contactId: c.contactIds[0], projectName: 'Doctors in Germany', sampleSize: 100, cpi: 80, currency: 'EUR' }).expect(201)).body;
    await api(rep).patch(`/rfqs/${lost.id}`, { status: 'LOST', outcomeReason: 'Price' }).expect(200);
    const rfq = (await api(rep).post('/rfqs', { companyId: c.id, contactId: c.contactIds[0], projectName: 'UK drivers survey', sampleSize: 400, cpi: 12.5, currency: 'GBP' }).expect(201)).body;
    await api(rep).patch(`/rfqs/${rfq.id}`, { status: 'WON', actualRevenue: 5400 }).expect(200);

    // The owner (not the rep) moves the company to a client status.
    await api(owner).patch(`/companies/${c.id}`, { statusId: statusNamed('Existing Client') }).expect(200);
    const deals = await dealsOf(c.id);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({ name: 'Northwind Panels Ltd: UK drivers survey', amount: 5400, currency: 'GBP', status: 'WON', owner: { id: rep.userId } });
    expect((await companyRow(c.id)).wonDealId).toBe(deals[0]!.id);
    expect((await api(rep).get(`/rfqs/${rfq.id}`).expect(200)).body.deal?.id).toBe(deals[0]!.id);
    expect((await api(rep).get(`/rfqs/${lost.id}`).expect(200)).body.deal).toBeNull();
    const notes = (await api(rep).get('/notifications?limit=100').expect(200)).body.items as { type: string; title: string }[];
    expect(notes.some((n) => n.type === 'deal.won' && n.title.startsWith('Client won: deal DEAL-') && n.title.endsWith('created for Northwind Panels Ltd'))).toBe(true);

    // Winning it again (after a status wobble) makes no second deal; a new RFQ is linked to the same deal.
    await api(owner).patch(`/companies/${c.id}`, { statusId: statusNamed('New Lead') }).expect(200);
    const extra = (await api(rep).post('/rfqs', { companyId: c.id, projectName: 'Repeat wave', sampleSize: 100, cpi: 10, currency: 'GBP' }).expect(201)).body;
    const again = (await api(rep).post(`/companies/${c.id}/won`).expect(200)).body as CompanyWonResult;
    expect(again).toMatchObject({ created: false, linkedRfqs: 0, deal: { id: deals[0]!.id } });
    expect(await dealsOf(c.id)).toHaveLength(1);
    // The extra RFQ is not won, and won RFQs come first, so only won RFQs are linked.
    expect((await api(rep).get(`/rfqs/${extra.id}`).expect(200)).body.deal).toBeNull();
  });

  it('closes the open deal as won instead of making another one', async () => {
    const c = await company('Contoso Fieldwork');
    const open = (await api(rep).post('/deals', { name: 'Contoso tracker', amount: 9000, currency: 'USD', companyId: c.id, stageId: openStageId, customFields: {} }).expect(201)).body as DealRow;
    const res = (await api(rep).post(`/companies/${c.id}/won`).expect(200)).body as CompanyWonResult;
    expect(res).toMatchObject({ created: false, deal: { id: open.id, status: 'WON', amount: 9000 } });
    expect(await dealsOf(c.id)).toHaveLength(1);
    const row = await companyRow(c.id);
    expect(row.status?.name).toBe('Existing Client');
    expect(row.wonDealId).toBe(open.id);
  });

  it('makes a deal from the company alone when there is no RFQ or deal', async () => {
    const c = await company('Fabrikam Insights', ['Lena Ortiz']);
    const res = (await api(rep).post(`/companies/${c.id}/won`).expect(200)).body as CompanyWonResult;
    expect(res).toMatchObject({ created: true, linkedRfqs: 0, deal: { name: 'Fabrikam Insights', amount: 0, status: 'WON' } });
    const [deal] = await dealsOf(c.id);
    expect(deal).toMatchObject({ contact: { id: c.contactIds[0] } });
  });

  it('makes the company a client when its deal is won', async () => {
    const c = await company('Tailspin Panels');
    const deal = (await api(rep).post('/deals', { name: 'Tailspin pilot', amount: 1200, companyId: c.id, stageId: openStageId, customFields: {} }).expect(201)).body as DealRow;
    expect((await companyRow(c.id)).status?.meaning).not.toBe('CLIENT');
    await api(rep).post(`/deals/${deal.id}/move`, { stageId: wonStageId }).expect(200);
    const row = await companyRow(c.id);
    expect(row.status?.name).toBe('Existing Client');
    expect(row.wonDealId).toBe(deal.id);
    // Already a client with its won deal: marking it won again changes nothing.
    expect((await api(rep).post(`/companies/${c.id}/won`).expect(200)).body).toMatchObject({ created: false, deal: { id: deal.id } });
    expect(await dealsOf(c.id)).toHaveLength(1);
  });

  it('only works on companies the caller can see', async () => {
    const c = await company('Wingtip Research');
    await api(other).post(`/companies/${c.id}/won`).expect(404);
    expect(await dealsOf(c.id)).toHaveLength(0);
  });
});
