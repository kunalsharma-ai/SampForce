import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EnquiryConvertResult, EnquiryDetail, EnquiryPage, EnquirySummary } from '@dealflow/types';
import { API_ENV } from '../src/common/env';
import { PasswordService } from '../src/auth/password.service';
import { WebsiteEnquirySync } from '../src/website-enquiries/website-enquiry-sync.service';
import { delivery, startWebsiteFixture, WEBSITE_KEY, WEBSITE_SECRET, type WebsiteFixture } from './fixtures/website-fixture';
import { api, appClient, asTenant, inviteMember, ORIGIN, registerUser, startApp, type TestUser } from './helpers';

/**
 * Website Enquiry (ADR 0095) against a stand-in of the company website's Sampforce API: the signed webhook, the pull
 * sync, the section's counts and filters, opening, status write-back, conversion into a company and employee, and the
 * Console set-up. Website Visitors (ADR 0029) is gone.
 */

function setEnv(vars: Record<string, string | undefined>): () => void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => setEnv(saved);
}

const slugOf = async (u: TestUser) => (await asTenant(u.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: u.tenantId }, select: { slug: true } }))).slug;
const grant = (u: TestUser) =>
  asTenant(u.tenantId, (tx) => tx.tenantFeatureOverride.upsert({ where: { tenantId_feature: { tenantId: u.tenantId, feature: 'website_enquiries' } }, create: { tenantId: u.tenantId, feature: 'website_enquiries', enabled: true, reason: 'test', updatedBy: 'test' }, update: { enabled: true } }));
const resetSync = async () => {
  const db = appClient();
  await db.platformSetting.deleteMany({ where: { key: { in: ['website_enquiries:sync', 'webhook_receipt:website'] } } });
  await db.$disconnect();
};

describe('Website Enquiry', () => {
  let app: INestApplication;
  let site: WebsiteFixture;
  let owner: TestUser;
  let other: TestUser;
  let restore: () => void;
  const hook = (d: { raw: string; headers: Record<string, string> }) => request(app.getHttpServer()).post('/api/v1/hooks/website-enquiries').set(d.headers).send(d.raw);
  const summary = async (u = owner) => (await api(u).get('/website-enquiries/summary').expect(200)).body as EnquirySummary;
  const list = async (qs = '', u = owner) => (await api(u).get(`/website-enquiries${qs}`).expect(200)).body as EnquiryPage;
  const sync = () => app.get(WebsiteEnquirySync);

  beforeAll(async () => {
    site = await startWebsiteFixture();
    await resetSync();
    restore = setEnv({ WEBSITE_API_BASE_URL: site.url, WEBSITE_API_KEY: WEBSITE_KEY, WEBSITE_WEBHOOK_SECRET: WEBSITE_SECRET, WEBSITE_ENQUIRY_WORKSPACE: undefined, PUBLIC_WEB_URL: 'https://crm.sampforce.test' });
    app = await startApp();
    owner = await registerUser(app, 'Frequent Research');
    other = await registerUser(app, 'Somebody Else');
    // The receiving workspace is named once it exists, as the Console would (an environment value here).
    (app.get(API_ENV) as Record<string, unknown>).WEBSITE_ENQUIRY_WORKSPACE = await slugOf(owner);
    await grant(owner);
  });

  afterAll(async () => {
    await app?.close();
    await site.close();
    await resetSync();
    restore();
  });

  it('the old Website Visitors API is gone and the section needs its feature', async () => {
    await api(owner).get('/visitors/settings').expect(404);
    await request(app.getHttpServer()).get('/api/v1/public/track/script.js').expect(404);
    // Not granted: the section is refused as outside the plan.
    expect((await api(other).get('/website-enquiries/summary').expect(403)).body.error.code).toBe('FEATURE_NOT_IN_PLAN');
    const s = await summary();
    expect(s).toMatchObject({ connected: true, total: 0, unread: 0, sync: { configured: true, lastDelivery: null } });
  });

  it('refuses unsigned, wrongly signed and replayed deliveries, and records why', async () => {
    const lead = site.lead();
    await hook({ raw: JSON.stringify({ id: 'evt_x', event: 'lead.created', data: lead }), headers: { 'content-type': 'application/json' } }).expect(401);
    await hook(delivery('lead.created', lead, { secret: 'not-the-secret-at-all-000000' })).expect(401);
    await hook(delivery('lead.created', lead, { t: Math.floor(Date.now() / 1000) - 600 })).expect(401);
    const s = await summary();
    expect(s.total).toBe(0);
    expect(s.sync.lastRefused?.reason).toMatch(/signature/i);
    site.leads.delete(lead.id);
  });

  it('a signed lead.created arrives at once, highlighted as new, and notifies the team', async () => {
    const member = await inviteMember(app, owner, 'member');
    const lead = site.lead({ id: 'l_3f9a2c71b0de', category: 'rfq', contact: { email: 'Asha.Rao@Acme-Pharma.test' } });
    expect((await hook(delivery('ping', { id: 'test', message: 'hello' })).expect(200)).body).toEqual({ ok: true, received: false });
    expect((await hook(delivery('lead.created', lead)).expect(200)).body).toEqual({ ok: true, received: true });
    // A retry of the same delivery is harmless.
    await hook(delivery('lead.created', lead)).expect(200);
    const s = await summary();
    expect(s).toMatchObject({ total: 1, unread: 1, today: 1, week: 1 });
    expect(s.byType.find((t) => t.key === 'enquiry')).toMatchObject({ count: 1, unread: 1 });
    expect(s.byCategory.find((c) => c.key === 'rfq')).toMatchObject({ count: 1, unread: 1 });
    expect(s.byForm[0]).toMatchObject({ label: "Let's Talk", count: 1 });
    expect(s.latest[0]).toMatchObject({ externalId: 'l_3f9a2c71b0de', unread: true, name: 'Asha Rao', email: 'asha.rao@acme-pharma.test', company: 'Acme Pharma', countryCode: 'IN', phone: '+91 9810000000', source: 'webhook' });
    expect(s.sync.lastDelivery?.event).toBe('ping');
    const notes = (await api(member).get('/notifications?limit=20').expect(200)).body as { items: { type: string; title: string; link: string; priority: string | null }[] };
    expect(notes.items.find((n) => n.type === 'website_enquiry.received')).toMatchObject({ title: 'New website enquiry from Asha Rao', priority: 'HIGH' });
    // The other workspace never sees it.
    expect(await asTenant(other.tenantId, (tx) => tx.websiteEnquiry.count({ where: { tenantId: other.tenantId } }))).toBe(0);
  });

  it('opening one marks it seen for everyone; it can be marked unread again', async () => {
    const [row] = (await list()).items;
    const d = (await api(owner).get(`/website-enquiries/${row!.id}`).expect(200)).body as EnquiryDetail;
    expect(d).toMatchObject({ unread: false, timeline: 'Within 1 month', message: 'We need 500 completes with doctors in India.', page: 'https://www.frequentresearch.test/contact', seen: { by: expect.any(String) } });
    expect(d.fields).toEqual([{ label: 'Budget', value: 'USD 5,000 - 10,000' }]);
    expect(d.matches).toEqual({ contact: null, company: null });
    expect((await summary()).unread).toBe(0);
    await api(owner).post(`/website-enquiries/${row!.id}/unread`, {}).expect(200);
    expect((await summary()).unread).toBe(1);
    expect((await api(owner).post('/website-enquiries/seen', {}).expect(200)).body).toEqual({ updated: 1 });
  });

  it('the pull sync imports everything the first time, then only what changed, without duplicates', async () => {
    site.lead({ type: 'download', category: 'download', form: { key: 'resource-download', name: 'Resource download form' }, contact: { name: 'Ben Ode', email: 'ben@globex.test', company: 'Globex' }, enquiry: { resource: 'Healthcare panel book', message: '' } });
    site.lead({ type: 'chat', category: 'chat', form: { key: 'chat', name: 'Live chat' }, contact: { name: 'Chi Wu', email: 'chi@gmail.com', company: '' }, enquiry: { interest: 'B2B panels', message: 'Hi, do you have panels in Vietnam?' } });
    site.contacts.set('nia@example.test', { id: 'nia@example.test', object: 'contact', email: 'nia@example.test', name: 'Nia Kapoor', subscribed: true, subscribedAt: new Date().toISOString(), forms: ['newsletter'], sources: ['newsletter'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    site.reviews.set('r_5b1e0f2a9c33', { id: 'r_5b1e0f2a9c33', object: 'review', status: 'published', rating: 5, review: 'Great field team, on time.', services: ['Online surveys'], reply: '', contact: { name: 'Rae Kumar', email: 'rae@client.test', company: 'Client Co', country: 'IN' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const first = await sync().syncNow(owner.tenantId);
    expect(first).toMatchObject({ ran: true, ok: true, received: 4 });
    expect(site.calls.filter((c) => c.startsWith('GET /leads'))[0]).not.toContain('updatedSince');
    expect(site.calls.some((c) => c.startsWith('GET /contacts') && c.includes('source=newsletter'))).toBe(true);
    let s = await summary();
    expect(s.total).toBe(5);
    expect(Object.fromEntries(s.byType.map((t) => [t.key, t.count]))).toMatchObject({ enquiry: 1, download: 1, chat: 1, newsletter: 1, review: 1 });
    expect(s.averageRating).toBe(5);
    expect(s.sync.lastPull).toMatchObject({ ok: true, received: 4 });
    // The first import is history: no notification per old lead.
    const owned = (await api(owner).get('/notifications?limit=50').expect(200)).body as { items: { type: string }[] };
    expect(owned.items.filter((n) => n.type.startsWith('website_enquiry.')).length).toBe(1);

    // Next pass: only changes, by updatedSince.
    site.calls.length = 0;
    const later = site.lead({ contact: { name: 'Dev Patel', email: 'dev@initech.test', company: 'Initech' }, createdAt: new Date(Date.now() + 1000).toISOString() });
    const second = await sync().syncNow(owner.tenantId);
    expect(second).toMatchObject({ ok: true, received: 1 });
    expect(site.calls.find((c) => c.startsWith('GET /leads'))).toContain('updatedSince=');
    s = await summary();
    expect(s.total).toBe(6);
    expect((await api(owner).get('/notifications?limit=50').expect(200)).body.items.some((n: { title: string }) => n.title === 'New website enquiry from Dev Patel')).toBe(true);
    // The webhook for the same lead after the pull changes nothing.
    await hook(delivery('lead.created', later)).expect(200);
    expect((await summary()).total).toBe(6);
  });

  it('filters by view, type, category, status, form and search', async () => {
    expect((await list('?type=download')).items.map((r) => r.name)).toEqual(['Ben Ode']);
    expect((await list('?category=chat,download')).total).toBe(2);
    expect((await list('?form=Live%20chat')).items[0]).toMatchObject({ name: 'Chi Wu', type: 'chat', resource: 'B2B panels' });
    expect((await list('?q=vietnam')).items.map((r) => r.name)).toEqual(['Chi Wu']);
    expect((await list('?q=GLOBEX')).total).toBe(1);
    expect((await list('?view=unread')).total).toBe(5);
    // Sign-ups and reviews have a SampForce status too.
    expect((await list('?status=new')).total).toBe(6);
    await api(owner).get('/website-enquiries?type=nonsense').expect(400);
  });

  it('a status change goes back to the website, retrying while it is down, and an update there comes back', async () => {
    const row = (await list('?q=initech')).items[0]!;
    const member = await inviteMember(app, owner, 'member');
    site.failPatches(1);
    let d = (await api(member).patch(`/website-enquiries/${row.id}`, { status: 'contacted', stage: 'Call booked', note: 'Call on Monday', assigneeId: member.userId }).expect(200)).body as EnquiryDetail;
    expect(d).toMatchObject({ status: 'contacted', stage: 'Call booked', note: 'Call on Monday', assignee: { id: member.userId }, unread: false });
    // The first try answered 503: it waits for the next one.
    await new Promise((r) => setTimeout(r, 300));
    d = (await api(owner).get(`/website-enquiries/${row.id}`).expect(200)).body;
    expect(d.writeBack).toMatchObject({ state: 'waiting', error: expect.stringMatching(/503/) });
    await asTenant(owner.tenantId, (tx) => tx.websiteEnquiry.update({ where: { id: row.id }, data: { writeBackAt: new Date(Date.now() - 1000) } }));
    expect(await sync().flushWriteBacks(owner.tenantId)).toBe(1);
    const patch = site.patches.at(-1)!;
    expect(patch).toMatchObject({ id: row.externalId, body: { status: 'contacted', stage: 'Call booked', note: 'Call on Monday', sampforceId: row.id, url: `https://crm.sampforce.test/app/website-enquiries?open=${row.id}`, owner: expect.any(String) } });
    d = (await api(owner).get(`/website-enquiries/${row.id}`).expect(200)).body;
    expect(d.writeBack.state).toBe('sent');
    // The website team marks it won there: lead.updated brings the new status in.
    const web = site.leads.get(row.externalId)!;
    web.status = 'won';
    web.adminNote = 'Signed by phone';
    web.updatedAt = new Date(Date.now() + 5000).toISOString();
    await hook(delivery('lead.updated', web)).expect(200);
    d = (await api(owner).get(`/website-enquiries/${row.id}`).expect(200)).body;
    expect(d).toMatchObject({ status: 'won', websiteNote: 'Signed by phone', stage: 'Call booked' });
    // An older copy arriving late never overwrites it.
    await hook(delivery('lead.updated', { ...web, status: 'new', updatedAt: new Date(Date.now() - 60_000).toISOString() })).expect(200);
    expect(((await api(owner).get(`/website-enquiries/${row.id}`).expect(200)).body as EnquiryDetail).status).toBe('won');
    // Viewers read but cannot change.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).get(`/website-enquiries/${row.id}`).expect(200);
    await api(viewer).patch(`/website-enquiries/${row.id}`, { status: 'lost' }).expect(403);
    await api(owner).patch(`/website-enquiries/${row.id}`, { status: 'maybe' }).expect(400);
    await api(owner).patch(`/website-enquiries/${row.id}`, { assigneeId: randomUUID() }).expect(400);
  });

  it('a key without leads:write stops the write-back with the reason instead of retrying', async () => {
    const row = (await list('?q=globex')).items[0]!;
    site.scopes = ['leads:read', 'contacts:read', 'reviews:read'];
    await api(owner).patch(`/website-enquiries/${row.id}`, { status: 'contacted' }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    await sync().flushWriteBacks(owner.tenantId);
    const d = (await api(owner).get(`/website-enquiries/${row.id}`).expect(200)).body as EnquiryDetail;
    expect(d.writeBack).toMatchObject({ state: 'failed', error: expect.stringMatching(/right/) });
    site.scopes = ['leads:read', 'contacts:read', 'reviews:read', 'leads:write'];
  });

  it('converts into a new company and employee, then finds them again for a second enquiry', async () => {
    const asha = (await list('?q=acme')).items[0]!;
    const res = (await api(owner).post(`/website-enquiries/${asha.id}/convert`, {}).expect(200)).body as EnquiryConvertResult;
    expect(res.created).toEqual({ company: true, contact: true });
    expect(res.company?.name).toBe('Acme Pharma');
    expect(res.contact?.name).toBe('Asha Rao');
    expect(res.enquiry).toMatchObject({ status: 'qualified', converted: { company: { name: 'Acme Pharma' }, contact: { name: 'Asha Rao' } } });
    const contact = (await api(owner).get(`/contacts/${res.contact!.id}`).expect(200)).body as { email: string; phone: string; jobTitle: string; country: string; company: { id: string } };
    expect(contact).toMatchObject({ email: 'asha.rao@acme-pharma.test', jobTitle: 'Insights Manager', country: 'IN', company: { id: res.company!.id } });
    const company = (await api(owner).get(`/companies/${res.company!.id}`).expect(200)).body as { name: string; website: string };
    expect(company.website).toBe('https://acme-pharma.test');
    // The employee's card lists the enquiry.
    expect(((await api(owner).get(`/website-enquiries/record?contactId=${res.contact!.id}`).expect(200)).body as { id: string }[]).map((r) => r.id)).toEqual([asha.id]);

    // A second enquiry from the same person matches the employee and company instead of creating new ones.
    await hook(delivery('lead.created', site.lead({ contact: { email: 'asha.rao@acme-pharma.test' }, enquiry: { message: 'A second project.' } }))).expect(200);
    const second = (await list('?q=second%20project')).items[0]!;
    const d = (await api(owner).get(`/website-enquiries/${second.id}`).expect(200)).body as EnquiryDetail;
    expect(d.matches).toEqual({ contact: { id: res.contact!.id, name: 'Asha Rao', companyId: res.company!.id }, company: { id: res.company!.id, name: 'Acme Pharma' } });
    const again = (await api(owner).post(`/website-enquiries/${second.id}/convert`, {}).expect(200)).body as EnquiryConvertResult;
    expect(again.created).toEqual({ company: false, contact: false });
    expect(again.contact?.id).toBe(res.contact!.id);
    expect((await summary()).converted).toBe(2);
  });

  it('a chat lead with a free-mail address and no company asks for the company name', async () => {
    const chi = (await list('?q=chi%20wu')).items[0]!;
    expect((await api(owner).post(`/website-enquiries/${chi.id}/convert`, {}).expect(400)).body.error.details[0].path).toBe('companyName');
    const res = (await api(owner).post(`/website-enquiries/${chi.id}/convert`, { companyName: 'Wu Insights' }).expect(200)).body as EnquiryConvertResult;
    expect(res).toMatchObject({ company: { name: 'Wu Insights' }, contact: { name: 'Chi Wu' }, created: { company: true, contact: true } });
    // A member who cannot create companies cannot convert.
    const viewer = await inviteMember(app, owner, 'viewer');
    await api(viewer).post(`/website-enquiries/${chi.id}/convert`, {}).expect(403);
  });

  it('a review and a sign-up arrive by webhook with their own notifications', async () => {
    await hook(delivery('review.created', { id: 'r_new', object: 'review', status: 'pending', rating: 4, review: 'Quick quotes.', services: [], contact: { name: 'Lee Park', email: 'lee@park.test' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).expect(200);
    await hook(delivery('newsletter.subscribed', { id: 'zoe@news.test', object: 'contact', email: 'zoe@news.test', name: 'Zoe', subscribed: true, sources: ['newsletter'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).expect(200);
    // An event this release does not know is accepted so the website does not retry it forever.
    expect((await hook(delivery('lead.deleted', { id: 'l_x' })).expect(200)).body).toEqual({ ok: true, received: false });
    const titles = ((await api(owner).get('/notifications?limit=50').expect(200)).body.items as { title: string }[]).map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(['New review from Lee Park', 'New newsletter sign-up from Zoe']));
    expect((await list('?type=review')).items.map((r) => r.rating)).toEqual([4, 5]);
  });

  it('without a receiving workspace the webhook answers 503 so the website retries later', async () => {
    const env = app.get(API_ENV) as Record<string, unknown>;
    const was = env.WEBSITE_ENQUIRY_WORKSPACE;
    env.WEBSITE_ENQUIRY_WORKSPACE = 'no-such-workspace';
    try {
      expect((await hook(delivery('lead.created', site.lead())).expect(503)).body.error.code).toBe('PENDING_CONFIGURATION');
      expect((await summary()).connected).toBe(false);
      expect((await api(owner).post('/website-enquiries/sync', {}).expect(200)).body).toMatchObject({ ran: false });
    } finally {
      env.WEBSITE_ENQUIRY_WORKSPACE = was;
    }
  });
});

describe('Website enquiries in the operator Console', () => {
  let app: INestApplication;
  let site: WebsiteFixture;
  let restore: () => void;
  const email = `web-${randomUUID().slice(0, 8)}@platform.test`;
  const password = 'operator-password-1';

  beforeAll(async () => {
    site = await startWebsiteFixture();
    restore = setEnv({ OPERATOR_JWT_SECRET: 'operator-secret-that-is-at-least-32-chars', PUBLIC_WEB_URL: 'https://crm.sampforce.test', WEBSITE_API_BASE_URL: undefined, WEBSITE_API_KEY: undefined, WEBSITE_WEBHOOK_SECRET: undefined, WEBSITE_ENQUIRY_WORKSPACE: undefined, PROVIDER_KEYS_REFRESH_SECONDS: '1' });
    const db = appClient();
    await db.platformOperator.create({ data: { email, name: 'Web Admin', passwordHash: await new PasswordService().hash(password), role: 'ADMIN' } });
    await db.$disconnect();
    app = await startApp();
  });

  afterAll(async () => {
    const db = appClient();
    await db.platformSecret.deleteMany({ where: { name: { in: ['WEBSITE_API_BASE_URL', 'WEBSITE_API_KEY', 'WEBSITE_WEBHOOK_SECRET', 'WEBSITE_ENQUIRY_WORKSPACE'] } } });
    await db.platformSetting.deleteMany({ where: { key: 'provider_check:website_enquiries' } });
    await db.$disconnect();
    await app.close();
    await site.close();
    restore();
  });

  it('is set up from Providers: checks the workspace, switches the section on for it, and tests the key', async () => {
    const owner = await registerUser(app, 'Receiving Org');
    const slug = await slugOf(owner);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/operator/login').set('origin', ORIGIN).send({ email, password }).expect(200);
    const post = (u: string, b: object = {}) => agent.post(`/api/v1/operator${u}`).set('origin', ORIGIN).send(b);
    type Row = { key: string; state: string; setup: { urls: { label: string; url: string }[] }; webhook: { state: string } | null; lastCheck: { ok: boolean; message: string } | null; env: { name: string; input: string; hint: string | null }[] };
    const row = async () => ((await agent.get('/api/v1/operator/providers').expect(200)).body as Row[]).find((r) => r.key === 'website_enquiries')!;
    const r0 = await row();
    expect(r0).toMatchObject({ state: 'not_configured', webhook: { state: 'waiting' } });
    expect(r0.setup.urls[0]!.url).toBe('https://crm.sampforce.test/api/v1/hooks/website-enquiries');
    await api(owner).get('/website-enquiries/summary').expect(403);

    const bad = (await post('/providers/website_enquiries/keys', { values: { WEBSITE_API_KEY: 'nope', WEBSITE_ENQUIRY_WORKSPACE: 'missing-workspace' } }).expect(400)).body.error;
    expect(bad.details.map((d: { path: string }) => d.path)).toEqual(['values.WEBSITE_API_KEY', 'values.WEBSITE_ENQUIRY_WORKSPACE']);
    await post('/providers/website_enquiries/keys', { values: { WEBSITE_API_BASE_URL: `${site.url}/`, WEBSITE_API_KEY: WEBSITE_KEY, WEBSITE_WEBHOOK_SECRET: WEBSITE_SECRET, WEBSITE_ENQUIRY_WORKSPACE: slug.toUpperCase() } }).expect(200);
    // The section is on for that workspace now.
    const s = (await api(owner).get('/website-enquiries/summary').expect(200)).body as EnquirySummary;
    expect(s).toMatchObject({ connected: true, sync: { configured: true } });
    // The workspace's full name works too (any case); its web address name is what is stored.
    expect((await row()).env.find((f: { name: string }) => f.name === 'WEBSITE_ENQUIRY_WORKSPACE')).toMatchObject({ input: 'workspace', hint: slug });
    await post('/providers/website_enquiries/keys', { values: { WEBSITE_ENQUIRY_WORKSPACE: 'receiving org' } }).expect(200);
    expect((await row()).env.find((f: { name: string }) => f.name === 'WEBSITE_ENQUIRY_WORKSPACE')).toMatchObject({ hint: slug });
    const checked = (await post('/providers/website_enquiries/check').expect(200)).body as Row;
    expect(checked).toMatchObject({ state: 'verified', lastCheck: { ok: true, message: expect.stringContaining('"Sampforce production"') } });
    expect(checked.lastCheck!.message).toContain('Website Enquiry is on for Receiving Org.');
    // A section switched off for the receiving workspace is switched back on by Test connection.
    await asTenant(owner.tenantId, (tx) => tx.tenantFeatureOverride.deleteMany({ where: { tenantId: owner.tenantId, feature: 'website_enquiries' } }));
    await api(owner).get('/website-enquiries/summary').expect(403);
    const healed = (await post('/providers/website_enquiries/check').expect(200)).body as Row;
    expect(healed.lastCheck!.message).toContain('Website Enquiry was off for Receiving Org and is now switched on.');
    await api(owner).get('/website-enquiries/summary').expect(200);
    // The key is stored in the database, not shown back in full.
    const db = appClient();
    const stored = await db.platformSecret.findFirst({ where: { name: 'WEBSITE_API_KEY' } });
    await db.$disconnect();
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(WEBSITE_KEY);
    // A signed delivery turns the webhook status green.
    await request(app.getHttpServer()).post('/api/v1/hooks/website-enquiries').set(delivery('ping', { id: 'test' }).headers).send(delivery('ping', { id: 'test' }).raw);
    const d = delivery('ping', { id: 'test' });
    await request(app.getHttpServer()).post('/api/v1/hooks/website-enquiries').set(d.headers).send(d.raw).expect(200);
    expect((await row()).webhook?.state).toBe('verified');
  });
});
