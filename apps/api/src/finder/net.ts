import { Inject, Injectable } from '@nestjs/common';
import { resolveMx } from 'node:dns/promises';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl } from '../common/net-guard';

const TIMEOUT_MS = 6000;
const MAX_BYTES = 1_000_000;
export const FINDER_USER_AGENT = 'DealFlowBot/1.0 (email finder; reads public contact pages; honours robots.txt)';

export interface FetchedPage {
  url: string;
  html: string;
}

/**
 * The finder's only way out to the internet: public https pages (checked against private addresses on every
 * redirect, size and time limited) and mail-server lookups. Tests point it at a fixture with FINDER_FIXTURE_URL.
 */
@Injectable()
export class FinderNet {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Whether the domain has a mail server. null when DNS could not answer. */
  async mailServer(domain: string): Promise<boolean | null> {
    const fx = this.env.FINDER_FIXTURE_URL;
    if (fx) {
      const res = await fetch(`${fx}/mx/${encodeURIComponent(domain)}`).catch(() => null);
      return res?.ok ? ((await res.json()) as { mx: boolean }).mx : null;
    }
    try {
      return (await resolveMx(domain)).length > 0;
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'ENOTFOUND' || code === 'ENODATA' ? false : null;
    }
  }

  /** An HTML page, or null when it is missing, not HTML, too slow or not public. */
  async page(url: string): Promise<FetchedPage | null> {
    const fx = this.env.FINDER_FIXTURE_URL;
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      const u = new URL(target);
      let res: Response;
      try {
        if (fx) {
          res = await fetch(`${fx}/site/${u.host}${u.pathname}${u.search}`, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        } else {
          await assertPublicUrl(target, false);
          res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': FINDER_USER_AGENT, accept: 'text/html' } });
        }
      } catch {
        return null;
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        target = new URL(res.headers.get('location')!, target).toString();
        continue;
      }
      if (!res.ok) return null;
      if (!/text\/(html|plain)/i.test(res.headers.get('content-type') ?? '')) return null;
      const html = await readCapped(res);
      return html === null ? null : { url: target, html };
    }
    return null;
  }

  /** Paths robots.txt asks crawlers (all, or DealFlowBot) not to read. */
  async disallowed(origin: string): Promise<string[]> {
    const page = await this.page(`${origin}/robots.txt`);
    if (!page) return [];
    const out: string[] = [];
    let applies = false;
    for (const raw of page.html.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const [k, ...rest] = line.split(':');
      const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k ?? '')) applies = v === '*' || /dealflowbot/i.test(v);
      else if (applies && /^disallow$/i.test(k ?? '') && v) out.push(v);
    }
    return out;
  }
}

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
