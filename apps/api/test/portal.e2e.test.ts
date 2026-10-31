import type { INestApplication } from '@nestjs/common';
import type { PortalDashboard, PortalMe, PortalRequest } from '@dealflow/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, asTenant, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

const PASSWORD = 'portal-pass-123';

/** Enhancement feature 11: the client self-service portal. */
describe('client portal', () => {
  let app: INestApplication;
  let owner: TestUser;
  let other: TestUser;
  const ids = {} as Record<'product' | 'book' | 'acme' | 'globex' | 'deal' | 'globexDeal' | 'quote' | 'globexQuote' | 'task' | 'privateTask', string>;
  const slug = `acme-${Date.now().toString(36)}`;

  function customer() {
    const agent = request.agent(app.getHttpServer());
    const p = (u: string) => `/api/v1/client-portal${u}`;
    return {
      agent,
      get: (u: string) => agent.get(p(u)),
      post: (u: string, body?: object) => agent.post(p(u)).set('origin', ORIGIN).send(body ?? {}),
      upload: (u: string, type: string, data: Buffer) => agent.post(p(u)).set('origin', ORIGIN).set('content-type', type).send(data),
    };
  }

  async function invite(companyId: string, email: string, role: 'viewer' | 'approver') {
    const res = (await api(owner).post('/portal/users', { companyId, email, name: email.split('@')[0], role }).expect(201)).body as { user: { id: string }; inviteUrl: string; emailed: boolean };
    return { ...res, token: new URL(res.inviteUrl).searchParams.get('token')! };
  }

  async function signedIn(companyId: string, email: string, role: 'viewer' | 'approver') {
    const { token, user } = await invite(companyId, email, role);
    const c = customer();
    expect((await c.post('/invitations/accept', { token, password: PASSWORD }).expect(201)).body.slug).toBe(slug);
    return { c, id: user.id };
  }

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Portal Seller');
    other = await registerUser(app, 'Other Seller');
    const o = api(owner);
    ids.product = (await o.post('/catalog/products', { name: 'Licence', unit: 'seat' }).expect(201)).body.id;
    const currency = (await o.get('/tenants/current').expect(200)).body.defaultCurrency ?? 'USD';
    ids.book = (await o.post('/catalog/price-books', { name: 'Standard', currency, isDefault: true }).expect(201)).body.id;
    await o.put(`/catalog/price-books/${ids.book}/prices/${ids.product}`, { unitPrice: 100 }).expect(204);
    const stage = (await o.get('/pipelines').expect(200)).body[0].stages[0];
    ids.acme = (await o.post('/companies', { name: 'Acme Buyer' }).expect(201)).body.id;
    ids.globex = (await o.post('/companies', { name: 'Globex Buyer' }).expect(201)).body.id;
    ids.deal = (await o.post('/deals', { name: 'Acme rollout', amount: 1000, stageId: stage.id, companyId: ids.acme }).expect(201)).body.id;
    ids.globexDeal = (await o.post('/deals', { name: 'Globex rollout', amount: 500, stageId: stage.id, companyId: ids.globex }).expect(201)).body.id;
    const q = (await o.post('/quotes', { opportunityId: ids.deal, title: 'Acme proposal', lines: [{ productId: ids.product, quantity: 5 }] }).expect(201)).body;
    ids.quote = q.id;
    await o.post(`/quotes/${q.id}/transition`, { action: 'submit' }).expect(200);
    await o.post(`/quotes/${q.id}/transition`, { action: 'mark_sent' }).expect(200);
    const gq = (await o.post('/quotes', { opportunityId: ids.globexDeal, title: 'Globex proposal', lines: [{ productId: ids.product, quantity: 1 }] }).expect(201)).body;
    ids.globexQuote = gq.id;
    await o.post(`/quotes/${gq.id}/transition`, { action: 'submit' }).expect(200);
    await o.post(`/quotes/${gq.id}/transition`, { action: 'mark_sent' }).expect(200);
    ids.task = (await o.post('/tasks', { title: 'Kick-off workshop', opportunityId: ids.deal }).expect(201)).body.id;
    ids.privateTask = (await o.post('/tasks', { title: 'Internal pricing review', opportunityId: ids.deal }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('needs setting up before anyone can be invited, and the address must be free', async () => {
    const o = api(owner);
    const s = (await o.get('/portal/settings').expect(200)).body;
    expect(s).toMatchObject({ enabled: false, updatedAt: null, allowApprovals: false });
    expect((await o.post('/portal/users', { companyId: ids.acme, email: 'x@acme.test', name: 'X', role: 'viewer' }).expect(409)).body.error.code).toBe('PORTAL_NOT_SET_UP');
    const body = { ...s, slug, enabled: true, title: 'Acme projects', allowApprovals: true };
    delete body.url;
    delete body.updatedAt;
    const saved = (await o.put('/portal/settings', body).expect(200)).body;
    expect(saved.url).toMatch(new RegExp(`/portal/${slug}$`));
    expect((await api(other).put('/portal/settings', { ...body, title: null }).expect(409)).body.error.code).toBe('PORTAL_SLUG_TAKEN');
    await o.put('/portal/settings', { ...body, slug: 'Bad Slug!' }).expect(400);
    const info = (await request(app.getHttpServer()).get(`/api/v1/client-portal/portals/${slug}`).expect(200)).body;
    expect(info).toMatchObject({ slug, title: 'Acme projects', seller: 'Portal Seller' });
    await request(app.getHttpServer()).get('/api/v1/client-portal/portals/no-such-portal').expect(404);
  });

  it('invites a customer, who sets a password and sees only their own company', async () => {
    const { c } = await signedIn(ids.acme, 'ana@acme.test', 'viewer');
    const me = (await c.get('/me').expect(200)).body as PortalMe;
    expect(me).toMatchObject({ user: { email: 'ana@acme.test', role: 'viewer' }, company: { id: ids.acme, name: 'Acme Buyer' } });
    const d = (await c.get('/dashboard').expect(200)).body as PortalDashboard;
    expect(d.deals.map((x) => x.name)).toEqual(['Acme rollout']);
    expect(d.proposals.map((x) => x.title)).toEqual(['Acme proposal']);
    expect(d.proposals[0]!.canDecide).toBe(false);
    expect(d.invoices).toBe('not_connected');
    // Another company's proposal is not reachable, even by id.
    await c.get(`/proposals/${ids.globexQuote}`).expect(404);
    expect((await c.get(`/proposals/${ids.quote}`).expect(200)).body.title).toBe('Acme proposal');
    // A portal session is not a workspace session.
    await c.agent.get('/api/v1/companies').expect(401);
  });

  it('shows only the tasks the team chose to share', async () => {
    const o = api(owner);
    const { c } = await signedIn(ids.acme, 'tom@acme.test', 'viewer');
    expect(((await c.get('/dashboard').expect(200)).body as PortalDashboard).milestones).toEqual([]);
    await o.put(`/portal/tasks/${ids.task}/visibility`, { visible: true }).expect(200);
    const ms = ((await c.get('/dashboard').expect(200)).body as PortalDashboard).milestones;
    expect(ms.map((m) => m.title)).toEqual(['Kick-off workshop']);
    const company = (await o.get(`/portal/companies/${ids.acme}`).expect(200)).body;
    expect(company.tasks.map((t: { title: string; portalVisible: boolean }) => [t.title, t.portalVisible])).toEqual(expect.arrayContaining([['Kick-off workshop', true], ['Internal pricing review', false]]));
  });

  it('lets only approvers approve, once, and tells the team', async () => {
    const { c: viewer } = await signedIn(ids.acme, 'vic@acme.test', 'viewer');
    expect((await viewer.post(`/proposals/${ids.quote}/decision`, { decision: 'accept' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    const { c } = await signedIn(ids.acme, 'boss@acme.test', 'approver');
    expect(((await c.get('/dashboard').expect(200)).body as PortalDashboard).proposals[0]!.canDecide).toBe(true);
    await c.post(`/proposals/${ids.globexQuote}/decision`, { decision: 'accept' }).expect(404);
    expect((await c.post(`/proposals/${ids.quote}/decision`, { decision: 'accept', note: 'Looks good' }).expect(201)).body.status).toBe('ACCEPTED');
    expect((await c.post(`/proposals/${ids.quote}/decision`, { decision: 'decline' }).expect(409)).body.error.code).toBe('ALREADY_DECIDED');
    const q = await asTenant(owner.tenantId, (tx) => tx.quote.findUniqueOrThrow({ where: { id: ids.quote } }));
    expect(q.status).toBe('ACCEPTED');
    expect(q.decisionNote).toBe('Looks good');
    expect(q.decidedByPortalUserId).not.toBeNull();
    const audit = (await api(owner).get('/audit-logs?limit=20').expect(200)).body.items as { action: string }[];
    expect(audit.map((a) => a.action)).toContain('portal.proposal_accepted');
  });

  it('runs a request from the customer to the team and back', async () => {
    const o = api(owner);
    const { c } = await signedIn(ids.acme, 'req@acme.test', 'viewer');
    const r = (await c.post('/requests', { subject: 'Need an extra seat', category: 'change_request', body: 'Can we add one more seat?' }).expect(201)).body as PortalRequest;
    expect(r).toMatchObject({ reference: expect.stringMatching(/^R-\d{4}$/), status: 'open', messages: [{ side: 'customer', body: 'Can we add one more seat?' }] });
    const inbox = (await o.get('/portal/requests?status=active').expect(200)).body as { id: string }[];
    expect(inbox.map((x) => x.id)).toContain(r.id);
    const replied = (await o.post(`/portal/requests/${r.id}/messages`, { body: 'Done, added.' }).expect(201)).body as PortalRequest;
    expect(replied.status).toBe('in_progress');
    await o.patch(`/portal/requests/${r.id}`, { status: 'resolved' }).expect(200);
    const seen = (await c.get(`/requests/${r.id}`).expect(200)).body as PortalRequest;
    expect(seen.messages.map((m) => m.side)).toEqual(['customer', 'team']);
    // A customer reply re-opens a resolved request; a closed one takes no replies.
    expect(((await c.post(`/requests/${r.id}/messages`, { body: 'One more thing' }).expect(201)).body as PortalRequest).status).toBe('open');
    await o.patch(`/portal/requests/${r.id}`, { status: 'closed' }).expect(200);
    expect((await c.post(`/requests/${r.id}/messages`, { body: 'Hello?' }).expect(409)).body.error.code).toBe('REQUEST_CLOSED');
    // Someone at another company cannot read it.
    const { c: g } = await signedIn(ids.globex, 'gus@globex.test', 'viewer');
    await g.get(`/requests/${r.id}`).expect(404);
    expect((await g.get('/requests').expect(200)).body).toEqual([]);
  });

  it('shares documents both ways with expiring links, and checks the file', async () => {
    const { c } = await signedIn(ids.acme, 'docs@acme.test', 'viewer');
    const up = (await c.upload('/documents?name=brief.txt', 'text/plain', Buffer.from('our brief')).expect(201)).body;
    expect(up).toMatchObject({ name: 'brief.txt', side: 'customer', sizeBytes: 9 });
    await c.upload('/documents?name=run.exe', 'application/x-msdownload', Buffer.from('MZ')).expect(400);
    await owner.agent.post(`/api/v1/portal/companies/${ids.acme}/documents?name=plan.pdf`).set('origin', ORIGIN).set('content-type', 'application/pdf').send(Buffer.from('%PDF-1.4 plan')).expect(201);
    const docs = (await c.get('/documents').expect(200)).body as { name: string; side: string; downloadUrl: string }[];
    expect(docs.map((d) => [d.name, d.side])).toEqual(expect.arrayContaining([['brief.txt', 'customer'], ['plan.pdf', 'team']]));
    const plan = docs.find((d) => d.name === 'plan.pdf')!;
    const dl = await request(app.getHttpServer()).get(plan.downloadUrl).expect(200);
    expect(dl.headers['content-disposition']).toContain('plan.pdf');
    expect(Buffer.from(dl.body as Buffer).toString()).toContain('%PDF-1.4 plan');
    await request(app.getHttpServer()).get(`${plan.downloadUrl}x`).expect(404);
    const { c: g } = await signedIn(ids.globex, 'gina@globex.test', 'viewer');
    expect((await g.get('/documents').expect(200)).body).toEqual([]);
  });

  it('locks after repeated wrong passwords, and a reset ends other sessions', async () => {
    const { c } = await signedIn(ids.acme, 'lock@acme.test', 'viewer');
    const fresh = customer();
    for (let i = 0; i < 5; i++) await fresh.post(`/portals/${slug}/login`, { email: 'lock@acme.test', password: 'wrong-password' }).expect(401);
    expect((await fresh.post(`/portals/${slug}/login`, { email: 'lock@acme.test', password: PASSWORD }).expect(401)).body.error.code).toBe('ACCOUNT_LOCKED');
    // Forgot-password answers the same for unknown emails.
    await fresh.post(`/portals/${slug}/password/forgot`, { email: 'nobody@acme.test' }).expect(202);
    await fresh.post(`/portals/${slug}/password/forgot`, { email: 'lock@acme.test' }).expect(202);
    // The email service is not configured in tests, so issue the reset token the way the service does and check reset.
    await c.get('/me').expect(200);
    const token = `${owner.tenantId}.reset-token-for-test-${Date.now()}`;
    const { createHash } = await import('node:crypto');
    await asTenant(owner.tenantId, (tx) => tx.portalUser.updateMany({ where: { email: 'lock@acme.test' }, data: { resetTokenHash: createHash('sha256').update(token).digest('hex'), resetExpiresAt: new Date(Date.now() + 60_000) } }));
    await fresh.post('/password/reset', { token, password: 'a-new-password-9' }).expect(204);
    await c.get('/me').expect(401);
    await fresh.post('/password/reset', { token, password: 'a-new-password-9' }).expect(400);
    await fresh.post(`/portals/${slug}/login`, { email: 'lock@acme.test', password: 'a-new-password-9' }).expect(204);
    await fresh.get('/me').expect(200);
  });

  it('disabling a person or the portal ends access at once', async () => {
    const o = api(owner);
    const { c, id } = await signedIn(ids.acme, 'gone@acme.test', 'viewer');
    await c.get('/me').expect(200);
    await o.patch(`/portal/users/${id}`, { status: 'disabled' }).expect(200);
    await c.get('/me').expect(401);
    const { c: c2 } = await signedIn(ids.acme, 'stay@acme.test', 'viewer');
    const s = (await o.get('/portal/settings').expect(200)).body;
    delete s.url;
    delete s.updatedAt;
    await o.put('/portal/settings', { ...s, enabled: false }).expect(200);
    await c2.get('/me').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/client-portal/portals/${slug}`).expect(404);
    await o.put('/portal/settings', { ...s, enabled: true }).expect(200);
    await c2.get('/me').expect(200);
  });

  it('keeps one workspace out of another', async () => {
    const x = api(other);
    await x.get(`/portal/companies/${ids.acme}`).expect(404);
    expect((await x.get('/portal/requests').expect(200)).body).toEqual([]);
    expect((await x.get('/portal/users').expect(200)).body).toEqual([]);
    await x.post('/portal/users', { companyId: ids.acme, email: 'sneak@acme.test', name: 'Sneak', role: 'approver' }).expect((r) => expect([404, 409]).toContain(r.status));
    const users = await asTenant(owner.tenantId, (tx) => tx.portalUser.findMany({ where: { email: 'sneak@acme.test' } }));
    expect(users).toEqual([]);
  });
});
