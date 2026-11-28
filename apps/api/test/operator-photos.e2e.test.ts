import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { png } from './fixtures/logo-fixture';
import { appClient, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';
type Agent = ReturnType<typeof request.agent>;

/**
 * Operators' photos in the Console (ADR 0087): an operator's own photo, or else the photo of the SampForce account with
 * the same email, on the operator's own details, on the operators list and at the photo route; removing the own photo
 * brings the linked one back.
 */
describe('Console operator photos', () => {
  let app: INestApplication;
  let admin: Agent;
  let other: Agent;
  let user: TestUser;
  let adminId: string;
  let otherId: string;
  const tag = randomUUID().slice(0, 6);
  const otherEmail = `plain-${tag}@platform.test`;
  const password = 'operator-password-1';
  const op = (agent: Agent) => ({
    get: (url: string) => agent.get(`/api/v1/operator${url}`),
    put: (url: string, body: Buffer, type = 'image/png') => agent.put(`/api/v1/operator${url}`).set('origin', ORIGIN).set('content-type', type).send(body),
    del: (url: string) => agent.delete(`/api/v1/operator${url}`).set('origin', ORIGIN),
  });

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    user = await registerUser(app, `Photo Org ${tag}`);
    const db = appClient();
    const passwordHash = await new PasswordService().hash(password);
    // The admin operator shares their email with the SampForce account; the other operator has no account.
    const a = await db.platformOperator.create({ data: { email: user.email, name: 'Ada Ops', passwordHash, role: 'ADMIN' } });
    const b = await db.platformOperator.create({ data: { email: otherEmail, name: 'Olu Ops', passwordHash, role: 'SUPPORT' } });
    adminId = a.id;
    otherId = b.id;
    await db.$disconnect();
    admin = request.agent(app.getHttpServer());
    other = request.agent(app.getHttpServer());
    await admin.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: user.email, password }).expect(200);
    await other.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: otherEmail, password }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('has no photo until one is set anywhere', async () => {
    expect((await op(admin).get('/me').expect(200)).body.photoUrl).toBeNull();
    await op(admin).get(`/photos/${adminId}`).expect(404);
  });

  it('uses the SampForce profile photo of the same email', async () => {
    await user.agent.put('/api/v1/me/photo').set('origin', ORIGIN).set('content-type', 'image/png').send(png(128, [200, 30, 30])).expect(200);
    const url = (await op(admin).get('/me').expect(200)).body.photoUrl as string;
    expect(url).toMatch(new RegExp(`^/api/v1/operator/photos/${adminId}\\?v=u`));
    const img = await op(other).get(`/photos/${adminId}`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    const row = ((await op(admin).get('/operators').expect(200)).body as { id: string; photoUrl: string | null }[]).find((o) => o.id === adminId);
    expect(row?.photoUrl).toBe(url);
  });

  it('lets an operator set their own photo, which wins, and remove it again', async () => {
    await op(other).put('/me/photo', Buffer.from('not an image')).expect(400);
    await op(other).put('/me/photo', png(32)).expect(400);
    const set = (await op(other).put('/me/photo', png(96)).expect(200)).body as { photoUrl: string };
    expect(set.photoUrl).toMatch(new RegExp(`^/api/v1/operator/photos/${otherId}\\?v=o`));
    expect((await op(other).get('/me').expect(200)).body.photoUrl).toBe(set.photoUrl);

    await op(admin).put('/me/photo', png(80, [10, 200, 10])).expect(200);
    expect((await op(admin).get('/me').expect(200)).body.photoUrl).toMatch(/\?v=o/);
    await op(admin).del('/me/photo').expect(204);
    // The linked SampForce photo shows again.
    expect((await op(admin).get('/me').expect(200)).body.photoUrl).toMatch(/\?v=u/);

    await op(other).del('/me/photo').expect(204);
    expect((await op(other).get('/me').expect(200)).body.photoUrl).toBeNull();
    await op(other).get(`/photos/${otherId}`).expect(404);
  });

  it('keeps photos behind the Console sign-in and writes the audit trail', async () => {
    await request(app.getHttpServer()).get(`/api/v1/operator/photos/${adminId}`).expect(401);
    await op(admin).get('/photos/not-a-uuid').expect(400);
    const db = appClient();
    const actions = (await db.platformAuditLog.findMany({ where: { operatorId: otherId }, select: { action: true } })).map((a) => a.action);
    await db.$disconnect();
    expect(actions).toEqual(expect.arrayContaining(['operator.photo_set', 'operator.photo_removed']));
  });
});
