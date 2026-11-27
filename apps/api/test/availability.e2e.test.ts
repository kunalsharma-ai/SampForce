import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Working status (redesign R1, ADR 0081): check in, break, resume, check out, the times SampForce works out, Away after
 * no open page, who sees whom in the hierarchy, and the notifications a manager and the Super admins get.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

describe('working status', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let manager: TestUser & { userId: string };
  let executive: TestUser & { userId: string };
  let executive2: TestUser & { userId: string };
  let other: TestUser;
  let managerId: string;
  let executiveId: string;
  let executive2Id: string;
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    superAdmin = await registerUser(app, 'Status Org');
    const m = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'East Team', person: { inviteEmail: `east.${Date.now()}@client.test` } }).expect(201)).body;
    managerId = m.id;
    manager = await acceptInvite(app, m.inviteUrl, 'Meera Manager');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const e = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Rahul Exec', person: { inviteEmail: `rahul.${Date.now()}@client.test` } }).expect(201)).body;
    executiveId = e.id;
    executive = await acceptInvite(app, e.inviteUrl, 'Rahul Exec');
    const e2 = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Amit Exec', person: { inviteEmail: `amit.${Date.now()}@client.test` } }).expect(201)).body;
    executive2Id = e2.id;
    executive2 = await acceptInvite(app, e2.inviteUrl, 'Amit Exec');
    other = await registerUser(app, 'Another Status Org');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('starts checked out, then records check-in, a break, resume and check-out with the times', async () => {
    const start = (await api(executive).get('/availability/me').expect(200)).body;
    expect(start).toMatchObject({ status: 'CHECKED_OUT', session: null, since: null });

    // Nothing but check-in works before checking in.
    expect((await api(executive).post('/availability/break', {}).expect(400)).body.error.code).toBe('NOT_CHECKED_IN');
    expect((await api(executive).post('/availability/check-out', {}).expect(400)).body.error.code).toBe('NOT_CHECKED_IN');

    const inn = (await api(executive).post('/availability/check-in', {}).expect(200)).body;
    expect(inn.status).toBe('WORKING');
    expect(inn.session).toMatchObject({ checkedOutAt: null, breaks: [], breakMinutes: 0, workedMinutes: 0 });
    expect((await api(executive).post('/availability/check-in', {}).expect(400)).body.error.code).toBe('ALREADY_CHECKED_IN');

    // Pretend the check-in was 2 hours ago, so the times can be checked.
    const session = await db.workSession.findFirstOrThrow({ where: { userId: executive.userId } });
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    await db.workSession.update({ where: { id: session.id }, data: { checkedInAt: twoHoursAgo } });

    const onBreak = (await api(executive).post('/availability/break', {}).expect(200)).body;
    expect(onBreak.status).toBe('ON_BREAK');
    expect(onBreak.session.breaks).toHaveLength(1);
    expect((await api(executive).post('/availability/break', {}).expect(400)).body.error.code).toBe('ALREADY_ON_BREAK');

    // The break started 15 minutes ago.
    const row = await db.workSession.findUniqueOrThrow({ where: { id: session.id } });
    const breaks = row.breaks as { start: string; end: string | null }[];
    await db.workSession.update({ where: { id: session.id }, data: { breaks: [{ start: new Date(Date.now() - 15 * 60_000).toISOString(), end: null }] } });
    expect(breaks[0]!.end).toBeNull();
    const during = (await api(executive).get('/availability/me').expect(200)).body;
    expect(during.session.breakMinutes).toBe(15);
    expect(during.session.workedMinutes).toBeGreaterThanOrEqual(104);
    expect(during.session.workedMinutes).toBeLessThanOrEqual(106);

    const back = (await api(executive).post('/availability/resume', {}).expect(200)).body;
    expect(back.status).toBe('WORKING');
    expect(back.session.breaks[0].end).not.toBeNull();
    expect((await api(executive).post('/availability/resume', {}).expect(400)).body.error.code).toBe('NOT_ON_BREAK');

    const out = (await api(executive).post('/availability/check-out', {}).expect(200)).body;
    expect(out.status).toBe('CHECKED_OUT');
    expect(out.session.checkedOutAt).not.toBeNull();
    expect(out.session.breakMinutes).toBe(15);
    expect(out.session.workedMinutes).toBeGreaterThanOrEqual(104);

    // Every step is in the log, which nobody can rewrite.
    const events = await db.availabilityEvent.findMany({ where: { userId: executive.userId }, orderBy: { at: 'asc' } });
    expect(events.map((e) => e.kind)).toEqual(['CHECK_IN', 'BREAK_START', 'BREAK_END', 'CHECK_OUT']);
  });

  it('tells the manager and the Super admins about each change, never the person themself', async () => {
    const managerNotes = (await api(manager).get('/notifications').expect(200)).body.items as { type: string; title: string; link: string }[];
    const status = managerNotes.filter((n) => n.type.startsWith('team.status.'));
    const titles = status.map((n) => n.title);
    // The change is in the type too, so the on-screen card shows the right picture in any language (spec section 9).
    expect(status.map((n) => n.type)).toEqual(expect.arrayContaining(['team.status.checked_in', 'team.status.on_break', 'team.status.back', 'team.status.checked_out']));
    expect(titles).toEqual(expect.arrayContaining(['Rahul Exec checked in', 'Rahul Exec is on a break', 'Rahul Exec is back at work', 'Rahul Exec checked out']));
    expect(status[0]!.link).toBe('/app/team-status');
    const superNotes = (await api(superAdmin).get('/notifications').expect(200)).body.items as { type: string }[];
    expect(superNotes.filter((n) => n.type.startsWith('team.status.'))).toHaveLength(4);
    const own = (await api(executive).get('/notifications').expect(200)).body.items as { type: string }[];
    expect(own.filter((n) => n.type.startsWith('team.status'))).toHaveLength(0);
  });

  it('lets a checked-in person choose Available or Away, and shows Away by itself after no open page', async () => {
    await api(executive2).post('/availability/check-in', {}).expect(200);
    expect((await api(executive2).put('/availability/status', { status: 'AVAILABLE' }).expect(200)).body.status).toBe('AVAILABLE');
    expect((await api(executive2).put('/availability/status', { status: 'AWAY' }).expect(200)).body).toMatchObject({ status: 'AWAY', autoAway: false });
    // Checked out and On break are not chosen by hand.
    await api(executive2).put('/availability/status', { status: 'ON_BREAK' }).expect(400);
    await api(executive2).put('/availability/status', { status: 'WORKING' }).expect(200);

    // No page open for 11 minutes: Away, until a page beats again.
    await db.workSession.updateMany({ where: { userId: executive2.userId, checkedOutAt: null }, data: { lastSeenAt: new Date(Date.now() - 11 * 60_000) } });
    expect((await api(executive2).get('/availability/me').expect(200)).body).toMatchObject({ status: 'AWAY', autoAway: true });
    expect((await api(executive2).post('/availability/beat', {}).expect(200)).body).toMatchObject({ status: 'WORKING', autoAway: false });
  });

  it('closes a session forgotten for a whole day at the last sign of life', async () => {
    await api(manager).post('/availability/check-in', {}).expect(200);
    const s = await db.workSession.findFirstOrThrow({ where: { userId: manager.userId, checkedOutAt: null } });
    const lastSeen = new Date(Date.now() - 19 * 3_600_000);
    await db.workSession.update({ where: { id: s.id }, data: { checkedInAt: new Date(Date.now() - 20 * 3_600_000), lastSeenAt: lastSeen } });
    const me = (await api(manager).get('/availability/me').expect(200)).body;
    expect(me.status).toBe('CHECKED_OUT');
    const closed = await db.workSession.findUniqueOrThrow({ where: { id: s.id } });
    expect(closed).toMatchObject({ autoClosed: true });
    expect(closed.checkedOutAt!.getTime()).toBe(lastSeen.getTime());
    // And a new check-in works.
    expect((await api(manager).post('/availability/check-in', {}).expect(200)).body.status).toBe('WORKING');
  });

  it('shows the Super Workspace everyone, a manager its team, and an executive only themself', async () => {
    const org = (await api(superAdmin).get('/availability/team').expect(200)).body;
    expect(org.scope).toBe('ORGANISATION');
    expect(org.people.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Meera Manager', 'Rahul Exec', 'Amit Exec']));
    expect(org.people[0].isMe).toBe(true);
    expect(org.counts.WORKING).toBeGreaterThanOrEqual(2);
    const amit = org.people.find((p: { name: string }) => p.name === 'Amit Exec');
    expect(amit).toMatchObject({ status: 'WORKING', workspace: { id: executive2Id, level: 'EXECUTIVE' } });

    const team = (await api(manager).get('/availability/team').expect(200)).body;
    expect(team.scope).toBe('TEAM');
    expect(team.people.map((p: { name: string }) => p.name).sort()).toEqual(['Amit Exec', 'Meera Manager', 'Rahul Exec']);
    // A manager can narrow to one of its executives, but not look outside its team.
    const one = (await api(manager).get(`/availability/team?workspaceId=${executiveId}`).expect(200)).body;
    expect(one.people.map((p: { name: string }) => p.name)).toEqual(['Rahul Exec']);
    expect((await api(executive).get(`/availability/team?workspaceId=${managerId}`).expect(400)).body.error.code).toBe('WORKSPACE_NOT_VISIBLE');

    const self = (await api(executive).get('/availability/team').expect(200)).body;
    expect(self.scope).toBe('SELF');
    expect(self.people.map((p: { name: string }) => p.name)).toEqual(['Rahul Exec']);
  });

  it('lets executives see their team mates once the manager allows chat with peers', async () => {
    await api(manager).put(`/workspaces/${executiveId}/permissions`, { canChatWithPeers: true }).expect(200);
    await api(manager).put(`/workspaces/${executive2Id}/permissions`, { canChatWithPeers: true }).expect(200);
    const mates = (await api(executive).get('/availability/team').expect(200)).body;
    expect(mates.people.map((p: { name: string }) => p.name).sort()).toEqual(['Amit Exec', 'Rahul Exec']);
  });

  it('keeps organisations apart', async () => {
    const theirs = (await api(other).get('/availability/team').expect(200)).body;
    expect(theirs.people.map((p: { name: string }) => p.name)).not.toContain('Rahul Exec');
    await api(other).post('/availability/check-in', {}).expect(200);
    const ours = (await api(superAdmin).get('/availability/team').expect(200)).body;
    expect(ours.people).toHaveLength(4);
  });
});
