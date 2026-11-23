import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSmtpFixture, type SmtpFixture } from './fixtures/smtp-fixture';
import { api, ORIGIN, ownerClient, registerUser, startApp, type TestUser } from './helpers';

/*
 * Workspace redesign W6: Settings, then Password & Authentication, changes the password while signed in. The current
 * password first, then a new one; every other device is signed out, reset links stop working, the change is in the
 * audit log and the person is told by email.
 */
describe('changing the password while signed in', () => {
  let app: INestApplication;
  let smtp: SmtpFixture;
  let user: TestUser;
  const db = ownerClient();
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    smtp = await startSmtpFixture();
    for (const [k, v] of Object.entries({ SMTP_URL: smtp.url, MAIL_FROM: 'SampForce <no-reply@dealflow.test>' })) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    user = await registerUser(app, 'Password Changers');
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
    await smtp.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('refuses a wrong current password, a weak new one and the same one', async () => {
    const wrong = await api(user).post('/auth/password', { currentPassword: 'not-my-password-1', newPassword: 'a-brand-new-pass-2' }).expect(400);
    expect(wrong.body.error).toMatchObject({ code: 'PASSWORD_INCORRECT', details: [{ path: 'currentPassword' }] });
    expect((await api(user).post('/auth/password', { currentPassword: user.password, newPassword: 'short' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await api(user).post('/auth/password', { currentPassword: user.password, newPassword: user.password }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    const refused = await db.auditLog.count({ where: { tenantId: user.tenantId, action: 'auth.password_change_failed', outcome: 'REFUSED' } });
    expect(refused).toBe(1);
  });

  it('changes it, signs the other devices out, keeps this one and tells the person', async () => {
    const other = request.agent(app.getHttpServer());
    await other.post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: user.password }).expect(200);
    await other.get('/api/v1/auth/me').expect(200);
    const newPassword = 'a-brand-new-pass-2';

    const done = (await api(user).post('/auth/password', { currentPassword: user.password, newPassword }).expect(200)).body;
    expect(done).toEqual({ signedOut: 1 });
    await other.get('/api/v1/auth/me').expect(401);
    await api(user).get('/auth/me').expect(200);

    // The old password stops working; the new one signs in.
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: user.password }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: user.email, password: newPassword }).expect(200);

    expect(await db.auditLog.count({ where: { tenantId: user.tenantId, action: 'auth.password_changed', entityId: { not: null } } })).toBe(1);
    const mail = smtp.messages.at(-1)!;
    expect(mail.to).toEqual([user.email]);
    expect(mail.subject).toBe('Your SampForce password was changed');
    expect(mail.text).toContain('changed from its security settings');
  });

  it('wants a signed-in person', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/password').set('origin', ORIGIN).send({ currentPassword: 'x', newPassword: 'a-brand-new-pass-3' }).expect(401);
  });
});
