import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/**
 * Mobile access (ADR 0072): the Console Admin approves, the Super Workspace switches it on, and only then can phones
 * sign in. Every phone request is checked against that, and phones only reach routes built for them.
 */
describe('mobile access', () => {
  let app: INestApplication;
  let admin: ReturnType<typeof request.agent>;
  let support: ReturnType<typeof request.agent>;
  let owner: TestUser;
  let other: TestUser;
  let member: TestUser & { userId: string };
  const http = () => request(app.getHttpServer());
  const phone = (installId = `install-${randomUUID().slice(0, 8)}`, platform: 'IOS' | 'ANDROID' = 'IOS') => ({ platform, installId, model: 'iPhone 17', osVersion: '26.1', appVersion: '1.0.0', name: 'Work phone' });
  const signIn = (u: { email: string; password: string }, device = phone()) => http().post('/api/v1/mobile/auth/login').send({ email: u.email, password: u.password, device });
  const bearer = (token: string) => ({
    get: (url: string) => http().get(`/api/v1${url}`).set('authorization', `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set('authorization', `Bearer ${token}`).send(body),
  });
  const op = (agent: ReturnType<typeof request.agent>) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
  });
  const decide = (tenantId: string, action: string, reason = 'Checked by the platform team') => op(admin).post(`/mobile/${tenantId}/decision`, { action, reason });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash('operator-password-1');
    const adminEmail = `mops-${randomUUID().slice(0, 8)}@platform.test`;
    const supportEmail = `msup-${randomUUID().slice(0, 8)}@platform.test`;
    await db.platformOperator.createMany({ data: [{ email: adminEmail, name: 'Mo Ops', passwordHash, role: 'ADMIN' }, { email: supportEmail, name: 'Sue Support', passwordHash, role: 'SUPPORT' }] });
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    support = request.agent(app.getHttpServer());
    await op(admin).post('/login', { email: adminEmail, password: 'operator-password-1' }).expect(200);
    await op(support).post('/login', { email: supportEmail, password: 'operator-password-1' }).expect(200);
    owner = await registerUser(app, 'Mobile Org');
    other = await registerUser(app, 'Other Mobile Org');
    member = await inviteMember(app, owner, 'member');
  });
  afterAll(async () => {
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('refuses phones until the Console approves, and starts no session', async () => {
    const res = await signIn(owner).expect(403);
    expect(res.body.error).toMatchObject({ code: 'MOBILE_ACCESS_BLOCKED', details: [{ path: 'reason', message: 'NOT_APPROVED' }] });
    expect((await api(owner).get('/mobile-access').expect(200)).body).toMatchObject({ status: 'OFF', inPlan: true, activated: false, live: false, blockedBy: 'NOT_APPROVED' });
    // A wrong password is a wrong password, whatever the mobile state.
    await http().post('/api/v1/mobile/auth/login').send({ email: owner.email, password: 'wrong-password-1', device: phone() }).expect(401);
  });

  it('lets only workspace admins ask for mobile access, once', async () => {
    await api(member).post('/mobile-access/request', { message: 'Our team works on the road' }).expect(403);
    const s = (await api(owner).post('/mobile-access/request', { message: 'Our team works on the road' }).expect(200)).body;
    expect(s).toMatchObject({ status: 'REQUESTED', request: { message: 'Our team works on the road' } });
    expect((await api(owner).post('/mobile-access/request', {}).expect(409)).body.error.code).toBe('ALREADY_REQUESTED');
    // The Super Workspace cannot switch it on before the Console approves.
    expect((await api(owner).put('/mobile-access/activation', { activated: true }).expect(409)).body.error.code).toBe('MOBILE_NOT_APPROVED');
  });

  it('shows requests first in the Console; only admins decide, and a reason is required', async () => {
    const overview = (await op(support).get('/mobile').expect(200)).body as { rows: { tenantId: string; status: string; requestMessage: string | null }[]; totals: { requested: number } };
    expect(overview.rows[0]).toMatchObject({ status: 'REQUESTED' });
    expect(overview.rows.find((r) => r.tenantId === owner.tenantId)).toMatchObject({ status: 'REQUESTED', requestMessage: 'Our team works on the road' });
    expect(overview.totals.requested).toBeGreaterThanOrEqual(1);
    await op(support).post(`/mobile/${owner.tenantId}/decision`, { action: 'approve', reason: 'Support tries to approve' }).expect(403);
    await op(admin).post(`/mobile/${owner.tenantId}/decision`, { action: 'approve', reason: 'ok' }).expect(400);
    // Suspending something never approved is not a valid step.
    expect((await decide(owner.tenantId, 'suspend').expect(409)).body.error.code).toBe('INVALID_MOBILE_TRANSITION');
  });

  it('rejects with a reason the Super Workspace can read, then accepts a new request', async () => {
    await decide(owner.tenantId, 'reject', 'Please confirm the number of field staff first').expect(200);
    expect((await api(owner).get('/mobile-access').expect(200)).body).toMatchObject({ status: 'REJECTED', decision: { status: 'REJECTED', reason: 'Please confirm the number of field staff first' } });
    await api(owner).post('/mobile-access/request', { message: '12 field staff' }).expect(200);
  });

  it('will not approve while the plan leaves the mobile app out', async () => {
    await op(admin).post(`/tenants/${owner.tenantId}/features`, { overrides: { mobile_app: false }, reason: 'Testing the plan check' }).expect(200);
    expect((await decide(owner.tenantId, 'approve').expect(409)).body.error.code).toBe('MOBILE_NOT_IN_PLAN');
    await op(admin).post(`/tenants/${owner.tenantId}/features`, { overrides: { mobile_app: null }, reason: 'Back to the plan' }).expect(200);
  });

  it('after approval, phones still wait for the Super Workspace to switch mobile on', async () => {
    const d = (await decide(owner.tenantId, 'approve', 'Approved for the field team').expect(200)).body;
    expect(d.state).toMatchObject({ status: 'APPROVED', activated: false, live: false, blockedBy: 'NOT_ACTIVATED' });
    expect((await signIn(owner).expect(403)).body.error.details[0].message).toBe('NOT_ACTIVATED');
    await api(member).put('/mobile-access/activation', { activated: true }).expect(403);
    const s = (await api(owner).put('/mobile-access/activation', { activated: true }).expect(200)).body;
    expect(s).toMatchObject({ status: 'APPROVED', activated: true, live: true, blockedBy: null });
  });

  let tokens: { accessToken: string; refreshToken: string; deviceId: string; expiresIn: number };
  const ownerInstall = `install-${randomUUID().slice(0, 8)}`;

  it('signs a phone in with the same account, with tokens in the body and no cookie', async () => {
    const res = await signIn(owner, phone(ownerInstall)).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    tokens = res.body;
    expect(tokens).toMatchObject({ tenantId: owner.tenantId, expiresIn: expect.any(Number) });
    expect(tokens.refreshToken.length).toBeGreaterThan(20);
    const me = (await bearer(tokens.accessToken).get('/mobile/session').expect(200)).body;
    expect(me).toMatchObject({ organisation: { id: owner.tenantId, name: 'Mobile Org' }, level: 'SUPER', device: { id: tokens.deviceId, platform: 'IOS' }, workspaces: [{ tenantId: owner.tenantId }] });
    // Members without a designation work their own records: they get the Executive app.
    const m = (await signIn(member).expect(200)).body;
    expect((await bearer(m.accessToken).get('/mobile/session').expect(200)).body.level).toBe('EXECUTIVE');
  });

  it('keeps phones to the routes built for them, whatever the request', async () => {
    expect((await bearer(tokens.accessToken).get('/leads').expect(403)).body.error.code).toBe('MOBILE_NOT_ALLOWED');
    expect((await bearer(tokens.accessToken).get('/auth/me').expect(403)).body.error.code).toBe('MOBILE_NOT_ALLOWED');
    expect((await bearer(tokens.accessToken).get('/mobile-access/devices').expect(403)).body.error.code).toBe('MOBILE_NOT_ALLOWED');
    // A phone's refresh token is not a web session either.
    await http().post('/api/v1/auth/refresh').set('origin', ORIGIN).set('cookie', `df_refresh=${tokens.refreshToken}`).expect(401);
  });

  it('rotates the refresh token; a reused one ends the sessions', async () => {
    // Reuse ends every session of the person (web included), so this uses a person of its own.
    const rotator = await inviteMember(app, owner, 'admin');
    const fresh = (await signIn(rotator).expect(200)).body;
    const next = (await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: fresh.refreshToken }).expect(200)).body;
    expect(next.refreshToken).not.toBe(fresh.refreshToken);
    expect(next.deviceId).toBe(fresh.deviceId);
    await bearer(next.accessToken).get('/mobile/session').expect(200);
    await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: fresh.refreshToken }).expect(401);
    await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: next.refreshToken }).expect(401);
    // A web refresh token is not a phone's.
    await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: 'x'.repeat(43) }).expect(401);
    // Nor is a web refresh token a phone's.
    const webCookie = ((await http().post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: rotator.email, password: rotator.password }).expect(200)).headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('df_refresh='))!;
    await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: webCookie.split(';')[0]!.slice('df_refresh='.length) }).expect(401);
    await bearer(next.accessToken).get('/mobile/session').expect(401);
    await api(rotator).get('/auth/me').expect(401);
  });

  it('shows phones with names to the organisation, and without names to the Console', async () => {
    const devices = (await api(owner).get('/mobile-access/devices').expect(200)).body as { id: string; person: { email: string } | null; platform: string }[];
    expect(devices.find((d) => d.id === tokens.deviceId)).toMatchObject({ platform: 'IOS', person: { email: owner.email } });
    // One phone, one row: signing in again on the same install reuses it.
    expect(devices.filter((d) => d.person?.email === owner.email)).toHaveLength(1);
    const detail = (await op(support).get(`/mobile/${owner.tenantId}`).expect(200)).body;
    expect(detail.state.devices.active).toBe(2); // the owner's phone and the member's
    expect(detail.devices.every((d: { person: unknown; name: unknown }) => d.person === null && d.name === null)).toBe(true);
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['mobile.approve', 'mobile.reject']));
    // Another organisation sees none of them and cannot sign them out.
    expect((await api(other).get('/mobile-access/devices').expect(200)).body).toEqual([]);
    await api(other).del(`/mobile-access/devices/${tokens.deviceId}`).expect(404);
  });

  it('suspending stops phones at once, leaves the web alone, and reinstating restores things as they were', async () => {
    await decide(owner.tenantId, 'suspend', 'Unpaid invoice').expect(200);
    const blocked = (await bearer(tokens.accessToken).get('/mobile/session').expect(403)).body;
    expect(blocked.error).toMatchObject({ code: 'MOBILE_ACCESS_BLOCKED', details: [{ message: 'SUSPENDED' }] });
    expect((await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(403)).body.error.details[0].message).toBe('SUSPENDED');
    expect((await signIn(owner).expect(403)).body.error.details[0].message).toBe('SUSPENDED');
    // The web keeps working, with all its data.
    await api(owner).get('/leads').expect(200);
    expect((await api(owner).get('/mobile-access').expect(200)).body).toMatchObject({ status: 'SUSPENDED', activated: true, live: false });
    await decide(owner.tenantId, 'reinstate', 'Invoice paid').expect(200);
    expect((await api(owner).get('/mobile-access').expect(200)).body).toMatchObject({ status: 'APPROVED', activated: true, live: true });
    // The phone carries on where it stopped, without signing in again.
    await bearer(tokens.accessToken).get('/mobile/session').expect(200);
  });

  it('the Super Workspace switching mobile off signs every phone out', async () => {
    await api(owner).put('/mobile-access/activation', { activated: false }).expect(200);
    await bearer(tokens.accessToken).get('/mobile/session').expect(401);
    // The phone's refresh says why, so the app can show it.
    expect((await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(403)).body.error.details[0].message).toBe('NOT_ACTIVATED');
    expect((await api(owner).get('/mobile-access').expect(200)).body.devices.active).toBe(0);
    await api(owner).put('/mobile-access/activation', { activated: true }).expect(200);
    tokens = (await signIn(owner, phone(ownerInstall)).expect(200)).body;
  });

  it('limits the number of phones when the Console sets one', async () => {
    await op(support).put(`/mobile/${owner.tenantId}/limits`, { maxDevices: 1, reason: 'Plan allows one phone' }).expect(403);
    await op(admin).put(`/mobile/${owner.tenantId}/limits`, { maxDevices: 1, reason: 'Plan allows one phone' }).expect(200);
    expect((await signIn(member).expect(409)).body.error.code).toBe('MOBILE_DEVICE_LIMIT');
    // The phone already signed in may sign in again.
    tokens = (await signIn(owner, phone(ownerInstall)).expect(200)).body;
    // Signing a phone out from the web frees the place.
    await api(owner).del(`/mobile-access/devices/${tokens.deviceId}`).expect(200);
    await bearer(tokens.accessToken).get('/mobile/session').expect(401);
    const m = (await signIn(member, phone(undefined, 'ANDROID')).expect(200)).body;
    await op(admin).put(`/mobile/${owner.tenantId}/limits`, { maxDevices: null, reason: 'No limit again' }).expect(200);
    // Signing out on the phone ends its session and frees its place too.
    await bearer(m.accessToken).post('/mobile/auth/logout').expect(204);
    await bearer(m.accessToken).get('/mobile/session').expect(401);
  });

  it('revoking clears the activation: the Console must approve and the Super Workspace switch on again', async () => {
    tokens = (await signIn(owner, phone(ownerInstall)).expect(200)).body;
    await decide(owner.tenantId, 'revoke', 'Contract ended').expect(200);
    await bearer(tokens.accessToken).get('/mobile/session').expect(401);
    expect((await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(403)).body.error.details[0].message).toBe('REVOKED');
    expect((await api(owner).get('/mobile-access').expect(200)).body).toMatchObject({ status: 'REVOKED', activated: false });
    expect((await api(owner).put('/mobile-access/activation', { activated: true }).expect(409)).body.error.code).toBe('MOBILE_NOT_APPROVED');
    await decide(owner.tenantId, 'approve', 'New contract').expect(200);
    await api(owner).put('/mobile-access/activation', { activated: true }).expect(200);
    await signIn(owner).expect(200);
  });

  it('a person removed from the organisation loses the phone too', async () => {
    const m = (await signIn(member).expect(200)).body;
    // Suspended in the organisation (as SCIM does).
    await asTenant(owner.tenantId, (tx) => tx.membership.updateMany({ where: { tenantId: owner.tenantId, userId: member.userId }, data: { status: 'SUSPENDED' } }));
    await bearer(m.accessToken).get('/mobile/session').expect(401);
    await http().post('/api/v1/mobile/auth/refresh').send({ refreshToken: m.refreshToken }).expect((r) => expect([401, 403]).toContain(r.status));
  });
});
