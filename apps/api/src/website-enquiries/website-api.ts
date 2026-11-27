import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '../common/env';

/**
 * The company website's "Sampforce API" (ADR 0095; the website's guide is docs/integrations/website-enquiries.md):
 * GET /ping, /leads, /contacts, /reviews paged with `nextCursor`, PATCH /leads/:id to send a status back. The key goes
 * in the Authorization header, never in a URL.
 */

const TIMEOUT_MS = 20_000;
/** The website allows 500 a page; fewer keeps one request small. */
export const PAGE_SIZE = 200;
/** A webhook signed longer ago than this is refused, so a captured delivery cannot be replayed. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export class WebsiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'WebsiteApiError';
  }
}

export interface WebsitePage<T> {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function websiteConfigured(env: ApiEnv): boolean {
  return !!(env.WEBSITE_API_BASE_URL && env.WEBSITE_API_KEY);
}

function base(env: ApiEnv): string {
  if (!env.WEBSITE_API_BASE_URL || !env.WEBSITE_API_KEY) throw new WebsiteApiError('The website API address and key are not set in the Console (Providers > Website enquiries).', null);
  return env.WEBSITE_API_BASE_URL.replace(/\/+$/, '');
}

/** What the website says went wrong, in one sentence an operator can act on. */
function failure(status: number, said: string): WebsiteApiError {
  const why =
    status === 401 ? 'The website refused the API key (wrong, revoked or expired). Make a new key in the website super admin and save it in the Console.'
      : status === 403 ? 'The key lacks a right it needs, or is used from an IP address not on its list.'
        : status === 404 ? 'The website has no such record.'
          : status === 429 ? 'The website asked to slow down; SampForce tries again later.'
            : status >= 500 ? `The website had a problem (HTTP ${status}); SampForce tries again later.`
              : `The website answered HTTP ${status}.`;
  return new WebsiteApiError(said ? `${why} (${said.slice(0, 200)})` : why, status);
}

async function call<T>(env: ApiEnv, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = `${base(env)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${env.WEBSITE_API_KEY}`,
        accept: 'application/json',
        'user-agent': 'SampForce-Website-Enquiry/1',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new WebsiteApiError(timeout ? 'The website did not answer in time.' : `Could not reach the website (${err instanceof Error ? err.message : String(err)}).`, null);
  }
  const body = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !body || body.ok === false) throw failure(res.ok ? 502 : res.status, typeof body?.error === 'string' ? body.error : '');
  return body;
}

export interface PingAnswer {
  key: { name: string; prefix: string; scopes: string[] };
  time: string;
}

export async function pingWebsite(env: ApiEnv): Promise<PingAnswer> {
  const body = await call<{ key?: Partial<PingAnswer['key']>; time?: string }>(env, '/ping');
  return { key: { name: String(body.key?.name ?? ''), prefix: String(body.key?.prefix ?? ''), scopes: Array.isArray(body.key?.scopes) ? body.key!.scopes.map(String) : [] }, time: String(body.time ?? '') };
}

/** One page of leads, contacts or reviews changed since `updatedSince` (all of them when it is null), oldest first. */
export async function fetchPage(env: ApiEnv, collection: 'leads' | 'contacts' | 'reviews', opts: { updatedSince: string | null; cursor: string | null; source?: string }): Promise<WebsitePage<unknown>> {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE), order: 'asc' });
  if (opts.updatedSince) qs.set('updatedSince', opts.updatedSince);
  if (opts.cursor) qs.set('cursor', opts.cursor);
  if (opts.source) qs.set('source', opts.source);
  const body = await call<{ data?: unknown[]; hasMore?: boolean; nextCursor?: string | null }>(env, `/${collection}?${qs}`);
  return { data: Array.isArray(body.data) ? body.data : [], hasMore: body.hasMore === true, nextCursor: typeof body.nextCursor === 'string' && body.nextCursor ? body.nextCursor : null };
}

export interface LeadWriteBack {
  status?: string;
  stage?: string;
  owner?: string;
  sampforceId?: string;
  url?: string;
  note?: string;
}

/** PATCH /leads/:id: the website shows it on the lead as "Sampforce (sales)" and changes the lead's status. */
export async function patchLead(env: ApiEnv, id: string, body: LeadWriteBack): Promise<void> {
  await call(env, `/leads/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/**
 * `X-Sampforce-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, with a timestamp no older (or
 * newer) than five minutes. Compared in constant time.
 */
export function verifySignature(secret: string, header: string | undefined, raw: Buffer, nowSeconds = Date.now() / 1000): SignatureCheck {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec((header ?? '').trim());
  if (!m) return { ok: false, reason: 'The X-Sampforce-Signature header is missing or malformed.' };
  if (Math.abs(nowSeconds - Number(m[1])) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'The signature is older than five minutes (or the clocks differ).' };
  const want = createHmac('sha256', secret).update(`${m[1]}.`).update(raw).digest();
  const got = Buffer.from(m[2]!, 'hex');
  if (got.length !== want.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'The signature did not match the webhook signing secret.' };
  return { ok: true };
}

/** Signs a body as the website does (tests and the website stand-in). */
export function signBody(secret: string, raw: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
