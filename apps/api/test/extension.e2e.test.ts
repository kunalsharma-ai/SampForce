import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProviderFixture, providerEnv, type ProviderFixture } from './fixtures/provider-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

describe('browser extension', () => {
  let app: INestApplication;
  let fixture: ProviderFixture;
  let owner: TestUser;
  let http: ReturnType<typeof api>;
  let token: string;
  let connectionId: string;
  const saved: Record<string, string | undefined> = {};

  /** Requests as the extension: its own origin and token, no cookies. */
  const ext = (t = token) => {
    const s = request(app.getHttpServer());
    return {
      get: (url: string) => s.get(`/api/v1${url}`).set('authorization', `Bearer ${t}`).set('origin', EXT_ORIGIN),
      post: (url: string, body: object) => s.post(`/api/v1${url}`).set('authorization', `Bearer ${t}`).set('origin', EXT_ORIGIN).send(body),
    };
  };

  beforeAll(async () => {
    fixture = await startProviderFixture();
    for (const [k, v] of Object.entries(providerEnv(fixture.url))) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    app = await startApp();
    owner = await registerUser(app, 'Extension Org');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
    http = api(owner);
  });

  afterAll(async () => {
    await app.close();
    await fixture.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('connects with a token that only reaches the extension routes', async () => {
    const created = (await http.post('/extension/connections', { name: 'Chrome at work' }).expect(201)).body;
    token = created.token;
    connectionId = created.connection.id;
    expect(token).toMatch(/^dfx_/);
    expect(created.connection).toMatchObject({ name: 'Chrome at work', lastUsedAt: null });

    const me = (await ext().get('/extension/me').expect(200)).body;
    expect(me).toMatchObject({ workspace: { id: owner.tenantId }, canSave: true, canEnroll: true, mailboxConnected: false, sequences: [] });

    // Everything else refuses the token, even what the role allows, including managing connections.
    expect((await ext().get('/leads').expect(403)).body.error.code).toBe('EXTENSION_NOT_ALLOWED');
    await ext().get('/extension/connections').expect(403);
    await ext().post('/extension/connections', { name: 'x' }).expect(403);
    await ext().get('/auth/sessions').expect(403);
    await ext('dfx_not-a-real-token').get('/extension/me').expect(401);

    // A cookie request from the extension origin is still refused, so the bypass is only for the token.
    await http.post('/leads', { fullName: 'x' }).set('origin', EXT_ORIGIN).expect(403);
    // The connection shows in the person's devices.
    const sessions = (await http.get('/auth/sessions').expect(200)).body as { userAgent: string }[];
    expect(sessions.some((s) => s.userAgent.startsWith('DealFlow browser extension'))).toBe(true);
  });

  it('looks up and saves people from a page without duplicating anyone', async () => {
    const existing = (await http.post('/leads', { fullName: 'Ana Buyer', email: 'ana@acme.test' }).expect(201)).body.lead.id;
    await http.post('/companies', { name: 'Acme', domain: 'acme.test' }).expect(201);
    await http.post('/sequences/suppressions', { emails: ['legal@acme.test'] }).expect(201);

    const look = (await ext().post('/extension/lookup', { emails: ['ANA@acme.test', 'jane.doe@acme.test', 'someone@gmail.com', 'legal@acme.test'], website: 'https://www.acme.test/team' }).expect(200)).body;
    expect(look.company).toMatchObject({ name: 'Acme' });
    expect(look.people).toEqual([
      { email: 'ana@acme.test', match: { entity: 'lead', id: existing, label: 'Ana Buyer' }, suppressed: false, personal: false },
      { email: 'jane.doe@acme.test', match: null, suppressed: false, personal: false },
      { email: 'someone@gmail.com', match: null, suppressed: false, personal: true },
      { email: 'legal@acme.test', match: null, suppressed: true, personal: false },
    ]);

    const auto = (await ext().post('/extension/capture', {
      people: [{ email: 'ana@acme.test' }, { email: 'jane.doe@acme.test' }, { email: 'someone@gmail.com' }, { email: 'legal@acme.test' }],
      companyName: 'Acme', sourceUrl: 'https://www.acme.test/team', auto: true,
    }).expect(200)).body;
    expect(auto.results.map((r: { email: string; outcome: string; reason?: string }) => [r.email, r.outcome, r.reason])).toEqual([
      ['ana@acme.test', 'existing', undefined],
      ['jane.doe@acme.test', 'created', undefined],
      ['someone@gmail.com', 'skipped', 'personal'],
      ['legal@acme.test', 'skipped', 'suppressed'],
    ]);
    const jane = (await http.get(`/leads/${auto.results[1].match.id}`).expect(200)).body;
    expect(jane).toMatchObject({ fullName: 'Jane Doe', companyName: 'Acme', source: 'Browser extension', tags: ['browser-extension', 'auto-captured'] });
    const site = (id: string) => asTenant(owner.tenantId, async (tx) => (await tx.lead.findUniqueOrThrow({ where: { id } })).website);
    expect(await site(jane.id)).toBe('acme.test');

    // Saving by hand can add a personal address; it is just never auto-captured.
    const manual = (await ext().post('/extension/capture', { people: [{ email: 'someone@gmail.com', fullName: 'Sam One' }], sourceUrl: 'https://www.acme.test/team' }).expect(200)).body;
    expect(manual.results[0]).toMatchObject({ outcome: 'created', match: { label: 'Sam One' } });
    expect(await site(manual.results[0].match.id)).toBeNull();
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.count({ where: { tenantId: owner.tenantId, action: 'extension.captured' } }));
    expect(audit).toBe(2);
  });

  it('enrols saved people in a running sequence, and checks first so nothing is half done', async () => {
    const seq = (await http.post('/sequences', { name: 'From the extension', steps: [{ id: 'a', type: 'email', delayDays: 0, subject: 'Hi', body: 'Hello {{first_name|there}}' }] }).expect(201)).body;
    const body = { people: [{ email: 'raj@globex.test', fullName: 'Raj Patel' }], companyName: 'Globex', sourceUrl: 'https://globex.test', sequenceId: seq.id };
    expect((await ext().post('/extension/capture', body).expect(409)).body.error.code).toBe('SEQUENCE_NOT_ACTIVE');
    await http.post(`/sequences/${seq.id}/status`, { status: 'ACTIVE' }).expect(200);
    expect((await ext().post('/extension/capture', body).expect(409)).body.error.code).toBe('NOT_CONNECTED');
    expect((await http.get('/leads?q=Raj').expect(200)).body.total).toBe(0);

    const { url } = (await http.post('/integrations/google/connect').expect(200)).body;
    await http.get(`/integrations/google/callback?code=good-code&state=${encodeURIComponent(new URL(url).searchParams.get('state')!)}`).expect(302);
    const me = (await ext().get('/extension/me').expect(200)).body;
    expect(me).toMatchObject({ mailboxConnected: true, sequences: [{ id: seq.id, name: 'From the extension' }] });

    const r = (await ext().post('/extension/capture', { ...body, people: [...body.people, { email: 'ana@acme.test' }] }).expect(200)).body;
    expect(r.results.map((x: { outcome: string }) => x.outcome)).toEqual(['created', 'existing']);
    expect(r.enrollment).toEqual({ enrolled: 2, skipped: [] });
  });

  it('follows the role: a viewer can look but not save', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    const t = (await api(viewer).post('/extension/connections', { name: 'Viewer' }).expect(201)).body.token as string;
    expect((await ext(t).get('/extension/me').expect(200)).body).toMatchObject({ canSave: false, canEnroll: false });
    await ext(t).post('/extension/lookup', { emails: ['ana@acme.test'] }).expect(200);
    await ext(t).post('/extension/capture', { people: [{ email: 'x@acme.test' }], sourceUrl: 'https://acme.test' }).expect(403);
  });

  it('stops working once disconnected or signed out with every other device', async () => {
    await http.del(`/extension/connections/${connectionId}`).expect(204);
    await ext().get('/extension/me').expect(401);
    await http.del(`/extension/connections/${connectionId}`).expect(404);

    const again = (await http.post('/extension/connections', { name: 'Again' }).expect(201)).body.token as string;
    await ext(again).get('/extension/me').expect(200);
    await http.post('/auth/sessions/revoke-others').expect(200);
    await ext(again).get('/extension/me').expect(401);

    // The extension can end its own connection.
    const own = (await http.post('/extension/connections', { name: 'Own' }).expect(201)).body.token as string;
    await ext(own).post('/extension/disconnect', {}).expect(204);
    await ext(own).get('/extension/me').expect(401);
    expect((await http.get('/extension/connections').expect(200)).body).toEqual([]);
  });
});
