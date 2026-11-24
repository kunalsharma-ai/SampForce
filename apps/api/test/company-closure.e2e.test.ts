import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { CompanyClosureService } from '../src/tenants/company-closure.service';
import { api, appClient, ORIGIN, ownerClient, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/*
 * Workspace redesign W7: an owner closes the company after seeing what it stops, typing the company name, entering
 * the password and confirming a second time. Sign-in stops for everyone at once. The Console can reopen it within 30
 * days with everything in it; after that the worker erases its data.
 */
describe('closing the company', () => {
  let app: INestApplication;
  let owner: TestUser;
  let manager: TestUser & { userId: string; workspaceId: string };
  let admin: ReturnType<typeof request.agent>;
  const db = ownerClient();
  const opEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;

  const login = (email: string, password: string) => request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email, password });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    owner = await registerUser(app, 'Closing Traders');
    await db.subscription.update({ where: { tenantId: owner.tenantId }, data: { maxManagerWorkspaces: 2, maxExecutiveWorkspaces: 2 } });
    manager = await workspacePerson(app, owner, 'MANAGER', 'North Team');
    await api(manager).post('/leads', { fullName: 'Ravi Menon' }).expect(201);
    await api(owner).post('/companies', { name: 'Coastal Foods Ltd' }).expect(201);

    const ops = appClient();
    await ops.platformOperator.create({ data: { email: opEmail, name: 'Ada Ops', passwordHash: await new PasswordService().hash('operator-password-1'), role: 'ADMIN' } });
    await ops.$disconnect();
    admin = request.agent(app.getHttpServer());
    await admin.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opEmail, password: 'operator-password-1' }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('shows the owner every workspace and the data closing stops; nobody else may see or do it', async () => {
    const impact = (await api(owner).get('/tenants/current/close-impact').expect(200)).body;
    expect(impact.name).toBe('Closing Traders');
    expect(impact.workspaces.map((w: { name: string; level: string; people: number }) => [w.level, w.name, w.people])).toEqual([
      ['SUPER', 'Closing Traders', 1],
      ['MANAGER', 'North Team', 1],
    ]);
    expect(impact.people).toBe(2);
    expect(impact.records).toMatchObject({ companies: 1, leads: 1 });
    const days = (new Date(impact.eraseAfter).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    await api(manager).get('/tenants/current/close-impact').expect(403);
    await api(manager).postConfirmed('/tenants/current/close', { confirmName: 'Closing Traders', understood: true }).expect(403);
  });

  it('needs the password, the typed name and the second confirmation', async () => {
    expect((await api(owner).post('/tenants/current/close', { confirmName: 'Closing Traders', understood: true }).expect(403)).body.error.code).toBe('PASSWORD_CONFIRMATION_REQUIRED');
    expect((await api(owner).postConfirmed('/tenants/current/close', { confirmName: 'Closing', understood: true }).expect(400)).body.error.code).toBe('CONFIRM_NAME_MISMATCH');
    expect((await api(owner).postConfirmed('/tenants/current/close', { confirmName: 'Closing Traders' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } })).status).toBe('ACTIVE');
  });

  it('closes it: everyone is signed out at once and told why at sign-in', async () => {
    const done = (await api(owner).postConfirmed('/tenants/current/close', { confirmName: 'closing traders', reason: 'Moving to another tool', understood: true }).expect(200)).body;
    expect(done.name).toBe('Closing Traders');
    await api(owner).get('/auth/me').expect(401);
    await api(manager).get('/leads').expect(401);
    const refused = await login(manager.email, manager.password).expect(403);
    expect(refused.body.error.code).toBe('COMPANY_CLOSED');
    expect(refused.body.error.message).toContain(done.eraseAfter.slice(0, 10));

    const t = await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } });
    expect(t).toMatchObject({ status: 'PENDING_DELETION', closeReason: 'Moving to another tool' });
    expect(await db.auditLog.count({ where: { tenantId: owner.tenantId, action: 'tenant.closed' } })).toBe(1);

    // The Console sees it closing, with the erase date and who closed it.
    const row = (await admin.get(`/api/v1/operator/clients/${owner.tenantId}`).expect(200)).body;
    expect(row.closure).toMatchObject({ eraseAfter: done.eraseAfter, closedBy: owner.email, reason: 'Moving to another tool' });
    expect(row.state).toBe('SUSPENDED');
  });

  it('the Console reopens it within the 30 days, with everything in it', async () => {
    await admin.post(`/api/v1/operator/clients/${owner.tenantId}/reopen`).set('origin', ORIGIN).send({ reason: 'Owner changed their mind' }).expect(200);
    const back = await login(manager.email, manager.password).expect(200);
    expect(back.body).toBeTruthy();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: owner.email, password: owner.password }).expect(200);
    owner = { ...owner, agent };
    expect(await db.lead.count({ where: { tenantId: owner.tenantId } })).toBe(1);
    expect((await admin.get(`/api/v1/operator/clients/${owner.tenantId}`).expect(200)).body.closure).toBeNull();
    await admin.post(`/api/v1/operator/clients/${owner.tenantId}/reopen`).set('origin', ORIGIN).send({ reason: 'Again' }).expect(409);
  });

  it('after 30 days the data is erased and cannot come back', async () => {
    const done = (await api(owner).postConfirmed('/tenants/current/close', { confirmName: 'Closing Traders', understood: true }).expect(200)).body;
    expect(done.eraseAfter).toBeTruthy();
    await db.tenant.update({ where: { id: owner.tenantId }, data: { eraseAfter: new Date(Date.now() - 1000) } });
    expect((await admin.post(`/api/v1/operator/clients/${owner.tenantId}/reopen`).set('origin', ORIGIN).send({ reason: 'Too late' }).expect(409)).body.error.code).toBe('REOPEN_TOO_LATE');

    expect(await app.get(CompanyClosureService).eraseDue()).toBe(1);
    for (const model of ['lead', 'company', 'membership', 'workspaceNode', 'auditLog', 'subscription'] as const) {
      expect(await (db[model] as unknown as { count: (a: object) => Promise<number> }).count({ where: { tenantId: owner.tenantId } }), model).toBe(0);
    }
    const t = await db.tenant.findUniqueOrThrow({ where: { id: owner.tenantId } });
    expect(t.erasedAt).toBeTruthy();
    expect(t.deletedAt).toBeTruthy();
    // People who belonged only to this company are anonymised: their email is free again.
    expect(await db.user.count({ where: { email: { in: [owner.email, manager.email] } } })).toBe(0);
    await login(manager.email, manager.password).expect(401);
    expect(await db.platformAuditLog.count({ where: { targetTenantId: owner.tenantId, action: 'client.erased' } })).toBe(1);
    await admin.get(`/api/v1/operator/clients/${owner.tenantId}`).expect(404);
    expect(await app.get(CompanyClosureService).eraseDue()).toBe(0);
  });
});
