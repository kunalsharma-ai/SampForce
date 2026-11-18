import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, type Dispatcher, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import type { ApiEnv } from './env';
import { guardedLookup, isPrivateAddress, UnsafeTargetError } from './net-guard';

/**
 * Servers a workspace brings itself (its own AI server, its own SMTP server; ADR 0068) are reached through this
 * guard. Public addresses are always allowed. Private and internal ones (10.x, 192.168.x, a LAN IPv6 range,
 * localhost, the cloud metadata address) only when the operator lists them in TRUSTED_PRIVATE_HOSTS, because otherwise
 * any workspace admin could make SampForce call into the server's own network.
 */
export interface TrustedHosts {
  names: Set<string>;
  ranges: BlockList;
  empty: boolean;
}

/** Reads "ollama.lan, 10.0.0.0/8, 2406:b400::/32, 192.168.1.20". Throws with a sentence for people when an entry is not valid. */
export function parseTrustedHosts(raw: string | undefined): TrustedHosts {
  const names = new Set<string>();
  const ranges = new BlockList();
  for (const entry of (raw ?? '').split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/[[\]]/g, '')).filter(Boolean)) {
    const [addr, bits] = entry.split('/') as [string, string | undefined];
    const family = isIP(addr);
    if (family) {
      const type = family === 4 ? 'ipv4' : 'ipv6';
      if (bits === undefined) ranges.addAddress(addr, type);
      else {
        const n = Number(bits);
        if (!Number.isInteger(n) || n < 0 || n > (family === 4 ? 32 : 128)) throw new Error(`"${entry}" has an invalid range size.`);
        ranges.addSubnet(addr, n, type);
      }
    } else if (!bits && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(entry)) {
      names.add(entry);
    } else {
      throw new Error(`"${entry}" is not a host name, an address or a range such as 10.0.0.0/8.`);
    }
  }
  return { names, ranges, empty: names.size === 0 && ranges.rules.length === 0 };
}

const trustedOf = (env: ApiEnv): TrustedHosts => {
  try {
    return parseTrustedHosts(env.TRUSTED_PRIVATE_HOSTS);
  } catch {
    return parseTrustedHosts('');
  }
};

/** Whether a private address may be dialled for this host name: the name itself or the address is on the operator's list. */
export function isTrusted(t: TrustedHosts, hostname: string, address: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (t.names.has(name)) return true;
  const family = isIP(address);
  return family !== 0 && t.ranges.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export const PRIVATE_TARGET_MESSAGE =
  'is a private or internal address. For safety, workspaces can only use it after the SampForce operator approves it (operator console > Providers > Workspace servers).';

/**
 * Resolves a host a workspace entered and returns the addresses that may be dialled, or throws UnsafeTargetError.
 * Callers connect to these exact addresses, so the name cannot resolve somewhere else a moment later.
 */
export async function allowedAddresses(env: ApiEnv, host: string): Promise<{ address: string; family: number }[]> {
  const bare = host.replace(/^\[|\]$/g, '');
  const found = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await lookup(bare, { all: true, verbatim: true }).catch(() => []);
  if (!found.length) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${bare}`), { code: 'ENOTFOUND' });
  if (env.ALLOW_PRIVATE_NETWORK_TARGETS) return found;
  const t = trustedOf(env);
  const blocked = found.filter((a) => isPrivateAddress(a.address) && !isTrusted(t, bare, a.address));
  if (blocked.length) throw new UnsafeTargetError(`${bare} ${PRIVATE_TARGET_MESSAGE}`);
  return found;
}

/** Whether plain http (no TLS) is acceptable: only to a private server the operator trusts, never across the internet. */
export async function assertScheme(env: ApiEnv, url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UnsafeTargetError('Only http and https addresses are allowed');
  if (url.username || url.password) throw new UnsafeTargetError('Addresses must not contain a user name or password');
  if (url.protocol === 'https:' || env.ALLOW_PRIVATE_NETWORK_TARGETS) return;
  const addresses = await allowedAddresses(env, url.hostname);
  if (!addresses.every((a) => isPrivateAddress(a.address))) {
    throw new UnsafeTargetError('Use an https:// address: the API key would otherwise cross the internet unencrypted. Plain http is allowed only for a private server the operator approved.');
  }
}

const agents = new Map<string, Dispatcher>();

/** fetch() to a server a workspace entered: checked scheme, public or operator-trusted addresses only, no redirects. */
export async function workspaceFetch(env: ApiEnv, raw: string, init: RequestInit): Promise<Response> {
  const url = new URL(raw);
  await assertScheme(env, url);
  if (env.ALLOW_PRIVATE_NETWORK_TARGETS) return fetch(url, { ...init, redirect: 'error' });
  const key = env.TRUSTED_PRIVATE_HOSTS ?? '';
  let agent = agents.get(key);
  if (!agent) {
    const t = trustedOf(env);
    agent = new Agent({ connect: { lookup: guardedLookup(undefined, (h, a) => isTrusted(t, h, a)) }, connections: 16 });
    agents.set(key, agent);
  }
  return (await undiciFetch(url, { ...(init as UndiciRequestInit), redirect: 'error', dispatcher: agent })) as unknown as Response;
}

/** Checks an address a workspace typed before it is saved, so the person learns at once what the operator must approve. */
export async function assertWorkspaceUrl(env: ApiEnv, raw: string): Promise<void> {
  const url = new URL(raw);
  await assertScheme(env, url);
  await allowedAddresses(env, url.hostname);
}
