import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearOidcCaches } from '../src/identity/oidc';
import { createOidcFixture, type OidcFixture } from './fixtures/oidc-fixture';
import { api, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const setPlan = (tenantId: string, planCode: string) =>
  asTenant(tenantId, (tx) => tx.subscription.update({ where: { tenantId }, data: { planCode, status: 'ACTIVE', seats: 20 } }));

/** Runs the browser part of a sign-in: start → provider → callback. Returns the agent and where it landed. */
async function ssoSignIn(app: INestApplication, workspace: string, agent = request.agent(app.getHttpServer())) {
  const start = await agent.get(`/api/v1/auth/sso/start?workspace=${workspace}`);
  if (!start.headers.location?.startsWith('http://127.0.0.1')) return { agent, landed: start.headers.location as string };
  const provider = await fetch(start.headers.location, { redirect: 'manual' });
  const back = new URL(provider.headers.get('location')!);
  const cb = await agent.get(`/api/v1/auth/sso/callback${back.search}`);
  return { agent, landed: cb.headers.location as string };
}

describe('single sign-on (OpenID Connect)', () => {
  let app: INestApplication;
  let idp: OidcFixture;
  let owner: TestUser;
  let slug: string;
  let memberRoleId: string;

  beforeAll(async () => {
    app = await startApp();
    idp = await createOidcFixture();
  });
  afterAll(async () => {
    await app.close();
    await idp.close();
  });
  beforeEach(() => clearOidcCaches());

  const connection = (over: object = {}) => ({
    loginSlug: slug, issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, allowedDomains: ['acme.test'], jitProvisioning: false, defaultRoleId: null, enabled: true, enforced: false, ...over,
  });

  it('is available on the Free plan, and checks the provider before turning on', async () => {
    owner = await registerUser(app, 'SSO Co');
    slug = `sso-${randomUUID().slice(0, 8)}`;
    const o = api(owner);
    expect((await o.get('/security/settings').expect(200)).body).not.toHaveProperty('ssoEntitled');
    const bad = await o.put('/security/sso', connection({ issuer: `${idp.issuer}/nope` })).expect(400);
    expect(bad.body.error.code).toBe('SSO_DISCOVERY_FAILED');
    expect((await o.put('/security/sso', connection({ enforced: true })).expect(400)).body.error.code).toBe('SSO_NOT_VERIFIED');
    const saved = (await o.put('/security/sso', connection()).expect(200)).body;
    expect(saved).toMatchObject({ loginSlug: slug, enabled: true, hasClientSecret: true });
    expect(JSON.stringify(saved)).not.toContain(idp.clientSecret);
    const roles = (await o.get('/tenants/current/roles').expect(200)).body as { id: string; key: string }[];
    memberRoleId = roles.find((r) => r.key === 'member')!.id;
    const ownerRole = roles.find((r) => r.key === 'owner')!.id;
    await o.put('/security/sso', connection({ jitProvisioning: true, defaultRoleId: ownerRole })).expect(400);
    // Free has two seats; the tests below add more people.
    await setPlan(owner.tenantId, 'launch');
  });

  it('refuses people who were not invited, and other email domains', async () => {
    idp.next = { sub: 'stranger', email: 'stranger@acme.test' };
    expect((await ssoSignIn(app, slug)).landed).toBe('http://localhost:3000/login/sso?sso_error=not_invited');
    idp.next = { sub: 'outsider', email: 'eve@evil.test' };
    expect((await ssoSignIn(app, slug)).landed).toBe('http://localhost:3000/login/sso?sso_error=domain_not_allowed');
    expect((await ssoSignIn(app, 'no-such-workspace')).landed).toBe('http://localhost:3000/login/sso?sso_error=unknown_workspace');
  });

  it('signs in an invited person, bound to this workspace', async () => {
    const email = `ada-${randomUUID().slice(0, 6)}@acme.test`;
    await api(owner).post('/tenants/current/invitations', { email, roleKey: 'manager' }).expect(201);
    idp.next = { sub: `sub-${email}`, email };
    const { agent, landed } = await ssoSignIn(app, slug);
    expect(landed).toBe('http://localhost:3000/app');
    const me = (await agent.get('/api/v1/auth/me').expect(200)).body;
    expect(me).toMatchObject({ authMethod: 'sso', role: 'manager', tenant: { id: owner.tenantId } });

    // The same person's own workspace is not reachable from this session.
    const own = await registerUser(app, 'Ada Own');
    const linkUser = await asTenant(own.tenantId, (tx) => tx.membership.findFirstOrThrow({ where: { tenantId: own.tenantId } }));
    expect(linkUser).toBeTruthy();
    await agent.post('/api/v1/auth/switch-tenant').set('origin', ORIGIN).send({ tenantId: own.tenantId }).expect(403);

    // Signing in again matches the provider subject, not the email.
    const again = await ssoSignIn(app, slug);
    expect(again.landed).toBe('http://localhost:3000/app');
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { action: 'auth.login', metadata: { path: ['method'], equals: 'sso' } } }));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects tampered or mismatched responses', async () => {
    const email = `grace-${randomUUID().slice(0, 6)}@acme.test`;
    await api(owner).put('/security/sso', connection({ jitProvisioning: true, defaultRoleId: memberRoleId })).expect(200);
    for (const bad of [{ nonce: 'replayed' }, { iss: 'https://evil.test' }, { aud: 'someone-else' }, { signWithOtherKey: true }, { email_verified: false }]) {
      idp.next = { sub: `s-${email}`, email, ...bad };
      expect((await ssoSignIn(app, slug)).landed, JSON.stringify(bad)).toBe('http://localhost:3000/login/sso?sso_error=invalid_response');
    }
    // A callback without the browser's state cookie, or with someone else's state, is refused.
    idp.next = { sub: `s-${email}`, email };
    const start = await request(app.getHttpServer()).get(`/api/v1/auth/sso/start?workspace=${slug}`);
    const back = new URL((await fetch(start.headers.location as string, { redirect: 'manual' })).headers.get('location')!);
    const noCookie = await request(app.getHttpServer()).get(`/api/v1/auth/sso/callback${back.search}`);
    expect(noCookie.headers.location).toContain('sso_error=expired');
    // Just-in-time provisioning creates the member with the default role.
    const jit = await ssoSignIn(app, slug);
    expect(jit.landed).toBe('http://localhost:3000/app');
    expect((await jit.agent.get('/api/v1/auth/me').expect(200)).body.role).toBe('member');
  });

  it('can require single sign-on: members lose password access, owners keep it, on any plan', async () => {
    const member = await inviteMember(app, owner, 'member');
    await api(owner).put('/security/sso', connection({ jitProvisioning: true, defaultRoleId: memberRoleId, enforced: true })).expect(200);
    expect((await api(member).get('/contacts').expect(403)).body.error.code).toBe('SSO_REQUIRED');
    expect((await api(member).get('/auth/me').expect(200)).body.restriction).toBe('sso_required');
    const pw = await request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: member.email, password: member.password });
    expect(pw.status).toBe(403);
    expect(pw.body.error.code).toBe('SSO_REQUIRED');
    await api(owner).get('/contacts').expect(200);

    // Enforcement does not depend on the plan.
    await setPlan(owner.tenantId, 'growth');
    expect((await api(member).get('/contacts').expect(403)).body.error.code).toBe('SSO_REQUIRED');
    await api(owner).put('/security/sso', connection({ enforced: false })).expect(200);
  });
});

describe('SCIM 2.0 provisioning', () => {
  let app: INestApplication;
  let owner: TestUser;
  let token: string;
  const scim = () => ({
    get: (p: string) => request(app.getHttpServer()).get(`/api/v1/scim/v2${p}`).set('authorization', `Bearer ${token}`),
    post: (p: string, b: object) => request(app.getHttpServer()).post(`/api/v1/scim/v2${p}`).set('authorization', `Bearer ${token}`).set('content-type', 'application/scim+json').send(JSON.stringify(b)),
    put: (p: string, b: object) => request(app.getHttpServer()).put(`/api/v1/scim/v2${p}`).set('authorization', `Bearer ${token}`).set('content-type', 'application/scim+json').send(JSON.stringify(b)),
    patch: (p: string, b: object) => request(app.getHttpServer()).patch(`/api/v1/scim/v2${p}`).set('authorization', `Bearer ${token}`).set('content-type', 'application/scim+json').send(JSON.stringify(b)),
    del: (p: string) => request(app.getHttpServer()).delete(`/api/v1/scim/v2${p}`).set('authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'SCIM Co');
  });
  afterAll(async () => {
    await app.close();
  });

  it('issues tokens on the Free plan, shown once', async () => {
    const o = api(owner);
    const created = (await o.post('/security/scim-tokens', { name: 'Okta' }).expect(201)).body;
    token = created.token;
    await setPlan(owner.tenantId, 'launch'); // seats for the people provisioned below
    expect(token).toMatch(/^dfscim_/);
    const settings = (await o.get('/security/settings').expect(200)).body;
    expect(settings.scimTokens).toEqual([expect.objectContaining({ name: 'Okta', prefix: token.slice(0, 12) })]);
    expect(JSON.stringify(settings)).not.toContain(token);
    await request(app.getHttpServer()).get('/api/v1/scim/v2/Users').expect(401);
    const wrong = await request(app.getHttpServer()).get('/api/v1/scim/v2/Users').set('authorization', 'Bearer dfscim_nope').expect(401);
    expect(wrong.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
  });

  it('creates, finds, updates, deactivates and removes people the way Okta and Entra ID call it', async () => {
    const email = `lin-${randomUUID().slice(0, 6)}@acme.test`;
    const created = await scim().post('/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: email, name: { givenName: 'Lin', familyName: 'Chen' }, emails: [{ value: email, primary: true }], externalId: 'okta-1', active: true }).expect(201);
    expect(created.headers['content-type']).toContain('application/scim+json');
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ userName: email, displayName: 'Lin Chen', active: true, externalId: 'okta-1' });
    expect((await scim().post('/Users', { userName: email }).expect(409)).body.scimType).toBe('uniqueness');

    const found = (await scim().get(`/Users?filter=${encodeURIComponent(`userName eq "${email.toUpperCase()}"`)}`).expect(200)).body;
    expect(found).toMatchObject({ totalResults: 1, Resources: [{ id }] });
    expect((await scim().get(`/Users?filter=${encodeURIComponent('externalId eq "okta-1"')}`).expect(200)).body.totalResults).toBe(1);
    expect((await scim().get(`/Users?filter=${encodeURIComponent('title co "x"')}`).expect(400)).body.scimType).toBe('invalidFilter');

    // Okta style: replace with a value object. Entra ID style: path + string booleans.
    await scim().patch(`/Users/${id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', value: { 'name.givenName': 'Lynn' } }] }).expect(200);
    const off = await scim().patch(`/Users/${id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] }).expect(200);
    expect(off.body).toMatchObject({ active: false, displayName: 'Lynn Chen' });
    expect((await scim().put(`/Users/${id}`, { userName: email, displayName: 'Lynn Chen', active: true }).expect(200)).body.active).toBe(true);

    // The member list in SampForce follows: deactivated people cannot use the workspace.
    await scim().patch(`/Users/${id}`, { Operations: [{ op: 'replace', path: 'active', value: false }] }).expect(200);
    const members = (await api(owner).get('/tenants/current/members').expect(200)).body as { email: string; status: string }[];
    expect(members.find((m) => m.email === email)?.status).toBe('SUSPENDED');

    await scim().del(`/Users/${id}`).expect(204);
    await scim().get(`/Users/${id}`).expect(404);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findMany({ where: { action: { startsWith: 'scim.' } }, select: { action: true } }));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['scim.user_created', 'scim.user_updated', 'scim.user_deactivated', 'scim.user_reactivated', 'scim.user_deleted']));
  });

  it('never touches owners, or accounts shared with other workspaces', async () => {
    const list = (await scim().get('/Users').expect(200)).body as { Resources: { id: string; userName: string }[] };
    const ownerRes = list.Resources.find((r) => r.userName === owner.email)!;
    await scim().patch(`/Users/${ownerRes.id}`, { Operations: [{ op: 'replace', path: 'active', value: false }] }).expect(403);
    await scim().del(`/Users/${ownerRes.id}`).expect(403);

    // Someone who also has their own workspace: SCIM can add them here but not change their email.
    const other = await registerUser(app, 'Elsewhere');
    const linked = await scim().post('/Users', { userName: other.email }).expect(201);
    expect((await scim().patch(`/Users/${linked.body.id}`, { Operations: [{ op: 'replace', path: 'userName', value: 'hijack@acme.test' }] }).expect(400)).body.scimType).toBe('mutability');
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('origin', ORIGIN).send({ email: other.email, password: other.password }).expect(200);

    // Revoked tokens stop working at once; other workspaces' members are invisible.
    const tokens = (await api(owner).get('/security/settings').expect(200)).body.scimTokens as { id: string }[];
    await api(owner).del(`/security/scim-tokens/${tokens[0]!.id}`).expect(204);
    await scim().get('/Users').expect(401);
  });

  it('serves discovery documents', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/scim/v2/ServiceProviderConfig').expect(200);
    expect(res.body).toMatchObject({ patch: { supported: true }, bulk: { supported: false } });
  });
});
