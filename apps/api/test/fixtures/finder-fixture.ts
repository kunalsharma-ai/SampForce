import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in internet for the email finder: a few made-up company websites, their mail-server records, and
 * Hunter.io's Domain Search and Email Finder response shapes. The API reaches it through FINDER_FIXTURE_URL
 * (pages as /site/<host>/<path>, MX as /mx/<domain>) and HUNTER_API_BASE_URL (/hunter). Nothing here is real.
 */
const page = (title: string, body: string, site?: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${site ? `<meta property="og:site_name" content="${site}">` : ''}</head><body>${body}</body></html>`;

export const FINDER_SITES: Record<string, Record<string, string>> = {
  'kestrel-analytics.com': {
    '/': page('Kestrel Analytics | Research consultancy', '<h1>Kestrel Analytics</h1><p>Made-up research consultancy.</p><a href="/our-people">Our people</a> <a href="/contact">Contact</a>', 'Kestrel Analytics'),
    '/our-people': page('Our people | Kestrel Analytics', '<h2>Leadership</h2><p><a href="mailto:priya.raman@kestrel-analytics.com">Priya Raman</a>, Managing Director</p><p><a href="mailto:tomas.herrera@kestrel-analytics.com">Tomás Herrera</a>, Head of Research</p><p>Hannah Cole: hannah.cole@kestrel-analytics.com</p>'),
    '/contact': page('Contact | Kestrel Analytics', '<p>New projects: projects [at] kestrel-analytics [dot] com</p><p>Press: our agency, hello@brightpr.example.org</p><p>Founder’s old address: k.founder@gmail.com</p><img src="logo@2x.png">'),
    '/robots.txt': 'User-agent: *\nDisallow: /admin\n',
  },
  'northpeak.io': {
    '/': page('NorthPeak Labs', '<h1>NorthPeak Labs</h1><p>Write to info@northpeak.io</p><a href="/team">Team</a>', 'NorthPeak Labs'),
    '/team': page('Team', '<p><a href="mailto:secret.person@northpeak.io">Secret Person</a></p>'),
    '/robots.txt': 'User-agent: *\nDisallow: /team\n',
  },
  'quietmail.dev': {
    '/': page('Quiet Mail', '<h1>Quiet Mail</h1><p>No addresses here.</p>', 'Quiet Mail'),
  },
};

const MX: Record<string, boolean> = { 'kestrel-analytics.com': true, 'northpeak.io': true, 'quietmail.dev': false };

const HUNTER_DOMAINS: Record<string, { value: string; first_name: string; last_name: string; position: string; confidence: number }[]> = {
  'kestrel-analytics.com': [
    { value: 'owen.price@kestrel-analytics.com', first_name: 'Owen', last_name: 'Price', position: 'Talent Partner', confidence: 91 },
    { value: 'priya.raman@kestrel-analytics.com', first_name: 'Priya', last_name: 'Raman', position: 'Managing Director', confidence: 97 },
  ],
  'bluefin-logistics.com': [{ value: 'ana.ruiz@bluefin-logistics.com', first_name: 'Ana', last_name: 'Ruiz', position: 'COO', confidence: 88 }],
};
const HUNTER_COMPANIES: Record<string, string> = { 'bluefin logistics': 'bluefin-logistics.com' };

export interface FinderFixture {
  url: string;
  hunterCalls: string[];
  close(): Promise<void>;
}

export async function startFinderFixture(port = 0): Promise<FinderFixture> {
  const hunterCalls: string[] = [];
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    const send = (status: number, body: string, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (u.pathname === '/health') return send(200, 'ok', 'text/plain');
    const site = u.pathname.match(/^\/site\/([^/]+)(\/.*)$/);
    if (site) {
      const pages = FINDER_SITES[site[1]!.replace(/^www\./, '')];
      const body = pages?.[site[2]!];
      if (!body) return send(404, 'Not found');
      return send(200, body, site[2] === '/robots.txt' ? 'text/plain' : 'text/html; charset=utf-8');
    }
    const mx = u.pathname.match(/^\/mx\/(.+)$/);
    if (mx) return send(200, JSON.stringify({ mx: MX[decodeURIComponent(mx[1]!)] ?? false }), 'application/json');
    if (u.pathname.startsWith('/hunter/')) {
      hunterCalls.push(`${u.pathname}?${[...u.searchParams.keys()].sort().join(',')}`);
      if (u.searchParams.get('api_key') !== 'hunter-test-key') return send(401, JSON.stringify({ errors: [{ id: 'authentication_failed' }] }), 'application/json');
      if (u.pathname === '/hunter/domain-search') {
        const domain = u.searchParams.get('domain') ?? HUNTER_COMPANIES[(u.searchParams.get('company') ?? '').toLowerCase()] ?? null;
        return send(200, JSON.stringify({ data: { domain, emails: (domain && HUNTER_DOMAINS[domain]) || [] } }), 'application/json');
      }
      if (u.pathname === '/hunter/email-finder') {
        const d = u.searchParams.get('domain')!;
        const f = (u.searchParams.get('first_name') ?? '').toLowerCase();
        const l = (u.searchParams.get('last_name') ?? '').toLowerCase();
        return send(200, JSON.stringify({ data: { email: d === 'bluefin-logistics.com' ? `${f[0]}${l}@${d}` : null, score: 72, position: null } }), 'application/json');
      }
    }
    send(404, 'Not found', 'text/plain');
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, hunterCalls, close: () => new Promise((r) => server.close(() => r())) };
}

// Run on its own (Playwright and demos): `tsx test/fixtures/finder-fixture.ts`, port from FINDER_FIXTURE_PORT.
if (process.argv[1]?.endsWith('finder-fixture.ts')) {
  void startFinderFixture(Number(process.env.FINDER_FIXTURE_PORT ?? 4300)).then((f) => console.warn(`Finder fixture on ${f.url}`));
}
