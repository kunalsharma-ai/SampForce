/**
 * Finds a company's logo from its website (ADR 0070). Pure helpers (image sniffing, icon link parsing, ranking) plus
 * {@link findLogo}, which drives them through a fetch function the caller supplies, so the network rules (public
 * addresses only, every redirect checked, sizes and times capped) live in one place: CompanyLogosService.
 *
 * Only the company's own site is read: its icon links (apple-touch-icon, icon, shortcut icon) and the usual
 * /apple-touch-icon.png and /favicon.ico. No third-party logo service sees which companies a workspace works with,
 * and it works for a server on an office network that can reach the company sites but nothing else.
 */

export type LogoType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon' | 'image/svg+xml';

export interface SniffedImage {
  contentType: LogoType;
  /** Larger side in pixels; null for SVG (it scales). */
  width: number | null;
}

/** The largest logo image kept (uploads and look-ups). */
export const LOGO_MAX_BYTES = 1_000_000;
/** Icons smaller than this are not worth showing. */
export const LOGO_MIN_WIDTH = 16;
/** An icon this size or larger (or an SVG) is good enough to stop looking. */
export const LOGO_GOOD_WIDTH = 96;

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');

/** What image a buffer holds, judged by its bytes (never by the server's Content-Type), or null. */
export function sniffImage(b: Buffer): SniffedImage | null {
  if (b.length < 12) return null;
  // PNG: signature, then the IHDR chunk with width and height.
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b.length >= 24) {
    return { contentType: 'image/png', width: Math.max(b.readUInt32BE(16), b.readUInt32BE(20)) };
  }
  if (ascii(b, 0, 4) === 'GIF8' && b.length >= 10) {
    return { contentType: 'image/gif', width: Math.max(b.readUInt16LE(6), b.readUInt16LE(8)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return size ? { contentType: 'image/jpeg', width: size } : null;
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const size = webpSize(b);
    return size ? { contentType: 'image/webp', width: size } : null;
  }
  // ICO: reserved 0, type 1, then 16-byte directory entries (width 0 means 256).
  if (b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1) {
    const count = b.readUInt16LE(4);
    if (count < 1 || count > 64 || b.length < 6 + 16 * count) return null;
    let best = 0;
    for (let i = 0; i < count; i++) {
      const w = b[6 + 16 * i] || 256;
      const h = b[7 + 16 * i] || 256;
      best = Math.max(best, w, h);
    }
    return { contentType: 'image/x-icon', width: best };
  }
  if (isSvg(b)) return { contentType: 'image/svg+xml', width: null };
  return null;
}

function jpegSize(b: Buffer): number | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // Start-of-frame markers carry the size; C4 (DHT), C8 and CC are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return Math.max(b.readUInt16BE(i + 5), b.readUInt16BE(i + 7));
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Buffer): number | null {
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8X' && b.length >= 30) return Math.max(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return Math.max((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && b.length >= 30) return Math.max(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  return null;
}

function isSvg(b: Buffer): boolean {
  const head = b.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '');
  // Skip an XML declaration, doctype and comments; the first element must be <svg.
  const rest = head.replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
  return /^<svg[\s>]/i.test(rest);
}

export interface IconCandidate {
  url: string;
  /** Higher is tried first: declared pixel size, SVG ranks above any bitmap. */
  score: number;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
};

/** Icon links in a page's HTML, resolved against the page URL and ranked best first. */
export function iconLinks(html: string, pageUrl: string): IconCandidate[] {
  const head = html.slice(0, 300_000);
  const baseHref = /<base\b[^>]*>/i.exec(head)?.[0];
  let base = pageUrl;
  if (baseHref) {
    const href = attr(baseHref, 'href');
    if (href) base = safeUrl(href, pageUrl) ?? pageUrl;
  }
  const out: IconCandidate[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const touch = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    // mask-icon is a one-colour silhouette for Safari pinned tabs, not a logo.
    if (!touch && !rel.includes('icon')) continue;
    const href = attr(tag, 'href');
    if (!href || href.startsWith('data:')) continue;
    const url = safeUrl(href, base);
    if (!url) continue;
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    const sizes = (attr(tag, 'sizes') ?? '').toLowerCase();
    const svg = type === 'image/svg+xml' || /\.svgz?(\?|#|$)/i.test(url) || sizes === 'any';
    const declared = Math.max(0, ...[...sizes.matchAll(/(\d+)x(\d+)/g)].map((m) => Math.max(Number(m[1]), Number(m[2]))));
    const score = svg ? 1000 : declared || (touch ? 180 : 32);
    out.push({ url, score });
  }
  return rank(out);
}

/** The well-known paths, for sites whose page names no icon. */
export function defaultIcons(origin: string): IconCandidate[] {
  return [
    { url: `${origin}/apple-touch-icon.png`, score: 180 },
    { url: `${origin}/favicon.ico`, score: 32 },
  ];
}

function safeUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Best first, each URL once. */
export function rank(list: IconCandidate[]): IconCandidate[] {
  const seen = new Set<string>();
  return [...list]
    .sort((a, b) => b.score - a.score)
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

/** A domain as the look-up uses it: lower case, no scheme, path, port or leading www. Null when it is not a host name. */
export function logoDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  try {
    host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  return host;
}

export interface FoundLogo {
  contentType: LogoType;
  data: Buffer;
  width: number | null;
  sourceUrl: string;
}

export type LookupResult = { status: 'FOUND'; logo: FoundLogo } | { status: 'NOT_FOUND' } | { status: 'UNREACHABLE'; error: string };

/** How the finder reads the web: a page as text, or a file as bytes; null when it is missing, too big or not public. */
export interface LogoFetcher {
  page(url: string): Promise<{ url: string; html: string } | null>;
  file(url: string): Promise<Buffer | null>;
}

/** Most icon files a single look-up downloads. */
const MAX_DOWNLOADS = 6;

/**
 * Looks for the company's logo on its website: the home page's icon links first (best declared size first), then
 * the well-known paths. Stops at the first image that is big enough; otherwise keeps the largest usable one.
 */
export async function findLogo(domain: string, net: LogoFetcher): Promise<LookupResult> {
  let page: { url: string; html: string } | null = null;
  for (const start of [`https://${domain}/`, `https://www.${domain}/`]) {
    page = await net.page(start);
    if (page) break;
  }
  const origin = page ? new URL(page.url).origin : `https://${domain}`;
  const candidates = rank([...(page ? iconLinks(page.html, page.url) : []), ...defaultIcons(origin)]);
  let best: FoundLogo | null = null;
  let downloaded = 0;
  let anyFile = false;
  for (const c of candidates) {
    if (downloaded >= MAX_DOWNLOADS) break;
    downloaded++;
    const data = await net.file(c.url);
    if (!data) continue;
    anyFile = true;
    const img = sniffImage(data);
    if (!img) continue;
    if (img.width !== null && img.width < LOGO_MIN_WIDTH) continue;
    const found: FoundLogo = { contentType: img.contentType, data, width: img.width, sourceUrl: c.url };
    if (img.width === null || img.width >= LOGO_GOOD_WIDTH) return { status: 'FOUND', logo: found };
    if (!best || (best.width ?? 0) < img.width) best = found;
  }
  if (best) return { status: 'FOUND', logo: best };
  if (!page && !anyFile) return { status: 'UNREACHABLE', error: `Could not reach ${domain}` };
  return { status: 'NOT_FOUND' };
}
