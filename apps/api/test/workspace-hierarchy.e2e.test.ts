import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from '@dealflow/types';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * The four-level workspace hierarchy (ADR 0071), through the API with real data. Covers Kunal's scenarios 3 to 10
 * and 15: workspace limits, who may create what, feature inheritance, refusals beyond the parent's grant, record
 * visibility by branch and isolation between client organisations.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser & { userId: string }> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { id: string; email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id, userId: me.user.id };
}

const allBut = (...out: string[]) => FEATURE_KEYS.filter((k) => !out.includes(k));

describe('workspace hierarchy', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let manager: TestUser & { userId: string };
  let manager2: TestUser & { userId: string };
  let executive: TestUser & { userId: string };
  let managerId: string;
  let manager2Id: string;
  let executiveId: string;
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    superAdmin = await registerUser(app, 'Client X');
    // Scenario 3: the Console Admin allows four Manager and six Executive Workspaces.
    await db.subscription.update({ where: { tenantId: superAdmin.tenantId }, data: { maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 } });
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('starts every organisation in its Super Workspace with full access', async () => {
    const me = (await api(superAdmin).get('/workspaces/me').expect(200)).body;
    expect(me).toMatchObject({ level: 'SUPER', levelLabel: 'Super Workspace', designation: 'Client Administrator', organizationName: 'Client X' });
    const tree = (await api(superAdmin).get('/workspaces').expect(200)).body;
    expect(tree.usage).toEqual({ managers: { used: 0, max: 4 }, executives: { used: 0, max: 6 } });
    expect(tree.canCreate).toEqual({ managers: true, executives: true });
    const auth = (await api(superAdmin).get('/auth/me').expect(200)).body;
    expect(auth.workspace).toMatchObject({ level: 'SUPER' });
    expect(auth.tenant.features).toContain('lead_management');
    // Existing CRM keeps working exactly as before.
    await api(superAdmin).post('/leads', { fullName: 'Before Hierarchy' }).expect(201);
  });

  it('scenario 4 and 5: creates four Manager Workspaces, then refuses a fifth', async () => {
    const first = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'North Team', person: { inviteEmail: 'north.manager@client-x.test' } }).expect(201)).body;
    expect(first).toMatchObject({ level: 'MANAGER', designation: 'Sales Manager', organizationId: superAdmin.tenantId, pendingInvites: ['north.manager@client-x.test'] });
    managerId = first.id;
    manager = await acceptInvite(app, first.inviteUrl, 'Rahul Sharma');
    const second = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'South Team', person: { inviteEmail: 'south.manager@client-x.test' } }).expect(201)).body;
    manager2Id = second.id;
    manager2 = await acceptInvite(app, second.inviteUrl, 'Priya Nair');
    await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'East Team' }).expect(201);
    // Two requests at once for the last place: exactly one wins.
    const race = await Promise.all([
      api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'West Team' }),
      api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'Central Team' }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(race.find((r) => r.status === 403)!.body.error.code).toBe('WORKSPACE_LIMIT_REACHED');

    const fifth = await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'Fifth Team' }).expect(403);
    expect(fifth.body.error.code).toBe('WORKSPACE_LIMIT_REACHED');
    const tree = (await api(superAdmin).get('/workspaces').expect(200)).body;
    expect(tree.usage.managers).toEqual({ used: 4, max: 4 });
    expect(tree.canCreate.managers).toBe(false);
    expect((await db.workspaceNode.count({ where: { tenantId: superAdmin.tenantId, level: 'MANAGER' } }))).toBe(4);
  });

  it('refuses duplicate workspace names in an organisation', async () => {
    await db.subscription.update({ where: { tenantId: superAdmin.tenantId }, data: { maxManagerWorkspaces: 5 } });
    const dup = await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: '  north   TEAM ' }).expect(409);
    expect(dup.body.error.code).toBe('WORKSPACE_NAME_TAKEN');
    await db.subscription.update({ where: { tenantId: superAdmin.tenantId }, data: { maxManagerWorkspaces: 4 } });
  });

  it('shows the manager their own workspace, designation and reporting line', async () => {
    const me = (await api(manager).get('/workspaces/me').expect(200)).body;
    expect(me).toMatchObject({ level: 'MANAGER', name: 'North Team', designation: 'Sales Manager', organizationName: 'Client X', parent: { level: 'SUPER' } });
    const tree = (await api(manager).get('/workspaces').expect(200)).body;
    expect(tree.workspaces.map((w: { name: string }) => w.name)).toEqual(['North Team']);
    expect(tree.canCreate).toEqual({ managers: false, executives: false });
  });

  it('scenario 6: a manager creates Executive Workspaces only once the Super Workspace allows it', async () => {
    const refused = await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Amit Desk' }).expect(403);
    expect(refused.body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
    // A manager can never give themselves the right.
    const self = await api(manager).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(403);
    expect(self.body.error.code).toBe('SELF_GRANT_FORBIDDEN');

    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { canCreateExecutives: true }).expect(200);
    const created = (await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Amit Desk', person: { inviteEmail: 'amit@client-x.test' } }).expect(201)).body;
    expect(created).toMatchObject({ level: 'EXECUTIVE', parentId: managerId, designation: 'Sales Executive' });
    executiveId = created.id;
    executive = await acceptInvite(app, created.inviteUrl, 'Amit Verma');
    // Only in their own team.
    const other = await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Elsewhere Desk', parentId: manager2Id }).expect(403);
    expect(other.body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
    // Manager 2 was not allowed.
    expect((await api(manager2).post('/workspaces', { level: 'EXECUTIVE', name: 'South Desk' }).expect(403)).body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
  });

  it('scenario 7: an Executive Workspace cannot create any workspace', async () => {
    for (const level of ['MANAGER', 'EXECUTIVE']) {
      const res = await api(executive).post('/workspaces', { level, name: `Exec ${level}` }).expect(403);
      expect(res.body.error.code).toBe('WORKSPACE_CREATE_FORBIDDEN');
    }
    const me = (await api(executive).get('/workspaces/me').expect(200)).body;
    expect(me).toMatchObject({ level: 'EXECUTIVE', designation: 'Sales Executive', parent: { id: managerId }, reportingManager: { id: manager.userId } });
    expect((await api(executive).get('/workspaces').expect(200)).body.canCreate).toEqual({ managers: false, executives: false });
  });

  it('enforces the executive limit across the organisation', async () => {
    await api(superAdmin).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 2', parentId: manager2Id }).expect(201);
    await api(superAdmin).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 3' }).expect(201);
    await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 4' }).expect(201);
    await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 5' }).expect(201);
    await api(superAdmin).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 6' }).expect(201);
    const seventh = await api(manager).post('/workspaces', { level: 'EXECUTIVE', name: 'Desk 7' }).expect(403);
    expect(seventh.body.error.code).toBe('WORKSPACE_LIMIT_REACHED');
    expect((await api(superAdmin).get('/workspaces').expect(200)).body.usage.executives).toEqual({ used: 6, max: 6 });
  });

  it('scenario 8: a feature switched off by the Super Workspace disappears for the whole branch', async () => {
    await api(manager).get('/leads').expect(200);
    await api(executive).get('/leads').expect(200);
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { features: allBut('lead_management', 'lead_assignment', 'lead_conversion', 'lead_merge') }).expect(200);
    const m = await api(manager).get('/leads').expect(403);
    expect(m.body.error.code).toBe('FEATURE_NOT_GRANTED');
    const e = await api(executive).get('/leads').expect(403);
    expect(e.body.error.code).toBe('FEATURE_NOT_GRANTED');
    // A direct call to a subfeature is refused too, and the session's feature list says so.
    expect((await api(executive).post('/leads', { fullName: 'Sneaky' }).expect(403)).body.error.code).toBe('FEATURE_NOT_GRANTED');
    expect((await api(executive).get('/auth/me').expect(200)).body.tenant.features).not.toContain('lead_management');
    // The other team keeps it.
    await api(manager2).get('/leads').expect(200);
    // The executive's own grant still lists it: switched back on above, it returns without a change below.
    const execRow = await db.workspaceNode.findUniqueOrThrow({ where: { id: executiveId } });
    expect(execRow.features).toContain('lead_management');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { features: [...FEATURE_KEYS] }).expect(200);
    await api(executive).get('/leads').expect(200);
  });

  it('scenario 9: a manager cannot grant a feature or action it was not given', async () => {
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { features: allBut('deal_cloning') }).expect(200);
    const res = await api(manager).put(`/workspaces/${executiveId}/permissions`, { features: [...FEATURE_KEYS] }).expect(403);
    expect(res.body.error.code).toBe('FEATURE_NOT_GRANTED');
    expect(res.body.error.details).toEqual([{ path: 'features', message: 'deal_cloning' }]);
    // Actions too: the manager's own grant has no "configure".
    const act = await api(manager).put(`/workspaces/${executiveId}/permissions`, { actions: { CRM: ['view', 'configure'] } }).expect(403);
    expect(act.body.error.code).toBe('ACTION_NOT_GRANTED');
    // Within its own grant it may narrow its executive.
    await api(manager).put(`/workspaces/${executiveId}/permissions`, { features: allBut('deal_cloning', 'data_export', 'excel_export') }).expect(200);
    // And it cannot touch the other team's workspaces or the Super Workspace.
    const desk2 = (await api(superAdmin).get('/workspaces').expect(200)).body.workspaces.find((w: { name: string }) => w.name === 'Desk 2');
    expect((await api(manager).put(`/workspaces/${desk2.id}/permissions`, { features: [] })).status).toBe(404);
    expect((await api(manager).put(`/workspaces/${manager2Id}/permissions`, { features: [] }).expect(403)).body.error.code).toBe('WORKSPACE_ADMIN_FORBIDDEN');
    await api(superAdmin).put(`/workspaces/${managerId}/permissions`, { features: [...FEATURE_KEYS] }).expect(200);
  });

  it('scenario 10: an executive sees only their own records and only the actions granted', async () => {
    const own = (await api(executive).post('/leads', { fullName: 'Exec Lead' }).expect(201)).body.lead;
    const managers = (await api(manager).post('/leads', { fullName: 'Manager Lead', ownerId: manager.userId }).expect(201)).body.lead;
    const southLead = (await api(manager2).post('/leads', { fullName: 'South Lead', ownerId: manager2.userId }).expect(201)).body.lead;

    // The executive: own lead yes, the manager's no.
    await api(executive).get(`/leads/${own.id}`).expect(200);
    await api(executive).get(`/leads/${managers.id}`).expect(404);
    const execList = (await api(executive).get('/leads').expect(200)).body.items.map((l: { fullName: string }) => l.fullName);
    expect(execList).toContain('Exec Lead');
    expect(execList).not.toContain('Manager Lead');
    // The manager sees their executive's lead, not the other team's; the Super Workspace sees everything.
    await api(manager).get(`/leads/${own.id}`).expect(200);
    await api(manager).get(`/leads/${southLead.id}`).expect(404);
    await api(superAdmin).get(`/leads/${southLead.id}`).expect(200);

    // Actions: the manager takes "delete" away from the executive.
    await api(executive).patch(`/leads/${own.id}`, { jobTitle: 'Buyer' }).expect(200);
    await api(manager).put(`/workspaces/${executiveId}/permissions`, { actions: { CRM: ['view', 'create', 'edit'] } }).expect(200);
    const del = await api(executive).del(`/leads/${own.id}`).expect(403);
    expect(del.body.error.code).toBe('ACTION_NOT_GRANTED');
    // Executives never get exports, assignment or administration by default.
    expect((await api(executive).get('/exports/leads').expect(403)).body.error.code).toMatch(/NOT_GRANTED|FORBIDDEN/);
    expect((await api(executive).post(`/leads/${own.id}/assign`, { ownerId: manager.userId }).expect(403)).body.error.code).toBe('ACTION_NOT_GRANTED');
  });

  it('scenario 15: another client organisation can never reach this one', async () => {
    const other = await registerUser(app, 'Client Y');
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId: superAdmin.tenantId, fullName: 'Exec Lead' } });
    await api(other).get(`/leads/${lead.id}`).expect(404);
    expect((await api(other).put(`/workspaces/${managerId}/permissions`, { features: [] })).status).toBe(404);
    expect((await api(other).post('/workspaces', { level: 'EXECUTIVE', name: 'Smuggled', parentId: managerId })).status).toBe(404);
    expect((await api(other).post(`/workspaces/${executiveId}/members`, { userId: executive.userId })).status).toBe(404);
    const theirs = (await api(other).get('/workspaces').expect(200)).body;
    expect(theirs.workspaces.map((w: { id: string }) => w.id)).not.toContain(managerId);
    expect(theirs.usage.managers.used).toBe(0);
  });

  it('only the Super Workspace moves people and workspaces, and an Executive Workspace holds one person', async () => {
    expect((await api(manager).post(`/workspaces/${executiveId}/move`, { parentId: manager2Id }).expect(403)).body.error.code).toBe('WORKSPACE_TRANSFER_FORBIDDEN');
    expect((await api(superAdmin).post(`/workspaces/${executiveId}/members`, { userId: manager2.userId }).expect(409)).body.error.code).toBe('WORKSPACE_OCCUPIED');
    await api(superAdmin).post(`/workspaces/${executiveId}/move`, { parentId: manager2Id }).expect(201);
    // Moved under the South team: now the South manager sees the executive's lead and North no longer does.
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId: superAdmin.tenantId, fullName: 'Exec Lead' } });
    await api(manager2).get(`/leads/${lead.id}`).expect(200);
    await api(manager).get(`/leads/${lead.id}`).expect(404);
    expect((await api(superAdmin).del(`/workspaces/${managerId}`).expect(409)).body.error.code).toBe('WORKSPACE_NOT_EMPTY');
  });

  it('writes every hierarchy change to the audit log', async () => {
    const rows = await db.auditLog.findMany({ where: { tenantId: superAdmin.tenantId, action: { startsWith: 'workspace.' } } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['workspace.created', 'workspace.permissions_changed', 'workspace.moved']) expect(actions).toContain(a);
    const change = rows.find((r) => r.action === 'workspace.permissions_changed' && (r.metadata as { featuresDisabled?: string[] }).featuresDisabled?.includes('lead_management'));
    expect(change?.actorUserId).toBeTruthy();
  });
});
