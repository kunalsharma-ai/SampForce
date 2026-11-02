import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/** ADR 0052: the API writes its messages in the language the request asks for (Accept-Language). */
describe('Messages in the reader’s language', () => {
  let app: INestApplication;
  let owner: TestUser;

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Language Org');
  });
  afterAll(async () => app.close());

  it('answers in English without a header, and keeps the error code as it is in every language', async () => {
    const en = await api(owner).get(`/deals/${randomUUID()}`).expect(404);
    expect(en.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Deal not found.' });
    const de = await api(owner).get(`/deals/${randomUUID()}`).set('accept-language', 'de-DE,de;q=0.9,en;q=0.8').expect(404);
    expect(de.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Verkaufschance nicht gefunden.' });
  });

  it('translates validation problems field by field, including Zod’s own messages', async () => {
    const res = await owner.agent.post('/api/v1/companies').set('origin', ORIGIN).set('accept-language', 'es').send({ name: '', industry: 42 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.message).toBe('La solicitud contiene campos no válidos.');
    const byPath = Object.fromEntries((res.body.error.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
    expect(byPath.name).toBe('Introduce un nombre de empresa');
    expect(byPath.industry).toBe('Se esperaba string y se recibió number');
  });

  it('fills the values of a sentence into the translation', async () => {
    const res = await owner.agent
      .post('/api/v1/auth/login')
      .set('origin', ORIGIN)
      .set('accept-language', 'ar')
      .send({ email: owner.email, password: 'not-the-password' })
      .expect(401);
    expect(res.body.error.message).toBe('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    const fr = await request(app.getHttpServer()).get('/api/v1/auth/me').set('accept-language', 'fr-CA').expect(401);
    expect(fr.body.error.message).toBe('Connectez-vous pour continuer.');
  });

  it('falls back to English for a language DealFlow does not have', async () => {
    const res = await api(owner).get(`/deals/${randomUUID()}`).set('accept-language', 'ja,pt;q=0.8').expect(404);
    expect(res.body.error.message).toBe('Deal not found.');
  });
});
