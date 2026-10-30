import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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
