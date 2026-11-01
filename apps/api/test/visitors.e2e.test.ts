import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VisitorsService } from '../src/visitors/visitors.service';
import { api, asTenant, inviteMember, registerUser, startApp, type TestUser } from './helpers';

const SITE = 'https://www.acme.test';
const DAY = 86_400_000;

/** Enhancement feature 15: consent-aware website visitor intelligence. */
describe('website visitor intelligence', () => {
  let app: INestApplication;
  let owner: TestUser;
  let member: TestUser & { userId: string };
  let other: TestUser;
  let siteKey: string;
  const ids: Record<string, string> = {};
  const visitor = randomUUID();
  const settings = {
    enabled: true,
    consentMode: 'opt_in',
    allowedDomains: ['www.acme.test', '*.acme-docs.test'],
    retentionDays: 90,
    createLeads: true,
    enquiryConsentText: 'Send me product news. I can unsubscribe at any time.',
    highIntentScore: 50,
    importantPages: [
      { pattern: '/pricing', label: 'Pricing', kind: 'pricing', weight: 20 },
      { pattern: '/demo', label: 'Book a demo', kind: 'demo', weight: 25 },
      { pattern: '/careers', label: 'Careers', kind: 'careers', weight: 0 },
    ],
  };
  const pub = () => request(app.getHttpServer());
  const collect = (body: object, origin = SITE, headers: Record<string, string> = {}) =>
    pub().post(`/api/v1/public/track/${siteKey}/collect`).set('origin', origin).set('content-type', 'text/plain').set(headers).send(JSON.stringify(body));
  const enquiry = (body: object, origin = SITE) => pub().post(`/api/v1/public/track/${siteKey}/enquiry`).set('origin', origin).set('content-type', 'text/plain').send(JSON.stringify(body));

  beforeAll(async () => {
    app = await startApp();
    owner = await registerUser(app, 'Visitors Co');
    other = await registerUser(app, 'Elsewhere Visitors');
    member = await inviteMember(app, owner, 'member');
    ids.owner = (await api(owner).get('/auth/me').expect(200)).body.user.id;
    ids.campaign = (await api(owner).post('/campaigns', { name: 'Autumn launch', channel: 'email', utmCampaign: 'autumn-launch' }).expect(201)).body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('is off by default, and only managers can turn it on for named websites', async () => {
    const s = (await api(member).get('/visitors/settings').expect(200)).body;
    expect(s).toMatchObject({ enabled: false, consentMode: 'opt_in', allowedDomains: [], retentionDays: 180 });
    expect(s.siteKey).toMatch(/^dfs_/);
    siteKey = s.siteKey;
    await pub().get(`/api/v1/public/track/${siteKey}/config`).set('origin', SITE).expect(404);
    await api(member).put('/visitors/settings', settings).expect(403);
    await api(owner).put('/visitors/settings', { ...settings, allowedDomains: [] }).expect(400);
    await api(owner).put('/visitors/settings', { ...settings, allowedDomains: ['https://acme.test/'] }).expect(400);
    const saved = (await api(owner).put('/visitors/settings', settings).expect(200)).body;
    expect(saved).toMatchObject({ enabled: true, allowedDomains: ['www.acme.test', '*.acme-docs.test'], siteKey });
  });

  it('serves the script and answers allowed websites only', async () => {
    const js = await pub().get('/api/v1/public/track/script.js').expect(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(js.text).toContain('globalPrivacyControl');
    const ok = await pub().get(`/api/v1/public/track/${siteKey}/config`).set('origin', SITE).expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe(SITE);
    expect(ok.body).toEqual({ enabled: true, consentMode: 'opt_in', enquiryConsentText: settings.enquiryConsentText });
    await pub().get(`/api/v1/public/track/${siteKey}/config`).set('origin', 'https://help.acme-docs.test').expect(200);
    const bad = await pub().get(`/api/v1/public/track/${siteKey}/config`).set('origin', 'https://evil.test').expect(403);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    await pub().get(`/api/v1/public/track/${siteKey}/config`).expect(403);
    await pub().get('/api/v1/public/track/dfs_notarealkey12345/config').set('origin', SITE).expect(404);
  });

  it('records page views, sessions, time on page and campaign source; drops privacy-signalled requests', async () => {
    const s1 = randomUUID();
    const first = await collect({ visitorId: visitor, sessionId: s1, events: [{ type: 'page', path: '/pricing', title: 'Pricing', referrer: 'news.example.org', utm: { source: 'newsletter', campaign: 'autumn-launch' } }] }).expect(200);
    expect(first.body).toEqual({ stored: 1 });
    expect(first.headers['access-control-allow-origin']).toBe(SITE);
    await collect({ visitorId: visitor, sessionId: s1, events: [{ type: 'engagement', path: '/pricing', engagedSeconds: 200 }, { type: 'page', path: '/careers/engineer' }] }).expect(200);
    await collect({ visitorId: visitor, sessionId: randomUUID(), events: [{ type: 'page', path: '/demo' }, { type: 'event', path: '/demo', name: 'calendar_opened' }] }).expect(200);

    expect((await collect({ visitorId: randomUUID(), sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }, SITE, { 'sec-gpc': '1' }).expect(200)).body).toEqual({ stored: 0 });
    expect((await collect({ visitorId: randomUUID(), sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }, SITE, { dnt: '1' }).expect(200)).body).toEqual({ stored: 0 });
    await collect({ visitorId: randomUUID(), sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }, 'https://evil.test').expect(403);
    await collect({ visitorId: 'not-a-uuid', sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }).expect(400);
    await collect({ visitorId: randomUUID(), sessionId: randomUUID(), events: [{ type: 'page', path: 'https://www.acme.test/?email=x@y.z' }] }).expect(400);

    const list = (await api(member).get('/visitors').expect(200)).body as { id: string; label: string; identified: unknown; visits: number; pageViews: number; engagedSeconds: number; intent: { score: number; high: boolean; signals: { label: string; points: number }[] }; campaign: { id: string } | null; firstTouch: object }[];
    expect(list).toHaveLength(1);
    const v = list[0]!;
    ids.visitor = v.id;
    expect(v).toMatchObject({ identified: null, visits: 2, pageViews: 3, engagedSeconds: 200, campaign: { id: ids.campaign }, firstTouch: { source: 'newsletter', campaign: 'autumn-launch', referrer: 'news.example.org' } });
    expect(v.label).toMatch(/^Anonymous visitor /);
    expect(v.intent.signals.map((x) => [x.label, x.points])).toEqual([
      ['Visited 2 times', 10],
      ['Viewed Book a demo', 25],
      ['Viewed Pricing', 20],
      ['3 minutes on the site', 10],
    ]);
    expect(v.intent).toMatchObject({ score: 65, high: true });
    // Anonymous visitors never trigger the high-intent workflow event.
    expect(await asTenant(owner.tenantId, (tx) => tx.domainEvent.count({ where: { type: 'visitor.high_intent' } }))).toBe(0);
  });

  it('turns an enquiry into a lead, links the visitor and signals high intent once', async () => {
    await enquiry({ visitorId: visitor, fullName: 'Rita Bot', email: 'rita@bot.test', website: 'http://spam' }).expect(400);
    await enquiry({ visitorId: visitor, fullName: 'Rita', email: 'nope' }).expect(400);
    const res = await enquiry({ visitorId: visitor, fullName: 'Rita Moreno', email: 'Rita@Globex.test', companyName: 'Globex', message: 'Can we see a demo for 40 seats?', consent: true, path: '/demo' }).expect(200);
    expect(res.body.message).toMatch(/Thank you/);
    expect(res.headers['access-control-allow-origin']).toBe(SITE);
    const leads = await asTenant(owner.tenantId, (tx) => tx.lead.findMany({ where: { email: 'rita@globex.test' } }));
    expect(leads).toHaveLength(1);
    ids.lead = leads[0]!.id;
    expect(leads[0]).toMatchObject({ fullName: 'Rita Moreno', source: 'Website', campaignId: ids.campaign, marketingConsent: 'OPTED_IN', consentSource: 'website enquiry' });
    const v = (await api(member).get(`/visitors/${ids.visitor}`).expect(200)).body;
    expect(v).toMatchObject({ label: 'Rita Moreno', identified: { type: 'lead', id: ids.lead }, identifiedVia: 'enquiry' });
    expect(v.intent.score).toBe(95);
    expect(v.sessions).toHaveLength(2);
    expect(v.sessions.flatMap((s: { events: { type: string; label: string | null; name: string | null }[] }) => s.events.map((e) => e.label ?? e.name ?? e.type))).toEqual(expect.arrayContaining(['Pricing', 'Book a demo', 'calendar_opened', 'enquiry']));
    const events = await asTenant(owner.tenantId, (tx) => tx.domainEvent.findMany({ where: { type: { in: ['visitor.high_intent', 'lead.created'] }, entityId: ids.lead } }));
    expect(events.map((e) => e.type).sort()).toEqual(['lead.created', 'visitor.high_intent']);
    // A second enquiry links to the same lead and does not signal again.
    await enquiry({ visitorId: visitor, fullName: 'Rita Moreno', email: 'rita@globex.test' }).expect(200);
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { email: { equals: 'rita@globex.test', mode: 'insensitive' } } }))).toBe(1);
    expect(await asTenant(owner.tenantId, (tx) => tx.domainEvent.count({ where: { type: 'visitor.high_intent' } }))).toBe(1);
    const record = (await api(member).get(`/visitors/record?type=lead&id=${ids.lead}`).expect(200)).body;
    expect(record.visitors.map((x: { id: string }) => x.id)).toEqual([ids.visitor]);
  });

  it('links an enquiry to an existing contact, notifies its owner and records consent only with consent text', async () => {
    const contact = (await api(owner).post('/contacts', { firstName: 'Hank', lastName: 'Scorpio', email: 'hank@globex.test' }).expect(201)).body;
    const v2 = randomUUID();
    const sid = randomUUID();
    for (const path of ['/pricing', '/demo', '/pricing/enterprise']) await collect({ visitorId: v2, sessionId: sid, events: [{ type: 'page', path }] }).expect(200);
    await enquiry({ visitorId: v2, fullName: 'Hank S', email: 'HANK@globex.test', message: 'Ready to talk', consent: true }).expect(200);
    const c = await asTenant(owner.tenantId, (tx) => tx.contact.findUniqueOrThrow({ where: { id: contact.id } }));
    expect(c.marketingConsent).toBe('OPTED_IN');
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { email: { equals: 'hank@globex.test', mode: 'insensitive' } } }))).toBe(0);
    const notes = ((await api(owner).get('/notifications').expect(200)).body.items as { type: string; title: string; link: string }[]).filter((n) => n.type === 'visitor.high_intent');
    expect(notes).toEqual([expect.objectContaining({ title: 'Hank Scorpio is showing high intent on your website', link: `/app/contacts/${contact.id}` })]);
    expect((await api(member).get(`/visitors/record?type=contact&id=${contact.id}`).expect(200)).body.visitors).toHaveLength(1);

    // Without consent text in settings, a ticked box records nothing.
    await api(owner).put('/visitors/settings', { ...settings, enquiryConsentText: null }).expect(200);
    await enquiry({ fullName: 'Nora', email: 'nora@initech.test', consent: true }).expect(200);
    const nora = await asTenant(owner.tenantId, (tx) => tx.lead.findFirstOrThrow({ where: { email: 'nora@initech.test' } }));
    expect(nora.marketingConsent).toBe('UNKNOWN');
    // Enquiries without tracking consent are kept, with no browsing history.
    expect((await api(member).get('/visitors?segment=identified&search=nora').expect(200)).body).toEqual([expect.objectContaining({ visits: 0, pageViews: 0, label: 'Nora' })]);
    await api(owner).put('/visitors/settings', settings).expect(200);
  });

  it('shows a dashboard with pages, sources, campaigns and high-intent visitors', async () => {
    const d = (await api(member).get('/visitors/dashboard?days=7').expect(200)).body;
    expect(d.totals).toMatchObject({ visitors: 2, visits: 3, pageViews: 6, identified: 2, enquiries: 4, leadsCreated: 2, returning: 1 });
    expect(d.daily).toHaveLength(7);
    expect(d.daily.at(-1)).toMatchObject({ visitors: 2, visits: 3, pageViews: 6 });
    expect(d.importantPages.map((p: { label: string; views: number }) => [p.label, p.views])).toEqual([
      ['Pricing', 3],
      ['Book a demo', 2],
      ['Careers', 1],
    ]);
    expect(d.sources).toEqual(expect.arrayContaining([{ source: 'newsletter', visits: 1 }, { source: 'Direct', visits: 2 }]));
    expect(d.campaigns).toEqual([{ campaign: { id: ids.campaign, name: 'Autumn launch' }, utmCampaign: 'autumn-launch', visits: 1, visitors: 1, leads: 1 }]);
    expect(d.highIntent.map((v: { label: string }) => v.label).sort()).toEqual(['Hank Scorpio', 'Rita Moreno']);
    await api(member).get('/visitors/dashboard?days=14').expect(400);
  });

  it('applies the retention period, erases a visitor on request and keeps workspaces apart', async () => {
    const old = randomUUID();
    await collect({ visitorId: old, sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }).expect(200);
    await asTenant(owner.tenantId, async (tx) => {
      const v = await tx.webVisitor.findFirstOrThrow({ where: { clientId: old } });
      const past = new Date(Date.now() - 120 * DAY);
      await tx.webVisitor.update({ where: { id: v.id }, data: { lastSeenAt: past } });
      await tx.webSession.updateMany({ where: { visitorId: v.id }, data: { lastAt: past } });
      await tx.webEvent.updateMany({ where: { visitorId: v.id }, data: { occurredAt: past } });
    });
    const deleted = await asTenant(owner.tenantId, (tx) => app.get(VisitorsService).applyRetention(tx, owner.tenantId));
    expect(deleted).toBe(3);
    expect(await asTenant(owner.tenantId, (tx) => tx.webVisitor.count({ where: { clientId: old } }))).toBe(0);
    expect(await app.get(VisitorsService).sweep(true)).toBeGreaterThanOrEqual(0);

    await api(other).get(`/visitors/${ids.visitor}`).expect(404);
    expect((await api(other).get('/visitors').expect(200)).body).toEqual([]);
    await api(member).del(`/visitors/${ids.visitor}`).expect(403);
    await api(owner).del(`/visitors/${ids.visitor}`).expect(204);
    await api(owner).get(`/visitors/${ids.visitor}`).expect(404);
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { id: ids.lead } }))).toBe(1);
    const audit = await asTenant(owner.tenantId, (tx) => tx.auditLog.findFirst({ where: { action: 'visitors.visitor_erased' } }));
    expect(audit?.metadata).toMatchObject({ leadId: ids.lead });

    const rotated = (await api(owner).post('/visitors/settings/rotate-key').expect(200)).body;
    expect(rotated.siteKey).not.toBe(siteKey);
    await pub().get(`/api/v1/public/track/${siteKey}/config`).set('origin', SITE).expect(404);
  });
});

describe('website enquiries: per-workspace daily ceiling', () => {
  let app: INestApplication;
  const saved = process.env.VISITOR_ENQUIRIES_PER_DAY;

  beforeAll(async () => {
    process.env.VISITOR_ENQUIRIES_PER_DAY = '2';
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env.VISITOR_ENQUIRIES_PER_DAY;
    else process.env.VISITOR_ENQUIRIES_PER_DAY = saved;
  });

  it('refuses enquiries past the daily ceiling even when each comes from a new address', async () => {
    const owner = await registerUser(app, 'Ceiling Co');
    const s = (await api(owner).put('/visitors/settings', { enabled: true, consentMode: 'opt_in', allowedDomains: ['www.acme.test'], retentionDays: 90, createLeads: true, enquiryConsentText: 'Send me news.', highIntentScore: 50, importantPages: [{ pattern: '/pricing', label: 'Pricing', kind: 'pricing', weight: 20 }] }).expect(200)).body;
    const pub = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1/public/track/${s.siteKey}/${path}`).set('origin', SITE).set('content-type', 'text/plain').send(JSON.stringify(body));
    const visitorId = randomUUID();
    await pub('collect', { visitorId, sessionId: randomUUID(), events: [{ type: 'page', path: '/' }] }).expect(200);
    // Two enquiries already today, from other addresses (as a distributed flood would be).
    await asTenant(owner.tenantId, async (tx) => {
      const v = await tx.webVisitor.findFirstOrThrow({ where: { clientId: visitorId } });
      await tx.webEvent.createMany({ data: ['a', 'b'].map((ipHash) => ({ tenantId: owner.tenantId, visitorId: v.id, type: 'enquiry', data: { ipHash } })) });
    });
    const res = await pub('enquiry', { visitorId, fullName: 'Late Larry', email: 'larry@late.test' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(await asTenant(owner.tenantId, (tx) => tx.lead.count({ where: { email: 'larry@late.test' } }))).toBe(0);
  });
});
