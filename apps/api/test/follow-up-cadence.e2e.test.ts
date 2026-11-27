import type { INestApplication } from '@nestjs/common';
import type { ContactCadence, EmployeeActivity, FollowUpCadenceSettings } from '@dealflow/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FollowUpCadenceService } from '../src/crm/follow-up-cadence.service';
import { localDay } from '../src/crm/crm-reminders.service';
import { CrmRemindersService } from '../src/crm/crm-reminders.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

const DAY = 86_400_000;

/*
 * The follow-up cadence (redesign R3, ADR 0083): Fresh Email Pending, Initial Email Sent, then follow-ups a set number
 * of days apart until the Super Workspace's number is reached, stopping when the employee answers.
 */
describe('Follow-up cadence', () => {
  let app: INestApplication;
  let owner: TestUser;
  let rep: TestUser & { userId: string };
  let companyId: string;
  let ids: string[] = [];
  const cadence = async (id: string) => (await api(rep).get(`/contacts/${id}/cadence`).expect(200)).body as ContactCadence;
  const stageOf = async (id: string) => ((await api(rep).get(`/companies/${companyId}/employee-activity`).expect(200)).body as EmployeeActivity).rows.find((r) => r.id === id)!.stage?.key ?? null;
  const openCadenceTasks = (contactId: string) => asTenant(owner.tenantId, (tx) => tx.task.findMany({ where: { contactId, cadenceStep: { not: null } }, orderBy: { cadenceStep: 'asc' } }));

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Cadence Research Ltd');
    rep = await inviteMember(app, owner, 'member');
    const res = (
      await api(owner)
        .post('/company-leads', {
          company: { name: 'Northwind Panels', country: 'GB', ownerId: rep.userId },
          employees: ['Priya Shah', 'Tom Hale', 'Lena Ortiz', 'Omar Haddad'].map((n) => {
            const [firstName, lastName] = n.split(' ');
            return { firstName, lastName, ownerId: rep.userId, emails: [{ value: `${firstName!.toLowerCase()}@northwind.example` }] };
          }),
        })
        .expect(201)
    ).body;
    companyId = res.company.id;
    ids = res.employeeIds;
  });
  afterAll(async () => app.close());

  it('defaults to 5 follow-ups 7 days apart, and only the Super Workspace changes it', async () => {
    const s = (await api(rep).get('/crm-config/follow-up-cadence').expect(200)).body as FollowUpCadenceSettings;
    expect(s).toMatchObject({ followUps: 5, intervalDays: 7, canEdit: false });
    await api(rep).put('/crm-config/follow-up-cadence', { followUps: 3, intervalDays: 2 }).expect(403);
    const manager = await workspacePerson(app, owner, 'MANAGER', 'Cadence Manager');
    expect((await api(manager).get('/crm-config/follow-up-cadence').expect(200)).body.canEdit).toBe(false);
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 0, intervalDays: 7 }).expect(400);
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 3, intervalDays: 7, extra: 1 }).expect(400);
    const saved = (await api(owner).put('/crm-config/follow-up-cadence', { followUps: 3, intervalDays: 2 }).expect(200)).body as FollowUpCadenceSettings;
    expect(saved).toMatchObject({ followUps: 3, intervalDays: 2, canEdit: true });
    expect(saved.updatedBy?.id).toBeTruthy();
  });

  it('starts every new employee in Fresh Email Pending', async () => {
    for (const id of ids) {
      expect(await stageOf(id)).toBe('FRESH_EMAIL_PENDING');
      expect(await cadence(id)).toMatchObject({ state: 'FRESH', completed: 0, total: 3, next: null });
    }
  });

  it('plans follow-up 1 when the initial email is logged, and each next one when the last is completed', async () => {
    const priya = ids[0]!;
    const sentAt = new Date(Date.now() - DAY);
    await api(rep).post('/interactions', { companyId, contactId: priya, kind: 'EMAIL_SENT', subject: 'Introduction', occurredAt: sentAt.toISOString() }).expect(201);
    expect(await stageOf(priya)).toBe('INITIAL_EMAIL_SENT');
    let c = await cadence(priya);
    expect(c).toMatchObject({ state: 'ACTIVE', completed: 0, total: 3, next: { step: 1 } });
    expect(new Date(c.next!.dueAt).getTime()).toBe(sentAt.getTime() + 2 * DAY);
    const [first] = await openCadenceTasks(priya);
    expect(first).toMatchObject({ title: 'Follow-up 1 of 3: Priya Shah', followUpType: 'EMAIL', assigneeId: rep.userId, status: 'OPEN', cadenceStep: 1 });
    // A second email changes nothing: the cadence runs once.
    await api(rep).post('/interactions', { companyId, contactId: priya, kind: 'EMAIL_SENT', subject: 'Again' }).expect(201);
    expect(await openCadenceTasks(priya)).toHaveLength(1);

    for (const step of [1, 2, 3]) {
      c = await cadence(priya);
      expect(c.next?.step).toBe(step);
      await api(rep).post(`/follow-ups/${c.next!.taskId}/complete`, { outcome: 'Sent' }).expect(200);
      expect(await stageOf(priya)).toBe(`FOLLOW_UP_${step}`);
    }
    c = await cadence(priya);
    expect(c).toMatchObject({ state: 'COMPLETE', completed: 3, total: 3, next: null });
    expect(await openCadenceTasks(priya)).toHaveLength(3);
  });

  it('stops when the employee answers, and cancels the follow-up still planned', async () => {
    const tom = ids[1]!;
    await api(rep).post(`/contacts/${tom}/initial-email`, {}).expect(200);
    expect((await cadence(tom)).next?.step).toBe(1);
    await api(rep).post('/interactions', { companyId, contactId: tom, kind: 'EMAIL_RECEIVED', subject: 'Re: Introduction' }).expect(201);
    const c = await cadence(tom);
    expect(c).toMatchObject({ state: 'STOPPED', next: null, stoppedReason: 'the contact replied' });
    const [t] = await openCadenceTasks(tom);
    expect(t).toMatchObject({ status: 'CANCELED', outcome: 'Cadence stopped: the contact replied' });
    expect(await stageOf(tom)).toBe('DISCUSSION');
    // Marking it again is refused: the first email already went out.
    await api(rep).post(`/contacts/${tom}/initial-email`, {}).expect(400);
  });

  it('starts from a synced or sent email, and a synced reply stops it', async () => {
    const lena = ids[2]!;
    const svc = app.get(FollowUpCadenceService);
    const actor = { tenantId: owner.tenantId, userId: rep.userId };
    await asTenant(owner.tenantId, (tx) => svc.emailStored(tx, actor, { contactId: lena, direction: 'OUTBOUND', sentAt: new Date() }));
    expect(await cadence(lena)).toMatchObject({ state: 'ACTIVE', next: { step: 1 } });
    await asTenant(owner.tenantId, (tx) => svc.emailStored(tx, actor, { contactId: lena, direction: 'INBOUND', sentAt: new Date() }));
    expect(await cadence(lena)).toMatchObject({ state: 'STOPPED', stoppedReason: 'the contact replied by email' });
    expect(await stageOf(lena)).toBe('DISCUSSION');
  });

  it('an RFQ from the employee stops the cadence too', async () => {
    const omar = ids[3]!;
    await api(rep).post(`/contacts/${omar}/initial-email`, { sentAt: new Date(Date.now() - 3 * DAY).toISOString() }).expect(200);
    await api(rep).post(`/contacts/${omar}/initial-email`, { sentAt: new Date(Date.now() + 5 * DAY).toISOString() }).expect(400);
    await api(rep).post('/rfqs', { companyId, contactId: omar, projectName: 'UK drivers survey' }).expect(201);
    expect(await cadence(omar)).toMatchObject({ state: 'STOPPED', stoppedReason: 'an RFQ arrived' });
    expect(await stageOf(omar)).toBe('RFQ_RECEIVED');
  });

  it('sends one morning summary of follow-ups due today and overdue', async () => {
    const reminders = app.get(CrmRemindersService);
    await api(owner).put('/crm-config/follow-up-cadence', { followUps: 3, intervalDays: 2 }).expect(200);
    const contact = (await api(rep).post('/contacts', { firstName: 'Zed', lastName: 'Morning', companyId, ownerId: rep.userId }).expect(201)).body;
    await api(rep).post(`/contacts/${contact.id}/initial-email`, { sentAt: new Date(Date.now() - 3 * DAY).toISOString() }).expect(200);
    const tenantTz = 'UTC';
    const now = new Date();
    const { hour } = localDay(now, tenantTz);
    // The summary goes out from 8:00; test at 9:00 today in UTC.
    const at = hour >= 8 ? now : new Date(now.getTime() + (9 - hour) * 3_600_000);
    await reminders.dailyDigest(at);
    await reminders.dailyDigest(at);
    // Notifications are private to their person, so read them as the rep.
    const page = (await api(rep).get('/notifications?limit=100').expect(200)).body as { items: { type: string; title: string }[] };
    const notes = page.items.filter((n) => n.type === 'followup.daily');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toMatch(/^Follow-ups for today: \d+ due, \d+ overdue$/);
  });

  it('works out the local day in a time zone', () => {
    const d = localDay(new Date('2026-11-26T20:30:00Z'), 'Asia/Kolkata');
    expect(d).toMatchObject({ date: '2026-11-27', hour: 2 });
    expect(d.endOfDay.toISOString()).toBe('2026-11-27T18:29:59.999Z');
    expect(localDay(new Date('2026-11-26T20:30:00Z'), 'Not/AZone').date).toBe('2026-11-26');
  });
});
