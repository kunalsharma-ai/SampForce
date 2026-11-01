import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepAt } from '../src/auth/totp';
import { type FinderFixture, startFinderFixture } from './fixtures/finder-fixture';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

/** Requests as the extension: its own origin, no cookies, and its token once it has one. */
function extension(app: INestApplication, token?: string) {
  const s = request(app.getHttpServer());
  const auth = <T extends request.Test>(r: T) => (token ? r.set('authorization', `Bearer ${token}`) : r).set('origin', EXT_ORIGIN);
  return {
    get: (url: string) => auth(s.get(`/api/v1${url}`)),
    post: (url: string, body: object) => auth(s.post(`/api/v1${url}`)).send(body),
  };
}

async function signIn(app: INestApplication, user: { email: string; password: string }): Promise<string> {
  const res = (await extension(app).post('/extension/login', { email: user.email, password: user.password, name: 'Chrome test' }).expect(200)).body;
  expect(res.token).toMatch(/^dfx_/);
  return res.token as string;
}

describe('extension sign-in and prospect discovery (Mock Mode)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let restore: () => void;

  beforeAll(async () => {
    restore = setEnv({ APOLLO_API_KEY: undefined, HUNTER_API_KEY: undefined, PROSPECT_DAILY_LIMIT: '100' });
    app = await startApp();
    owner = await registerUser(app, 'Extension Prospects');
    await asTenant(owner.tenantId, (tx) => tx.subscription.update({ where: { tenantId: owner.tenantId }, data: { planCode: 'growth', status: 'ACTIVE', seats: 20 } }));
  });

  afterAll(async () => {
    await app.close();
    restore();
  });

  it('signs in with email and password into an extension connection, never a web session', async () => {
    const wrong = await extension(app).post('/extension/login', { email: owner.email, password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();

    const res = await extension(app).post('/extension/login', { email: owner.email, password: owner.password }).expect(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.connection).toMatchObject({ name: 'Browser extension' });
    const me = (await extension(app, res.body.token).get('/extension/me').expect(200)).body;
    expect(me).toMatchObject({ workspace: { id: owner.tenantId }, prospects: { canRead: true, canSave: true, canSearch: true } });
    // The token is still an extension token: the rest of the API refuses it.
    expect((await extension(app, res.body.token).get('/leads').expect(403)).body.error.code).toBe('EXTENSION_NOT_ALLOWED');
    // It shows in the web app's connection list, and the sign-in is audited as from the extension.
    expect((await api(owner).get('/extension/connections').expect(200)).body.map((c: { name: string }) => c.name)).toContain('Browser extension');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { action: { in: ['auth.login', 'extension.connected'] } }, orderBy: { createdAt: 'desc' }, take: 2 }));
    expect(audit.map((a) => [a.action, a.metadata])).toEqual([
      ['extension.connected', { name: 'Browser extension', via: 'password' }],
      ['auth.login', { method: 'password', client: 'extension' }],
    ]);
  });

  it('refuses sign-in from ordinary websites, so they cannot drive attempts or lockouts', async () => {
    const u = await registerUser(app, 'Extension Origin');
    const from = (origin: string) => request(app.getHttpServer()).post('/api/v1/extension/login').set('origin', origin).send({ email: u.email, password: 'wrong-password' });
    expect((await from('https://evil.example').expect(403)).body.error.code).toBe('BAD_ORIGIN');
    expect((await request(app.getHttpServer()).post('/api/v1/extension/login/mfa').set('origin', 'https://evil.example').send({ challenge: 'x'.repeat(20), code: '123456' }).expect(403)).body.error.code).toBe('BAD_ORIGIN');
    // Refused before the password check, so nothing counts towards the lockout.
    const user = await asTenant(u.tenantId, (tx) => tx.user.findFirstOrThrow({ where: { email: u.email } }));
    expect(user).toMatchObject({ failedLoginCount: 0 });
    // Firefox and the web app's own origin are allowed through to the password check.
    await from('moz-extension://0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0').expect(401);
    await from('http://localhost:3000').expect(401);
  });

  it('asks for the second factor when the account has one', async () => {
    const u = await registerUser(app, 'Extension MFA');
    const setup = (await api(u).post('/auth/mfa/setup', { password: u.password }).expect(200)).body as { secret: string };
    const code = (offset = 0) => hotp(base32Decode(setup.secret), stepAt(Date.now() / 1000) + offset);
    await api(u).post('/auth/mfa/enable', { code: code() }).expect(200);

    const step1 = (await extension(app).post('/extension/login', { email: u.email, password: u.password }).expect(200)).body;
    expect(step1).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    await extension(app).post('/extension/login/mfa', { challenge: step1.challenge, code: '000000' }).expect(401);
    const done = (await extension(app).post('/extension/login/mfa', { challenge: step1.challenge, code: code(1) }).expect(200)).body;
    expect(done.token).toMatch(/^dfx_/);
    await extension(app, done.token).get('/extension/me').expect(200);
  });

  it('sends people in workspaces that enforce single sign-on to a connection code', async () => {
    const member = await inviteMember(app, owner, 'member');
    const enforce = (on: boolean) => asTenant(owner.tenantId, (tx) => tx.tenant.update({ where: { id: owner.tenantId }, data: { ssoEnforced: on } }));
    await enforce(true);
    try {
      const res = await extension(app).post('/extension/login', { email: member.email, password: member.password }).expect(403);
      expect(res.body.error).toMatchObject({ code: 'SSO_REQUIRED', message: expect.stringContaining('connection code') });
      // The owner may still sign in with a password, as in the web app.
      await signIn(app, owner);
    } finally {
      await enforce(false);
    }
  });

  it('discovers labelled sample people, saves them to a new list, and keeps them out of the CRM', async () => {
    const token = await signIn(app, owner);
    const ext = extension(app, token);
    const found = (await ext.post('/extension/prospects/discover', { domain: 'www.northwind.com', titles: ['Head of Operations'] }).expect(200)).body;
    expect(found).toMatchObject({ mode: 'mock', notice: expect.stringContaining('Mock Mode') });
    expect(found.people).toHaveLength(12);
    expect(found.people.every((p: { sample: boolean; domain: string; title: string }) => p.sample && p.domain === 'northwind.example' && p.title === 'Head of Operations')).toBe(true);

    const people = found.people.slice(0, 3);
    const saved = (await ext.post('/extension/prospects/import', { people, destination: { type: 'new_list', name: 'Northwind' }, sourceUrl: 'https://www.northwind.com/about' }).expect(200)).body;
    expect(saved.destination).toMatchObject({ type: 'list', name: 'Northwind' });
    expect(saved.results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'added', 'added']);
    expect(saved.results[0].email).toMatch(/@northwind\.example$/);
    expect(saved.usage).toEqual({ used: 4, limit: 100 });

    // The same name again reuses the list, and the same people are duplicates.
    const again = (await ext.post('/extension/prospects/import', { people, destination: { type: 'new_list', name: 'northwind' }, sourceUrl: 'https://www.northwind.com/about' }).expect(200)).body;
    expect(again.destination.id).toBe(saved.destination.id);
    expect(again.results.map((r: { outcome: string }) => r.outcome)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    const lists = (await ext.get('/extension/prospect-lists').expect(200)).body;
    expect(lists).toEqual([expect.objectContaining({ name: 'Northwind', prospects: 3, samples: 3 })]);

    // Sample people never reach the CRM, even when the caller claims they are real.
    const forged = people.map((p: object) => ({ ...p, sample: false, email: 'someone@northwind.example' }));
    const crm = (await ext.post('/extension/prospects/import', { people: forged, destination: { type: 'crm' }, sourceUrl: 'https://www.northwind.com/about' }).expect(200)).body;
    expect(crm.results.map((r: { outcome: string; reason: string }) => [r.outcome, r.reason])).toEqual(Array(3).fill(['skipped', 'Sample data from Mock Mode cannot be added to the CRM.']));
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { tenantId: owner.tenantId } }))).toBe(0);

    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { action: 'prospects.added', entityId: saved.destination.id }, orderBy: { createdAt: 'asc' } }));
    expect(audit.metadata).toMatchObject({ source: 'extension', added: 3 });
  });

  it('only offers what the role allows', async () => {
    const viewer = await inviteMember(app, owner, 'viewer');
    const token = await signIn(app, viewer);
    const ext = extension(app, token);
    expect((await ext.get('/extension/me').expect(200)).body.prospects).toEqual({ canRead: true, canSave: false, canSearch: false });
    await ext.post('/extension/prospects/discover', { domain: 'northwind.com' }).expect(403);
    await ext.get('/extension/prospect-lists').expect(200);
  });
});

describe('extension prospect discovery with an Apollo key (stand-in)', () => {
  let app: INestApplication;
  let finder: FinderFixture;
  let owner: TestUser;
  let restore: () => void;

  beforeAll(async () => {
    finder = await startFinderFixture();
    restore = setEnv({ APOLLO_API_KEY: 'apollo-test-key', APOLLO_API_BASE_URL: `${finder.url}/apollo`, HUNTER_API_KEY: undefined, PROSPECT_DAILY_LIMIT: '100' });
    app = await startApp();
    owner = await registerUser(app, 'Live Extension Prospects');
  });

  afterAll(async () => {
    await app.close();
    await finder.close();
    restore();
  });

  it('finds people at the company on screen and adds the ones with an email as leads', async () => {
    const ext = extension(app, await signIn(app, owner));
    const lead = (await api(owner).post('/leads', { fullName: 'Dev K', email: 'dev.kapoor@bluefin-logistics.com' }).expect(201)).body.lead;
    const found = (await ext.post('/extension/prospects/discover', { domain: 'bluefin-logistics.com' }).expect(200)).body;
    expect(found.mode).toBe('live');
    expect(found.people.map((p: { fullName: string; email: null }) => [p.fullName, p.email])).toEqual([['Ana Lima', null], ['Dev Kapoor', null], ['Ruth Okon', null]]);

    const res = (await ext.post('/extension/prospects/import', { people: found.people, destination: { type: 'crm' }, sourceUrl: 'https://bluefin-logistics.com/team' }).expect(200)).body;
    expect(res.results.map((r: { name: string; outcome: string }) => [r.name, r.outcome])).toEqual([['Ana Lima', 'added'], ['Dev Kapoor', 'existing'], ['Ruth Okon', 'skipped']]);
    expect(res.results[2].reason).toContain('No email address was found');
    expect(res.usage).toEqual({ used: 4, limit: 100 });

    const ana = await asTenant(owner.tenantId, (tx) => tx.lead.findFirstOrThrow({ where: { email: 'ana.lima@bluefin-logistics.com' } }));
    expect(ana).toMatchObject({ source: 'Prospect discovery', emailStatus: 'valid', jobTitle: 'Head of Operations', companyName: 'Bluefin Logistics', tags: ['prospect-discovery'] });
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { id: lead.id } }))).toBe(1);
    expect(finder.apolloCalls).toEqual(['/apollo/mixed_people/api_search', '/apollo/people/bulk_match']);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirstOrThrow({ where: { action: 'extension.prospects_imported' } }));
    expect(audit.metadata).toMatchObject({ sourceUrl: 'https://bluefin-logistics.com/team', created: 1, existing: 1 });
  });
});
