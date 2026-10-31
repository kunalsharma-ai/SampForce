/**
 * Reads email addresses and the people behind them from a page's HTML, without running it. Used by the
 * email finder on a company's public pages. Mirrors the extension's page reader (apps/extension/src/lib/page.js).
 */

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/gi;
const NOT_A_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|json|mp4|webm|woff2?)$/i;
const JUNK = /(^|\.)(example\.(com|org|net)|sentry\.io|wixpress\.com|domain\.com|email\.com|yourcompany\.com)$/i;
const ROLE = new Set(['info', 'sales', 'contact', 'hello', 'support', 'admin', 'office', 'team', 'enquiries', 'inquiries', 'marketing', 'press', 'media', 'careers', 'jobs', 'hr', 'billing', 'help', 'service', 'privacy', 'legal', 'noreply', 'no-reply', 'projects', 'webmaster', 'accounts']);

export interface PageFinding {
  email: string;
  name: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', commat: '@', period: '.' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

export function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase().replace(/^mailto:/, '').replace(/[.,;:]+$/, '');
  const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at);
  if (NOT_A_TLD.test(e) || JUNK.test(e.slice(at + 1)) || /^[0-9a-f]{20,}$/.test(local) || /@\d+x\./.test(e)) return null;
  return e;
}

export function belongsTo(email: string, domain: string): boolean {
  const d = email.slice(email.lastIndexOf('@') + 1);
  const s = domain.replace(/^www\./, '');
  return d === s || d.endsWith(`.${s}`);
}

export function isRoleMailbox(email: string): boolean {
  return ROLE.has(email.slice(0, email.indexOf('@')));
}

export function looksLikeName(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return /^[\p{Lu}][\p{L}'’-]+(?: [\p{Lu}][\p{L}'’.-]*){1,3}$/u.test(t) && !/^(Email|Contact|Write|Send|Mail)\b/i.test(t);
}

export function nameFromEmail(email: string): string | null {
  if (isRoleMailbox(email)) return null;
  const parts = email.slice(0, email.indexOf('@')).split(/[._-]+/).filter((p) => /^[a-z]{2,}$/i.test(p));
  if (parts.length < 2) return null;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(' ');
}

function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
}

/** The site's own name: og:site_name, application-name, or the last part of the title. */
export function siteName(html: string): string | null {
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:og:site_name|application-name)["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (meta) return decodeEntities(meta).trim();
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const parts = title.split(/\s[|–—-]\s/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : null;
}

/** All of the page's visible text, title and site name, for matching a company name. */
export function pageText(html: string): string {
  return `${siteName(html) ?? ''} ${textOf(html)}`;
}

/** Same-site links whose path suggests a contact, about or team page. */
export function interestingLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]!), base);
      if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
      if (/(contact|about|team|people|staff|leadership|management|impressum|imprint|kontakt)/i.test(u.pathname)) out.add(u.pathname);
    } catch {
      // Not a usable link.
    }
  }
  return [...out].slice(0, 8);
}

export function extractEmails(html: string): PageFinding[] {
  const found = new Map<string, PageFinding>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const e = cleanEmail(decodeURIComponent(decodeEntities(m[1]!)).split(',')[0]!);
    if (!e) continue;
    const text = textOf(m[2]!).trim();
    const name = looksLikeName(text) ? text : null;
    if (!found.has(e) || (!found.get(e)!.name && name)) found.set(e, { email: e, name });
  }
  const text = textOf(html).replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
  for (const m of text.matchAll(EMAIL)) {
    const e = cleanEmail(m[0]);
    if (e && !found.has(e)) found.set(e, { email: e, name: null });
    if (found.size >= 200) break;
  }
  return [...found.values()];
}
