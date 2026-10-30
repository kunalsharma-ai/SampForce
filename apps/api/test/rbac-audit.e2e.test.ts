import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { appClient, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/** Adds an existing user to a tenant with a role (stand-in for invitations, which ship in Phase 6). */
async function addMember(db: PrismaClient, tenantId: string, userEmail: string, roleKey: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email: userEmail } });
  return withDbContext(db, { tenantId }, async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: roleKey } } });
    return tx.membership.create({ data: { tenantId, userId: user.id, roleId: role.id } });
  });
}

describe('role-based access control and audit logging', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let owner: TestUser;
  let rep: TestUser;
  let repMembershipId: string;
  let repAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    owner = await registerUser(app, 'RBAC Org');
    rep = await registerUser(app, 'Rep Personal');
    repMembershipId = (await addMember(db, owner.tenantId, rep.email, 'member')).id;
    repAgent = request.agent(app.getHttpServer());
    await repAgent.post('/api/v1/auth/login').send({ email: rep.email, password: rep.password }).expect(200);
    await repAgent.post('/api/v1/auth/switch-tenant').set('origin', ORIGIN).send({ tenantId: owner.tenantId }).expect(200);
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('lets a member read the dashboard but not manage the workspace or read the audit log', async () => {
    const me = await repAgent.get('/api/v1/auth/me').expect(200);
    expect(me.body.tenant.id).toBe(owner.tenantId);
    expect(me.body.role).toBe('member');
    expect(me.body.memberships).toHaveLength(2);

    await repAgent.get('/api/v1/dashboard/summary').expect(200);
    const denied = await repAgent.patch('/api/v1/tenants/current').set('origin', ORIGIN).send({ name: 'Nope' }).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await repAgent.get('/api/v1/audit-logs').expect(403);
    await repAgent
      .patch(`/api/v1/tenants/current/members/${repMembershipId}/role`)
      .set('origin', ORIGIN)
      .send({ roleKey: 'admin' })
      .expect(403);
  });

  it('records tenant updates in the audit log with before/after values', async () => {
    await owner.agent
      .patch('/api/v1/tenants/current')
      .set('origin', ORIGIN)
      .send({ name: 'RBAC Org Renamed', brandColor: '#8057FF' })
      .expect(200);
    const logs = await owner.agent.get('/api/v1/audit-logs?limit=5').expect(200);
    const entry = logs.body.items.find((i: { action: string }) => i.action === 'tenant.updated');
    expect(entry.metadata.changes.name).toEqual({ from: 'RBAC Org', to: 'RBAC Org Renamed' });
    expect(entry.actorName).toBe('User RBAC Org');
    expect(entry.ipAddress).toBeTruthy();
  });

  it('validates tenant settings', async () => {
    const res = await owner.agent
      .patch('/api/v1/tenants/current')
      .set('origin', ORIGIN)
      .send({ brandColor: 'red' })
      .expect(400);
    expect(res.body.error.details[0].path).toBe('brandColor');
    await owner.agent.patch('/api/v1/tenants/current').set('origin', ORIGIN).send({ defaultTimezone: 'Mars/Base' }).expect(400);
    await owner.agent.patch('/api/v1/tenants/current').set('origin', ORIGIN).send({}).expect(400);
  });

  it('lets the owner change roles, audits it, and applies the new permissions immediately', async () => {
    await owner.agent
      .patch(`/api/v1/tenants/current/members/${repMembershipId}/role`)
      .set('origin', ORIGIN)
      .send({ roleKey: 'manager' })
      .expect(200);
    await repAgent.get('/api/v1/audit-logs').expect(200);

    const logs = await owner.agent.get('/api/v1/audit-logs').expect(200);
    expect(logs.body.items.some((i: { action: string; metadata: { to?: string } }) =>
      i.action === 'member.role_changed' && i.metadata.to === 'manager')).toBe(true);
  });

  it('protects the owner role', async () => {
    const members = await owner.agent.get('/api/v1/tenants/current/members').expect(200);
    const ownerRow = members.body.find((m: { roleKey: string }) => m.roleKey === 'owner');
    const last = await owner.agent
      .patch(`/api/v1/tenants/current/members/${ownerRow.membershipId}/role`)
      .set('origin', ORIGIN)
      .send({ roleKey: 'admin' })
      .expect(400);
    expect(last.body.error.code).toBe('LAST_OWNER');

    await owner.agent
      .patch(`/api/v1/tenants/current/members/${repMembershipId}/role`)
      .set('origin', ORIGIN)
      .send({ roleKey: 'admin' })
      .expect(200);
    // An admin can manage members but cannot mint new owners.
    await repAgent
      .patch(`/api/v1/tenants/current/members/${repMembershipId}/role`)
      .set('origin', ORIGIN)
      .send({ roleKey: 'owner' })
      .expect(403);
  });

  it('paginates the audit log with a cursor', async () => {
    const p1 = await owner.agent.get('/api/v1/audit-logs?limit=2').expect(200);
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await owner.agent.get(`/api/v1/audit-logs?limit=2&cursor=${p1.body.nextCursor}`).expect(200);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    await owner.agent.get('/api/v1/audit-logs?limit=1000').expect(400);
  });
});
