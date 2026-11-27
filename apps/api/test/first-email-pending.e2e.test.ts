import type { INestApplication } from '@nestjs/common';
import type { ContactCadence, FirstEmailList, FollowUpCadenceSettings, FollowUpCounts } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FollowUpCadenceService } from '../src/crm/follow-up-cadence.service';
import { providerEnv, type ProviderFixture, startProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

const DAY = 86_400_000;

/*
 * First Email Pending (ADR 0096): every new contact waits here until their first email is confirmed as sent; then they
 * wait for the Super Workspace's follow-up period and the background job moves them into Follow-ups by creating
 * follow-up 1. Periods can differ per company or team, and the follow-ups can be calls, emails, WhatsApp…
 */
describe('First Email Pending', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let other: TestUser & { userId: string };
  let companyId: string;
  let otherCompanyId: string;
  const ids: Record<string, string> = {};
  const saved: Record<string, string | undefined> = {};
  const list = async (user: TestUser, query = '') => (await api(user).get(`/follow-ups/first-email?${query.replace(/^&/, '')}`).expect(200)).body as FirstEmailList;
  const cadence = async (id: string) => (await api(owner).get(`/contacts/${id}/cadence`).expect(200)).body as ContactCadence;
  const moveDue = (now: Date) => app.get(FollowUpCadenceService).moveDue(now);
  const contact = async (user: TestUser, body: Record<string, unknown>) => (await api(user).post('/contacts', body).expect(201)).body.id as string;

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    owner = await registerUser(app, 'First Email Research');
    await asTenant(owner.tenantId, (tx) => tx.subscription.updateMany({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    rep = await inviteMember(app, owner, 'member');
    other = await inviteMember(app, owner, 'member');
    // The rep's mailbox, so SampForce can send.
    const { url } = (await api(rep).post('/integrations/google/connect').expect(200)).body;
    const state = new URL(url).searchParams.get('state')!;
    await api(rep).get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(state)}`).expect(302);

    // Contacts made three ways: a company form with employees, by hand, and by another person.
    const lead = (
      await api(owner)
        .post('/company-leads', {
          company: { name: 'Northwind Panels', country: 'GB', ownerId: rep.userId },
          employees: [
            { firstName: 'Priya', lastName: 'Shah', jobTitle: 'Research Director', ownerId: rep.userId, emails: [{ value: 'priya@northwind.example' }] },
            { firstName: 'Tom', lastName: 'Hale', ownerId: rep.userId },
          ],
        })
        .expect(201)
    ).body;
    companyId = lead.company.id;
    [ids.priya, ids.tom] = lead.employeeIds;
    ids.lena = await contact(rep, { firstName: 'Lena', lastName: 'Ortiz', email: 'lena@northwind.example', companyId, ownerId: rep.userId });
    ids.bounced = await contact(rep, { firstName: 'Bea', lastName: 'Bounce', email: 'bea@northwind.example', companyId, ownerId: rep.userId });
    await asTenant(owner.tenantId, (tx) => tx.contact.update({ where: { id: ids.bounced }, data: { emailStatus: 'bounced' } }));
    otherCompanyId = (await api(owner).post('/companies', { name: 'Contoso Fieldwork', ownerId: other.userId }).expect(201)).body.id;
    ids.omar = await contact(other, { firstName: 'Omar', lastName: 'Haddad', email: 'omar@contoso.example', companyId: otherCompanyId, ownerId: other.userId });
  });
  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('lists every new contact whose first email has not gone out, and flags those with no usable address', async () => {
    const all = await list(owner, '&scope=all');
    const by = (id: string) => all.rows.find((r) => r.contactId === id);
    expect(by(ids.priya!)).toMatchObject({ name: 'Priya Shah', designation: 'Research Director', email: 'priya@northwind.example', status: 'PENDING', company: { id: companyId, name: 'Northwind Panels' }, owner: { id: rep.userId } });
    expect(by(ids.tom!)).toMatchObject({ status: 'NO_EMAIL', email: null });
    expect(by(ids.bounced!)).toMatchObject({ status: 'INVALID_EMAIL' });
    expect(by(ids.omar!)).toMatchObject({ status: 'PENDING', company: { name: 'Contoso Fieldwork' } });
    expect(all.counts).toMatchObject({ PENDING: 3, NO_EMAIL: 1, INVALID_EMAIL: 1, SENT: 0, createdToday: 5 });
    expect(all.total).toBe(5);
    expect(by(ids.priya!)!.cadence).toEqual({ firstFollowUpDays: 7, channel: 'EMAIL', source: 'ORGANISATION' });
    // One status at a time.
    expect((await list(owner, '&scope=all&status=NO_EMAIL')).rows.map((r) => r.contactId)).toEqual([ids.tom]);
  });

  it('keeps to the people the caller may see, and filters by employee, company, search and creation date', async () => {
    const mine = await list(rep, '&scope=mine');
    expect(mine.rows.map((r) => r.contactId).sort()).toEqual([ids.priya, ids.tom, ids.lena, ids.bounced].sort());
    expect((await list(owner, `&scope=all&ownerId=${other.userId}`)).rows.map((r) => r.contactId)).toEqual([ids.omar]);
    expect((await list(owner, `&scope=all&companyId=${otherCompanyId}`)).total).toBe(1);
    expect((await list(owner, '&scope=all&q=northwind')).total).toBe(4);
    expect((await list(owner, '&scope=all&q=haddad')).rows.map((r) => r.contactId)).toEqual([ids.omar]);

    // Omar was created yesterday.
    await asTenant(owner.tenantId, (tx) => tx.contact.update({ where: { id: ids.omar }, data: { createdAt: new Date(Date.now() - DAY - 60_000) } }));
    expect((await list(owner, '&scope=all&period=today')).total).toBe(4);
    const yesterday = await list(owner, '&scope=all&period=yesterday');
    expect(yesterday.rows.map((r) => r.contactId)).toEqual([ids.omar]);
    expect(yesterday.counts.createdToday).toBe(4);
    expect((await list(owner, '&scope=all&period=month')).total).toBeGreaterThanOrEqual(4);
    const day = new Date(Date.now() - DAY - 60_000).toISOString().slice(0, 10);
    expect((await list(owner, `&scope=all&from=${day}&to=${day}`)).rows.map((r) => r.contactId)).toEqual([ids.omar]);
    await api(owner).get('/follow-ups/first-email?period=decade').expect(400);
    await api(owner).get('/follow-ups/first-email?from=27-11-2026').expect(400);
  });

  it('marks the first email only once it is really sent: a failed send keeps the contact pending', async () => {
    fixture.state.revoked = true;
    await api(rep).post('/emails/send', { to: 'priya@northwind.example', subject: 'Introduction', body: 'Hello Priya', contactId: ids.priya }).expect(409);
    expect((await list(rep, '&scope=mine&status=PENDING')).rows.map((r) => r.contactId)).toContain(ids.priya);
    expect((await cadence(ids.priya!)).initialEmailAt).toBeNull();

    fixture.state.revoked = false;
    await api(rep).post('/emails/send', { to: 'priya@northwind.example', subject: 'Introduction', body: 'Hello Priya', contactId: ids.priya }).expect(201);
    const c = await cadence(ids.priya!);
    expect(c).toMatchObject({ state: 'ACTIVE', initialEmailSource: 'SENT', next: null });
    const sent = await list(rep, '&scope=mine&status=SENT');
    expect(sent.rows).toHaveLength(1);
    expect(sent.rows[0]).toMatchObject({ contactId: ids.priya, status: 'SENT', sentSource: 'SENT', nextFollowUpAt: c.movesAt });
    expect(new Date(c.movesAt!).getTime() - new Date(c.initialEmailAt!).getTime()).toBe(7 * DAY);
    expect((await list(rep, '&scope=mine')).rows.map((r) => r.contactId)).not.toContain(ids.priya);
  });

  it('moves the contact into Follow-ups when the period passes with no answer, once', async () => {
    const before = (await api(rep).get('/follow-ups/counts?scope=mine').expect(200)).body as FollowUpCounts;
    // Not yet: six days on.
    await moveDue(new Date(Date.now() + 6 * DAY));
    expect((await cadence(ids.priya!)).next).toBeNull();
    const at = new Date(Date.now() + 7 * DAY + 60_000);
    await Promise.all([moveDue(at), moveDue(at)]);
    const c = await cadence(ids.priya!);
    expect(c).toMatchObject({ next: { step: 1 }, movesAt: null });
    const tasks = await asTenant(owner.tenantId, (tx) => tx.task.findMany({ where: { contactId: ids.priya, cadenceStep: { not: null } } }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ followUpType: 'EMAIL', assigneeId: rep.userId, title: 'Follow-up 1 of 5: Priya Shah' });
    // Out of First Email Pending, into the Follow-ups lists.
    expect((await list(rep, '&scope=mine&status=SENT')).total).toBe(0);
    const after = (await api(rep).get('/follow-ups/counts?scope=mine').expect(200)).body as FollowUpCounts;
    expect(after.upcoming + after.today + after.overdue).toBe(before.upcoming + before.today + before.overdue + 1);
    // The timeline says why, and the owner is told.
    const notes = await asTenant(owner.tenantId, (tx) => tx.activity.findMany({ where: { contactId: ids.priya, type: 'NOTE' } }));
    expect(notes.map((n) => n.subject)).toContain('Moved to Follow-ups: no answer 7 days after the first email');
    const page = (await api(rep).get('/notifications?limit=50').expect(200)).body as { items: { title: string }[] };
    expect(page.items.map((n) => n.title)).toContain('Priya Shah moved into Follow-ups: no answer to the first email');
  });

  it('lets only the Super Workspace set periods per company and team, and how follow-ups are made', async () => {
    const manager = await workspacePerson(app, owner, 'MANAGER', 'North Team Manager');
    await api(rep).put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7, firstFollowUpDays: 3 }).expect(403);
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7, rules: [{ scope: 'COMPANY', targetId: '00000000-0000-4000-8000-000000000000', firstFollowUpDays: 3, intervalDays: 3, followUps: 2, channel: 'CALL' }] }).expect(400);
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7, rules: [{ scope: 'TEAM', targetId: companyId, firstFollowUpDays: 3, intervalDays: 3, followUps: 2, channel: 'CALL' }] }).expect(400);
    const rule = { scope: 'COMPANY', targetId: companyId, firstFollowUpDays: 3, intervalDays: 4, followUps: 2, channel: 'CALL' };
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7, rules: [rule, rule] }).expect(400);
    const s = (
      await api(owner)
        .put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7, firstFollowUpDays: 10, channel: 'EMAIL', rules: [rule, { scope: 'TEAM', targetId: manager.workspaceId, firstFollowUpDays: 2, intervalDays: 2, followUps: 3, channel: 'WHATSAPP' }] })
        .expect(200)
    ).body as FollowUpCadenceSettings;
    expect(s).toMatchObject({ firstFollowUpDays: 10, rules: [rule, { scope: 'TEAM' }] });
    expect(s.ruleTargets).toEqual({ [companyId]: 'Northwind Panels', [manager.workspaceId]: 'North Team Manager' });
    // An older screen that saves only the count and the interval keeps the rest.
    const kept = (await api(owner).put('/crm-config/follow-up-cadence', { followUps: 5, intervalDays: 7 }).expect(200)).body as FollowUpCadenceSettings;
    expect(kept).toMatchObject({ firstFollowUpDays: 10, rules: [rule, { scope: 'TEAM' }] });

    // Lena's company has its own rule: 3 days, then calls.
    expect((await list(rep, '&scope=mine')).rows.find((r) => r.contactId === ids.lena)!.cadence).toEqual({ firstFollowUpDays: 3, channel: 'CALL', source: 'COMPANY' });
    await api(rep).post('/interactions', { companyId, contactId: ids.lena, kind: 'EMAIL_SENT', subject: 'Introduction' }).expect(201);
    const c = await cadence(ids.lena!);
    expect(c.initialEmailSource).toBe('LOGGED');
    expect(new Date(c.movesAt!).getTime() - new Date(c.initialEmailAt!).getTime()).toBe(3 * DAY);
    await moveDue(new Date(Date.now() + 3 * DAY + 60_000));
    const [task] = await asTenant(owner.tenantId, (tx) => tx.task.findMany({ where: { contactId: ids.lena, cadenceStep: 1 } }));
    expect(task).toMatchObject({ followUpType: 'CALL', title: 'Follow-up 1 of 2: Lena Ortiz', nextAction: 'Call them for follow-up 1.' });

    // Omar's company has no rule: the organisation's 10 days.
    expect((await list(owner, '&scope=all')).rows.find((r) => r.contactId === ids.omar)!.cadence).toEqual({ firstFollowUpDays: 10, channel: 'EMAIL', source: 'ORGANISATION' });
    // A contact of someone in the North team follows the team's rule.
    const teamContact = await contact(manager, { firstName: 'Nia', lastName: 'North', email: 'nia@north.example', ownerId: manager.userId });
    expect((await list(owner, '&scope=all')).rows.find((r) => r.contactId === teamContact)!.cadence).toEqual({ firstFollowUpDays: 2, channel: 'WHATSAPP', source: 'TEAM' });
  });

  it('does not move a contact whose cadence stopped while waiting, nor one never emailed', async () => {
    await api(other).post(`/contacts/${ids.omar}/initial-email`, {}).expect(200);
    await api(other).post('/interactions', { companyId: otherCompanyId, contactId: ids.omar, kind: 'CALL_INCOMING', subject: 'Called back' }).expect(201);
    await moveDue(new Date(Date.now() + 30 * DAY));
    expect(await asTenant(owner.tenantId, (tx) => tx.task.count({ where: { contactId: { in: [ids.omar!, ids.tom!] }, cadenceStep: { not: null } } }))).toBe(0);
    expect((await cadence(ids.omar!)).state).toBe('STOPPED');
  });
});
