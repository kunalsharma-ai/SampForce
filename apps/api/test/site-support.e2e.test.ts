import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';
import { newReference } from '../src/support/site-support.service';
import { appClient, ORIGIN, ownerClient, registerUser, startApp } from './helpers';

const OP_SECRET = 'operator-secret-that-is-at-least-32-chars';

/*
 * Help & Support on the public website (ADR 0078): a visitor who is not signed in sends a message, the Console lists
 * it under Website messages and marks it handled. Workspaces never see these messages.
 */
describe('website help and support messages', () => {
  let app: INestApplication;
  let ops: ReturnType<typeof request.agent>;
  const db = ownerClient();
  const tag = randomUUID().slice(0, 8);
  const opsEmail = `site-ops-${tag}@platform.test`;
  const opsPassword = 'operator-password-1';

  beforeAll(async () => {
    process.env.OPERATOR_JWT_SECRET = OP_SECRET;
    app = await startApp();
    const client = appClient();
    await client.platformOperator.create({ data: { email: opsEmail, name: 'Meera (Support)', passwordHash: await new PasswordService().hash(opsPassword), role: 'SUPPORT' } });
    await client.$disconnect();
    ops = request.agent(app.getHttpServer());
    await ops.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email: opsEmail, password: opsPassword }).expect(200);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app?.close();
  });

  const send = (body: object, language = 'en') =>
    request(app.getHttpServer()).post('/api/v1/site/support-requests').set('origin', ORIGIN).set('accept-language', language).send(body);

  it('makes readable references', () => {
    for (let i = 0; i < 50; i++) expect(newReference()).toMatch(/^SF-[2-9A-HJ-NP-Z]{6}$/);
  });

  it('takes a message from a signed-out visitor and shows it in the Console', async () => {
    const res = await send({ name: 'Asha Visitor', email: `Asha.${tag}@Example.com`, topic: 'SIGN_IN', message: `I cannot find my workspace ${tag}.`, pagePath: '/' }, 'fr').expect(201);
    expect(res.body.reference).toMatch(/^SF-/);
    const stored = await db.siteSupportRequest.findUnique({ where: { reference: res.body.reference } });
    expect(stored).toMatchObject({ name: 'Asha Visitor', email: `asha.${tag}@example.com`, topic: 'SIGN_IN', status: 'NEW', language: 'fr', pagePath: '/' });

    const list = (await ops.get(`/api/v1/operator/support/site-requests?q=${tag}`).expect(200)).body;
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ reference: res.body.reference, status: 'NEW', handledByName: null });
    expect(list.counts.NEW).toBeGreaterThanOrEqual(1);

    const done = (await ops.patch(`/api/v1/operator/support/site-requests/${list.rows[0].id}`).set('origin', ORIGIN).send({ status: 'HANDLED' }).expect(200)).body;
    expect(done).toMatchObject({ status: 'HANDLED', handledByName: 'Meera (Support)' });
    expect(done.handledAt).toBeTruthy();
    const audit = await db.platformAuditLog.findFirst({ where: { action: 'site_support.handled', targetId: list.rows[0].id } });
    expect(audit).toBeTruthy();

    const handled = (await ops.get(`/api/v1/operator/support/site-requests?status=HANDLED&q=${tag}`).expect(200)).body;
    expect(handled.rows.map((r: { id: string }) => r.id)).toEqual([list.rows[0].id]);
    const reopened = (await ops.patch(`/api/v1/operator/support/site-requests/${list.rows[0].id}`).set('origin', ORIGIN).send({ status: 'NEW' }).expect(200)).body;
    expect(reopened).toMatchObject({ status: 'NEW', handledAt: null, handledByName: null });
  });

  it('checks what the visitor typed, in their language', async () => {
    const res = await send({ name: '', email: 'not-an-email', message: 'short' }, 'es').expect(400);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(['email', 'message', 'name']);
    expect(JSON.stringify(res.body.error.details)).toContain('Cuéntanos un poco más');
  });

  it('drops messages from bots that fill the hidden field', async () => {
    const res = await send({ name: 'Bot', email: `bot-${tag}@example.com`, message: `Buy cheap things now ${tag}`, website: 'https://spam.example' }).expect(201);
    expect(res.body.reference).toMatch(/^SF-/);
    expect(await db.siteSupportRequest.count({ where: { email: `bot-${tag}@example.com` } })).toBe(0);
  });

  it('keeps website messages away from workspaces and signed-out readers', async () => {
    const owner = await registerUser(app, 'Site Support Client');
    await owner.agent.get('/api/v1/operator/support/site-requests').expect(401);
    await request(app.getHttpServer()).get('/api/v1/operator/support/site-requests').expect(401);
    await request(app.getHttpServer()).patch(`/api/v1/operator/support/site-requests/${randomUUID()}`).set('origin', ORIGIN).send({ status: 'HANDLED' }).expect(401);
    await ops.patch(`/api/v1/operator/support/site-requests/${randomUUID()}`).set('origin', ORIGIN).send({ status: 'HANDLED' }).expect(404);
  });
});
