import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

describe('CSV import and export', () => {
  let app: INestApplication;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    http = api(await registerUser(app, 'Importer'));
  });
  afterAll(async () => {
    await app.close();
  });

  const csv = [
    'Name,Email,Company,Tags,Value',
    'Alan Turing,alan@bletchley.test,Bletchley,"math; crypto",1000',
    'Bad Email,not-an-email,X,,',
    'Alan Again,ALAN@bletchley.test,Bletchley,,',
    '"=HYPERLINK(""http://evil"")",formula@x.test,Evil,,',
  ].join('\n');
  const mapping = { Name: 'fullName', Email: 'email', Company: 'companyName', Tags: 'tags', Value: 'estimatedValue' };

  it('dry-runs without writing, then imports with duplicates skipped', async () => {
    const dry = (await http.post('/imports', { entity: 'leads', csv, mapping, dryRun: true }).expect(200)).body;
    expect(dry).toMatchObject({ dryRun: true, totalRows: 4, created: 2, skippedDuplicates: 1 });
    expect(dry.errors).toEqual([expect.objectContaining({ row: 3 })]);
    expect((await http.get('/leads').expect(200)).body.total).toBe(0);

    const real = (await http.post('/imports', { entity: 'leads', csv, mapping }).expect(200)).body;
    expect(real).toMatchObject({ dryRun: false, created: 2, skippedDuplicates: 1 });
    const leads = (await http.get('/leads?q=turing').expect(200)).body.items;
    expect(leads[0]).toMatchObject({ email: 'alan@bletchley.test', tags: ['math', 'crypto'], estimatedValue: 1000 });

    const again = (await http.post('/imports', { entity: 'leads', csv, mapping }).expect(200)).body;
    expect(again).toMatchObject({ created: 0, skippedDuplicates: 3 });
  });

  it('rejects unknown mappings and a missing required column', async () => {
    await http.post('/imports', { entity: 'leads', csv, mapping: { Name: 'passwordHash' } }).expect(400);
    await http.post('/imports', { entity: 'leads', csv, mapping: { Email: 'email' } }).expect(400);
    await http.post('/imports', { entity: 'leads', csv, mapping: { Missing: 'fullName' } }).expect(400);
  });

  it('links imported contacts to companies by name', async () => {
    const res = (await http.post('/imports', { entity: 'contacts', csv: 'First,Last,Org\nAda,Lovelace,Analytical\nCharles,Babbage,analytical\n', mapping: { First: 'firstName', Last: 'lastName', Org: 'companyName' } }).expect(200)).body;
    expect(res.created).toBe(2);
    const companies = (await http.get('/companies?q=analytical').expect(200)).body.items;
    expect(companies).toHaveLength(1);
    expect(companies[0].contactCount).toBe(2);
  });

  it('exports CSV with formulas neutralised and audits the export', async () => {
    const res = await http.get('/exports/leads').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const logs = (await http.get('/audit-logs?limit=50').expect(200)).body.items;
    expect(logs.some((l: { action: string }) => l.action === 'data.exported')).toBe(true);
    expect(logs.some((l: { action: string }) => l.action === 'data.imported')).toBe(true);
  });
});

describe('invitations', () => {
  let app: INestApplication;
  let owner: TestUser;
  let http: ReturnType<typeof api>;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Inviter');
    http = api(owner);
    // The free plan includes 2 users; these tests invite more, so put the workspace on a per-seat plan.
    const { withDbContext } = await import('@dealflow/database');
    const { appClient } = await import('./helpers');
    const db = appClient();
    await withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    await db.$disconnect();
  });
  afterAll(async () => {
    await app.close();
  });

  const tokenOf = (url: string) => url.split('/invite/')[1]!;

  it('lets a new person join with the role they were invited to, once', async () => {
    const inv = (await http.post('/tenants/current/invitations', { email: 'New.Person@example.com', roleKey: 'viewer' }).expect(201)).body;
    expect(inv).toMatchObject({ email: 'new.person@example.com', roleKey: 'viewer', status: 'pending', emailDelivery: 'not_configured' });
    const token = tokenOf(inv.inviteUrl);

    const anon = request.agent(app.getHttpServer());
    const preview = (await anon.get(`/api/v1/auth/invitations/${token}`).expect(200)).body;
    expect(preview).toEqual({ tenantName: 'Inviter', email: 'new.person@example.com', roleName: 'Viewer', hasAccount: false });

    await anon.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name: 'New Person', password: 'short' }).expect(400);
    await anon.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name: 'New Person', password: 'a-long-password-1' }).expect(200);
    const me = (await anon.get('/api/v1/auth/me').expect(200)).body;
    expect(me).toMatchObject({ role: 'viewer', tenant: { id: owner.tenantId } });

    // Viewers can read but not write.
    await anon.get('/api/v1/leads').expect(200);
    await anon.post('/api/v1/leads').set('origin', ORIGIN).send({ fullName: 'x' }).expect(403);

    const reuse = await request(app.getHttpServer()).post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name: 'X', password: 'a-long-password-1' }).expect(404);
    expect(reuse.body.error.code).toBe('INVITATION_INVALID');

    const members = (await http.get('/tenants/current/members').expect(200)).body;
    expect(members.map((m: { email: string }) => m.email)).toContain('new.person@example.com');
    await http.post('/tenants/current/invitations', { email: 'new.person@example.com', roleKey: 'member' }).expect(409);
  });

  it('requires the existing account password when the invitee already has an account', async () => {
    const other = await registerUser(app, 'Elsewhere');
    const inv = (await http.post('/tenants/current/invitations', { email: other.email, roleKey: 'member' }).expect(201)).body;
    const token = tokenOf(inv.inviteUrl);
    const anon = request(app.getHttpServer());
    await anon.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, name: 'Hijack', password: 'wrong-password-123' }).expect(401);
    await other.agent.post('/api/v1/auth/invitations/accept').set('origin', ORIGIN).send({ token, password: other.password }).expect(200);
    const me = (await other.agent.get('/api/v1/auth/me').expect(200)).body;
    expect(me.memberships.map((m: { tenantId: string }) => m.tenantId).sort()).toEqual([owner.tenantId, other.tenantId].sort());
  });

  it('revokes pending invitations and blocks non-managers', async () => {
    const inv = (await http.post('/tenants/current/invitations', { email: 'revoke@example.com', roleKey: 'member' }).expect(201)).body;
    await http.del(`/tenants/current/invitations/${inv.id}`).expect(204);
    await request(app.getHttpServer()).get(`/api/v1/auth/invitations/${tokenOf(inv.inviteUrl)}`).expect(404);
    const list = (await http.get('/tenants/current/invitations').expect(200)).body;
    expect(list.find((i: { id: string }) => i.id === inv.id).status).toBe('revoked');

    const outsider = api(await registerUser(app, 'Outsider'));
    await outsider.del(`/tenants/current/invitations/${inv.id}`).expect(404);
  });

  it('enforces the free plan user limit, counting pending invitations', async () => {
    const free = api(await registerUser(app, 'Free Plan'));
    await free.post('/tenants/current/invitations', { email: 'one@example.com', roleKey: 'member' }).expect(201);
    const res = await free.post('/tenants/current/invitations', { email: 'two@example.com', roleKey: 'member' }).expect(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
    // Re-inviting the same address replaces the pending invitation instead of taking another seat.
    await free.post('/tenants/current/invitations', { email: 'one@example.com', roleKey: 'viewer' }).expect(201);
  });

  it('never stores the raw token', async () => {
    const inv = (await http.post('/tenants/current/invitations', { email: 'hash@example.com', roleKey: 'member' }).expect(201)).body;
    const { appClient } = await import('./helpers');
    const { withDbContext } = await import('@dealflow/database');
    const db = appClient();
    const row = await withDbContext(db, { tenantId: owner.tenantId }, (tx) => tx.invitation.findUniqueOrThrow({ where: { id: inv.id } }));
    await db.$disconnect();
    expect(row.tokenHash).not.toBe(tokenOf(inv.inviteUrl));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
