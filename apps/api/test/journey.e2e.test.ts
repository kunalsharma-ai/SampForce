import type { INestApplication } from '@nestjs/common';
import type { CompanyJourney, ContactCadence, JourneyBoard, JourneyCard, JourneySettings } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/*
 * The company journey and the Pipeline journey board (redesign R5, ADR 0085): each company's stage is worked out from
 * its employees, RFQs, deals and status, and the Super Workspace renames, recolours or hides stages.
 */
describe('Company journey', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let statuses: { id: string; name: string }[];
  const make = async (name: string, employees: string[] = ['Priya Shah']) => {
    const res = (
      await api(rep)
        .post('/company-leads', {
          company: { name, country: 'GB', ownerId: rep.userId },
          employees: employees.map((n) => {
            const [firstName, lastName] = n.split(' ');
            return { firstName, lastName, ownerId: rep.userId, emails: [{ value: `${firstName!.toLowerCase()}.${name.length}@journey.example` }] };
          }),
        })
        .expect(201)
    ).body;
    return { id: res.company.id as string, contactIds: res.employeeIds as string[] };
  };
  const board = async (as: TestUser = rep, query = '') => (await api(as).get(`/pipeline/journey${query}`).expect(200)).body as JourneyBoard;
  const cardOf = async (id: string): Promise<JourneyCard> => (await board()).columns.flatMap((c) => c.cards).find((c) => c.companyId === id)!;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Journey Research Ltd');
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    statuses = (await api(owner).get('/crm-config/statuses?kind=COMPANY').expect(200)).body;
  });
  afterAll(async () => app.close());

  it('moves a company along the journey as its employees, RFQs and deals move', async () => {
    const empty = await make('Lone Panels', []);
    expect((await cardOf(empty.id)).stage).toBe('NEW');

    const c = await make('Northwind Panels', ['Priya Shah', 'Tom Hale']);
    expect(await cardOf(c.id)).toMatchObject({ stage: 'FRESH_EMAIL', employees: 2, followUp: null, nextAction: null });

    // Sent just over 7 days ago: the follow-up period has passed, so follow-up 1 is created at once (ADR 0096).
    await api(rep).post(`/contacts/${c.contactIds[0]}/initial-email`, { sentAt: new Date(Date.now() - 7 * 86_400_000 - 60_000).toISOString() }).expect(200);
    let card = await cardOf(c.id);
    expect(card).toMatchObject({ stage: 'INITIAL_EMAIL', followUp: { step: 1, total: 5 }, nextAction: { title: 'Follow-up 1 of 5: Priya Shah', overdue: false } });

    const cadence = (await api(rep).get(`/contacts/${c.contactIds[0]}/cadence`).expect(200)).body as ContactCadence;
    await api(rep).post(`/follow-ups/${cadence.next!.taskId}/complete`, { outcome: 'Sent' }).expect(200);
    card = await cardOf(c.id);
    expect(card).toMatchObject({ stage: 'FOLLOW_UP', followUp: { step: 2, total: 5 } });

    // The visual journey of a company in follow-up.
    const j = (await api(rep).get(`/companies/${c.id}/journey`).expect(200)).body as CompanyJourney;
    expect(j.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['NEW:DONE', 'FRESH_EMAIL:DONE', 'INITIAL_EMAIL:DONE', 'FOLLOW_UP:CURRENT', 'DISCUSSION:NEXT', 'RFQ:PENDING', 'NEGOTIATION:PENDING', 'WON:PENDING']);
    expect(j.steps.find((s) => s.key === 'INITIAL_EMAIL')!.at).not.toBeNull();
    expect(j.steps.find((s) => s.key === 'FOLLOW_UP')!.at).not.toBeNull();

    await api(rep).post('/rfqs', { companyId: c.id, contactId: c.contactIds[1], projectName: 'UK drivers survey', currency: 'GBP' }).expect(201);
    expect(await cardOf(c.id)).toMatchObject({ stage: 'RFQ', openRfqs: 1 });

    await api(rep).post('/deals', { name: 'Northwind tracker', amount: 4000, companyId: c.id, customFields: {} }).expect(201);
    expect((await cardOf(c.id)).stage).toBe('NEGOTIATION');

    await api(rep).post(`/companies/${c.id}/won`).expect(200);
    expect((await cardOf(c.id)).stage).toBe('WON');
    expect(((await api(rep).get(`/companies/${c.id}/journey`).expect(200)).body as CompanyJourney).steps.at(-1)).toMatchObject({ key: 'WON', state: 'WON' });
  });

  it('ends the journey on the company status, after the furthest step it reached', async () => {
    const c = await make('Contoso Fieldwork');
    await api(rep).post(`/contacts/${c.contactIds[0]}/initial-email`, {}).expect(200);
    await api(rep).patch(`/companies/${c.id}`, { statusId: statuses.find((s) => s.name === 'Not Interested')!.id }).expect(200);
    expect((await cardOf(c.id)).stage).toBe('NOT_INTERESTED');
    const j = (await api(rep).get(`/companies/${c.id}/journey`).expect(200)).body as CompanyJourney;
    expect(j.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['NEW:DONE', 'FRESH_EMAIL:DONE', 'INITIAL_EMAIL:DONE', 'NOT_INTERESTED:LOST']);
  });

  it('filters, counts and keeps to the companies the caller can see', async () => {
    const all = await board();
    expect(all.total).toBe(all.columns.reduce((n, c) => n + c.total, 0));
    expect(all.columns.map((c) => c.stage.key)).toEqual(['NEW', 'FRESH_EMAIL', 'INITIAL_EMAIL', 'FOLLOW_UP', 'DISCUSSION', 'RFQ', 'NEGOTIATION', 'WON', 'LOST', 'REJECTED', 'NOT_INTERESTED', 'ON_HOLD']);
    const found = await board(rep, '?q=northwind');
    expect(found.total).toBe(1);
    expect((await board(other)).total).toBe(0);
    expect((await board(owner, `?ownerId=${rep.userId}`)).total).toBe(all.total);
  });

  it('lets only the Super Workspace rename, recolour and hide stages', async () => {
    const s = (await api(rep).get('/crm-config/journey').expect(200)).body as JourneySettings;
    expect(s.canEdit).toBe(false);
    expect(s.stages.find((x) => x.key === 'FOLLOW_UP')!.name).toBe('In Follow-up');
    await api(rep).put('/crm-config/journey', { stages: { FOLLOW_UP: { name: 'Chasing' } } }).expect(403);
    await api(owner).put('/crm-config/journey', { stages: { RFQ: { hidden: true } } }).expect(400);
    const saved = (await api(owner).put('/crm-config/journey', { stages: { FOLLOW_UP: { name: 'Chasing', color: '#1D4ED8' }, INITIAL_EMAIL: { hidden: true } } }).expect(200)).body as JourneySettings;
    expect(saved).toMatchObject({ canEdit: true });
    expect(saved.stages.find((x) => x.key === 'FOLLOW_UP')).toMatchObject({ name: 'Chasing', color: '#1d4ed8', customised: true });

    // A hidden stage leaves the board, and its companies show in the stage before it.
    const b = await board();
    expect(b.columns.map((c) => c.stage.key)).not.toContain('INITIAL_EMAIL');
    expect(b.columns.find((c) => c.stage.key === 'FOLLOW_UP')!.stage.name).toBe('Chasing');
    const c = await make('Fabrikam Insights');
    await api(rep).post(`/contacts/${c.contactIds[0]}/initial-email`, {}).expect(200);
    expect((await cardOf(c.id)).stage).toBe('FRESH_EMAIL');
  });
});
