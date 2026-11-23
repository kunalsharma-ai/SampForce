import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/*
 * Audit views by workspace level (ADR 0071, part 7, spec section 17). Each of the eight kinds of change the spec names
 * is recorded with who, what, which record and when; the Super Workspace reads its organisation, a manager only its own
 * team and only when allowed, executives never, and the Console Admin reads the platform log.
 */

async function acceptInvite(app: INestApplication, inviteUrl: string, name: string): Promise<TestUser> {
  const token = inviteUrl.split('/invite/')[1]!;
  const agent = request.agent(app.getHttpServer());
  const password = 'a-long-password-1';
  await agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name, password }).expect(200);
  const me = (await agent.get('/api/v1/auth/me').expect(200)).body as { user: { email: string }; tenant: { id: string } };
  return { agent, email: me.user.email, password, tenantId: me.tenant.id };
}

interface Row {
  action: string;
  category: string | null;
  actor: { name: string; workspace: { name: string; level: string } | null } | null;
  actorType: string;
  record: { type: string; label: string | null } | null;
  changes: string[];
  createdAt: string;
}

describe('workspace audit views', () => {
  let app: INestApplication;
  let superAdmin: TestUser;
  let north: TestUser;
  let south: TestUser;
  let priya: TestUser;
  let other: TestUser;
  let ops: ReturnType<typeof request.agent>;
  let northId: string;
  let southId: string;
  let priyaId: string;
  const db = ownerClient();
  const stamp = Date.now();
  const opEmail = `ops-audit-${randomUUID().slice(0, 8)}@platform.test`;
  const all = async (user: TestUser, query = ''): Promise<Row[]> => (await api(user).get(`/audit-logs?limit=100${query}`).expect(200)).body.items;

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const op = appClient();
    await op.platformOperator.create({ data: { email: opEmail, name: 'Ada Ops', passwordHash: await new PasswordService().hash('operator-password-1'), role: 'ADMIN' } });
    await op.$disconnect();
    ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opEmail, password: 'operator-password-1' }).expect(200);

    superAdmin = await registerUser(app, 'Frequent Research Audit');
    await db.subscription.update({ where: { tenantId: superAdmin.tenantId }, data: { maxManagerWorkspaces: 4, maxExecutiveWorkspaces: 6 } });
    const n = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'North India Sales', person: { inviteEmail: `rahul.${stamp}@client.test` } }).expect(201)).body;
    northId = n.id;
    north = await acceptInvite(app, n.inviteUrl, 'Rahul Sharma');
    const s = (await api(superAdmin).post('/workspaces', { level: 'MANAGER', name: 'South India Sales', person: { inviteEmail: `meera.${stamp}@client.test` } }).expect(201)).body;
    southId = s.id;
    south = await acceptInvite(app, s.inviteUrl, 'Meera Iyer');
    await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canCreateExecutives: true }).expect(200);
    const p = (await api(north).post('/workspaces', { level: 'EXECUTIVE', name: 'Priya Sharma', person: { inviteEmail: `priya.${stamp}@client.test` } }).expect(201)).body;
    priyaId = p.id;
    priya = await acceptInvite(app, p.inviteUrl, 'Priya Sharma');
    other = await registerUser(app, 'Another Client Audit');

    // The eight kinds of change the spec names.
    await api(superAdmin).put(`/workspaces/${southId}/permissions`, { features: (await api(superAdmin).get('/workspaces').expect(200)).body.workspaces.find((w: { id: string }) => w.id === southId).features.filter((f: string) => f !== 'quotes') }).expect(200);
    await api(superAdmin).post('/targets', { workspaceId: northId, metric: 'LEADS', period: 'MONTHLY', startsOn: `${new Date().toISOString().slice(0, 7)}-01`, amount: 40 }).expect(201);
    const task = (await api(north).post('/assigned-tasks', { title: 'Call the Kantar panel team', workspaceId: priyaId }).expect(201)).body;
    await api(priya).patch(`/assigned-tasks/${task.id}`, { status: 'DONE' }).expect(200);
    const company = (await api(priya).post('/companies', { name: `Kantar Panels ${stamp}` }).expect(201)).body;
    await api(priya).patch(`/companies/${company.id}`, { name: `Kantar Panels India ${stamp}` }).expect(200);
    await api(superAdmin).del(`/companies/${company.id}`).expect((r) => expect([200, 204]).toContain(r.status));
    await ops.put(`/api/v1/operator/clients/${superAdmin.tenantId}/subscription`).set('origin', ORIGIN).send({ maxManagerWorkspaces: 5, seats: 30, reason: 'Order form 42 signed' }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('records who, what, which record and when for each kind of change the spec names', async () => {
    const rows = await all(superAdmin);
    const find = (action: string) => rows.find((r) => r.action === action);
    // Who created a workspace.
    expect(rows.find((r) => r.action === 'workspace.created' && r.record?.label === 'North India Sales')).toMatchObject({ category: 'workspaces', actor: { workspace: { level: 'SUPER' } }, record: { type: 'workspace' } });
    expect(rows.find((r) => r.action === 'workspace.created' && r.record?.label === 'Priya Sharma')).toMatchObject({ actor: { name: 'Rahul Sharma', workspace: { name: 'North India Sales', level: 'MANAGER' } } });
    // Who modified a permission, and who switched a feature off.
    expect(rows.find((r) => r.action === 'workspace.permissions_changed' && r.record?.label === 'North India Sales')?.changes).toContain('May create Executive Workspaces: yes');
    const off = rows.find((r) => r.action === 'workspace.features_changed');
    expect(off).toMatchObject({ category: 'features', record: { type: 'workspace', label: 'South India Sales' } });
    expect(off?.changes).toEqual([expect.stringMatching(/^Switched off: Quotes/)]);
    // Who changed the subscription, and who changed a workspace limit: the Console, in entries of their own.
    expect(find('billing.subscription_changed')).toMatchObject({ category: 'subscription', actorType: 'PLATFORM_ADMIN', actor: null, record: { type: 'subscription' } });
    expect(find('billing.subscription_changed')?.changes.join(' ')).toContain('Seats');
    expect(find('workspace.limits_changed')).toMatchObject({ category: 'limits', changes: expect.arrayContaining([expect.stringMatching(/^Manager Workspaces: 4 → 5$/), 'Reason: Order form 42 signed']) });
    // Who modified a sales target.
    expect(find('target.set')).toMatchObject({ category: 'targets', record: { type: 'workspace_target', label: expect.stringContaining('North India Sales') } });
    // Who assigned and who completed a task.
    expect(find('task.assigned')).toMatchObject({ actor: { name: 'Rahul Sharma' }, record: { label: 'Call the Kantar panel team' } });
    expect(find('task.completed')).toMatchObject({ category: 'tasks', actor: { name: 'Priya Sharma', workspace: { name: 'Priya Sharma', level: 'EXECUTIVE' } }, record: { label: 'Call the Kantar panel team' } });
    // Who edited and who deleted a CRM record: still named after it is gone.
    expect(find('company.updated')).toMatchObject({ category: 'records', actor: { name: 'Priya Sharma' }, record: { type: 'company', label: `Kantar Panels India ${stamp}` } });
    expect(find('company.deleted')).toMatchObject({ record: { label: `Kantar Panels India ${stamp}` } });
    for (const r of rows) expect(Number.isNaN(Date.parse(r.createdAt))).toBe(false);
  });

  it('filters by kind of change, workspace, person and date', async () => {
    const limits = await all(superAdmin, '&category=limits');
    expect(limits.map((r) => r.action)).toEqual(['workspace.limits_changed']);
    const team = await all(superAdmin, `&workspaceId=${northId}`);
    expect(team.some((r) => r.actor?.name === 'Meera Iyer')).toBe(false);
    expect(team.some((r) => r.record?.label === 'South India Sales')).toBe(false);
    expect(team.some((r) => r.action === 'task.completed')).toBe(true);
    const byPriya = await all(superAdmin, `&actorUserId=${(await api(priya).get('/auth/me').expect(200)).body.user.id}`);
    expect(byPriya.length).toBeGreaterThan(0);
    expect(byPriya.every((r) => r.actor?.name === 'Priya Sharma')).toBe(true);
    expect(await all(superAdmin, '&from=2001-01-01&to=2001-01-31')).toEqual([]);
    await api(superAdmin).get('/audit-logs?from=yesterday').expect(400);
    const filters = (await api(superAdmin).get('/audit-logs/filters').expect(200)).body;
    expect(filters.scope).toBe('ORGANISATION');
    expect(filters.workspaces.map((w: { name: string }) => w.name)).toEqual(expect.arrayContaining(['North India Sales', 'South India Sales', 'Priya Sharma']));
  });

  it('gives a manager its own team’s entries only once the Super Workspace allows it', async () => {
    expect((await api(north).get('/audit-logs').expect(403)).body.error.code).toBe('AUDIT_NOT_PERMITTED');
    // A manager cannot grant itself the right.
    await api(north).put(`/workspaces/${northId}/permissions`, { canViewAuditLog: true }).expect(403);
    await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canViewAuditLog: true }).expect(200);
    const page = (await api(north).get('/audit-logs?limit=100').expect(200)).body;
    expect(page.scope).toBe('TEAM');
    const names = new Set((page.items as Row[]).map((r) => r.actor?.name ?? r.actorType));
    expect(names.has('Priya Sharma')).toBe(true);
    expect(names.has('Meera Iyer')).toBe(false);
    expect((page.items as Row[]).some((r) => r.record?.label === 'South India Sales')).toBe(false);
    expect((page.items as Row[]).some((r) => r.actorType === 'PLATFORM_ADMIN')).toBe(false);
    // What the Super Workspace did to the team's own workspace is in it; another team's workspace is refused.
    expect((page.items as Row[]).some((r) => r.action === 'workspace.permissions_changed' && r.record?.label === 'North India Sales')).toBe(true);
    expect((await api(north).get(`/audit-logs?workspaceId=${southId}`).expect(403)).body.error.code).toBe('AUDIT_NOT_PERMITTED');
    const filters = (await api(north).get('/audit-logs/filters').expect(200)).body;
    expect(filters.workspaces.map((w: { name: string }) => w.name).sort()).toEqual(['North India Sales', 'Priya Sharma']);
    expect(filters.people.map((p: { name: string }) => p.name).sort()).toEqual(['Priya Sharma', 'Rahul Sharma']);
    // The other manager still has nothing, and the Super Workspace can take the right back.
    await api(south).get('/audit-logs').expect(403);
    await api(superAdmin).put(`/workspaces/${northId}/permissions`, { canViewAuditLog: false }).expect(200);
    await api(north).get('/audit-logs').expect(403);
    // The grant itself is audited.
    expect((await all(superAdmin, '&category=permissions')).some((r) => r.changes.includes('May read its team’s audit log: no'))).toBe(true);
  });

  it('never gives an executive the audit log, and keeps each organisation to its own', async () => {
    await api(priya).get('/audit-logs').expect(403);
    const theirs = await all(other);
    expect(theirs.some((r) => r.record?.label === 'North India Sales')).toBe(false);
    await api(superAdmin).put(`/workspaces/${priyaId}/permissions`, { canViewAuditLog: true }).expect(400);
  });

  it('gives the Console Admin the platform log, filtered by client and action, with client names', async () => {
    const rows = (await ops.get(`/api/v1/operator/audit-log?tenantId=${superAdmin.tenantId}&action=subscription`).expect(200)).body;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ action: 'client.subscription_changed', operator: { email: opEmail }, client: { id: superAdmin.tenantId, name: 'Frequent Research Audit' } });
    const older = (await ops.get(`/api/v1/operator/audit-log?before=${encodeURIComponent(rows.at(-1).createdAt)}&tenantId=${superAdmin.tenantId}`).expect(200)).body;
    expect(older.every((r: { createdAt: string }) => r.createdAt < rows.at(-1).createdAt)).toBe(true);
    await api(superAdmin).get('/operator/audit-log').expect(401);
  });
});
