import { publicFetch } from '../common/net-guard';

/**
 * Reading public web pages for company logos (ADR 0070) and company auto-fill (ADR 0076). The only way out: public
 * https addresses (checked at connect time, so DNS rebinding cannot reach the internal network), every redirect
 * checked again, sizes and times capped. With `fixtureUrl` (tests only, refused in production) every request goes to
 * the stand-in server as /site/<host>/<path>.
 */
export interface SiteFetcher {
  /** An HTML page (cut at `maxBytes`) and the URL it ended up at, or null. */
  page(url: string): Promise<{ url: string; html: string } | null>;
  /** A file of at most `maxBytes` (dropped when bigger), or null. */
  file(url: string, accept: string, maxBytes: number): Promise<Buffer | null>;
  /** A JSON document (Wikidata), or null. */
  json(url: string): Promise<unknown>;
  /**
   * One request, redirects not followed, any status: what the hidden browser (page-renderer.ts) is given for each
   * request a page makes. The body is at most `maxBytes` (null when bigger or unreachable).
   */
  raw(url: string, accept: string, maxBytes: number): Promise<{ status: number; headers: Headers; body: Buffer } | null>;
}

/**
 * The user agent sent to company websites: an ordinary desktop Chrome, as a visitor's browser sends (Kunal,
 * 2026-11-26), because many sites block or strip pages for anything that names itself a bot.
 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/**
 * Sent to Wikidata's API instead: Wikimedia's user-agent policy requires API clients to describe themselves and refuses
 * generic browser agents from scripts.
 */
export const WIKIDATA_USER_AGENT = 'SampForce/1.0 (company auto-fill; https://www.wikidata.org/wiki/Wikidata:Data_access)';

export interface SiteFetchOptions {
  userAgent: string;
  /** User agent for json() (Wikidata); defaults to `userAgent`. */
  jsonUserAgent?: string;
  timeoutMs: number;
  pageMaxBytes: number;
  fixtureUrl?: string | undefined;
}

export function siteFetcher(opts: SiteFetchOptions): SiteFetcher {
  /** One request to `target`, without following redirects; null when it is refused or fails. */
  const once = async (target: string, accept: string, userAgent = opts.userAgent): Promise<Response | null> => {
    let u: URL;
    try {
      u = new URL(target);
    } catch {
      return null;
    }
    try {
      const init = { redirect: 'manual' as const, signal: AbortSignal.timeout(opts.timeoutMs), headers: { 'user-agent': userAgent, accept, 'accept-language': 'en-US,en;q=0.9' } };
      return opts.fixtureUrl ? await fetch(`${opts.fixtureUrl}/site/${u.host}${u.pathname}${u.search}`, init) : await publicFetch(target, init, false);
    } catch {
      return null;
    }
  };
  const get = async (url: string, accept: string, userAgent?: string): Promise<{ res: Response; url: string } | null> => {
    let target = url;
    for (let hop = 0; hop < 5; hop++) {
      const res = await once(target, accept, userAgent);
      if (!res) return null;
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        target = new URL(location, target).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      return { res, url: target };
    }
    return null;
  };
  return {
    page: async (url) => {
      const got = await get(url, 'text/html,application/xhtml+xml');
      if (!got) return null;
      if (!/text\/html|application\/xhtml/i.test(got.res.headers.get('content-type') ?? '')) {
        await got.res.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = await readCapped(got.res, opts.pageMaxBytes, true);
      return body ? { url: got.url, html: body.toString('utf8') } : null;
    },
    file: async (url, accept, maxBytes) => {
      const got = await get(url, accept);
      return got ? readCapped(got.res, maxBytes, false) : null;
    },
    raw: async (url, accept, maxBytes) => {
      const res = await once(url, accept);
      if (!res) return null;
      const body = await readCapped(res, maxBytes, false);
      return body ? { status: res.status, headers: res.headers, body } : null;
    },
    json: async (url) => {
      const got = await get(url, 'application/json', opts.jsonUserAgent);
      if (!got) return null;
      const body = await readCapped(got.res, 4_000_000, false);
      if (!body) return null;
      try {
        return JSON.parse(body.toString('utf8')) as unknown;
      } catch {
        return null;
      }
    },
  };
}

/** Reads at most `max` bytes. A page is cut there (its head is what matters); a file that is too big is dropped. */
export async function readCapped(res: Response, max: number, truncate: boolean): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const declared = Number(res.headers.get('content-length'));
  if (!truncate && Number.isFinite(declared) && declared > max) {
    await res.body.cancel().catch(() => undefined);
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => undefined);
        if (!truncate) return null;
        break;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}
