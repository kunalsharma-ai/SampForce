import type { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient, withDbContext } from '@dealflow/database';
import { appClient, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

describe('tenant isolation', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    app = await startApp();
    db = appClient();
    a = await registerUser(app, 'Tenant A');
    b = await registerUser(app, 'Tenant B');
    await withDbContext(db, { tenantId: b.tenantId }, (tx) =>
      tx.lead.createMany({
        data: [
          { tenantId: b.tenantId, fullName: 'B lead 1' },
          { tenantId: b.tenantId, fullName: 'B lead 2' },
        ],
      }),
    );
    await withDbContext(db, { tenantId: a.tenantId }, (tx) =>
      tx.lead.create({ data: { tenantId: a.tenantId, fullName: 'A lead' } }),
    );
  });
  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  it('only counts the caller tenant data on the dashboard', async () => {
    const resA = await a.agent.get('/api/v1/dashboard/summary').expect(200);
    const resB = await b.agent.get('/api/v1/dashboard/summary').expect(200);
    const total = (r: typeof resA) => r.body.kpis.find((k: { key: string }) => k.key === 'totalLeads').value;
    expect(total(resA)).toBe(1);
    expect(total(resB)).toBe(2);
  });

  it('never shows another tenant in audit logs or member lists', async () => {
    const logs = await a.agent.get('/api/v1/audit-logs').expect(200);
    expect(logs.body.items.length).toBeGreaterThan(0);
    const members = await a.agent.get('/api/v1/tenants/current/members').expect(200);
    expect(members.body.map((m: { email: string }) => m.email)).toEqual([a.email]);
    const me = await a.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([a.tenantId]);
  });

  it('refuses to switch into a workspace the user does not belong to', async () => {
    const res = await a.agent
      .post('/api/v1/auth/switch-tenant')
      .set('origin', ORIGIN)
      .send({ tenantId: b.tenantId })
      .expect(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
  });

  it('rejects a validly signed token whose tenant the user is not a member of', async () => {
    const me = await a.agent.get('/api/v1/auth/me').expect(200);
    const forged = await new SignJWT({ tid: b.tenantId, sid: '00000000-0000-0000-0000-000000000000' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(me.body.user.id)
      .setIssuer('dealflow-api')
      .setAudience('dealflow')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
    const { default: request } = await import('supertest');
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/summary')
      .set('authorization', `Bearer ${forged}`)
      .expect(401);
  });

  describe('row-level security at the database layer', () => {
    it('hides all tenant rows when no context is set', async () => {
      expect(await db.lead.count()).toBe(0);
      expect(await db.tenant.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
    });

    it('shows only the context tenant rows', async () => {
      const leads = await withDbContext(db, { tenantId: a.tenantId }, (tx) => tx.lead.findMany());
      expect(leads.map((l) => l.fullName)).toEqual(['A lead']);
      // Even an explicit filter for the other tenant returns nothing.
      const sneaky = await withDbContext(db, { tenantId: a.tenantId }, (tx) =>
        tx.lead.findMany({ where: { tenantId: b.tenantId } }),
      );
      expect(sneaky).toHaveLength(0);
    });

    it('rejects writes that target another tenant', async () => {
      await expect(
        withDbContext(db, { tenantId: a.tenantId }, (tx) =>
          tx.lead.create({ data: { tenantId: b.tenantId, fullName: 'Injected' } }),
        ),
      ).rejects.toThrow(/row-level security/);
      const updated = await withDbContext(db, { tenantId: a.tenantId }, (tx) =>
        tx.lead.updateMany({ where: { tenantId: b.tenantId }, data: { fullName: 'Overwritten' } }),
      );
      expect(updated.count).toBe(0);
    });

    it('does not leak context between pooled transactions', async () => {
      await withDbContext(db, { tenantId: a.tenantId }, (tx) => tx.lead.count());
      expect(await db.lead.count()).toBe(0);
    });

    it('keeps the audit log append-only for the application role', async () => {
      await expect(
        withDbContext(db, { tenantId: a.tenantId }, (tx) => tx.auditLog.deleteMany({})),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withDbContext(db, { tenantId: a.tenantId }, (tx) => tx.auditLog.updateMany({ data: { action: 'x' } })),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
