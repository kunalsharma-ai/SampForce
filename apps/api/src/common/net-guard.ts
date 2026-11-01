import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, type Dispatcher, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

/**
 * Outbound request guard against server-side request forgery: webhook targets and provider URLs
 * must use http(s) and resolve only to public addresses. Tests may allow private targets via
 * ALLOW_PRIVATE_NETWORK_TARGETS, which the config refuses in production.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('ff');
}

export class UnsafeTargetError extends Error {}

export async function assertPublicUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError('Not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeTargetError('Only http and https URLs are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('URLs must not contain credentials');
  if (allowPrivate) return url;
  if (url.protocol !== 'https:') throw new UnsafeTargetError('Use an https:// URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new UnsafeTargetError('The host name does not resolve');
  if (addresses.some(isPrivateAddress)) throw new UnsafeTargetError('The URL points to a private or reserved network address');
  return url;
}

type Resolver = (hostname: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * A `lookup` for socket connections that refuses private and reserved addresses. The connection uses exactly the
 * addresses checked here, so a host name cannot pass {@link assertPublicUrl} and then resolve somewhere internal
 * when the request is made (DNS rebinding).
 */
export function guardedLookup(resolve: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((all) => {
        const wanted = options.family === 4 || options.family === 6 ? all.filter((a) => a.family === options.family) : all;
        if (wanted.length === 0) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
        if (wanted.some((a) => isPrivateAddress(a.address))) {
          throw new UnsafeTargetError('The URL points to a private or reserved network address');
        }
        if (options.all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, wanted);
        else callback(null, wanted[0]!.address, wanted[0]!.family);
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, '', 0));
  };
}

const publicAgent = new Agent({ connect: { lookup: guardedLookup() }, connections: 64 });

/**
 * fetch() for URLs that customers or providers supply (webhooks, Zapier hooks, workflow webhooks, Teams channels,
 * recording downloads, SSO discovery). It checks the URL with {@link assertPublicUrl} and then connects only to the
 * public addresses that were checked. With `allowPrivate` (tests, refused in production) it is a plain fetch.
 * Redirects are never followed automatically: callers pass `redirect: 'manual'` or `'error'` and check each hop.
 */
export async function publicFetch(raw: string | URL, init: RequestInit & { redirect: 'manual' | 'error' }, allowPrivate: boolean, agent: Dispatcher = publicAgent): Promise<Response> {
  const url = await assertPublicUrl(raw.toString(), allowPrivate);
  if (allowPrivate) return fetch(url, init);
  return (await undiciFetch(url, { ...(init as UndiciRequestInit), dispatcher: agent })) as unknown as Response;
}

/** For tests: an agent whose connections resolve with `resolve` instead of the system resolver. */
export function publicAgentFor(resolve: Resolver): Agent {
  return new Agent({ connect: { lookup: guardedLookup(resolve) } });
}
