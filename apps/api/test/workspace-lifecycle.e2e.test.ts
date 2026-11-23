import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Workspace redesign W4: a Manager or Executive Workspace can be deactivated (reversible: its people and everyone
 * below stop until it is reactivated) or deleted. Deleting shows what it touches first, needs the typed name and the
 * password, and hands everything over: its people's records and open tasks go to the receiving workspace's person, a
 * manager's Executive Workspaces move under the receiving workspace, and nothing in the CRM is erased.
 */

type Person = TestUser & { userId: string; workspaceId: string };

describe('deactivating and deleting workspaces', () => {
  let app: INestApplication;
  let owner: TestUser;
  let north: Person;
  let south: Person;
  let exec: Person;
  const db = ownerClient();

  async function workspace(creator: TestUser, level: 'MANAGER' | 'EXECUTIVE', name: string, person: string, parentId?: string): Promise<Person> {
    const ws = (await api(creator).post('/workspaces', { level, name, ...(parentId ? { parentId } : {}), person: { inviteEmail: `${randomUUID().slice(0, 8)}@lifecycle.test` } }).expect(201)).body as { id: string; inviteUrl: string };
    const agent = request.agent(app.getHttpServer());
    const password = 'a-long-password-1';
    await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token: ws.inviteUrl.split('/invite/')[1], name: person, password }).expect(200);
    const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
    return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id, workspaceId: ws.id };
  }

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Lifecycle Traders');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 3, maxExecutiveWorkspaces: 3 } });
    north = await workspace(owner, 'MANAGER', 'North Team', 'Rahul North');
    south = await workspace(owner, 'MANAGER', 'South Team', 'Priya South');
    exec = await workspace(owner, 'EXECUTIVE', 'North Exec One', 'Asha Exec', north.workspaceId);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('deactivates a manager with the password: its people and the executives below stop until it is reactivated', async () => {
    const url = `/workspaces/${north.workspaceId}/deactivate`;
    expect((await api(owner).post(url, { reason: 'Team on leave' }).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect((await api(north).postConfirmed(`/workspaces/${south.workspaceId}/deactivate`, { reason: 'Not mine' }).expect(403)).body.error.code).toBe('WORKSPACE_ADMIN_FORBIDDEN');
    const row = (await api(owner).postConfirmed(url, { reason: 'Team on leave' }).expect(200)).body;
    expect(row).toMatchObject({ id: north.workspaceId, deactivationReason: 'Team on leave' });
    expect(row.deactivatedAt).toBeTruthy();
    await api(owner).postConfirmed(url, { reason: 'Again' }).expect(409);

    for (const who of [north, exec]) {
      expect((await api(who).get('/auth/me').expect(200)).body.restriction).toBe('workspace_deactivated');
      expect((await api(who).get('/leads').expect(403)).body.error.code).toBe('WORKSPACE_DEACTIVATED');
    }
    await api(south).get('/leads').expect(200);
    await api(owner).get('/leads').expect(200);
    // The tree says so, and the grants are kept.
    const tree = (await api(owner).get('/workspaces').expect(200)).body;
    expect(tree.workspaces.find((w: { id: string }) => w.id === north.workspaceId)).toMatchObject({ deactivationReason: 'Team on leave' });

    await api(owner).post(`/workspaces/${north.workspaceId}/reactivate`).expect(200);
    expect((await api(north).get('/auth/me').expect(200)).body.restriction).toBeUndefined();
    await api(exec).get('/leads').expect(200);
    await api(owner).post(`/workspaces/${north.workspaceId}/reactivate`).expect(409);

    const actions = (await db.auditLog.findMany({ where: { tenantId: owner.tenantId, entityId: north.workspaceId } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['workspace.deactivated', 'workspace.reactivated']));
  });

  it('a manager may deactivate its own executive without the Delete action', async () => {
    await api(north).postConfirmed(`/workspaces/${exec.workspaceId}/deactivate`, { reason: 'Holiday' }).expect(200);
    expect((await api(exec).get('/leads').expect(403)).body.error.code).toBe('WORKSPACE_DEACTIVATED');
    await api(north).post(`/workspaces/${exec.workspaceId}/reactivate`).expect(200);
    await api(exec).get('/leads').expect(200);
  });

  it('shows what deleting a manager touches, and where its records can go', async () => {
    await api(north).post('/leads', { fullName: 'North Lead' }).expect(201);
    await api(north).post('/companies', { name: 'North Buyer Ltd' }).expect(201);
    await api(exec).post('/leads', { fullName: 'Exec Lead' }).expect(201);
    await db.task.create({ data: { tenantId: owner.tenantId, title: 'Call North Buyer', assigneeId: north.userId } });

    const impact = (await api(owner).get(`/workspaces/${north.workspaceId}/impact`).expect(200)).body;
    expect(impact).toMatchObject({ name: 'North Team', level: 'MANAGER', handoverRequired: true, pendingInvites: 0 });
    expect(impact.people.map((p: { userId: string }) => p.userId)).toEqual([north.userId]);
    expect(impact.records).toMatchObject({ leads: 1, companies: 1, openTasks: 1 });
    expect(impact.workspacesBelow).toEqual([{ id: exec.workspaceId, name: 'North Exec One', people: 1 }]);
    const options = impact.handoverOptions.map((o: { id: string }) => o.id);
    expect(options).toContain(south.workspaceId);
    expect(options).not.toContain(north.workspaceId);
    expect(options).not.toContain(exec.workspaceId);
    expect(impact.handoverOptions.find((o: { id: string }) => o.id === south.workspaceId).receiver).toBe('Priya South');
    // A manager sees the impact of its own executives only.
    await api(north).get(`/workspaces/${exec.workspaceId}/impact`).expect(200);
    expect((await api(north).get(`/workspaces/${south.workspaceId}/impact`).expect(403)).body.error.code).toBe('WORKSPACE_ADMIN_FORBIDDEN');
  });

  it('deletes a manager only with its typed name, the password and a receiving workspace, and erases nothing', async () => {
    const url = `/workspaces/${north.workspaceId}`;
    expect((await api(owner).delUnconfirmed(url).send({ confirmName: 'North Team', handoverToId: south.workspaceId }).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect((await api(owner).del(url, { confirmName: 'North', handoverToId: south.workspaceId }).expect(400)).body.error.code).toBe('CONFIRM_NAME_MISMATCH');
    expect((await api(owner).del(url, { confirmName: 'north team' }).expect(400)).body.error.code).toBe('HANDOVER_REQUIRED');
    expect((await api(owner).del(url, { confirmName: 'North Team', handoverToId: exec.workspaceId }).expect(400)).body.error.code).toBe('INVALID_HANDOVER');
    const before = (await api(owner).get('/workspaces').expect(200)).body.usage.managers.used;

    const done = (await api(owner).del(url, { confirmName: 'north team', handoverToId: south.workspaceId }).expect(200)).body;
    expect(done).toMatchObject({ name: 'North Team', handoverTo: 'South Team', workspacesMoved: 1, peopleRemoved: 1 });
    expect(done.recordsMoved).toBeGreaterThanOrEqual(3);

    // The records are South's now; nothing was erased.
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, fullName: 'North Lead' } });
    expect(lead).toMatchObject({ ownerId: south.userId, deletedAt: null });
    expect((await db.company.findFirstOrThrow({ where: { tenantId: owner.tenantId, name: 'North Buyer Ltd' } })).ownerId).toBe(south.userId);
    expect(await db.task.findFirstOrThrow({ where: { tenantId: owner.tenantId, title: 'Call North Buyer' } })).toMatchObject({ assigneeId: south.userId, reassignedFromId: north.userId, workspaceNodeId: south.workspaceId });
    await api(south).get(`/leads/${lead.id}`).expect(200);

    // The executive moved under South with its person and records, and keeps working.
    expect((await db.workspaceNode.findUniqueOrThrow({ where: { id: exec.workspaceId } })).parentId).toBe(south.workspaceId);
    await api(exec).get('/leads').expect(200);
    const execLead = await db.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, fullName: 'Exec Lead' } });
    await api(south).get(`/leads/${execLead.id}`).expect(200);

    // North's person lost access to the organisation; the workspace stops counting and leaves the tree.
    await api(north).get('/leads').expect(401);
    const tree = (await api(owner).get('/workspaces').expect(200)).body;
    expect(tree.usage.managers.used).toBe(before - 1);
    expect(tree.workspaces.map((w: { id: string }) => w.id)).not.toContain(north.workspaceId);

    const entry = await db.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'workspace.deleted', entityId: north.workspaceId } });
    expect(entry.metadata).toMatchObject({ workspace: 'North Team', handoverToId: south.workspaceId, receiverId: south.userId, workspacesMoved: ['North Exec One'] });
  });

  it('a manager deletes its own executive only once it has Delete, handing the records to itself', async () => {
    await api(exec).post('/leads', { fullName: 'Second Exec Lead' }).expect(201);
    const url = `/workspaces/${exec.workspaceId}`;
    expect((await api(south).del(url, { confirmName: 'North Exec One', handoverToId: south.workspaceId }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
    const actions = (await api(owner).get('/workspaces').expect(200)).body.workspaces.find((w: { id: string }) => w.id === south.workspaceId).actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${south.workspaceId}/permissions`, { actions: { ...actions, Administration: [...(actions.Administration ?? []), 'delete'] } }).expect(200);
    const impact = (await api(south).get(`/workspaces/${exec.workspaceId}/impact`).expect(200)).body;
    expect(impact.handoverOptions.map((o: { id: string }) => o.id)).toEqual([south.workspaceId]);

    await api(south).del(url, { confirmName: 'North Exec One', handoverToId: south.workspaceId }).expect(200);
    expect((await db.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, fullName: 'Second Exec Lead' } })).ownerId).toBe(south.userId);
    await api(exec).get('/leads').expect(401);
  });

  it('deletes an empty workspace without a receiving one', async () => {
    const ws = (await api(owner).post('/workspaces', { level: 'MANAGER', name: 'Empty Team' }).expect(201)).body;
    const impact = (await api(owner).get(`/workspaces/${ws.id}/impact`).expect(200)).body;
    expect(impact.handoverRequired).toBe(false);
    await api(owner).del(`/workspaces/${ws.id}`, { confirmName: 'Empty Team' }).expect(200);
  });
});
