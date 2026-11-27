import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Targets and tasks down the workspace hierarchy (ADR 0071, part 4), through the API with real records. Covers Kunal's
 * scenario 11 (an executive records a lead and the targets above it move) and scenario 12 (a manager assigns a task
 * and the executive receives it), plus who may hand work to whom.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

describe('targets and tasks down the hierarchy', () => {
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
    superAdmin = await registerUser(app, 'Frequent Research Work');
    const m = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'North Team', person: { inviteEmail: `north.${Date.now()}@client.test` } }).expect(201)).body;
    managerId = m.id;
    manager = await acceptInvite(app, m.inviteUrl, 'Rahul Sharma');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const e = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${Date.now()}@client.test` } }).expect(201)).body;
    executiveId = e.id;
    executive = await acceptInvite(app, e.inviteUrl, 'Priya Sharma');
    const e2 = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Arjun Mehta', person: { inviteEmail: `arjun.${Date.now()}@client.test` } }).expect(201)).body;
    executive2Id = e2.id;
    executive2 = await acceptInvite(app, e2.inviteUrl, 'Arjun Mehta');
    other = await registerUser(app, 'Another Client');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('scenario 11: the Super Workspace sets a target, the manager splits it, and an executive’s new lead moves both', async () => {
    const target = (await api(superAdmin).post('/targets', { workspaceId: managerId, metric: 'LEADS', period: 'MONTHLY', startsOn: monthStart, amount: 10 }).expect(201)).body;
    expect(target).toMatchObject({ source: 'SUPER', achieved: 0, workspace: { id: managerId, level: 'MANAGER' }, canDistribute: true });

    // The manager hands it down: 6 and 4. More than the target is refused.
    const over = await api(manager).post(`/targets/${target.id}/distribute`, { parts: [{ workspaceId: executiveId, amount: 6 }, { workspaceId: executive2Id, amount: 5 }] }).expect(409);
    expect(over.body.error.code).toBe('TARGET_OVER_DISTRIBUTED');
    const parts = (await api(manager).post(`/targets/${target.id}/distribute`, { parts: [{ workspaceId: executiveId, amount: 6 }, { workspaceId: executive2Id, amount: 4 }] }).expect(201)).body;
    expect(parts.map((p: { source: string }) => p.source)).toEqual(['MANAGER', 'MANAGER']);

    // Scenario 11: the executive records a new lead (a company) and logs a call.
    await api(executive).post('/companies', { name: `Lead from Priya ${Date.now()}` }).expect(201);
    const mine = (await api(executive).get('/targets').expect(200)).body;
    expect(mine.targets).toHaveLength(1);
    expect(mine.targets[0]).toMatchObject({ amount: 6, achieved: 1, source: 'MANAGER', editable: false });
    expect(mine.assignable).toEqual([]);
    const team = (await api(manager).get('/targets').expect(200)).body.targets as { id: string; achieved: number; distributed: number; workspace: { id: string } }[];
    expect(team.find((t) => t.id === target.id)).toMatchObject({ achieved: 1, distributed: 10 });
    expect(team.find((t) => t.workspace.id === executive2Id)).toMatchObject({ achieved: 0 });

    // The target is in the Super Workspace's view too, and the executive was told about it.
    const all = (await api(superAdmin).get('/targets').expect(200)).body.targets;
    expect(all).toHaveLength(3);
    const told = (await api(executive).get('/notifications').expect(200)).body.items;
    expect(told.some((n: { type: string }) => n.type === 'target.set')).toBe(true);

    // Lowering a target below what was handed down is refused.
    expect((await api(superAdmin).patch(`/targets/${target.id}`, { amount: 8 }).expect(409)).body.error.code).toBe('TARGET_BELOW_DISTRIBUTED');
  });

  it('refuses targets from workspaces that do not hand work down', async () => {
    expect((await api(executive).post('/targets', { workspaceId: executiveId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(executive).post('/targets', { workspaceId: executive2Id, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(404);
    // A manager cannot set its own target, nor one in another organisation.
    expect((await api(manager).post('/targets', { workspaceId: managerId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(403)).body.error.code).toBe('WORKSPACE_ADMIN_FORBIDDEN');
    await api(other).post('/targets', { workspaceId: executiveId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(404);

    // When the Super Workspace takes "assign" away in Administration, the manager can no longer set targets.
    const tree = (await api(superAdmin).get('/workspaces').expect(200)).body;
    const north = tree.workspaces.find((w: { id: string }) => w.id === managerId);
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { actions: { ...north.actions, Administration: (north.actions.Administration as string[]).filter((a) => a !== 'assign') } }).expect(200);
    expect((await api(manager).post('/targets', { workspaceId: executiveId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { actions: north.actions }).expect(200);

    // Daily call target counts logged calls.
    const calls = (await api(manager).post('/targets', { workspaceId: executiveId, metric: 'CALLS', period: 'DAILY', startsOn: today, amount: 20 }).expect(201)).body;
    const company = (await api(executive).post('/companies', { name: `Call target ${Date.now()}` }).expect(201)).body.id;
    await api(executive).post('/activities', { type: 'CALL', subject: 'Intro call', companyId: company }).expect(201);
    const after = (await api(executive).get('/targets').expect(200)).body.targets.find((t: { id: string }) => t.id === calls.id);
    expect(after).toMatchObject({ achieved: 1, percent: 5, source: 'MANAGER' });
  });

  it('scenario 12: a manager assigns a task and the executive receives it, with comments and history', async () => {
    const created = (await api(manager).post('/assigned-tasks', { title: 'Call the five new research leads', priority: 'HIGH', dueAt: new Date(Date.now() - 3_600_000).toISOString(), workspaceId: executiveId }).expect(201)).body;
    expect(created).toMatchObject({ assignee: { id: executive.userId }, workspace: { id: executiveId }, createdBy: { id: manager.userId }, overdue: true, canEdit: true });

    const mine = (await api(executive).get('/assigned-tasks').expect(200)).body;
    expect(mine.forMe.map((t: { id: string }) => t.id)).toContain(created.id);
    expect(mine.forMe[0]).toMatchObject({ id: created.id, priority: 'HIGH', overdue: true, canEdit: false, canChangeStatus: true });
    const told = (await api(executive).get('/notifications').expect(200)).body.items;
    expect(told.some((n: { type: string; title: string }) => n.type === 'task.assigned' && n.title.includes('Call the five new research leads'))).toBe(true);

    // The executive may not change the task itself, only its status; it comments and finishes it.
    expect((await api(executive).patch(`/assigned-tasks/${created.id}`, { priority: 'LOW' }).expect(403)).body.error.code).toBe('TASK_EDIT_FORBIDDEN');
    await api(executive).post(`/assigned-tasks/${created.id}/comments`, { body: 'Three done, two tomorrow.' }).expect(201);
    const done = (await api(executive).patch(`/assigned-tasks/${created.id}`, { status: 'DONE' }).expect(200)).body;
    expect(done.status).toBe('DONE');
    expect(done.completedAt).not.toBeNull();

    // The manager tracks it: comment, history and a notification that it was finished.
    const seen = (await api(manager).get(`/assigned-tasks/${created.id}`).expect(200)).body;
    expect(seen.commentList.map((c: { body: string }) => c.body)).toEqual(['Three done, two tomorrow.']);
    expect(seen.history.map((h: { kind: string }) => h.kind)).toEqual(['created', 'commented', 'updated']);
    expect(seen.history[2].changes).toEqual([{ field: 'status', from: 'OPEN', to: 'DONE' }]);
    const managerTold = (await api(manager).get('/notifications').expect(200)).body.items;
    // A finished task has its own type, so it pops up as "Task completed" on screen (spec section 9).
    expect(managerTold.some((n: { type: string; title: string }) => n.type === 'task.completed' && n.title.startsWith('Task completed'))).toBe(true);

    // Isolation: the other executive and another organisation never see it; executives cannot assign tasks.
    await api(executive2).get(`/assigned-tasks/${created.id}`).expect(404);
    await api(other).get(`/assigned-tasks/${created.id}`).expect(404);
    expect((await api(executive).post('/assigned-tasks', { title: 'Upward task', workspaceId: managerId }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    expect((await api(manager).post('/assigned-tasks', { title: 'Upward task', workspaceId: managerId }).expect(403)).body.error.code).toBe('TASK_ASSIGN_FORBIDDEN');
    expect((await api(manager).post('/assigned-tasks', { title: 'Wrong person', workspaceId: executiveId, assigneeUserId: executive2.userId }).expect(400)).body.error.code).toBe('INVALID_ASSIGNEE');

    // The history is append-only and the change is in the audit log.
    const audit = await db.auditLog.findMany({ where: { tenantId: superAdmin.tenantId, entityId: created.id } });
    expect(audit.map((a) => a.action).sort()).toEqual(['task.assigned', 'task.commented', 'task.completed']);
  });
  it('R7: the assignee acknowledges, starts and blocks a task, and comments get reactions', async () => {
    const t = (await api(manager).post('/assigned-tasks', { title: 'Send the panel book to Kantar', workspaceId: executiveId }).expect(201)).body;
    expect(t).toMatchObject({ progress: 'NEW', acknowledgedAt: null, canProgress: false });
    expect((await api(executive).get(`/assigned-tasks/${t.id}`).expect(200)).body.canProgress).toBe(true);

    // Only the assignee says where it stands; blocking needs a reason.
    expect((await api(manager).post(`/assigned-tasks/${t.id}/progress`, { progress: 'ACKNOWLEDGED' }).expect(403)).body.error.code).toBe('TASK_PROGRESS_FORBIDDEN');
    await api(executive).post(`/assigned-tasks/${t.id}/progress`, { progress: 'BLOCKED' }).expect(400);
    const ack = (await api(executive).post(`/assigned-tasks/${t.id}/progress`, { progress: 'ACKNOWLEDGED' }).expect(200)).body;
    expect(ack.progress).toBe('ACKNOWLEDGED');
    expect(ack.acknowledgedAt).not.toBeNull();
    await api(executive).post(`/assigned-tasks/${t.id}/progress`, { progress: 'IN_PROGRESS' }).expect(200);
    const blocked = (await api(executive).post(`/assigned-tasks/${t.id}/progress`, { progress: 'BLOCKED', reason: 'Waiting for the client’s logo files' }).expect(200)).body;
    expect(blocked).toMatchObject({ progress: 'BLOCKED', blockedReason: 'Waiting for the client’s logo files', acknowledgedAt: ack.acknowledgedAt });

    // The manager hears about each step, the block as high priority, and sees it in the history.
    const told = (await api(manager).get('/notifications').expect(200)).body.items.filter((n: { title: string }) => n.title.includes('Send the panel book'));
    expect(told.map((n: { title: string }) => n.title)).toEqual(expect.arrayContaining(['Task acknowledged: Send the panel book to Kantar', 'Task in progress: Send the panel book to Kantar', 'Task blocked: Send the panel book to Kantar']));
    const seen = (await api(manager).get(`/assigned-tasks/${t.id}`).expect(200)).body;
    expect(seen.history.filter((h: { kind: string }) => h.kind === 'progress').map((h: { changes: { field: string; to: string }[] }) => h.changes[0]!.to)).toEqual(['ACKNOWLEDGED', 'IN_PROGRESS', 'BLOCKED']);

    // Reactions on comments: add, see who, take back.
    const withComment = (await api(executive).post(`/assigned-tasks/${t.id}/comments`, { body: 'Chasing them today.' }).expect(201)).body;
    const commentId = withComment.commentList[0].id;
    const reacted = (await api(manager).post(`/assigned-tasks/${t.id}/comments/${commentId}/reactions`, { emoji: '👍' }).expect(200)).body;
    expect(reacted.commentList[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: true, names: ['Rahul Sharma'] }]);
    const both = (await api(executive).post(`/assigned-tasks/${t.id}/comments/${commentId}/reactions`, { emoji: '👍' }).expect(200)).body;
    expect(both.commentList[0].reactions[0]).toMatchObject({ count: 2, mine: true });
    const back = (await api(manager).post(`/assigned-tasks/${t.id}/comments/${commentId}/reactions`, { emoji: '👍' }).expect(200)).body;
    expect(back.commentList[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: false, names: ['Priya Sharma'] }]);
    await api(manager).post(`/assigned-tasks/${t.id}/comments/${commentId}/reactions`, { emoji: '💩' }).expect(400);
    await api(executive2).post(`/assigned-tasks/${t.id}/comments/${commentId}/reactions`, { emoji: '👍' }).expect(404);

    // A finished task's progress is closed.
    await api(executive).patch(`/assigned-tasks/${t.id}`, { status: 'DONE' }).expect(200);
    expect((await api(executive).post(`/assigned-tasks/${t.id}/progress`, { progress: 'IN_PROGRESS' }).expect(400)).body.error.code).toBe('TASK_NOT_OPEN');
  });

  it('R7: targets cover half-yearly and yearly periods and the new metrics', async () => {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const y = (await api(superAdmin).post('/targets', { workspaceId: managerId, metric: 'MEETINGS', period: 'YEARLY', startsOn: yearStart, amount: 120 }).expect(201)).body;
    expect(y).toMatchObject({ metric: 'MEETINGS', period: 'YEARLY', amount: 120 });
    expect(y.endsOn.slice(0, 10)).toBe(`${today.slice(0, 4)}-12-31`);
    const h = (await api(superAdmin).post('/targets', { workspaceId: managerId, metric: 'EMAILS_SENT', period: 'HALF_YEARLY', startsOn: yearStart, amount: 500 }).expect(201)).body;
    expect(h.endsOn.slice(0, 10)).toBe(`${today.slice(0, 4)}-06-30`);
    for (const metric of ['FOLLOW_UPS_DONE', 'RFQS', 'CONVERSIONS'])
      await api(superAdmin).post('/targets', { workspaceId: managerId, metric, period: 'MONTHLY', startsOn: monthStart, amount: 3 }).expect(201);
  });
});
