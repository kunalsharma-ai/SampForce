import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, asTenant, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

describe('operator console disabled', () => {
  it('every operator route is 404 without OPERATOR_JWT_SECRET', async () => {
    const app = await startApp();
    await request(app.getHttpServer()).post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: 'a@b.test', password: 'x' }).expect(404);
    await request(app.getHttpServer()).get('/api/v1/operator/tenants').expect(404);
    await app.close();
  });
});

/** The platform operator realm: separate sign-in, scoped reads, audited overrides and support grants. */
describe('operator console', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let owner: TestUser;
  let other: TestUser;
  const adminEmail = `ops-${randomUUID().slice(0, 8)}@platform.test`;
  const supportEmail = `sup-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Ada Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sam Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    owner = await registerUser(app, 'Operated Ltd');
    other = await registerUser(app, 'Bystander Ltd');
    await api(owner).post('/leads', { fullName: 'Secret Lead', email: 'secret@lead.test' }).expect(201);
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('signs in with its own strict, path-scoped cookie; wrong passwords are refused and logged', async () => {
    await op(admin).post('/login', { email: adminEmail, password: 'wrong-password' }).expect(401);
    await op(admin).get('/me').expect(401);
    const res = await op(admin).post('/login', { email: adminEmail, password }).expect(200);
    expect(res.body).toMatchObject({ email: adminEmail, role: 'ADMIN' });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('df_op='))!;
    expect(cookie).toMatch(/Path=\/api\/v1\/operator/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    await op(support).post('/login', { email: supportEmail, password }).expect(200);
    const log = (await op(admin).get('/audit-log').expect(200)).body as { action: string; metadata: { email?: string } }[];
    expect(log.some((l) => l.action === 'operator.login_failed' && l.metadata.email === adminEmail)).toBe(true);
  });

  it('keeps the realms apart', async () => {
    await owner.agent.get('/api/v1/operator/tenants').expect(401);
    const token = (await op(admin).post('/login', { email: adminEmail, password }).expect(200)).headers['set-cookie'] as unknown as string[];
    const opCookie = token.find((c) => c.startsWith('df_op='))!.split(';')[0]!;
    await request(app.getHttpServer()).get('/api/v1/tenants/current').set('cookie', opCookie.replace('df_op=', 'df_access=')).expect(401);
  });

  it('lists workspaces with plan and member counts, never CRM data', async () => {
    const rows = (await op(support).get('/tenants?search=Operated').expect(200)).body as Record<string, unknown>[];
    const row = rows.find((r) => r.id === owner.tenantId)!;
    expect(row).toMatchObject({ name: 'Operated Ltd', members: 1, subscription: { planCode: 'free', status: 'ACTIVE' }, supportAccessUntil: null });
    expect(JSON.stringify(rows)).not.toContain('Secret Lead');
    const detail = (await op(support).get(`/tenants/${owner.tenantId}`).expect(200)).body;
    expect(detail.support).toBeNull();
  });

  it('the operator scan cannot reach CRM tables', async () => {
    const db = appClient();
    const leads = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.operator_scan', 'on', true)`;
      return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM leads`;
    });
    const subs = await db.$transaction(async (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM subscriptions`);
    await db.$disconnect();
    expect(Number(leads[0]!.n)).toBe(0);
    expect(Number(subs[0]!.n)).toBe(0);
  });

  it('shows members and the audit log only while the workspace grants support access', async () => {
    await api(owner).post('/support-access', { hours: 100, reason: 'Too long' }).expect(400);
    const grant = (await api(owner).post('/support-access', { hours: 2, reason: 'Help with import mapping' }).expect(201)).body;
    expect(grant).toMatchObject({ active: true, reason: 'Help with import mapping' });
    const detail = (await op(support).get(`/tenants/${owner.tenantId}`).expect(200)).body;
    expect(detail.support.members).toEqual([expect.objectContaining({ email: owner.email, role: 'Owner' })]);
    expect(detail.support.audit.some((a: { action: string }) => a.action === 'support_access.granted')).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('Secret Lead');
    expect((await op(support).get(`/tenants/${other.tenantId}`).expect(200)).body.support).toBeNull();

    await api(owner).del(`/support-access/${grant.id}`).expect(204);
    expect((await op(support).get(`/tenants/${owner.tenantId}`).expect(200)).body.support).toBeNull();
  });

  it('only admins override plans; both audit logs record who and why', async () => {
    const body = { planCode: 'enterprise', seats: 25, status: 'ACTIVE', reason: 'Signed annual order form #1042' };
    await op(support).post(`/tenants/${owner.tenantId}/plan`, body).expect(403);
    await op(admin).post(`/tenants/${owner.tenantId}/plan`, { ...body, reason: 'x' }).expect(400);
    const detail = (await op(admin).post(`/tenants/${owner.tenantId}/plan`, body).expect(200)).body;
    expect(detail.subscription).toMatchObject({ planCode: 'enterprise', seats: 25, provider: 'NONE' });
    expect((await api(owner).get('/billing').expect(200)).body).toMatchObject({ plan: { code: 'enterprise' }, seatLimit: 25 });
    const checkout = await api(owner).post('/billing/checkout', { provider: 'STRIPE', planCode: 'growth', interval: 'MONTH', seats: 1 }).expect(503);
    expect(checkout.body.error.code).toBe('BILLING_NOT_CONFIGURED');

    const tenantAudit = (await api(owner).get('/audit-logs?limit=10').expect(200)).body.items as { action: string; actorType: string; metadata: { reason?: string; operator?: string } }[];
    expect(tenantAudit.find((a) => a.action === 'billing.plan_overridden')).toMatchObject({ actorType: 'PLATFORM_ADMIN', metadata: { reason: body.reason, operator: adminEmail } });
    const platform = (await op(admin).get(`/audit-log?tenantId=${owner.tenantId}`).expect(200)).body as { action: string; operator: { email: string } }[];
    expect(platform.find((a) => a.action === 'tenant.plan_overridden')!.operator.email).toBe(adminEmail);
    const db = appClient();
    await expect(db.platformAuditLog.updateMany({ data: { action: 'tampered' } })).rejects.toThrow(/permission denied/);
    await expect(db.platformAuditLog.deleteMany({})).rejects.toThrow(/permission denied/);
    await db.$disconnect();
  });

  it('suspending a workspace locks its members out until it is reactivated', async () => {
    await op(admin).post(`/tenants/${owner.tenantId}/status`, { suspended: true, reason: 'Chargeback under review' }).expect(200);
    await api(owner).get('/leads').expect(401);
    await op(admin).post(`/tenants/${owner.tenantId}/status`, { suspended: false, reason: 'Chargeback resolved' }).expect(200);
    await api(owner).get('/leads').expect(200);
    const audit = (await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { tenantId: owner.tenantId, actorType: 'PLATFORM_ADMIN' }, select: { action: true } }))).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['tenant.suspended', 'tenant.reactivated']));
  });

  it('signing out clears the operator session', async () => {
    await op(support).post('/logout', {}).expect(204);
    await op(support).get('/me').expect(401);
  });
});
