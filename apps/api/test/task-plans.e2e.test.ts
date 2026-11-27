import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PerformanceView, TargetsView, TargetTrend, TaskPlanDetail, TaskPlansView } from '@dealflow/types';
import { PrismaService } from '../src/common/prisma.service';
import { TaskPlansService } from '../src/task-plans/task-plans.service';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Recurring tasks, the new target measures and performance ranking (ADR 0096), through the API with real records.
 * Kunal's example: a manager gives an executive "create companies and add contacts every day for a month"; the
 * executive's own records complete the day, the manager and the Super Workspace hear about it, and a change applies
 * from now on only.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('recurring tasks, targets and rankings', () => {
  let app: INestApplication;
  let superAdmin: TestUser & { userId?: string };
  let manager: TestUser & { userId: string };
  let executive: TestUser & { userId: string };
  let executive2: TestUser & { userId: string };
  let other: TestUser;
  let managerId: string;
  let executiveId: string;
  const db = ownerClient();
  let today: string;

  beforeAll(async () => {
    app = await startApp();
    superAdmin = await registerUser(app, 'Frequent Research Tasks');
    const m = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'North Team', person: { inviteEmail: `north.${stamp()}@client.test` } }).expect(201)).body;
    managerId = m.id;
    manager = await acceptInvite(app, m.inviteUrl, 'Rahul Sharma');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const e = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Kunal Verma', person: { inviteEmail: `kunal.${stamp()}@client.test` } }).expect(201)).body;
    executiveId = e.id;
    executive = await acceptInvite(app, e.inviteUrl, 'Kunal Verma');
    const e2 = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${stamp()}@client.test` } }).expect(201)).body;
    executive2 = await acceptInvite(app, e2.inviteUrl, 'Arjun Mehta');
    other = await registerUser(app, 'Another Client');
    const view = (await api(executive).get('/task-plans').expect(200)).body as TaskPlansView;
    today = new Intl.DateTimeFormat('en-CA', { timeZone: view.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('makes today’s task from a monthly plan and completes it from the executive’s own records', async () => {
    const plan = (await api(manager)
      .post('/task-plans', {
        title: 'Daily prospecting',
        requirements: [{ metric: 'QUALIFIED_COMPANIES', amount: 2, per: 'DAY' }, { metric: 'CONTACTS', amount: 1, per: 'DAY' }],
        duration: 'ONE_MONTH', startsOn: today, workingDays: EVERY_DAY, assigneeIds: [executive.userId],
      })
      .expect(201)).body as TaskPlanDetail;
    expect(plan).toMatchObject({ status: 'ACTIVE', duration: 'ONE_MONTH', canManage: true, assignees: [{ id: executive.userId, workspace: { id: executiveId } }] });
    expect(plan.instances).toHaveLength(1);

    // The executive sees it straight away, not started, and was told about it.
    let mine = (await api(executive).get('/task-plans').expect(200)).body as TaskPlansView;
    expect(mine.today).toHaveLength(1);
    expect(mine.today[0]).toMatchObject({ title: 'Daily prospecting', cadence: 'DAY', status: 'NOT_STARTED', percent: 0 });
    const told = (await api(executive).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
    expect(told.some((n) => n.type === 'task.assigned' && n.title === 'New recurring task: Daily prospecting')).toBe(true);
    // The manager sees it on the team's list.
    const team = (await api(manager).get('/task-plans').expect(200)).body as TaskPlansView;
    expect(team.teamToday.map((i) => i.person.name)).toContain('Kunal Verma');

    // One qualified company: a quarter of the day (half of one requirement, none of the other).
    const name = `Acme Research ${stamp()}`;
    await api(executive).post('/companies', { name, website: `https://acme-${stamp()}.test` }).expect(201);
    mine = (await api(executive).get('/task-plans').expect(200)).body as TaskPlansView;
    expect(mine.today[0]).toMatchObject({ status: 'IN_PROGRESS', percent: 25 });
    expect(mine.today[0]!.requirements[0]).toMatchObject({ metric: 'QUALIFIED_COMPANIES', done: 1, remaining: 1, percent: 50 });

    // A repeat of the same company, and one nobody can reach, do not count.
    await api(executive).post('/companies', { name, website: `https://acme-copy-${stamp()}.test` }).expect(201);
    await api(executive).post('/companies', { name: `No details ${stamp()}` }).expect(201);
    mine = (await api(executive).get('/task-plans').expect(200)).body as TaskPlansView;
    expect(mine.today[0]!.requirements[0]!.done).toBe(1);

    // The second company and a contact finish the day as they are saved, before anyone opens the page.
    await api(executive).post('/companies', { name: `Globex ${stamp()}`, website: `https://globex-${stamp()}.test` }).expect(201);
    await api(executive).post('/contacts', { firstName: 'Gia', lastName: 'Buyer', email: `gia.${stamp()}@globex.test` }).expect(201);
    const stored = await db.taskPlanInstance.findFirstOrThrow({ where: { planId: plan.id, userId: executive.userId } });
    expect(stored).toMatchObject({ status: 'COMPLETED', percent: 100 });
    expect(stored.completedAt).not.toBeNull();

    mine = (await api(executive).get('/task-plans').expect(200)).body as TaskPlansView;
    expect(mine.today[0]).toMatchObject({ status: 'COMPLETED', percent: 100, streak: 1 });
    expect(mine.bestStreak).toBe(1);

    // A celebration waits for the executive, and the manager and the Super Workspace were told.
    const achievements = (await api(executive).get('/achievements').expect(200)).body.items as { kind: string; details: { taskTitle?: string; streak?: number } }[];
    expect(achievements.find((a) => a.kind === 'TASK_PLAN_DONE')).toMatchObject({ details: { taskTitle: 'Daily prospecting', streak: 1 } });
    expect(achievements.some((a) => a.kind === 'TASK_PLAN_HALF')).toBe(true);
    for (const who of [manager, superAdmin]) {
      const items = (await api(who).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
      expect(items.some((n) => n.type === 'task.completed' && n.title === 'Kunal Verma completed Daily prospecting')).toBe(true);
    }
    const own = (await api(executive).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
    expect(own.filter((n) => n.type === 'task.completed' && n.title === 'Completed: Daily prospecting')).toHaveLength(1);
  });

  it('applies a change from now on, keeps finished days, and tells the executive', async () => {
    const plan = (await api(manager).get('/task-plans').expect(200)).body.team.find((p: { title: string }) => p.title === 'Daily prospecting');
    const changed = (await api(manager)
      .patch(`/task-plans/${plan.id}`, { requirements: [{ metric: 'QUALIFIED_COMPANIES', amount: 5, per: 'DAY' }, { metric: 'MEETINGS', amount: 2, per: 'WEEK' }] })
      .expect(200)).body as TaskPlanDetail;
    expect(changed.revisions[0]).toMatchObject({ kind: 'updated', by: { name: 'Rahul Sharma' }, changes: [{ field: 'requirements' }] });
    // Today was already completed against 2 companies and 1 contact: that stays as it was measured.
    const day = changed.instances.find((i) => i.cadence === 'DAY')!;
    expect(day).toMatchObject({ status: 'COMPLETED' });
    expect(day.requirements.map((r) => [r.metric, r.amount])).toEqual([['QUALIFIED_COMPANIES', 2], ['CONTACTS', 1]]);
    // The new weekly requirement starts this week.
    expect(changed.instances.find((i) => i.cadence === 'WEEK')).toMatchObject({ status: 'NOT_STARTED', requirements: [{ metric: 'MEETINGS', amount: 2 }] });
    const told = (await api(executive).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
    expect(told.some((n) => n.type === 'task.updated' && n.title === 'Recurring task changed: Daily prospecting')).toBe(true);
  });

  it('closes an ended period as partially or not completed and tells the manager', async () => {
    const plan = (await api(manager)
      .post('/task-plans', { title: 'Weekly calls', requirements: [{ metric: 'CALLS', amount: 10, per: 'WEEK' }], duration: 'ONE_WEEK', startsOn: today, workingDays: EVERY_DAY, assigneeIds: [executive2.userId] })
      .expect(201)).body as TaskPlanDetail;
    const company = (await api(executive2).post('/companies', { name: `Call me ${stamp()}` }).expect(201)).body.id;
    await api(executive2).post('/activities', { type: 'CALL', subject: 'Intro call', companyId: company }).expect(201);
    // A week later the worker closes the instance.
    const instance = await db.taskPlanInstance.findFirstOrThrow({ where: { planId: plan.id } });
    const svc = app.get(TaskPlansService);
    const prisma = app.get(PrismaService);
    await prisma.run({ tenantId: superAdmin.tenantId } as never, (tx) => svc.runTenant(tx, superAdmin.tenantId, new Date(instance.endsAt.getTime() + 3_600_000)));
    expect(await db.taskPlanInstance.findUniqueOrThrow({ where: { id: instance.id } })).toMatchObject({ status: 'PARTIALLY_COMPLETED', percent: 10 });
    const items = (await api(manager).get('/notifications').expect(200)).body.items as { type: string; title: string }[];
    expect(items.some((n) => n.type === 'task.not_completed' && n.title === 'Arjun Mehta did not complete Weekly calls (10%)')).toBe(true);
    const detail = (await api(executive2).get(`/task-plans/${plan.id}`).expect(200)).body as TaskPlanDetail;
    expect(detail.totals).toMatchObject({ partial: 1 });
    // With history, the plan can be cancelled but not deleted.
    expect((await api(manager).del(`/task-plans/${plan.id}`).expect(409)).body.error.code).toBe('TASK_PLAN_HAS_HISTORY');
    const cancelled = (await api(manager).post(`/task-plans/${plan.id}/cancel`, { reason: 'Moved to a monthly target' }).expect(200)).body as TaskPlanDetail;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Moved to a monthly target' });
  });

  it('keeps the hierarchy: self-tasks for anyone, team tasks only downwards', async () => {
    // An executive may set themselves a task, but not one for a colleague.
    const self = (await api(executive).post('/task-plans', { title: 'My own calls', requirements: [{ metric: 'CALLS', amount: 3, per: 'DAY' }], duration: 'ONE_DAY', startsOn: today, workingDays: EVERY_DAY, assigneeIds: [executive.userId] }).expect(201)).body as TaskPlanDetail;
    expect(self.endsOn).toBe(today);
    const refused = await api(executive).post('/task-plans', { title: 'For Arjun', requirements: [{ metric: 'CALLS', amount: 3, per: 'DAY' }], duration: 'ONE_DAY', startsOn: today, assigneeIds: [executive2.userId] });
    expect(refused.status).toBe(403);
    // The executive cannot change the manager's task; another organisation cannot even see it.
    const plan = (await api(manager).get('/task-plans').expect(200)).body.team.find((p: { title: string }) => p.title === 'Daily prospecting');
    expect((await api(executive).patch(`/task-plans/${plan.id}`, { title: 'Easier' }).expect(409)).body.error.code).toBe('TASK_PLAN_FORBIDDEN');
    await api(other).get(`/task-plans/${plan.id}`).expect(404);
    // A task never starts in the past; a fresh task without history can be deleted.
    await api(manager).post('/task-plans', { title: 'Old', requirements: [{ metric: 'CALLS', amount: 3, per: 'DAY' }], duration: 'ONE_DAY', startsOn: '2020-01-01', assigneeIds: [executive.userId] }).expect(400);
    await api(executive).del(`/task-plans/${self.id}`).expect(204);
  });

  it('pausing stops today’s instance and resuming the same day brings it back', async () => {
    const plan = (await api(manager).post('/task-plans', { title: 'Emails', requirements: [{ metric: 'EMAILS_SENT', amount: 100, per: 'DAY' }], duration: 'TWO_DAYS', startsOn: today, workingDays: EVERY_DAY, assigneeIds: [executive2.userId] }).expect(201)).body as TaskPlanDetail;
    const paused = (await api(manager).post(`/task-plans/${plan.id}/pause`).expect(200)).body as TaskPlanDetail;
    expect(paused.status).toBe('PAUSED');
    expect(paused.instances[0]!.status).toBe('CANCELLED');
    const resumed = (await api(manager).post(`/task-plans/${plan.id}/resume`).expect(200)).body as TaskPlanDetail;
    expect(resumed.status).toBe('ACTIVE');
    expect(resumed.instances[0]!.status).toBe('NOT_STARTED');
  });

  it('targets: organisation targets, new measures, exceeding 100%, the previous period and the trend', async () => {
    const view = (await api(superAdmin).get('/targets').expect(200)).body as TargetsView;
    const org = view.assignable.find((a) => a.level === 'SUPER')!;
    expect(org).toBeTruthy();
    const contacts = (await api(superAdmin).post('/targets', { workspaceId: org.id, metric: 'CONTACTS', period: 'DAILY', startsOn: today, amount: 1 }).expect(201)).body;
    // Kunal's executive added one contact today (first test); a second one takes it past 100%.
    await api(executive2).post('/contacts', { firstName: 'Ola', lastName: 'Nordmann', email: `ola.${stamp()}@buyer.test` }).expect(201);
    const after = ((await api(superAdmin).get('/targets').expect(200)).body as TargetsView).targets.find((t) => t.id === contacts.id)!;
    expect(after).toMatchObject({ achieved: 2, percent: 200, remaining: 0, state: 'RUNNING', daysLeft: 1, workspace: { level: 'SUPER' } });
    expect(after.previous).toMatchObject({ achieved: 0 });
    expect(after.rule).toMatch(/email address or a phone number/);

    const deals = (await api(manager).post('/targets', { workspaceId: executiveId, metric: 'DEALS_CREATED', period: 'MONTHLY', startsOn: `${today.slice(0, 7)}-01`, amount: 4 }).expect(201)).body;
    expect(deals).toMatchObject({ metric: 'DEALS_CREATED', achieved: 0, currency: null });
    // The deadline moves: the period becomes custom.
    const moved = (await api(manager).patch(`/targets/${deals.id}`, { endsOn: today }).expect(200)).body;
    expect(moved).toMatchObject({ period: 'CUSTOM', endsOn: today });
    const trend = (await api(executive).get(`/targets/${deals.id}/trend`).expect(200)).body as TargetTrend;
    expect(trend.points.length).toBeGreaterThan(0);
    expect(trend.points.at(-1)).toMatchObject({ achieved: 0 });
    expect(trend.history).toHaveLength(6);

    // Executives see their own targets only; the organisation's target stays with the Super Workspace.
    const execView = (await api(executive).get('/targets').expect(200)).body as TargetsView;
    expect(execView.scope).toBe('SELF');
    expect(execView.targets.every((t) => t.workspace.id === executiveId)).toBe(true);
  });

  it('performance: ranks executives on the Super Workspace’s measures and keeps others private', async () => {
    const settings = (await api(superAdmin).put('/performance/settings', { weights: { QUALIFIED_COMPANIES: 50, TASK_COMPLETION: 50 }, showTeamPosition: true, superTaskNotices: 'ALL' }).expect(200)).body;
    expect(settings.weights).toMatchObject({ QUALIFIED_COMPANIES: 50, TASK_COMPLETION: 50, REVENUE: 0 });
    expect((await api(manager).put('/performance/settings', { weights: { QUALIFIED_COMPANIES: 10 }, showTeamPosition: true, superTaskNotices: 'ALL' }).expect(403)).body.error.code).toBe('WORKSPACE_ADMIN_FORBIDDEN');

    const all = (await api(superAdmin).get('/performance?period=WEEK').expect(200)).body as PerformanceView;
    expect(all.scope).toBe('ORGANISATION');
    expect(all.method.map((m) => m.metric)).toEqual(['TASK_COMPLETION', 'QUALIFIED_COMPANIES']);
    expect(all.managers.map((r) => r.workspace.name)).toEqual(['North Team']);
    const kunal = all.executives.find((r) => r.workspace.name === 'Kunal Verma')!;
    const arjun = all.executives.find((r) => r.workspace.name === 'Arjun Mehta')!;
    // Kunal: 2 qualified companies (the best, share 1); of his two finished instances one was completed (the weekly
    // meetings instance was closed by the worker run a week ahead above): (50 x 1 + 50 x 0.5) / 100 = 75.
    expect(kunal).toMatchObject({ rank: 1, values: { QUALIFIED_COMPANIES: 2, TASK_COMPLETION: 50 }, shares: { QUALIFIED_COMPANIES: 1, TASK_COMPLETION: 0.5 }, score: 75 });
    // Arjun: no qualified company and his one finished instance was only partly done.
    expect(arjun).toMatchObject({ rank: 2, values: { QUALIFIED_COMPANIES: 0, TASK_COMPLETION: 0 }, score: 0 });

    // The manager sees its team and itself, not other managers (none allowed); the executive only themselves.
    const mgr = (await api(manager).get('/performance').expect(200)).body as PerformanceView;
    expect(mgr).toMatchObject({ scope: 'TEAM', canConfigure: false });
    expect(mgr.managers.every((r) => r.me)).toBe(true);
    const exec = (await api(executive2).get('/performance').expect(200)).body as PerformanceView;
    expect(exec.executives).toHaveLength(1);
    expect(exec.executives[0]).toMatchObject({ me: true, rank: 2 });
    await api(other).get('/performance').expect(200);
  });
});
