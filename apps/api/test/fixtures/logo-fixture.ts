import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';
import { ENRICH_SITES, wikidataAnswer } from './company-sites';

/** A real PNG of `size`×`size` pixels: a rounded badge in `rgb` on white (small, valid, renders in browsers). */
export function png(size: number, rgb: [number, number, number] = [37, 99, 235]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows: Buffer[] = [];
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inside = (x - r + 0.5) ** 2 + (y - r + 0.5) ** 2 <= (r * 0.8) ** 2;
      const c = inside ? rgb : [255, 255, 255];
      row[1 + x * 3] = c[0]!;
      row[2 + x * 3] = c[1]!;
      row[3 + x * 3] = c[2]!;
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

/** An ICO file holding one PNG image of `size` pixels (how modern favicon.ico files are made). */
export function ico(size: number): Buffer {
  const image = png(size, [220, 38, 38]);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = size >= 256 ? 0 : size;
  header[7] = size >= 256 ? 0 : size;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}

/** A rounded-square mark on a two-colour gradient. */
const mark = (from: string, to: string, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/>${inner}</svg>`;

const html = (head: string) => `<!doctype html><html><head><title>Site</title>${head}</head><body>Made-up site</body></html>`;

type Entry = { type: string; body: Buffer | string } | { redirect: string };

/**
 * Stand-in company websites for logo look-ups. The API reaches them through LOGO_FIXTURE_URL as /site/<host>/<path>.
 * Nothing here is real.
 */
export const LOGO_SITES: Record<string, Record<string, Entry>> = {
  // Declares a large apple-touch-icon and a small favicon: the large one wins.
  'brightwave.example': {
    '/': { type: 'text/html; charset=utf-8', body: html('<link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" sizes="180x180" href="/static/touch.png">') },
    '/static/touch.png': { type: 'image/png', body: png(180, [16, 185, 129]) },
    '/favicon-32.png': { type: 'image/png', body: png(32) },
  },
  // No icon links; the home page moves to www, which only has /favicon.ico.
  'oldfield.example': {
    '/': { redirect: 'https://www.oldfield.example/' },
  },
  'www.oldfield.example': {
    '/': { type: 'text/html', body: html('') },
    '/favicon.ico': { type: 'image/x-icon', body: ico(48) },
  },
  // An SVG logo, linked with an absolute URL on a CDN host.
  'vectorly.example': {
    '/': { type: 'text/html', body: html('<link rel="mask-icon" href="/mask.svg"><link rel="icon" type="image/svg+xml" href="https://cdn.vectorly.example/brand/logo.svg">') },
  },
  'cdn.vectorly.example': {
    '/brand/logo.svg': { type: 'image/svg+xml', body: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7c3aed"/><path d="M16 18h10l6 20 6-20h10L37 48H27z" fill="#fff"/></svg>' },
  },
  // Made-up companies with made-up marks, for the browser suite and screen previews.
  'lumenharbor.example': {
    '/': { type: 'text/html', body: html('<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/svg+xml" href="/brand.svg">') },
    '/brand.svg': { type: 'image/svg+xml', body: mark('#0ea5e9', '#1e3a8a', '<path d="M14 44c8-14 28-14 36 0" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="32" cy="24" r="7" fill="#fde047"/>') },
  },
  'tidepool.example': {
    '/': { type: 'text/html', body: html('<link rel="apple-touch-icon" href="/touch.svg">') },
    '/touch.svg': { type: 'image/svg+xml', body: mark('#14b8a6', '#0f766e', '<path d="M12 38c5-5 10-5 15 0s10 5 15 0 7-4 10-2" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M12 28c5-5 10-5 15 0s10 5 15 0 7-4 10-2" stroke="#ccfbf1" stroke-width="4.5" fill="none" stroke-linecap="round"/>') },
  },
  'emberline.example': {
    '/': { type: 'text/html', body: html('<link rel="icon" type="image/svg+xml" href="/e.svg">') },
    '/e.svg': { type: 'image/svg+xml', body: mark('#f97316', '#b91c1c', '<path d="M32 12c4 9 13 13 13 24a13 13 0 0 1-26 0c0-6 3-9 6-12 0 5 2 8 5 9-1-8 0-15 2-21z" fill="#fff"/>') },
  },
  'quantaforge.example': {
    '/': { type: 'text/html', body: html('<link rel="icon" type="image/svg+xml" href="/q.svg">') },
    '/q.svg': { type: 'image/svg+xml', body: mark('#8b5cf6', '#4338ca', '<rect x="17" y="17" width="18" height="18" rx="4" fill="#fff"/><rect x="29" y="29" width="18" height="18" rx="4" fill="#c4b5fd" fill-opacity=".9"/>') },
  },
  // The "icon" is an HTML error page served as image/png: not an image, so nothing is kept.
  'liar.example': {
    '/': { type: 'text/html', body: html('<link rel="icon" href="/icon.png">') },
    '/icon.png': { type: 'image/png', body: '<html>not found</html>' },
  },
};

export interface LogoFixture {
  url: string;
  hits: string[];
  close(): Promise<void>;
}

export async function startLogoFixture(port = 0): Promise<LogoFixture> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    const [pathname, search] = (req.url ?? '').split('?') as [string, string | undefined];
    const m = /^\/site\/([^/]+)(\/.*)?$/.exec(pathname);
    const host = m?.[1] ?? '';
    const path = m?.[2] ?? '/';
    hits.push(`${host}${path}`);
    if (host === 'www.wikidata.org' && path === '/w/api.php') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(wikidataAnswer(new URLSearchParams(search ?? ''))));
      return;
    }
    // Company auto-fill pages (ADR 0076) first; the logo files of the same made-up companies after them.
    const entry = ENRICH_SITES[host]?.[path] ?? LOGO_SITES[host]?.[path];
    if (!entry) {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
      return;
    }
    if ('redirect' in entry) {
      res.writeHead(301, { location: entry.redirect }).end();
      return;
    }
    res.writeHead(200, { 'content-type': entry.type }).end(entry.body);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const bound = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${bound}`, hits, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// Run on its own (Playwright and demos): `tsx test/fixtures/logo-fixture.ts`, port from LOGO_FIXTURE_PORT.
if (process.argv[1]?.endsWith('logo-fixture.ts')) {
  void startLogoFixture(Number(process.env.LOGO_FIXTURE_PORT ?? 4310)).then((f) => console.warn(`Logo fixture on ${f.url}`));
}
