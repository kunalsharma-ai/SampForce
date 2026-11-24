import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Workspace redesign W2: Delete is a permission like any other, off by default for every new Manager and Executive
 * Workspace. The workspace above turns it on. Every route that asks for the password also needs it, whatever its HTTP
 * method (a bulk delete is a POST), and the Super Workspace keeps it.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id };
}

describe('delete permission', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser;
  let managerId: string;
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Delete Rights Ltd');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 2, maxExecutiveWorkspaces: 2 } });
    const ws = (await api(owner).post('/workspaces', { level: 'MANAGER', name: 'North', person: { inviteEmail: 'north@delete-rights.test' } }).expect(201)).body;
    managerId = ws.id;
    manager = await acceptInvite(app, ws.inviteUrl, 'Neha Manager');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('is off for a new Manager Workspace, on for the Super Workspace', async () => {
    const me = (await api(manager).get('/auth/me').expect(200)).body;
    expect(me.workspace.level).toBe('MANAGER');
    expect(me.workspace.actions.CRM).toContain('edit');
    expect(me.workspace.actions.CRM).not.toContain('delete');
    expect(Object.values(me.workspace.actions as Record<string, string[]>).some((l) => l.includes('delete'))).toBe(false);
    const sup = (await api(owner).get('/auth/me').expect(200)).body;
    expect(sup.workspace.actions.CRM).toContain('delete');
  });

  it('refuses a delete without the permission, even with the right password, and deletes once it is granted', async () => {
    const lead = (await api(manager).post('/leads', { fullName: 'Kept Lead' }).expect(201)).body.lead;
    const refused = await api(manager).del(`/leads/${lead.id}`).expect(403);
    
    expect(refused.body.error.code).toBe('ACTION_NOT_GRANTED');
    const bulk = await api(manager).postConfirmed('/records/bulk', { entity: 'leads', ids: [lead.id], action: 'delete' }).expect(403);
    
    expect(bulk.body.error.code).toBe('ACTION_NOT_GRANTED');
    // Other bulk actions are not deletes and still work.
    await api(manager).post('/records/bulk', { entity: 'leads', ids: [lead.id], action: 'status', status: 'CONTACTED' }).expect(200);
    await api(manager).get(`/leads/${lead.id}`).expect(200);

    // A manager cannot give itself the right.
    await api(manager).put(`/workspaces/${managerId}/permissions`, { actions: { CRM: ['view', 'create', 'edit', 'delete'] } }).expect(403);

    // The whole action map is sent: an update replaces it.
    const before = (await api(manager).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(owner).put(`/workspaces/${managerId}/permissions`, { actions: { ...before, CRM: [...before.CRM!, 'delete'] } }).expect(200);
    expect((await api(manager).get('/auth/me').expect(200)).body.workspace.actions.CRM).toContain('delete');
    await api(manager).del(`/leads/${lead.id}`).expect(204);
    await api(manager).get(`/leads/${lead.id}`).expect(404);
  });

  it('is still off for an Executive Workspace created below a manager that has it', async () => {
    await api(owner).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const exec = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 1', person: { inviteEmail: 'desk1@delete-rights.test' } }).expect(201)).body;
    const executive = await acceptInvite(app, exec.inviteUrl, 'Arun Exec');
    expect((await api(executive).get('/auth/me').expect(200)).body.workspace.actions.CRM).not.toContain('delete');
    const lead = (await api(executive).post('/leads', { fullName: 'Exec Lead' }).expect(201)).body.lead;
    expect((await api(executive).del(`/leads/${lead.id}`).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
  });
});
