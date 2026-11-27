import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { TokenService } from '../src/auth/token.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, startApp, type TestUser, workspacePerson, perWorkspaceDelete } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
const tomorrowPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/*
 * Workspace management (sections 16-22): one Super Workspace per person unless the Console allows another; temporary
 * blacklists; the Console's Workspace Management directory with suspend, blacklist, delete and restore on any
 * workspace, each block and delete behind the operator's password, and every action in both audit logs.
 */
describe('workspace management', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let exec: TestUser & { userId: string; workspaceId: string };
  let admin: ReturnType<typeof request.agent>;
  const db = ownerClient();
  const opEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const opPassword = 'operator-password-1';
  const op = {
    get: (url: string) => admin.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => admin.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    patch: (url: string, body: object) => admin.patch(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    del: (url: string, body: object) => admin.delete(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  };

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    owner = await registerUser(app, `Blocking Traders ${randomUUID().slice(0, 4)}`);
    // These tests grant Delete workspace by workspace (W2), so the organisation-wide switch is off.
    await perWorkspaceDelete(owner);
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 3, maxExecutiveWorkspaces: 3 } });
    manager = await workspacePerson(app, owner, 'MANAGER', 'North Team');
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Field Desk');
    await api(manager).post('/leads', { fullName: 'Ravi Menon' }).expect(201);
    const ops = appClient();
    await ops.platformOperator.create({ data: { email: opEmail, name: 'Ada Ops', passwordHash: await new PasswordService().hash(opPassword), role: 'ADMIN' } });
    await ops.$disconnect();
    admin = request.agent(app.getHttpServer());
    await op.post('/login', { email: opEmail, password: opPassword }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('the Super Workspace blacklists a Manager Workspace until a day, with the password; it stops its people and lifts on reactivate', async () => {
    await api(owner).post(`/workspaces/${manager.workspaceId}/blacklist`, { until: tomorrowPlus(5), reason: 'Data review' }).expect(403);
    await api(owner).postConfirmed(`/workspaces/${manager.workspaceId}/blacklist`, { until: tomorrowPlus(0), reason: 'Today is not in the future' }).expect(400);
    const row = (await api(owner).postConfirmed(`/workspaces/${manager.workspaceId}/blacklist`, { until: tomorrowPlus(5), reason: 'Data review' }).expect(200)).body;
    expect(row.blacklistedUntil.slice(0, 10)).toBe(tomorrowPlus(5));
    expect(row.lockedByConsole).toBe(false);
    const refused = await api(manager).get('/leads').expect(403);
    expect(refused.body.error.code).toBe('WORKSPACE_BLACKLISTED');
    expect(refused.body.error.message).toContain(tomorrowPlus(5));
    expect((await api(manager).get('/auth/me').expect(200)).body).toMatchObject({ restriction: 'workspace_deactivated', restrictionUntil: expect.stringContaining(tomorrowPlus(5)) });
    // One block at a time.
    await api(owner).postConfirmed(`/workspaces/${manager.workspaceId}/deactivate`, { reason: 'Twice' }).expect(409);
    await api(owner).post(`/workspaces/${manager.workspaceId}/reactivate`, {}).expect(200);
    await api(manager).get('/leads').expect(200);
    expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'workspace.blacklisted', entityId: manager.workspaceId } })).toBe(1);
  });

  it('a blacklist lifts by itself when its day comes', async () => {
    await api(owner).postConfirmed(`/workspaces/${exec.workspaceId}/blacklist`, { until: tomorrowPlus(2), reason: 'Short block' }).expect(200);
    await api(exec).get('/leads').expect(403);
    await db.workspaceNode.update({ where: { id: exec.workspaceId }, data: { blacklistedUntil: new Date(Date.now() - 1000) } });
    await api(exec).get('/leads').expect(200);
  });

  it('a manager acts on its own Executive Workspaces only when the Super Workspace allowed it', async () => {
    // An executive under the Super Workspace is none of the manager's business.
    await api(manager).postConfirmed(`/workspaces/${exec.workspaceId}/blacklist`, { until: tomorrowPlus(3), reason: 'Not mine' }).expect((r) => expect([403, 404]).toContain(r.status));
    // One in the manager's own team: the manager may block it (Edit is handed down by default) but deletes it only
    // when the Super Workspace hands down Delete, which it does not by default.
    const own = (await api(owner).post('/workspaces', { level: 'EXECUTIVE', name: 'North Desk', parentId: manager.workspaceId }).expect(201)).body;
    await api(manager).postConfirmed(`/workspaces/${own.id}/blacklist`, { until: tomorrowPlus(3), reason: 'Team block' }).expect(200);
    await api(manager).post(`/workspaces/${own.id}/reactivate`, {}).expect(200);
    const refused = await api(manager).del(`/workspaces/${own.id}`, { confirmName: 'North Desk' }).expect(403);
    expect(['FEATURE_NOT_GRANTED', 'ACTION_NOT_GRANTED']).toContain(refused.body.error.code);
    await api(owner).del(`/workspaces/${own.id}`, { confirmName: 'North Desk' }).expect(200);
  });

  it('lists every workspace with its owner, status, users and parent', async () => {
    const list = (await op.get(`/workspaces?tenantId=${owner.tenantId}`).expect(200)).body;
    const by = (name: string) => list.rows.find((r: { name: string }) => r.name === name);
    expect(list.rows).toHaveLength(4);
    expect(by('North Desk'), JSON.stringify(by('North Desk'))).toMatchObject({ status: 'DELETED', restorable: true, parent: { name: 'North Team' } });
    expect(list.rows[0]).toMatchObject({ level: 'SUPER', status: 'ACTIVE', users: 1, owner: { email: owner.email }, parent: null });
    expect(by('North Team')).toMatchObject({ level: 'MANAGER', status: 'ACTIVE', users: 1, owner: { email: manager.email }, parent: { level: 'SUPER' } });
    expect(by('North Team').permissions.features).toBeGreaterThan(0);
    expect(list.counts).toMatchObject({ ACTIVE: 3, DELETED: 1 });
    const searched = (await op.get(`/workspaces?q=${encodeURIComponent(manager.email)}`).expect(200)).body;
    expect(searched.rows.map((r: { name: string }) => r.name)).toEqual(['North Team']);
  });

  it('the Console suspends with its password; the client cannot lift a block the Console set', async () => {
    expect((await op.post(`/workspaces/${manager.workspaceId}/suspend`, { reason: 'Contract review', password: 'wrong-password' }).expect(400)).body.error.code).toBe('INVALID_PASSWORD');
    const detail = (await op.post(`/workspaces/${manager.workspaceId}/suspend`, { reason: 'Contract review', password: opPassword }).expect(200)).body;
    expect(detail).toMatchObject({ status: 'SUSPENDED', statusReason: 'Contract review', lockedByConsole: true });
    await api(manager).get('/leads').expect(403);
    expect((await api(owner).post(`/workspaces/${manager.workspaceId}/reactivate`, {}).expect(403)).body.error.code).toBe('WORKSPACE_LOCKED_BY_CONSOLE');
    await op.post(`/workspaces/${manager.workspaceId}/reactivate`, { reason: 'Review done' }).expect(200);
    await api(manager).get('/leads').expect(200);
    const history = (await op.get(`/workspaces/${manager.workspaceId}`).expect(200)).body.history;
    expect(history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['workspace.deactivated', 'workspace.reactivated', 'workspace.blacklisted']));
    expect(history.find((h: { action: string }) => h.action === 'workspace.deactivated').actor).toContain('(SampForce)');
    expect(await db.platformAuditLog.count({ where: { targetTenantId: owner.tenantId, action: 'workspace.suspended' } })).toBe(1);
  });

  it('the Console blacklists the Super Workspace: everyone in the company is blocked until the day', async () => {
    const superId = (await op.get(`/workspaces?tenantId=${owner.tenantId}&level=SUPER`).expect(200)).body.rows[0].id;
    const detail = (await op.post(`/workspaces/${superId}/blacklist`, { until: tomorrowPlus(4), reason: 'Unpaid invoices', password: opPassword }).expect(200)).body;
    expect(detail).toMatchObject({ level: 'SUPER', status: 'BLACKLISTED', lockedByConsole: true });
    expect((await api(owner).get('/leads').expect(403)).body.error.code).toBe('WORKSPACE_BLACKLISTED');
    await api(manager).get('/leads').expect(403);
    await op.post(`/workspaces/${detail.id}/reactivate`, { reason: 'Paid' }).expect(200);
    await api(owner).get('/leads').expect(200);
  });

  it('the Console deletes a Manager Workspace (records go up) and restores it with its people', async () => {
    await op.del(`/workspaces/${manager.workspaceId}`, { confirmName: 'North', reason: 'Team closed', password: opPassword }).expect(400);
    const gone = (await op.del(`/workspaces/${manager.workspaceId}`, { confirmName: 'north team', reason: 'Team closed', password: opPassword }).expect(200)).body;
    expect(gone.status).toBe('DELETED');
    expect(gone.restorable).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { tenantId: owner.tenantId, fullName: 'Ravi Menon' } });
    const ownerId = (await db.user.findUniqueOrThrow({ where: { email: owner.email } })).id;
    expect(lead.ownerId).toBe(ownerId);
    await api(manager).get('/leads').expect((r) => expect([401, 403]).toContain(r.status));

    const back = (await op.post(`/workspaces/${manager.workspaceId}/restore`, { reason: 'Reorganised back' }).expect(200)).body;
    expect(back).toMatchObject({ status: 'ACTIVE', users: 1 });
    await api(manager).get('/leads').expect(200);
    await op.post(`/workspaces/${manager.workspaceId}/restore`, { reason: 'Again' }).expect(409);
  });

  it('deleting the Super Workspace closes the company; restoring reopens it', async () => {
    const superId = (await op.get(`/workspaces?tenantId=${owner.tenantId}&level=SUPER`).expect(200)).body.rows[0].id;
    const name = (await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).name;
    const closed = (await op.del(`/workspaces/${superId}`, { confirmName: name, reason: 'Client left', password: opPassword }).expect(200)).body;
    expect(closed.closed).toBe(true);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).status).toBe('PENDING_DELETION');
    const row = (await op.get(`/workspaces/${superId}`).expect(200)).body;
    expect(row).toMatchObject({ status: 'DELETED', restorable: true, statusReason: 'Client left' });
    const reopened = await op.post(`/workspaces/${superId}/restore`, { reason: 'Client came back' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).status).toBe('ACTIVE');
  });

  it('one person owns one Super Workspace unless the Console allows another', async () => {
    const body = (email: string, extra: object = {}) => ({
      organisation: { name: `Second Co ${randomUUID().slice(0, 4)}` }, administrator: { name: 'Kunal', email }, planCode: 'growth', seats: 5, reason: 'New order form', ...extra,
    });
    const refused = await op.post('/clients', body(owner.email)).expect(409);
    expect(refused.body.error.code).toBe('SUPER_WORKSPACE_LIMIT');
    const created = (await op.post('/clients', body(owner.email, { allowAnotherSuper: true })).expect(201)).body;
    const token = created.inviteUrl.split('/invite/')[1];
    await owner.agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, password: owner.password }).expect(200);

    // An owner invitation without the Console's yes is refused when accepted.
    const third = (await op.post('/clients', body(`fresh-${randomUUID().slice(0, 6)}@client.test`)).expect(201)).body;
    const raw = randomUUID();
    const tenantId = third.client.id as string;
    const role = await db.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'owner' } } });
    await db.invitation.create({ data: { tenantId, email: owner.email, roleId: role.id, tokenHash: TokenService.hashRefresh(raw), invitedById: 'test', acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) } });
    const no = await request(app.getHttpServer()).post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token: raw, password: owner.password }).expect(403);
    expect(no.body.error.code).toBe('SUPER_WORKSPACE_LIMIT');
    // Inside a company nobody creates a Super Workspace.
    await api(owner).post('/workspaces', { level: 'SUPER', name: 'Another Super' }).expect((r) => expect([400, 403]).toContain(r.status));
  });

  it('only operators with the workspace permissions see and act', async () => {
    await request(app.getHttpServer()).get('/api/v1/operator/workspaces').expect(401);
  });
});
