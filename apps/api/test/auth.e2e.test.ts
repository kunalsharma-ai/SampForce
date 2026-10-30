import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, registerUser, startApp } from './helpers';

function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const hit = raw?.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0]?.slice(name.length + 1) || undefined;
}

describe('authentication', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('registers a user, provisions a workspace and returns the session', async () => {
    const u = await registerUser(app, 'Acme Research');
    const me = await u.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.email).toBe(u.email);
    expect(me.body.tenant).toMatchObject({ id: u.tenantId, name: 'Acme Research', plan: 'free', isDemo: false });
    expect(me.body.role).toBe('owner');
    expect(me.body.permissions).toContain('billing:manage');
    expect(me.body.memberships).toHaveLength(1);
  });

  it('sets httpOnly SameSite cookies', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'C', email: 'cookies@example.com', password: 'correcthorse1', organizationName: 'Cookie Co' })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('df_access='))).toMatch(/HttpOnly.*SameSite=Lax/i);
    expect(cookies.find((c) => c.startsWith('df_refresh='))).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects duplicate emails and invalid input with structured errors', async () => {
    const u = await registerUser(app);
    const dup = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: u.email.toUpperCase(), password: 'correcthorse1', organizationName: 'Dup' })
      .expect(409);
    expect(dup.body.error.code).toBe('EMAIL_IN_USE');

    const bad = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: '', email: 'not-an-email', password: 'short', organizationName: 'A' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'password', 'organizationName']),
    );
  });

  it('logs in with valid credentials and gives a generic error otherwise', async () => {
    const u = await registerUser(app);
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'wrong-password-1' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-1' })
      .expect(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('requires authentication for protected routes', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/dashboard/summary').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('rotates refresh tokens and revokes every session when an old token is reused', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'R', email: 'rotate@example.com', password: 'correcthorse1', organizationName: 'Rotate' })
      .expect(201);
    const first = cookieValue(login, 'df_refresh')!;

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('cookie', `df_refresh=${first}`)
      .expect(200);
    const second = cookieValue(r1, 'df_refresh')!;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    // Replaying the rotated token is treated as theft: it fails and kills the newer session too.
    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('cookie', `df_refresh=${first}`)
      .expect(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('cookie', `df_refresh=${second}`).expect(401);
  });

  it('logs out and invalidates the refresh token', async () => {
    const u = await registerUser(app);
    await u.agent.post('/api/v1/auth/logout').set('origin', ORIGIN).expect(204);
    await u.agent.get('/api/v1/auth/me').expect(401);
    await u.agent.post('/api/v1/auth/refresh').set('origin', ORIGIN).expect(401);
  });

  it('blocks state-changing requests from foreign origins', async () => {
    const u = await registerUser(app);
    const res = await u.agent
      .patch('/api/v1/tenants/current')
      .set('origin', 'https://evil.example')
      .send({ name: 'Hacked' })
      .expect(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('serves health checks and the OpenAPI document', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200, { status: 'ok', checks: { database: 'ok' } });
    const doc = await request(app.getHttpServer()).get('/api/v1/openapi.json').expect(200);
    expect(doc.body.openapi).toBe('3.1.0');
    for (const path of ['/leads', '/leads/{id}/convert', '/deals/board', '/deals/{id}/move', '/pipelines', '/imports', '/exports/{entity}', '/tasks/{id}', '/auth/invitations/accept']) {
      expect(doc.body.paths).toHaveProperty([path]);
    }
    expect(Object.keys(doc.body.paths)).toContain('/dashboard/summary');
  });
});
