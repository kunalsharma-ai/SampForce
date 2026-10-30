import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** Acceptance test 13: webhook delivery survives endpoint failures, retries, and recovers. */
describe('webhooks', () => {
  let app: INestApplication;
  let worker: WorkerService;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let server: Server;
  let base: string;
  /** Status codes the receiver answers with, in order; then 200. */
  const script: Record<string, number[]> = {};
  const received: { path: string; headers: Record<string, string | string[] | undefined>; body: string }[] = [];

  beforeAll(async () => {
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Hooks');
    http = api(owner);
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body });
        const status = script[req.url ?? '']?.shift() ?? 200;
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => server.close(r));
  });

  const retryNow = () =>
    asTenant(owner.tenantId, (tx) => tx.webhookDelivery.updateMany({ where: { status: 'PENDING' }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }));

  it('signs deliveries, retries failures with backoff and recovers', async () => {
    script['/flaky'] = [500, 503];
    const created = (await http.post('/webhooks', { url: `${base}/flaky`, events: ['lead.created'] }).expect(201)).body;
    expect(created.secret).toMatch(/^whsec_/);
    const listed = (await http.get('/webhooks').expect(200)).body;
    expect(listed[0]).not.toHaveProperty('secret');
    expect(JSON.stringify(listed)).not.toContain(created.secret);

    const lead = (await http.post('/leads', { fullName: 'Hooked Lead' }).expect(201)).body.lead;
    await worker.drain();
    let hook = (await http.get('/webhooks').expect(200)).body[0];
    expect(hook.recentDeliveries[0]).toMatchObject({ eventType: 'lead.created', status: 'PENDING', attempts: 1, responseCode: 500 });

    // The next attempt waits for the backoff window.
    await worker.drain();
    expect(received.filter((r) => r.path === '/flaky')).toHaveLength(1);
    const next = await asTenant(owner.tenantId, (tx) => tx.webhookDelivery.findFirstOrThrow({ where: { webhookId: created.id } }));
    expect(next.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

    await retryNow();
    await worker.drain();
    await retryNow();
    await worker.drain();
    hook = (await http.get('/webhooks').expect(200)).body[0];
    expect(hook.recentDeliveries[0]).toMatchObject({ status: 'SUCCEEDED', attempts: 3, responseCode: 200 });
    expect(hook.consecutiveFailures).toBe(0);
    expect(hook.active).toBe(true);

    const last = received.filter((r) => r.path === '/flaky').at(-1)!;
    const sig = String(last.headers['x-dealflow-signature']);
    const [, t, v1] = sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    expect(createHmac('sha256', created.secret).update(`${t}.${last.body}`).digest('hex')).toBe(v1);
    const payload = JSON.parse(last.body);
    expect(payload).toMatchObject({ type: 'lead.created', data: { entityType: 'lead', entityId: lead.id } });
    expect(last.headers['x-dealflow-event']).toBe('lead.created');
    // Every attempt carries the same event id, so receivers can de-duplicate.
    expect(new Set(received.filter((r) => r.path === '/flaky').map((r) => JSON.parse(r.body).id)).size).toBe(1);
  });

  it('switches off an endpoint that keeps failing, notifies admins, and can be re-enabled and redelivered', async () => {
    script['/down'] = Array(20).fill(500);
    const created = (await http.post('/webhooks', { url: `${base}/down`, events: ['contact.created'] }).expect(201)).body;
    for (let i = 0; i < 3; i++) await http.post('/contacts', { firstName: `Down ${i}` }).expect(201);
    await worker.drain();
    // Test config: WEBHOOK_DISABLE_AFTER_FAILURES=3.
    let hook = (await http.get('/webhooks').expect(200)).body.find((h: { id: string }) => h.id === created.id);
    expect(hook.active).toBe(false);
    expect(hook.disabledReason).toMatch(/3 failed deliveries/);
    const inbox = (await http.get('/notifications').expect(200)).body;
    expect(inbox.items.some((n: { type: string }) => n.type === 'webhook.disabled')).toBe(true);

    // While switched off, new events are not queued for it.
    await http.post('/contacts', { firstName: 'Ignored' }).expect(201);
    await worker.drain();
    const count = await asTenant(owner.tenantId, (tx) => tx.webhookDelivery.count({ where: { webhookId: created.id } }));
    expect(count).toBe(3);

    // Pending retries are failed once the hook is off; a person can bring them back.
    await retryNow();
    await worker.drain();
    const failed = await asTenant(owner.tenantId, (tx) => tx.webhookDelivery.findMany({ where: { webhookId: created.id, status: 'FAILED' } }));
    expect(failed.length).toBe(3);

    script['/down'] = [];
    hook = (await http.patch(`/webhooks/${created.id}`, { active: true }).expect(200)).body;
    expect(hook).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null });
    await http.post(`/webhooks/${created.id}/deliveries/${failed[0]!.id}/redeliver`).expect(202);
    await http.post(`/webhooks/${created.id}/deliveries/${failed[0]!.id}/redeliver`).expect(404);
    await worker.drain();
    const redelivered = await asTenant(owner.tenantId, (tx) => tx.webhookDelivery.findUniqueOrThrow({ where: { id: failed[0]!.id } }));
    expect(redelivered.status).toBe('SUCCEEDED');
  });

  it('validates input and restricts management to integration admins', async () => {
    await http.post('/webhooks', { url: 'not a url', events: ['lead.created'] }).expect(400);
    await http.post('/webhooks', { url: `${base}/x`, events: ['auth.login'] }).expect(400);
    await http.post('/webhooks', { url: 'ftp://example.com/x', events: ['lead.created'] }).expect(400);
    const member = await inviteMember(app, owner, 'manager');
    await api(member).get('/webhooks').expect(403);
    await api(member).post('/webhooks', { url: `${base}/x`, events: ['lead.created'] }).expect(403);

    const other = await registerUser(app, 'Hook Outsider');
    const mine = (await http.get('/webhooks').expect(200)).body[0];
    await api(other).patch(`/webhooks/${mine.id}`, { active: false }).expect(404);
    await api(other).del(`/webhooks/${mine.id}`).expect(404);
    expect((await api(other).get('/webhooks').expect(200)).body).toEqual([]);
    await http.del(`/webhooks/${mine.id}`).expect(204);
  });
});

describe('notifications', () => {
  let app: INestApplication;
  let worker: WorkerService;
  let owner: TestUser;

  beforeAll(async () => {
    app = await startApp();
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Notify');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('tells people about work someone else assigned to them, once, and only them', async () => {
    const rep = await inviteMember(app, owner, 'member');
    const other = await inviteMember(app, owner, 'member');
    const http = api(owner);
    const lead = (await http.post('/leads', { fullName: 'Assign Me' }).expect(201)).body.lead;
    await http.patch(`/leads/${lead.id}`, { ownerId: rep.userId }).expect(200);
    await http.post('/tasks', { title: 'Prep the demo', assigneeId: rep.userId }).expect(201);
    await http.post('/tasks', { title: 'My own task' }).expect(201);
    await worker.drain();
    await worker.drain();

    const inbox = (await api(rep).get('/notifications').expect(200)).body;
    expect(inbox.unread).toBe(2);
    expect(inbox.items.map((n: { title: string }) => n.title).sort()).toEqual(['Assign Me was assigned to you', 'New task for you: Prep the demo']);
    expect((await api(other).get('/notifications').expect(200)).body.items).toHaveLength(0);
    expect((await http.get('/notifications').expect(200)).body.items).toHaveLength(0);

    // Users cannot mark someone else's notifications.
    await api(other).post('/notifications/read', { ids: [inbox.items[0].id] }).expect(200);
    expect((await api(rep).get('/notifications?unread=true').expect(200)).body.items).toHaveLength(2);
    await api(rep).post('/notifications/read', { ids: [inbox.items[0].id] }).expect(200);
    expect((await api(rep).get('/notifications').expect(200)).body.unread).toBe(1);
    await api(rep).post('/notifications/read', { ids: 'all' }).expect(200);
    expect((await api(rep).get('/notifications').expect(200)).body.unread).toBe(0);
  });
});
