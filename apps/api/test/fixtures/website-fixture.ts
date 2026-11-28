import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for the company website's "Sampforce API" (ADR 0095), written from the website's guide
 * (docs/integrations/website-enquiries.md): GET /ping, /leads, /contacts, /reviews (paged, oldest first, `updatedSince`,
 * `nextCursor`), PATCH /leads/:id, and signed webhook deliveries. It is not the website's code and has not been run
 * against the real website.
 */
export const WEBSITE_KEY = 'sfk_test_Pu5oq3xxxxxxxxxxxxxxxxxxxxxxxxxxxx';
export const WEBSITE_SECRET = 'website-webhook-secret-0123456789abcdef';

export interface FixtureLead {
  id: string;
  object: 'lead';
  type: string;
  category: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  form: { key: string; name: string };
  contact: { name: string; firstName: string; lastName: string; email: string; phone: string; countryCode: string; country: string; company: string; designation: string };
  enquiry: { service: string; timeline: string; message: string; resource: string; title: string; interest: string };
  page: string;
  consent: boolean;
  extraFields: Record<string, string>;
  otherFields: Record<string, string>;
  owner: string;
  adminNote: string;
  sampforce: Record<string, unknown> | null;
}

export interface WebsiteFixture {
  url: string;
  leads: Map<string, FixtureLead>;
  contacts: Map<string, Record<string, unknown>>;
  reviews: Map<string, Record<string, unknown>>;
  /** Every request as "METHOD /path?query". */
  calls: string[];
  /** PATCH bodies by lead id. */
  patches: { id: string; body: Record<string, unknown> }[];
  scopes: string[];
  /** The next n PATCH calls answer 503. */
  failPatches(n: number): void;
  lead(over?: Partial<Omit<FixtureLead, 'contact' | 'enquiry' | 'form'>> & { contact?: Partial<FixtureLead['contact']>; enquiry?: Partial<FixtureLead['enquiry']>; form?: Partial<FixtureLead['form']> }): FixtureLead;
  close(): Promise<void>;
}

let seq = 0;
const iso = (d = new Date()) => d.toISOString();

export function sampleLead(over: Parameters<WebsiteFixture['lead']>[0] = {}): FixtureLead {
  seq++;
  const at = over.createdAt ?? iso();
  return {
    id: over.id ?? `l_${(Date.now() + seq).toString(16)}${seq}`,
    object: 'lead',
    type: over.type ?? 'enquiry',
    category: over.category ?? 'service',
    status: over.status ?? 'new',
    createdAt: at,
    updatedAt: over.updatedAt ?? at,
    form: { key: 'lets-talk', name: "Let's Talk", ...over.form },
    contact: { name: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', email: 'asha.rao@acme-pharma.test', phone: '9810000000', countryCode: '+91', country: 'India', company: 'Acme Pharma', designation: 'Insights Manager', ...over.contact },
    enquiry: { service: 'Market Research: Online surveys', timeline: 'Within 1 month', message: 'We need 500 completes with doctors in India.', resource: '', title: '', interest: '', ...over.enquiry },
    page: over.page ?? 'https://www.frequentresearch.test/contact',
    consent: over.consent ?? false,
    extraFields: over.extraFields ?? { Budget: 'USD 5,000 - 10,000' },
    otherFields: over.otherFields ?? {},
    owner: over.owner ?? '',
    adminNote: over.adminNote ?? '',
    sampforce: over.sampforce ?? null,
  };
}

/** A signed delivery as the website sends it: the raw body and its headers. */
export function delivery(event: string, data: unknown, opts: { secret?: string; t?: number; id?: string } = {}): { raw: string; headers: Record<string, string> } {
  const id = opts.id ?? `evt_${Math.random().toString(16).slice(2, 14)}`;
  const raw = JSON.stringify({ id, event, createdAt: iso(), attempt: 1, data });
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', opts.secret ?? WEBSITE_SECRET).update(`${t}.${raw}`).digest('hex');
  return { raw, headers: { 'content-type': 'application/json', 'user-agent': 'FR-Website-Sampforce/1', 'x-sampforce-event': event, 'x-sampforce-delivery': id, 'x-sampforce-signature': `t=${t},v1=${v1}` } };
}

function page<T extends { updatedAt?: unknown; createdAt?: unknown }>(all: T[], q: URLSearchParams) {
  const since = q.get('updatedSince');
  const limit = Math.min(Number(q.get('limit') ?? 100), 500);
  const start = Number(q.get('cursor') ?? 0);
  const list = all
    .filter((x) => !since || String(x.updatedAt ?? x.createdAt) >= new Date(since).toISOString())
    .sort((a, b) => String(a.updatedAt ?? a.createdAt).localeCompare(String(b.updatedAt ?? b.createdAt)));
  const data = list.slice(start, start + limit);
  const more = start + limit < list.length;
  return { ok: true, count: data.length, hasMore: more, nextCursor: more ? String(start + limit) : null, data };
}

export async function startWebsiteFixture(port = 0): Promise<WebsiteFixture> {
  const leads = new Map<string, FixtureLead>();
  const contacts = new Map<string, Record<string, unknown>>();
  const reviews = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const patches: { id: string; body: Record<string, unknown> }[] = [];
  let failing = 0;
  const fx = { scopes: ['leads:read', 'contacts:read', 'reviews:read', 'leads:write'] };
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const path = u.pathname.replace(/^\/api\/v1\/sampforce/, '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    // For browser tests: health, adding a lead as the website would, and what SampForce sent back (no key needed; not part of the website's API).
    if (path === '/health') return send(200, { ok: true });
    if (path === '/__patches') return send(200, patches);
    if (path === '/__leads' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
      req.on('end', () => {
        const l = JSON.parse(raw || '{}') as FixtureLead;
        leads.set(l.id, l);
        send(201, { ok: true });
      });
      return;
    }
    calls.push(`${req.method} ${path}${u.search}`);
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${WEBSITE_KEY}` && req.headers['x-api-key'] !== WEBSITE_KEY) return send(401, { ok: false, error: 'Invalid API key.' });
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      if (req.method === 'GET' && path === '/ping') return send(200, { ok: true, key: { name: 'Sampforce production', prefix: 'sfk_test_P', scopes: fx.scopes }, time: iso(), version: 'v1' });
      if (req.method === 'GET' && path === '/leads') return send(200, page([...leads.values()], u.searchParams));
      if (req.method === 'GET' && path === '/contacts') {
        const src = u.searchParams.get('source');
        return send(200, page([...contacts.values()].filter((c) => !src || (c.sources as string[] | undefined)?.includes(src)), u.searchParams));
      }
      if (req.method === 'GET' && path === '/reviews') return send(200, page([...reviews.values()], u.searchParams));
      const m = /^\/leads\/([^/]+)$/.exec(path);
      if (m && req.method === 'PATCH') {
        if (!fx.scopes.includes('leads:write')) return send(403, { ok: false, error: 'This key lacks leads:write.' });
        if (failing > 0) {
          failing--;
          return send(503, { ok: false, error: 'Busy.' });
        }
        const lead = leads.get(decodeURIComponent(m[1]!));
        if (!lead) return send(404, { ok: false, error: 'No such lead.' });
        const b = JSON.parse(body || '{}') as Record<string, unknown>;
        if (b.status && !['new', 'contacted', 'qualified', 'won', 'lost', 'spam'].includes(String(b.status))) return send(422, { ok: false, error: 'Unknown status.' });
        patches.push({ id: lead.id, body: b });
        if (b.status) lead.status = String(b.status);
        lead.sampforce = { ...b, updated: iso() };
        lead.updatedAt = iso();
        return send(200, { ok: true, data: lead });
      }
      return send(404, { ok: false, error: 'Not found.' });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/sampforce`;
  return {
    url,
    leads,
    contacts,
    reviews,
    calls,
    patches,
    get scopes() {
      return fx.scopes;
    },
    set scopes(v: string[]) {
      fx.scopes = v;
    },
    failPatches: (n) => void (failing = n),
    lead(over = {}) {
      const l = sampleLead(over);
      leads.set(l.id, l);
      return l;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A few weeks of history, so the first import has something to bring in (browser tests and previews). */
export function seedHistory(fx: WebsiteFixture): void {
  const day = 86_400_000;
  const at = (daysAgo: number, h = 10) => new Date(Date.now() - daysAgo * day - h * 3_600_000).toISOString();
  fx.lead({ createdAt: at(1), category: 'rfq', contact: { name: 'Meera Iyer', firstName: 'Meera', lastName: 'Iyer', email: 'meera.iyer@novacare.test', company: 'NovaCare Health', designation: 'Head of Insights' }, enquiry: { service: 'Healthcare research: Physician surveys', message: 'Looking for a quote: 300 oncologists across India and the UAE, 20-minute online survey, fieldwork in January.' }, extraFields: { Budget: 'USD 10,000 - 25,000', 'Sample size': '300' } });
  fx.lead({ createdAt: at(2), type: 'download', category: 'download', form: { key: 'case-study', name: 'Case study download' }, contact: { name: 'Tom Becker', firstName: 'Tom', lastName: 'Becker', email: 'tom.becker@marktblick.test', company: 'Marktblick GmbH', country: 'Germany', countryCode: '+49', phone: '1701234567' }, enquiry: { resource: 'B2B panel quality case study', message: '' } });
  fx.lead({ createdAt: at(3), type: 'chat', category: 'chat', form: { key: 'chat', name: 'Live chat' }, contact: { name: 'Lina Haddad', firstName: 'Lina', lastName: 'Haddad', email: 'lina.haddad@gmail.com', company: '', country: 'United Arab Emirates', countryCode: '+971', phone: '501234567' }, enquiry: { interest: 'Consumer panels in the GCC', message: 'Do you have panels in Saudi Arabia and Qatar?' } });
  fx.lead({ createdAt: at(5), category: 'partnership', form: { key: 'partner', name: 'Partner with us' }, contact: { name: 'Daniel Ortiz', firstName: 'Daniel', lastName: 'Ortiz', email: 'daniel@panelhub.test', company: 'PanelHub', country: 'Spain', countryCode: '+34', phone: '612345678' }, enquiry: { service: 'Panel partnership', message: 'We run a 200k consumer panel in Spain and would like to partner.' }, status: 'contacted' });
  fx.lead({ createdAt: at(8), type: 'resource-download', category: 'download', form: { key: 'resource', name: 'Resource download' }, contact: { name: 'Grace Lee', firstName: 'Grace', lastName: 'Lee', email: 'grace.lee@brightpath.test', company: 'BrightPath Consulting', country: 'Singapore', countryCode: '+65', phone: '81234567' }, enquiry: { resource: 'Global panel book 2026', message: '' } });
  fx.lead({ createdAt: at(11), contact: { name: 'Arjun Mehta', firstName: 'Arjun', lastName: 'Mehta', email: 'arjun.mehta@finsight.test', company: 'FinSight Analytics' }, enquiry: { service: 'Market research: B2B IT decision makers', message: 'Need 150 CIO interviews in the US.' }, status: 'qualified' });
  for (const [i, c] of [
    ['priya.nair@outlook.com', 'Priya Nair', 2],
    ['sam.wilson@acmeretail.test', 'Sam Wilson', 6],
  ].entries()) {
    const [email, name, days] = c as [string, string, number];
    fx.contacts.set(email, { id: email, object: 'contact', email, name, subscribed: true, subscribedAt: at(days, i), forms: ['newsletter'], sources: ['newsletter'], createdAt: at(days, i), updatedAt: at(days, i) });
  }
  fx.reviews.set('r_seed_1', { id: 'r_seed_1', object: 'review', status: 'published', rating: 5, review: 'Excellent field team, delivered 1,200 completes ahead of schedule.', services: ['Online surveys'], reply: '', contact: { name: 'Hannah Clarke', email: 'hannah.clarke@insightly.test', company: 'Insightly UK', country: 'United Kingdom' }, createdAt: at(4), updatedAt: at(4) });
  fx.reviews.set('r_seed_2', { id: 'r_seed_2', object: 'review', status: 'published', rating: 4, review: 'Quick turnaround on our physician study.', services: ['Healthcare research'], reply: '', contact: { name: 'Omar Farouk', email: 'omar@medisurvey.test', company: 'MediSurvey', country: 'Egypt' }, createdAt: at(9), updatedAt: at(9) });
}

// Run on its own (Playwright): `tsx test/fixtures/website-fixture.ts`, port from WEBSITE_FIXTURE_PORT, with seeded history.
if (process.argv[1]?.endsWith('website-fixture.ts')) {
  void startWebsiteFixture(Number(process.env.WEBSITE_FIXTURE_PORT ?? 4980)).then((f) => {
    seedHistory(f);
    console.warn(`Website fixture on ${f.url}`);
  });
}
