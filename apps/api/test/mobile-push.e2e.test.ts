import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { defaultMobileConfig, type MobileAppConfig, type MobileDashboard } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CrmRemindersService } from '../src/crm/crm-reminders.service';
import { MobilePushService } from '../src/mobile/push/mobile-push.service';
import { api, asTenant, registerUser, startApp, type TestUser, workspacePerson } from './helpers';

interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  data: { route: string | null; type: string };
}

/** A stand-in for Expo's push service: records what it is sent and answers like Expo does. */
function expoFixture() {
  const received: ExpoMessage[] = [];
  const gone = new Set<string>();
  let auth: string | undefined;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      auth = req.headers.authorization;
      const messages = JSON.parse(raw) as ExpoMessage[];
      received.push(...messages);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: messages.map((m) => (gone.has(m.to) ? { status: 'error', message: `"${m.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: randomUUID() })) }));
    });
  });
  return { server, received, gone, auth: () => auth };
}

/**
 * Phone notifications (ADR 0072, M8): a phone registers its push token; announcements, chat messages and task
 * reminders go to it through Expo, as the person's Mobile Configuration allows; a phone Apple or Google no longer
 * accept is forgotten.
 */
describe('mobile push notifications', () => {
  let app: INestApplication;
  let owner: TestUser;
  let exec: TestUser & { userId: string; workspaceId: string };
  let token = '';
  const expo = expoFixture();
  const saved = process.env.EXPO_PUSH_URL;
  const phoneToken = 'ExponentPushToken[abcdefghijklmnopqrstuv]';
  const http = () => request(app.getHttpServer());
  const phone = (method: 'get' | 'put' | 'post' | 'delete', url: string) => http()[method](`/api/v1${url}`).set('authorization', `Bearer ${token}`);
  const send = () => app.get(MobilePushService).sendDue();
  const publish = async (change: (c: MobileAppConfig) => void) => {
    const draft = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
    change(draft);
    await api(owner).put('/mobile-config/draft', draft).expect(200);
    await api(owner).post('/mobile-config/publish', { note: 'Push test' }).expect(200);
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => expo.server.listen(0, '127.0.0.1', resolve));
    process.env.EXPO_PUSH_URL = `http://127.0.0.1:${(expo.server.address() as AddressInfo).port}/--/api/v2/push/send`;
    app = await startApp();
    owner = await registerUser(app, 'Push Org');
    exec = await workspacePerson(app, owner, 'EXECUTIVE', 'Push Exec');
    await asTenant(owner.tenantId, (tx) => tx.mobileAccess.create({ data: { tenantId: owner.tenantId, status: 'APPROVED', decisionStatus: 'APPROVED', decidedAt: new Date(), activatedAt: new Date(), activatedById: null } }));
    const res = await http()
      .post('/api/v1/mobile/auth/login')
      .send({ email: exec.email, password: exec.password, device: { platform: 'ANDROID', installId: `push-${randomUUID().slice(0, 8)}`, model: 'Pixel 10', osVersion: '17', appVersion: '1.0.0' } })
      .expect(200);
    token = res.body.accessToken;
  });
  beforeEach(() => {
    expo.received.length = 0;
  });
  afterAll(async () => {
    await app.close();
    expo.server.close();
    if (saved === undefined) delete process.env.EXPO_PUSH_URL;
    else process.env.EXPO_PUSH_URL = saved;
  });

  it('registers the phone’s push token, and refuses anything else', async () => {
    expect((await phone('get', '/mobile/push').expect(200)).body).toEqual({ enabled: true, registered: false });
    const bad = await phone('put', '/mobile/push').send({ token: 'not-a-token' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    // A web session cannot register a phone.
    await api(exec).put('/mobile/push', { token: phoneToken }).expect(400);
    expect((await phone('put', '/mobile/push').send({ token: phoneToken }).expect(200)).body).toEqual({ enabled: true, registered: true });
  });

  it('sends an announcement to everyone’s phone and shows it on the home screen', async () => {
    const posted = (await api(owner).post('/announcements', { title: 'Office closed on Friday', body: 'The office is closed for the holiday. Calls go to the duty phone.' }).expect(201)).body;
    expect(posted).toMatchObject({ title: 'Office closed on Friday', author: { name: expect.any(String) } });
    // Executives cannot post one.
    await api(exec).post('/announcements', { title: 'Nope', body: 'Nope' }).expect(403);
    expect(await send()).toBe(1);
    expect(expo.received).toEqual([expect.objectContaining({ to: phoneToken, title: 'Office closed on Friday', body: expect.stringContaining('office is closed'), data: expect.objectContaining({ type: 'announcement', route: '/notifications' }) })]);
    expect(expo.auth()).toBeUndefined();
    // Once only.
    expect(await send()).toBe(0);
    // The phone reads it in its notifications and on the announcements card.
    const inbox = (await phone('get', '/notifications').expect(200)).body as { items: { type: string; title: string }[] };
    expect(inbox.items[0]).toMatchObject({ type: 'announcement.posted', title: 'Office closed on Friday' });
    expect(((await phone('get', '/announcements').expect(200)).body as { title: string }[]).map((a) => a.title)).toEqual(['Office closed on Friday']);
    await publish((c) => {
      c.dashboard.EXECUTIVE = [...c.dashboard.EXECUTIVE.filter((x) => x.card !== 'announcements'), { card: 'announcements', showChart: false }];
    });
    const d = (await phone('get', '/mobile/dashboard?period=MONTH').expect(200)).body as MobileDashboard;
    expect(d.cards.find((c) => c.card === 'announcements')).toMatchObject({ notices: [expect.objectContaining({ title: 'Office closed on Friday' })], opens: 'notifications', empty: null });
  });

  it('sends chat messages, and stops when the configuration switches that type off', async () => {
    const conv = (await api(owner).post('/chat/conversations', { kind: 'DIRECT', userId: exec.userId }).expect(201)).body as { id: string };
    await api(owner).post(`/chat/conversations/${conv.id}/messages`, { clientId: randomUUID(), body: 'Can you call the buyer today?' }).expect(201);
    expect(await send()).toBe(1);
    expect(expo.received[0]).toMatchObject({ body: 'Can you call the buyer today?', data: { type: 'chat_message', route: `/chat/${conv.id}` } });

    await publish((c) => {
      c.notifications.types.chat_message = false;
    });
    await api(owner).post(`/chat/conversations/${conv.id}/messages`, { clientId: randomUUID(), body: 'Second message' }).expect(201);
    expect(await send()).toBe(0);
    expect(expo.received).toHaveLength(1);
    const skipped = await asTenant(owner.tenantId, (tx) => tx.mobilePush.findFirst({ where: { tenantId: owner.tenantId, body: 'Second message' } }));
    expect(skipped).toMatchObject({ status: 'SKIPPED', lastError: 'This notification is switched off in the Mobile Configuration.' });
    await publish(() => undefined);
  });

  it('reminds about a task that became overdue', async () => {
    const due = new Date(Date.now() - 5 * 60_000).toISOString();
    const task = (await phone('post', '/mobile/records/tasks').send({ title: 'Send the revised quote', dueAt: due }).expect(201)).body as { id: string };
    await app.get(CrmRemindersService).sweep();
    expect(await send()).toBe(1);
    expect(expo.received[0]).toMatchObject({ title: 'Task overdue: Send the revised quote', data: { type: 'task_overdue', route: `/tasks/${task.id}` } });
  });

  it('forgets a phone that Apple or Google no longer accept, and a phone that turned notifications off', async () => {
    expo.gone.add(phoneToken);
    await api(owner).post('/announcements', { title: 'Second notice', body: 'Read me.' }).expect(201);
    expect(await send()).toBe(0);
    expect((await phone('get', '/mobile/push').expect(200)).body.registered).toBe(false);
    expo.gone.clear();
    // Nothing is queued for a person without a phone that allows notifications.
    await api(owner).post('/announcements', { title: 'Third notice', body: 'Read me.' }).expect(201);
    expect(await asTenant(owner.tenantId, (tx) => tx.mobilePush.count({ where: { tenantId: owner.tenantId, title: 'Third notice' } }))).toBe(0);
    await phone('put', '/mobile/push').send({ token: phoneToken }).expect(200);
    expect((await phone('delete', '/mobile/push').expect(200)).body.registered).toBe(false);
  });
});
