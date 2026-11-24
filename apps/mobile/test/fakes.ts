import type { StoredTokens, TokenStore } from '../src/lib/api';
import type { KeyValueStore } from '../src/lib/config-sync';

export class MemoryTokens implements TokenStore {
  value: StoredTokens | null = null;
  async get() {
    return this.value;
  }
  async set(t: StoredTokens | null) {
    this.value = t;
  }
}

export class MemoryKv implements KeyValueStore {
  readonly map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  async removeItem(k: string) {
    this.map.delete(k);
  }
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
  language: string | null;
  /** The password-confirmation pass a delete carries. */
  confirmation: string | null;
}

type Handler = (call: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/** A fetch that answers from a route table and records every call. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const impl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\/v1/, '') + url.search;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.authorization ?? null, language: headers['accept-language'] ?? null, confirmation: headers['x-password-confirmation'] ?? null };
    calls.push(call);
    const handler = routes[`${call.method} ${url.pathname.replace(/^\/api\/v1/, '')}`];
    if (!handler) return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No route' } }), { status: 404 });
    const res = await handler(call);
    return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? null), { status: res.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

export const tokens = (n: number, expiresIn = 900) => ({ accessToken: `access-${n}`, refreshToken: `refresh-token-number-${n}-xxxxxxxx`, expiresIn, tenantId: 'tenant-1', deviceId: 'device-1' });

export const device = { platform: 'IOS' as const, installId: 'install-test-1', model: 'iPhone 17', osVersion: '26.1', appVersion: '1.0.0' };
