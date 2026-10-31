import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepAt } from '../src/auth/totp';
import { api, asTenant, inviteMember, ORIGIN, ownerClient, registerUser, startApp } from './helpers';

const codeAt = (secret: string, offset = 0) => hotp(base32Decode(secret), stepAt(Date.now() / 1000) + offset);

async function login(app: INestApplication, email: string, password: string) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email, password });
  return { agent, res };
}

describe('two-step verification and lockout', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('enrols with an authenticator app, then sign-in needs a code or a recovery code', async () => {
    const u = await registerUser(app, 'MFA Co');
    const a = api(u);
    expect((await a.get('/auth/mfa').expect(200)).body).toMatchObject({ enabled: false, canManage: true });

    await a.post('/auth/mfa/setup', { password: 'wrong-password-1' }).expect(400);
    const setup = (await a.post('/auth/mfa/setup', { password: u.password }).expect(200)).body as { secret: string; otpauthUri: string };
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/DealFlow%3A/);
    await a.post('/auth/mfa/enable', { code: '000000' }).expect(400);

    // A second device signed in before enrolment is signed out when the second factor turns on.
    const other = await login(app, u.email, u.password);
    expect(other.res.status).toBe(200);
    const enabled = await a.post('/auth/mfa/enable', { code: codeAt(setup.secret) }).expect(200);
    const recovery = enabled.body.recoveryCodes as string[];
    expect(recovery).toHaveLength(10);
    await other.agent.post('/api/v1/auth/refresh').set('origin', ORIGIN).expect(401);
    const me = (await a.get('/auth/me').expect(200)).body;
    expect(me).toMatchObject({ authMethod: 'mfa', mfaEnabled: true });

    // Password alone now yields a challenge, not a session.
    const step1 = await login(app, u.email, u.password);
    expect(step1.res.body).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(step1.res.headers['set-cookie']).toBeUndefined();
    await step1.agent.get('/api/v1/auth/me').expect(401);
    await step1.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: step1.res.body.challenge, code: '123456' }).expect(401);
    await step1.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: 'not-a-challenge-token', code: codeAt(setup.secret, 1) }).expect(401);
    await step1.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: step1.res.body.challenge, code: codeAt(setup.secret, 1) }).expect(200);
    expect((await step1.agent.get('/api/v1/auth/me').expect(200)).body.authMethod).toBe('mfa');

    // The same code cannot be used twice.
    const replay = await login(app, u.email, u.password);
    await replay.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: replay.res.body.challenge, code: codeAt(setup.secret, 1) }).expect(401);

    // Recovery codes work once each, with or without the dash, in any case.
    await replay.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: replay.res.body.challenge, code: recovery[0]!.toUpperCase() }).expect(200);
    const again = await login(app, u.email, u.password);
    await again.agent.post('/api/v1/auth/mfa/verify').set('origin', ORIGIN).send({ challenge: again.res.body.challenge, code: recovery[0] }).expect(401);
    expect((await a.get('/auth/mfa').expect(200)).body.recoveryCodesRemaining).toBe(9);

    // Turning it off needs the password and a code.
    await a.post('/auth/mfa/disable', { password: u.password, code: 'zzzzz-zzzzz' }).expect(400);
    await a.post('/auth/mfa/disable', { password: u.password, code: recovery[1] }).expect(204);
    expect((await login(app, u.email, u.password)).res.body.tenantId).toBe(u.tenantId);

    const audit = await asTenant(u.tenantId, (tx) => tx.auditLog.findMany({ where: { action: { startsWith: 'auth.mfa' } }, select: { action: true } }));
    expect(audit.map((r) => r.action).sort()).toEqual(['auth.mfa_disabled', 'auth.mfa_enabled']);
  });

  it('pauses sign-in after ten failures without revealing it, and counts failed codes too', async () => {
    const u = await registerUser(app, 'Lockout Co');
    for (let i = 0; i < 10; i++) expect((await login(app, u.email, 'wrong-password-1')).res.status).toBe(401);
    const locked = await login(app, u.email, u.password);
    expect(locked.res.status).toBe(401);
    expect(locked.res.body.error.code).toBe('INVALID_CREDENTIALS');

    const db = ownerClient();
    try {
      const row = await db.user.findUniqueOrThrow({ where: { email: u.email } });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      await db.user.update({ where: { email: u.email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      expect((await login(app, u.email, u.password)).res.status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { email: u.email } })).failedLoginCount).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });

  it('lets a workspace require two-step verification, restricting members until they turn it on', async () => {
    const owner = await registerUser(app, 'Policy Co');
    const member = await inviteMember(app, owner, 'member');
    const o = api(owner);

    // The admin must have it on first, so they cannot lock themselves out of the setting.
    const refused = await o.put('/security/mfa-policy', { requireMfa: true }).expect(400);
    expect(refused.body.error.code).toBe('MFA_NOT_ENABLED');
    const setup = (await o.post('/auth/mfa/setup', { password: owner.password }).expect(200)).body as { secret: string };
    await o.post('/auth/mfa/enable', { code: codeAt(setup.secret) }).expect(200);
    await o.put('/security/mfa-policy', { requireMfa: true }).expect(200);
    expect((await o.get('/security/settings').expect(200)).body).toMatchObject({ requireMfa: true, membersWithoutMfa: 1, callerHasMfa: true });

    const m = api(member);
    const blocked = await m.get('/contacts').expect(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    expect((await m.get('/auth/me').expect(200)).body.restriction).toBe('mfa_enrolment');
    const ms = (await m.post('/auth/mfa/setup', { password: member.password }).expect(200)).body as { secret: string };
    await m.post('/auth/mfa/enable', { code: codeAt(ms.secret) }).expect(200);
    await m.get('/contacts').expect(200);
    expect((await m.get('/auth/me').expect(200)).body.restriction).toBeUndefined();
  });

  it('lists signed-in devices and signs out the others', async () => {
    const u = await registerUser(app, 'Devices Co');
    const second = await login(app, u.email, u.password);
    const a = api(u);
    const list = (await a.get('/auth/sessions').expect(200)).body as { id: string; current: boolean }[];
    expect(list, JSON.stringify(list)).toHaveLength(2);
    expect(list.filter((s) => s.current), JSON.stringify(list)).toHaveLength(1);
    const otherId = list.find((s) => !s.current)!.id;
    await a.del(`/auth/sessions/${otherId}`).expect(204);
    await a.del(`/auth/sessions/${otherId}`).expect(404);
    // The signed-out device loses access at once, not when its access token expires.
    await second.agent.get('/api/v1/auth/me').expect(401);
    await login(app, u.email, u.password);
    expect((await a.post('/auth/sessions/revoke-others').expect(200)).body.revoked).toBe(1);
    expect((await a.get('/auth/sessions').expect(200)).body).toHaveLength(1);
  });
});
