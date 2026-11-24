import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { base32Decode, hotp, stepAt } from '../src/auth/totp';
import { appClient, ORIGIN, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/** The authenticator code for a step from now (0 = current). Each step works once, so tests move forward. */
const totp = (secret: string, ahead = 0) => hotp(base32Decode(secret), stepAt(Date.now() / 1000) + ahead);

/**
 * Console sign-in security (ADR 0074): a session row per sign-in that can be listed and ended, a pause after five
 * failures, two-step verification with recovery codes, unusual sign-ins flagged, and the policy that requires it.
 */
describe('Console sign-in security', () => {
  let app: INestApplication;
  const tag = randomUUID().slice(0, 6);
  const adminEmail = `sec-admin-${tag}@platform.test`;
  const supportEmail = `sec-sup-${tag}@platform.test`;
  const lockEmail = `sec-lock-${tag}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    post: (url: string, body: object = {}) => agent.post(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).send(body),
    del: (url: string) => agent.delete(`/api/v1/operator${url}`).set('origin', ORIGIN),
  });
  const fresh = () => request.agent(app.getHttpServer());
  const signIn = async (email: string, extra: object = {}) => {
    const agent = fresh();
    const res = await op(agent).post('/login', { email, password, ...extra }).expect(200);
    return { agent, res };
  };

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    await db.platformOperator.createMany({
      data: [
        { email: adminEmail, name: 'Ada Secure', passwordHash, role: 'ADMIN' },
        { email: supportEmail, name: 'Sam Secure', passwordHash, role: 'SUPPORT' },
        { email: lockEmail, name: 'Lee Locked', passwordHash, role: 'SUPPORT' },
      ],
    });
    await db.$disconnect();
  });
  afterAll(async () => {
    const db = appClient();
    await db.platformSetting.deleteMany({ where: { key: 'console.security_policy' } });
    await db.$disconnect();
    await app.close();
    delete process.env.OPERATOR_JWT_SECRET;
  });

  it('keeps a session per sign-in that its operator can list and end, and ends it on sign-out', async () => {
    const { agent: a } = await signIn(supportEmail);
    const { agent: b, res } = await signIn(supportEmail, { remember: true });
    expect((res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('df_op='))).toMatch(/Max-Age=604800/);
    const mine = (await op(a).get('/me/sessions').expect(200)).body as { id: string; current: boolean; device: string }[];
    expect(mine.filter((s) => s.current)).toHaveLength(1);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const bId = (await op(b).get('/me/sessions').expect(200)).body.find((s: { current: boolean }) => s.current).id;

    // Ending session B from A signs B out at once.
    await op(a).del(`/me/sessions/${bId}`).expect(204);
    await op(b).get('/me').expect(401);

    // Signing out ends the session on the server, so a copied cookie stops working.
    const { agent: c, res: cRes } = await signIn(supportEmail);
    const cookie = (cRes.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('df_op='))!.split(';')[0]!;
    await op(c).post('/logout').expect(204);
    await request(app.getHttpServer()).get('/api/v1/operator/me').set('cookie', cookie).expect(401);

    // "Sign out everywhere else" keeps only the current session.
    const { agent: d } = await signIn(supportEmail);
    expect((await op(a).post('/me/sessions/end-others').expect(200)).body.ended).toBeGreaterThanOrEqual(1);
    await op(d).get('/me').expect(401);
    await op(a).get('/me').expect(200);
  });

  it('pauses sign-in after five failures in a row, with the same answer as a wrong password', async () => {
    for (let i = 0; i < 5; i++) expect((await op(fresh()).post('/login', { email: lockEmail, password: 'wrong-password-x' }).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    // Even the right password is refused while paused.
    expect((await op(fresh()).post('/login', { email: lockEmail, password }).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS');
    const db = appClient();
    try {
      const row = await db.platformOperator.findUniqueOrThrow({ where: { email: lockEmail } });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
      const outcomes = (await db.operatorLoginEvent.findMany({ where: { email: lockEmail }, orderBy: { createdAt: 'asc' } })).map((e) => e.outcome);
      expect(outcomes).toEqual(['wrong_password', 'wrong_password', 'wrong_password', 'wrong_password', 'locked', 'locked']);
      await db.platformOperator.update({ where: { email: lockEmail }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    } finally {
      await db.$disconnect();
    }
    // Once the pause is over, the right password works and the sign-in is flagged after so many failures.
    await signIn(lockEmail);
    const { agent: admin } = await signIn(adminEmail);
    const flagged = (await op(admin).get('/security/logins?suspicious=true').expect(200)).body as { email: string; outcome: string; reason: string }[];
    expect(flagged.find((e) => e.email === lockEmail)).toMatchObject({ outcome: 'success', reason: expect.stringMatching(/failed attempts in the last hour/) });
  });

  it('turns on two-step verification and asks for a code, or a one-time recovery code, at sign-in', async () => {
    const { agent } = await signIn(supportEmail);
    expect((await op(agent).get('/me/mfa').expect(200)).body).toMatchObject({ enabled: false });
    expect((await op(agent).post('/me/mfa/setup', { password: 'nope' }).expect(400)).body.error.code).toBe('INVALID_PASSWORD');
    const { secret, otpauthUri } = (await op(agent).post('/me/mfa/setup', { password }).expect(200)).body;
    expect(otpauthUri).toContain('otpauth://totp/');
    await op(agent).post('/me/mfa/enable', { code: '000000' }).expect(400);
    const codes = (await op(agent).post('/me/mfa/enable', { code: totp(secret) }).expect(200)).body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect((await op(agent).get('/me/mfa').expect(200)).body).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });

    // The password alone gives a challenge, not a session.
    const step1 = await op(fresh()).post('/login', { email: supportEmail, password }).expect(200);
    expect(step1.body).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(step1.headers['set-cookie']).toBeUndefined();
    const second = fresh();
    expect((await op(second).post('/login/mfa', { challenge: step1.body.challenge, code: '123456' }).expect(401)).body.error.code).toBe('INVALID_MFA_CODE');
    await op(second).post('/login/mfa', { challenge: 'not-a-real-challenge', code: totp(secret, 1) }).expect(401);
    await op(second).post('/login/mfa', { challenge: step1.body.challenge, code: totp(secret, 1) }).expect(200);
    await op(second).get('/me').expect(200);

    // A recovery code works once.
    const again = (await op(fresh()).post('/login', { email: supportEmail, password }).expect(200)).body.challenge;
    await op(fresh()).post('/login/mfa', { challenge: again, code: codes[0] }).expect(200);
    await op(fresh()).post('/login/mfa', { challenge: again, code: codes[0] }).expect(401);
    expect((await op(agent).get('/me/mfa').expect(200)).body.recoveryCodesRemaining).toBe(9);
  });

  it('lets Super Admins require two-step verification, see every session and reset a lost authenticator', async () => {
    const { agent: admin } = await signIn(adminEmail);
    const { agent: support } = await signIn(lockEmail);
    await op(support).get('/security/policy').expect(403);
    await op(support).get('/security/sessions').expect(403);
    expect((await op(admin).get('/security/policy').expect(200)).body).toEqual({ requireMfa: false, idleMinutes: 60, lockoutAttempts: 5, lockoutMinutes: 15 });

    // Requiring it starts with the person asking.
    expect((await op(admin).put('/security/policy', { requireMfa: true }).expect(409)).body.error.code).toBe('MFA_REQUIRED_FIRST');
    const { secret } = (await op(admin).post('/me/mfa/setup', { password }).expect(200)).body;
    await op(admin).post('/me/mfa/enable', { code: totp(secret) }).expect(200);
    expect((await op(admin).put('/security/policy', { requireMfa: true, idleMinutes: 30 }).expect(200)).body).toMatchObject({ requireMfa: true, idleMinutes: 30 });

    // An operator without it can only reach their own account until they turn it on.
    expect((await op(support).get('/clients').expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    await op(support).get('/me').expect(200);
    const login = (await op(fresh()).post('/login', { email: lockEmail, password }).expect(200)).body;
    expect(login.mfaSetupRequired).toBe(true);
    const own = (await op(support).post('/me/mfa/setup', { password }).expect(200)).body.secret as string;
    await op(support).post('/me/mfa/enable', { code: totp(own) }).expect(200);
    await op(support).get('/clients').expect(200);
    // And cannot turn it off while the policy asks for it.
    expect((await op(support).post('/me/mfa/disable', { password, code: totp(own, 1) }).expect(409)).body.error.code).toBe('MFA_REQUIRED');

    // Every live session, with who and where.
    const all = (await op(admin).get('/security/sessions').expect(200)).body as { operatorEmail: string; id: string }[];
    expect(all.some((s) => s.operatorEmail === lockEmail)).toBe(true);
    const lockId = (await op(admin).get('/operators').expect(200)).body.find((o: { email: string }) => o.email === lockEmail).id as string;
    expect((await op(admin).get('/operators').expect(200)).body.find((o: { email: string }) => o.email === lockEmail).mfaEnabled).toBe(true);

    // A lost phone: the Super Admin resets it and the operator's sessions end.
    await op(admin).post(`/operators/${lockId}/mfa/reset`).expect(204);
    await op(support).get('/me').expect(401);
    await op(admin).post(`/operators/${(await op(admin).get('/me').expect(200)).body.id}/mfa/reset`).expect(403);
    await op(admin).put('/security/policy', { requireMfa: false }).expect(200);
  });

  it('ends sessions that sat idle longer than the policy allows', async () => {
    const { agent } = await signIn(lockEmail);
    const id = (await op(agent).get('/me/sessions').expect(200)).body.find((s: { current: boolean }) => s.current).id as string;
    const db = appClient();
    try {
      await db.operatorSession.update({ where: { id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    } finally {
      await db.$disconnect();
    }
    await op(agent).get('/me').expect(401);
  });
});
