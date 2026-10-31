import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@dealflow/database';
import { startSmtpFixture, type SmtpFixture } from './fixtures/smtp-fixture';
import { api, registerUser, startApp, type TestUser } from './helpers';

const ORIGIN = 'http://localhost:3000';

describe('password reset by email', () => {
  let app: INestApplication;
  let smtp: SmtpFixture;
  let user: TestUser;
  let http: ReturnType<typeof request>;
  const saved: Record<string, string | undefined> = {};
  const admin = new PrismaClient({ datasources: { db: { url: process.env.TEST_OWNER_DATABASE_URL } } });

  const post = (url: string, body: object) => http.post(`/api/v1${url}`).set('origin', ORIGIN).send(body);
  const tokenFrom = (text: string) => /reset-password#token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

  beforeAll(async () => {
    smtp = await startSmtpFixture();
    for (const [k, v] of Object.entries({ SMTP_URL: smtp.url, MAIL_FROM: 'DealFlow <no-reply@dealflow.test>', PUBLIC_WEB_URL: 'https://app.dealflow.test' })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    http = request(app.getHttpServer());
    user = await registerUser(app, 'Resetters');
  });

  afterAll(async () => {
    await app.close();
    await smtp.close();
    await admin.$disconnect();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const r = await post('/auth/password-reset/request', { email: 'nobody-here@example.com' }).expect(202);
    expect(r.body).toEqual({ ok: true });
    expect(smtp.messages).toHaveLength(0);
    await post('/auth/password-reset/request', { email: 'not-an-email' }).expect(400);
  });

  it('emails a one-time link that sets a new password and signs out every device', async () => {
    // A second device is signed in before the reset.
    const other = request.agent(app.getHttpServer());
    await other.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: user.password }).expect(200);
    await other.get('/api/v1/auth/me').expect(200);

    await post('/auth/password-reset/request', { email: user.email.toUpperCase() }).expect(202);
    const mail = smtp.messages.at(-1)!;
    expect(mail.to).toEqual([user.email]);
    expect(mail.from).toBe('no-reply@dealflow.test');
    expect(mail.subject).toBe('Reset your DealFlow password');
    expect(mail.text).toContain('https://app.dealflow.test/reset-password#token=');
    const token = tokenFrom(mail.text)!;
    expect(token.length).toBeGreaterThan(30);
    // Only a hash is stored.
    const rows = await admin.passwordResetToken.findMany({ where: { user: { email: user.email } } });
    expect(rows.some((r) => r.tokenHash.includes(token))).toBe(false);

    await post('/auth/password-reset', { token, password: 'short' }).expect(400);
    await post('/auth/password-reset', { token, password: 'brand-new-passphrase-7' }).expect(204);
    const changed = smtp.messages.at(-1)!;
    expect(changed.subject).toBe('Your DealFlow password was changed');

    // Used once only.
    const again = await post('/auth/password-reset', { token, password: 'another-passphrase-9' }).expect(400);
    expect(again.body.error.code).toBe('RESET_LINK_INVALID');
    // Old password fails, new one works, and the other device was signed out.
    await http.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: user.password }).expect(401);
    await http.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: 'brand-new-passphrase-7' }).expect(200);
    await other.post('/api/v1/auth/refresh').set('origin', ORIGIN).expect(401);
    // The reset is in the workspace audit log.
    const owner = { ...user, agent: request.agent(app.getHttpServer()) };
    await owner.agent.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: 'brand-new-passphrase-7' }).expect(200);
    const audit = (await api(owner).get('/audit-logs?pageSize=50').expect(200)).body.items.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['auth.password_reset_requested', 'auth.password_reset']));
    user.password = 'brand-new-passphrase-7';
  });

  it('keeps only the newest link working, expires links, and limits requests per account', async () => {
    await post('/auth/password-reset/request', { email: user.email }).expect(202);
    const first = tokenFrom(smtp.messages.at(-1)!.text)!;
    await post('/auth/password-reset/request', { email: user.email }).expect(202);
    const second = tokenFrom(smtp.messages.at(-1)!.text)!;
    await post('/auth/password-reset', { token: first, password: 'yet-another-pass-1' }).expect(400);

    await admin.passwordResetToken.updateMany({ where: { user: { email: user.email }, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await post('/auth/password-reset', { token: second, password: 'yet-another-pass-1' }).expect(400);

    // Three links an hour per account (two were asked for above, one in the previous test).
    const before = smtp.messages.length;
    await post('/auth/password-reset/request', { email: user.email }).expect(202);
    expect(smtp.messages.length).toBe(before);
  });

  it('sends no link to an account that signs in only with single sign-on', async () => {
    const sso = await registerUser(app, 'SSO only');
    await admin.user.update({ where: { email: sso.email }, data: { passwordHash: '!no-password' } });
    const before = smtp.messages.length;
    await post('/auth/password-reset/request', { email: sso.email }).expect(202);
    expect(smtp.messages.length).toBe(before);
  });
});

describe('password reset without an email service', () => {
  it('says the site cannot send email instead of pretending to', async () => {
    const saved = process.env.SMTP_URL;
    delete process.env.SMTP_URL;
    const app = await startApp();
    try {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/password-reset/request').set('origin', ORIGIN).send({ email: 'someone@example.com' }).expect(503);
      expect(r.body.error.code).toBe('MAIL_NOT_CONFIGURED');
    } finally {
      await app.close();
      if (saved !== undefined) process.env.SMTP_URL = saved;
    }
  });
});
