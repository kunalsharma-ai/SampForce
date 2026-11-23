import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, type MobileAppConfig } from '@dealflow/types';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

/**
 * Team chat on the phone (ADR 0072, M7): the web's chat routes and live socket, reachable with a phone token while
 * the person's Mobile Configuration has chat, and closed again the moment it does not.
 */
describe('mobile chat', () => {
  let app: INestApplication;
  let owner: TestUser;
  let ownerId = '';
  let exec: TestUser & { userId: string; workspaceId: string };
  let execToken = '';
  let port = 0;
  const http = () => request(app.getHttpServer());
  const phone = (method: 'get' | 'post', url: string, token = execToken) => http()[method](`/api/v1${url}`).set('authorization', `Bearer ${token}`);
  const publish = async (change: (c: MobileAppConfig) => void) => {
    const draft = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
    change(draft);
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', { note: 'Chat test' }).expect(200);
  };

  beforeAll(async () => {
    app = await startApp();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    owner = await registerUser(app, 'Chat Phone Org');
    ownerId = ((await api(owner).get('/auth/me').expect(200)).body as { user: { id: string } }).user.id;
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Chat Exec');
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    const res = await http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: exec.email, password: exec.password, device: { platform: 'IOS', installId: `chat-${randomUUID().slice(0, 8)}`, model: 'iPhone 18', osVersion: '20', appVersion: '1.0.0' } })
      .expect(200);
    execToken = res.body.accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets a phone start a direct message, send, read and see who it can talk to', async () => {
    const people = (await phone('get', '/chat/people').expect(200)).body as { id: string; name: string; photoUrl?: string | null }[];
    expect(people.map((p) => p.id)).toContain(ownerId);
    const conv = (await phone('post', '/chat/conversations').send({ kind: 'DIRECT', userId: ownerId }).expect(201)).body as { id: string };
    const sent = (await phone('post', `/chat/conversations/${conv.id}/messages`).send({ clientId: randomUUID(), body: 'Sent from my phone' }).expect(201)).body;
    expect(sent).toMatchObject({ body: 'Sent from my phone' });
    // The web sees it, and its reply reaches the phone.
    const web = (await api(owner).get(`/chat/conversations/${conv.id}/messages`).expect(200)).body as { body: string }[];
    expect(web.map((m) => m.body)).toContain('Sent from my phone');
    await api(owner).post(`/chat/conversations/${conv.id}/messages`, { clientId: randomUUID(), body: 'Got it, thanks' }).expect(201);
    const list = (await phone('get', '/chat/conversations').expect(200)).body as { id: string; unread: number }[];
    expect(list.find((c) => c.id === conv.id)?.unread).toBe(1);
    await phone('post', `/chat/conversations/${conv.id}/read`).send({}).expect(200);
    const after = (await phone('get', '/chat/conversations').expect(200)).body as { id: string; unread: number }[];
    expect(after.find((c) => c.id === conv.id)?.unread).toBe(0);
  });

  it('opens the live socket from a phone ticket and carries new messages', async () => {
    const { ticket, path } = (await phone('post', '/chat/socket-ticket').send({}).expect(200)).body as { ticket: string; path: string };
    // A native app sends no Origin header.
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}?ticket=${encodeURIComponent(ticket)}`);
    const events: { type: string; [k: string]: unknown }[] = [];
    ws.on('message', (raw) => events.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const conv = (await api(owner).post('/chat/conversations', { kind: 'DIRECT', userId: exec.userId }).expect(201)).body as { id: string };
    await api(owner).post(`/chat/conversations/${conv.id}/messages`, { clientId: randomUUID(), body: 'Live to the phone' }).expect(201);
    const arrived = () => events.some((e) => e.type === 'message' && e.conversationId === conv.id && e.authorId === ownerId);
    const deadline = Date.now() + 6000;
    while (!arrived() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(arrived()).toBe(true);
    ws.close();
  });

  it('closes chat to phones when the configuration turns it off, and leaves the web alone', async () => {
    await publish((c) => {
      c.chat.enabled = false;
    });
    const off = await phone('get', '/chat/conversations').expect(403);
    expect(off.body.error.code).toBe('MOBILE_MODULE_OFF');
    await phone('post', '/chat/socket-ticket').send({}).expect(403);
    await api(exec).get('/chat/conversations').expect(200);
    await publish(() => undefined);
    await phone('get', '/chat/conversations').expect(200);
  });
});
