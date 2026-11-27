import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ownerClient, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/*
 * Field access handed down by the Super Workspace (ADR 0096). On top of what the Console withholds from a level, the
 * workspace above may hide fields from a Manager or Executive Workspace, or lock them (seen, filled in on a new record,
 * never changed). Limits only add up down the tree: a manager cannot open for its executives what is hidden or
 * locked for itself. The Super Workspace always sees and changes everything.
 */
describe('Field access from the Super Workspace', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let executive: TestUser & { userId: string; workspaceId: string };
  const db = ownerClient();

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Field Access Ltd');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 3, maxExecutiveWorkspaces: 3 } });
    manager = await workspacePerson(app, owner, 'MANAGER', 'Meera Manager');
    const ownerMe = (await api(owner).get('/auth/me').expect(200)).body;
    const sup = ownerMe.workspace.actions as Record<string, string[]>;
    const ownerFeatures = ownerMe.tenant.features as string[];
    // "Give everything allowed": every section and action the Super Workspace has, and Executive Workspaces of its own.
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { actions: sup, features: ownerFeatures, canCreateExecutives: true }).expect(200);
    executive = await workspacePerson(app, manager, 'EXECUTIVE', 'Esha Executive');
    const mgr = (await api(manager).get('/auth/me').expect(200)).body.workspace.actions as Record<string, string[]>;
    await api(manager).put(`/workspaces/${executive.workspaceId}/permissions`, { actions: mgr, features: ownerFeatures }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  const me = async (u: TestUser) => (await api(u).get('/auth/me').expect(200)).body;
  const row = async (u: TestUser, id: string) => ((await api(u).get('/workspaces').expect(200)).body.workspaces as { id: string }[]).find((w) => w.id === id) as Record<string, unknown>;

  it('lets the Super Workspace hide and lock fields for a Manager Workspace, enforced by the server', async () => {
    const company = (await api(owner).post('/companies', { name: `Lock Co ${Date.now()}`, primaryEmail: 'sales@lock.test', website: 'https://lock.test', industry: 'Research', managerId: manager.userId, ownerId: manager.userId }).expect(201)).body;
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { hiddenFields: ['company.website', 'nope.field'] }).expect(400);
    const saved = (await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { hiddenFields: ['company.website'], lockedFields: ['company.primaryEmail', 'company.website'] }).expect(200)).body;
    // A hidden field is not also locked.
    expect(saved).toMatchObject({ hiddenFields: ['company.website'], lockedFields: ['company.primaryEmail'], effectiveHiddenFields: ['company.website'], effectiveLockedFields: ['company.primaryEmail'] });
    expect((await me(manager)).workspace).toMatchObject({ hiddenFields: ['company.website'], lockedFields: ['company.primaryEmail'] });
    // The Super Workspace keeps every right.
    expect((await me(owner)).workspace).toMatchObject({ hiddenFields: [], lockedFields: [] });

    const seen = (await api(manager).get(`/companies/${company.id}`).expect(200)).body;
    expect(seen.website).toBeNull();
    expect(seen.primaryEmail).toBe('sales@lock.test');
    // Locked and hidden fields are not changed by an edit; the rest is saved.
    await api(manager).patch(`/companies/${company.id}`, { primaryEmail: 'changed@lock.test', website: 'https://changed.test', industry: 'Market research' }).expect(200);
    const after = (await api(owner).get(`/companies/${company.id}`).expect(200)).body;
    expect(after).toMatchObject({ primaryEmail: 'sales@lock.test', website: 'https://lock.test', industry: 'Market research' });
    // A locked field can be filled in on a new record.
    const created = (await api(manager).post('/companies', { name: `Manager Co ${Date.now()}`, primaryEmail: 'new@lock.test' }).expect(201)).body;
    expect((await api(owner).get(`/companies/${created.id}`).expect(200)).body.primaryEmail).toBe('new@lock.test');

    const entry = await db.auditLog.findFirst({ where: { tenantId: owner.tenantId, action: 'workspace.permissions_changed', entityId: manager.workspaceId }, orderBy: { createdAt: 'desc' } });
    expect(entry?.metadata).toMatchObject({ fieldsHidden: ['company.website'], fieldsLocked: ['company.primaryEmail'] });
  });

  it('passes limits down: a manager cannot open for its executives what is hidden or locked for itself', async () => {
    // The manager tries to show everything to its executive: what is fixed above still applies.
    const r = (await api(manager).put(`/workspaces/${executive.workspaceId}/permissions`, { hiddenFields: [], lockedFields: [] }).expect(200)).body;
    expect(r).toMatchObject({ effectiveHiddenFields: ['company.website'], effectiveLockedFields: ['company.primaryEmail'] });
    // It may hide more, and lock a field the Super Workspace left open.
    await api(manager).put(`/workspaces/${executive.workspaceId}/permissions`, { hiddenFields: ['contact.email'], lockedFields: ['deal.amount', 'company.primaryEmail'] }).expect(200);
    const exec = (await me(executive)).workspace;
    expect(exec.hiddenFields).toEqual(['company.website', 'contact.email']);
    expect(exec.lockedFields).toEqual(['company.primaryEmail', 'deal.amount']);
    // The Super Workspace sees the executive's own choices and the result.
    expect(await row(owner, executive.workspaceId)).toMatchObject({ hiddenFields: ['contact.email'], lockedFields: ['company.primaryEmail', 'deal.amount'], effectiveHiddenFields: ['company.website', 'contact.email'] });

    // Hiding at the top hides it all the way down, and lifting it opens it again.
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { hiddenFields: ['company.website', 'company.primaryEmail'], lockedFields: [] }).expect(200);
    expect((await me(executive)).workspace.hiddenFields).toEqual(['company.primaryEmail', 'company.website', 'contact.email']);
    await api(owner).put(`/workspaces/${manager.workspaceId}/permissions`, { hiddenFields: [], lockedFields: [] }).expect(200);
    const opened = (await me(executive)).workspace;
    expect(opened.hiddenFields).toEqual(['contact.email']);
    expect(opened.lockedFields).toEqual(['company.primaryEmail', 'deal.amount']);
  });

  it('refuses field access for the Super Workspace and from an executive', async () => {
    const tree = (await api(owner).get('/workspaces').expect(200)).body;
    const superRow = tree.workspaces.find((w: { level: string }) => w.level === 'SUPER') ?? tree.mine;
    expect(superRow).toMatchObject({ hiddenFields: [], lockedFields: [], effectiveHiddenFields: [], effectiveLockedFields: [] });
    await api(executive).put(`/workspaces/${executive.workspaceId}/permissions`, { hiddenFields: [] }).expect(403);
    await api(executive).put(`/workspaces/${manager.workspaceId}/permissions`, { lockedFields: [] }).expect(403);
  });
});
