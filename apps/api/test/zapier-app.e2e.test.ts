import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerService } from '../src/worker/worker.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

/** The shapes of the Zapier Platform app definition this test uses (integrations/zapier). */
type Bundle = { authData: Record<string, string>; inputData?: Record<string, unknown>; targetUrl?: string; subscribeData?: { id: string }; cleanedRequest?: Record<string, unknown> };
type Fn = (z: FakeZ, bundle: Bundle) => Promise<unknown>;
interface ZapierApp {
  version: string;
  platformVersion: string;
  authentication: { type: string; fields: { key: string }[]; test: Fn; connectionLabel: string };
  beforeRequest: ((req: ZRequest, z: FakeZ, bundle: Bundle) => ZRequest)[];
  afterResponse: ((res: ZResponse, z: FakeZ) => ZResponse)[];
  triggers: Record<string, { operation: { type: string; performSubscribe: Fn; performUnsubscribe: Fn; perform: Fn; performList: Fn } }>;
  creates: Record<string, { operation: { perform: Fn } }>;
}
type ZRequest = { url: string; method?: string; json?: unknown; headers?: Record<string, string> };
type ZResponse = { status: number; data: unknown; content: string };
type FakeZ = { request: (r: ZRequest) => Promise<ZResponse>; errors: { Error: new (message: string, code: string, status: number) => Error } };

const zapierApp = createRequire(resolve(process.cwd(), 'package.json'))('../../integrations/zapier/index.js') as ZapierApp;

class ZapierError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * A stand-in for Zapier's runtime: runs the app's beforeRequest and afterResponse hooks around fetch, as
 * zapier-platform-core does. This proves the app and the API agree; it is not Zapier itself.
 */
function fakeZ(bundle: Bundle): FakeZ {
  const z: FakeZ = {
    errors: { Error: ZapierError },
    request: async (r) => {
      const req = zapierApp.beforeRequest.reduce<ZRequest>((acc, f) => f(acc, z, bundle), { ...r, headers: { ...(r.headers ?? {}) } });
      const res = await fetch(req.url, { method: req.method ?? 'GET', headers: { ...req.headers, ...(req.json !== undefined ? { 'content-type': 'application/json' } : {}) }, body: req.json !== undefined ? JSON.stringify(req.json) : undefined });
      const content = await res.text();
      let data: unknown = null;
      try {
        data = content ? JSON.parse(content) : null;
      } catch {
        data = content;
      }
      return zapierApp.afterResponse.reduce<ZResponse>((acc, f) => f(acc, z), { status: res.status, data, content });
    },
  };
  return z;
}

describe('API keys and the DealFlow Zapier app', () => {
  let app: INestApplication;
  let base: string;
  let owner: TestUser;
  let worker: WorkerService;
  let receiver: Server;
  let receiverUrl: string;
  let answer = 200;
  const received: { path: string; body: Record<string, unknown> }[] = [];
  let key: string;
  let keyId: string;
  const pub = () => request(app.getHttpServer());
  const bundle = (extra: Partial<Bundle> = {}): Bundle => ({ authData: { baseUrl: `${base}/`, apiKey: key }, ...extra });

  beforeAll(async () => {
    app = await startApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    worker = app.get(WorkerService);
    owner = await registerUser(app, 'Zap Co');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', seats: 10 } }));
    // Stands in for hooks.zapier.com: records what DealFlow posts.
    receiver = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        received.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') });
        res.writeHead(answer).end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
    await new Promise((r) => receiver.close(r));
  });

  it('creates a key shown once, stores only its hash, and refuses scopes the creator lacks', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(member).post('/api-keys', { name: 'Nope', scopes: ['leads:read'] }).expect(403);
    await api(owner).post('/api-keys', { name: 'Bad', scopes: ['billing:manage'] }).expect(400);

    const created = (await api(owner).post('/api-keys', { name: 'Zapier', scopes: ['leads:read', 'leads:write', 'contacts:read', 'contacts:write', 'deals:read', 'activities:read', 'activities:write'] }).expect(201)).body;
    key = created.key;
    keyId = created.id;
    expect(key).toMatch(/^dfk_[A-Za-z0-9_-]{40}$/);
    expect(created).toMatchObject({ name: 'Zapier', prefix: key.slice(0, 12), revokedAt: null, hooks: 0 });
    const listed = (await api(owner).get('/api-keys').expect(200)).body;
    expect(JSON.stringify(listed)).not.toContain(key);
    const row = await asTenant(owner.tenantId, (tx) => tx.apiKey.findFirstOrThrow({ where: { id: keyId } }));
    expect(row.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(key);
    expect((await api(owner).get('/api-keys/zapier').expect(200)).body).toEqual({ inviteUrl: null, subscriptions: 0 });
  });

  it('a key works only on CRM and Zapier routes, only within its scopes, and never with the cookie', async () => {
    const auth = { authorization: `Bearer ${key}` };
    expect((await pub().get('/api/v1/leads').set(auth).expect(200)).body.items).toEqual([]);
    expect((await pub().get('/api/v1/companies').set(auth).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await pub().get('/api/v1/api-keys').set(auth).expect(403)).body.error.code).toBe('API_KEY_NOT_ALLOWED');
    expect((await pub().get('/api/v1/tenants/current/members').set(auth).expect(403)).body.error.code).toBe('API_KEY_NOT_ALLOWED');
    await pub().get('/api/v1/webhooks').set(auth).expect(403);
    expect((await pub().get('/api/v1/leads').set({ authorization: 'Bearer dfk_notarealkeynotarealkeynotarealkey00' }).expect(401)).body.error.code).toBe('INVALID_API_KEY');
    // Cross-site POST with a key is allowed (no cookie is used), and the action is audited as the key's creator.
    const lead = (await pub().post('/api/v1/leads').set(auth).set('origin', 'https://zapier.com').send({ fullName: 'Key Lead' }).expect(201)).body.lead;
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, entityId: lead.id, action: 'lead.created' } }));
    expect(audit.actorUserId).not.toBeNull();
  });

  it('the Zapier app connects with the key and shows a connection label', async () => {
    expect(zapierApp.authentication.fields.map((f) => f.key)).toEqual(['baseUrl', 'apiKey']);
    const me = await zapierApp.authentication.test(fakeZ(bundle()), bundle());
    expect(me).toMatchObject({ workspace: 'Zap Co', keyName: 'Zapier', scopes: expect.arrayContaining(['leads:read']) });
    const bad = { authData: { baseUrl: base, apiKey: 'dfk_notarealkeynotarealkeynotarealkey00' } };
    await expect(zapierApp.authentication.test(fakeZ(bad), bad)).rejects.toThrow('This API key is not valid');
  });

  it('a REST-hook trigger subscribes, receives the event, reads the record, and unsubscribes', async () => {
    await worker.drain(); // events from earlier tests go out before the Zap exists
    const t = zapierApp.triggers.lead_created!.operation;
    expect(t.type).toBe('hook');
    const sub = (await t.performSubscribe(fakeZ(bundle()), bundle({ targetUrl: `${receiverUrl}/hooks/standard/123/abc` }))) as { id: string };
    expect(sub.id).toMatch(/^[0-9a-f-]{36}$/);
    // Admins see it, with only the host shown.
    const hooks = (await api(owner).get('/webhooks').expect(200)).body;
    expect(hooks[0]).toMatchObject({ id: sub.id, source: 'zapier', url: expect.stringContaining('(Zapier)'), events: ['lead.created'] });
    expect(JSON.stringify(hooks)).not.toContain('/hooks/standard/123/abc');
    await api(owner).patch(`/webhooks/${sub.id}`, { url: 'https://example.com/x' }).expect(400);

    await api(owner).post('/leads', { fullName: 'Zap Lead', email: 'zap@lead.test' }).expect(201);
    await worker.drain();
    const hit = received.at(-1)!;
    expect(hit.path).toBe('/hooks/standard/123/abc');
    expect(hit.body).toMatchObject({ type: 'lead.created' });
    const out = (await t.perform(fakeZ(bundle()), bundle({ cleanedRequest: hit.body }))) as Record<string, unknown>[];
    expect(out).toEqual([expect.objectContaining({ id: hit.body.id, event: 'lead.created', entity_type: 'lead', record__fullName: 'Zap Lead', record__email: 'zap@lead.test' })]);

    const samples = (await t.performList(fakeZ(bundle()), bundle())) as Record<string, unknown>[];
    expect(samples[0]).toMatchObject({ event: 'lead.created', record__fullName: 'Zap Lead' });

    // A key without companies:read cannot subscribe to company events.
    await expect(zapierApp.triggers.company_created!.operation.performSubscribe(fakeZ(bundle()), bundle({ targetUrl: `${receiverUrl}/c` }))).rejects.toThrow('needs companies:read');

    await t.performUnsubscribe(fakeZ(bundle()), bundle({ subscribeData: sub }));
    const before = received.length;
    await api(owner).post('/leads', { fullName: 'After Unsubscribe' }).expect(201);
    await worker.drain();
    expect(received).toHaveLength(before);
  });

  it('a 410 from Zapier removes the subscription', async () => {
    const t = zapierApp.triggers.contact_created!.operation;
    const sub = (await t.performSubscribe(fakeZ(bundle()), bundle({ targetUrl: `${receiverUrl}/hooks/standard/gone` }))) as { id: string };
    answer = 410;
    await api(owner).post('/contacts', { firstName: 'Gone' }).expect(201);
    await worker.drain();
    answer = 200;
    const row = await asTenant(owner.tenantId, (tx) => tx.webhook.findFirstOrThrow({ where: { id: sub.id } }));
    expect(row.deletedAt).not.toBeNull();
    expect(row.disabledReason).toContain('410');
  });

  it('actions create records through the normal API, and a revoked key stops at once with its subscriptions', async () => {
    const lead = (await zapierApp.creates.create_lead!.operation.perform(fakeZ(bundle()), bundle({ inputData: { fullName: 'From Typeform', email: 'tf@example.com', source: 'Zapier: Typeform', phone: '' } }))) as { id: string; fullName: string; source: string };
    expect(lead).toMatchObject({ fullName: 'From Typeform', source: 'Zapier: Typeform' });
    const contact = (await zapierApp.creates.create_contact!.operation.perform(fakeZ(bundle()), bundle({ inputData: { firstName: 'Zed', lastName: 'Zapped' } }))) as { firstName: string };
    expect(contact.firstName).toBe('Zed');
    const task = (await zapierApp.creates.create_task!.operation.perform(fakeZ(bundle()), bundle({ inputData: { title: 'Call the Typeform lead', dueAt: '2026-11-05T10:00:00Z', priority: 'HIGH' } }))) as { title: string; priority: string };
    expect(task).toMatchObject({ title: 'Call the Typeform lead', priority: 'HIGH' });
    await expect(zapierApp.creates.create_lead!.operation.perform(fakeZ(bundle()), bundle({ inputData: { email: 'no-name@example.com' } }))).rejects.toThrow();

    const sub = (await zapierApp.triggers.deal_won!.operation.performSubscribe(fakeZ(bundle()), bundle({ targetUrl: `${receiverUrl}/won` }))) as { id: string };
    expect((await api(owner).get('/api-keys').expect(200)).body.find((k: { id: string }) => k.id === keyId).hooks).toBe(1);
    await api(owner).del(`/api-keys/${keyId}`).expect(204);
    await pub().get('/api/v1/leads').set({ authorization: `Bearer ${key}` }).expect(401);
    const row = await asTenant(owner.tenantId, (tx) => tx.webhook.findFirstOrThrow({ where: { id: sub.id } }));
    expect(row.deletedAt).not.toBeNull();
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { tenantId: owner.tenantId, action: 'api_key.revoked' } }));
    expect(audit.metadata).toMatchObject({ hooksRemoved: 1 });
  });

  it('a key stops working when its creator leaves the workspace', async () => {
    const admin = await inviteMember(app, owner, 'admin');
    const k = (await api(admin).post('/api-keys', { name: 'Admin key', scopes: ['leads:read'] }).expect(201)).body.key as string;
    await pub().get('/api/v1/leads').set({ authorization: `Bearer ${k}` }).expect(200);
    await asTenant(owner.tenantId, (tx) => tx.membership.updateMany({ where: { tenantId: owner.tenantId, userId: admin.userId }, data: { status: 'SUSPENDED' } }));
    await pub().get('/api/v1/leads').set({ authorization: `Bearer ${k}` }).expect(401);
  });
});
