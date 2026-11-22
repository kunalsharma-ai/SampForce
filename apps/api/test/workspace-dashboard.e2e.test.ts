import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * One dashboard per workspace level (ADR 0071, part 6), counted from real records: an executive's day, a manager's
 * team and the Super Workspace's organisation all move when an executive records a lead and a call.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id };
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

describe('workspace dashboards', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let north: TestUser;
  let priya: TestUser;
  let arjun: TestUser;
  let other: TestUser;
  let northId: string;
  let southId: string;
  let priyaId: string;
  const db = ownerClient();
  const stamp = Date.now();

  beforeAll(async () => {
    app = await startApp();
    superAdmin = await registerUser(app, 'Frequent Research Dashboards');
    await db.subscription.update({ where: { tenantId: superAdmin.tenantId }, data: { maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 } });
    const n = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@client.test` } }).expect(201)).body;
    northId = n.id;
    north = await acceptInvite(app, n.inviteUrl, 'Rahul Sharma');
    southId = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'South India Sales', person: { inviteEmail: `meera.${stamp}@client.test` } }).expect(201)).body.id;
    await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canCreateExecutives: true }).expect(200);
    const p = (await api(north).post('/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@client.test` } }).expect(201)).body;
    priyaId = p.id;
    priya = await acceptInvite(app, p.inviteUrl, 'Priya Sharma');
    const a = (await api(north).post('/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${stamp}@client.test` } }).expect(201)).body;
    arjun = await acceptInvite(app, a.inviteUrl, 'Arjun Mehta');
    other = await registerUser(app, 'Another Client');

    await api(superAdmin).post('/targets', { workspaceId: northId, metric: 'LEADS', period: 'MONTHLY', startsOn: monthStart, amount: 10 }).expect(201);
    await api(north).post('/targets', { workspaceId: priyaId, metric: 'LEADS', period: 'DAILY', startsOn: today, amount: 5 }).expect(201);
    await api(north).post('/targets', { workspaceId: priyaId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(201);

    // Priya records a lead and a call; Arjun records nothing.
    const company = (await api(priya).post('/companies', { name: `Kantar Panels ${stamp}` }).expect(201)).body;
    await api(priya).post('/activities', { type: 'CALL', subject: 'Intro call', companyId: company.id }).expect(201);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('gives an executive their day: target, leads, what remains and calls', async () => {
    const d = (await api(priya).get('/workspace-dashboard?period=TODAY').expect(200)).body;
    expect(d.level).toBe('EXECUTIVE');
    expect(d.today).toMatchObject({ leadTarget: 5, leads: 1, remaining: 4, calls: 1, callTarget: 20 });
    expect(d.targets).toEqual(expect.arrayContaining([expect.objectContaining({ metric: 'LEADS', amount: 5, achieved: 1 })]));
    expect(d).not.toHaveProperty('executives');
    // Arjun's day is his own.
    expect((await api(arjun).get('/workspace-dashboard').expect(200)).body.today).toMatchObject({ leadTarget: null, leads: 0, remaining: null, calls: 0 });
  });

  it('gives a manager its team: each executive, the best and lowest, reports and trend', async () => {
    const d = (await api(north).get('/workspace-dashboard').expect(200)).body;
    expect(d).toMatchObject({ level: 'MANAGER', team: { name: 'North India Sales' }, executiveCount: 2, totals: { leads: 1, calls: 1 } });
    expect(d.executives.map((e: { workspace: { name: string } }) => e.workspace.name)).toEqual(['Arjun Mehta', 'Priya Sharma']);
    expect(d.best.workspace.name).toBe('Priya Sharma');
    expect(d.lowest.workspace.name).toBe('Arjun Mehta');
    expect(d.reports.map((r: { period: string; leads: number }) => [r.period, r.leads])).toEqual([['TODAY', 1], ['WEEK', 1], ['MONTH', 1]]);
    expect(d.trend).toHaveLength(8);
    expect(d.trend.at(-1).leads).toBe(1);
    expect(d.targets).toEqual([expect.objectContaining({ metric: 'LEADS', amount: 10, achieved: 1, percent: 10 })]);
    // Other managers' figures only when the Super Workspace allows it.
    expect(d.otherManagers).toBeNull();
    await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canViewOtherManagers: true }).expect(200);
    const again = (await api(north).get('/workspace-dashboard').expect(200)).body;
    expect(again.otherManagers.map((m: { workspace: { id: string } }) => m.workspace.id)).toEqual([southId]);
  });

  it('gives the Super Workspace the organisation: capacity, totals, targets and the leaders', async () => {
    const d = (await api(superAdmin).get('/workspace-dashboard?period=MONTH').expect(200)).body;
    expect(d).toMatchObject({ level: 'SUPER', workspaces: { managers: { used: 2, max: 4 }, executives: { used: 2, max: 6 } }, totals: { leads: 1, calls: 1 } });
    expect(d.targets).toEqual([expect.objectContaining({ metric: 'LEADS', amount: 10, achieved: 1 })]);
    expect(d.managers.map((m: { workspace: { name: string }; leads: number }) => [m.workspace.name, m.leads])).toEqual([['North India Sales', 1], ['South India Sales', 0]]);
    expect(d.topManager.workspace.name).toBe('North India Sales');
    expect(d.topExecutive).toMatchObject({ workspace: { name: 'Priya Sharma' }, manager: { name: 'North India Sales' } });
    expect(d.work).toEqual(expect.objectContaining({ openTasks: expect.any(Number), overdueFollowUps: expect.any(Number) }));
  });

  it('counts only the caller’s organisation', async () => {
    const d = (await api(other).get('/workspace-dashboard').expect(200)).body;
    expect(d).toMatchObject({ level: 'SUPER', totals: { leads: 0, calls: 0 }, managers: [], topExecutive: null });
    await api(other).get('/workspace-dashboard?period=YEAR').expect(400);
  });
});
