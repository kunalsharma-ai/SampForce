import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, NetworkError, normalizeServer, REFRESH_EARLY_MS } from '../src/lib/api';
import { device, fakeFetch, MemoryTokens, tokens } from './fakes';

const SERVER = 'https://crm.example.com';

describe('server address', () => {
  it('accepts HTTPS addresses, adds https:// and drops paths', () => {
    expect(normalizeServer('crm.example.com')).toBe(SERVER);
    expect(normalizeServer(' https://crm.example.com/app/login ')).toBe(SERVER);
    expect(normalizeServer('https://crm.example.com:8443')).toBe('https://crm.example.com:8443');
  });
  it('refuses plain HTTP except on this machine or the Android emulator, and refuses credentials in the address', () => {
    expect(normalizeServer('http://crm.example.com')).toBeNull();
    expect(normalizeServer('http://localhost:4000')).toBe('http://localhost:4000');
    expect(normalizeServer('http://10.0.2.2:4000')).toBe('http://10.0.2.2:4000');
    expect(normalizeServer('https://user:pw@crm.example.com')).toBeNull();
    expect(normalizeServer('')).toBeNull();
    expect(normalizeServer('ftp://crm.example.com')).toBeNull();
  });
});

describe('api client', () => {
  it('keeps the tokens from sign-in and sends the access token, the language and no cookie', async () => {
    let now = 1_000_000;
    const store = new MemoryTokens();
    const f = fakeFetch({ 'POST /mobile/auth/login': () => ({ status: 200, body: tokens(1) }), 'GET /mobile/session': () => ({ status: 200, body: { ok: true } }) });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl, language: () => 'fr', now: () => now });
    await api.login('a@b.co', 'secret-password', device);
    expect(store.value).toMatchObject({ accessToken: 'access-1', expiresAt: now + 900_000, deviceId: 'device-1' });
    now += 1000;
    await api.get('/mobile/session');
    expect(f.calls[1]).toMatchObject({ path: '/mobile/session', auth: 'Bearer access-1', language: 'fr' });
    expect(f.calls[0]!.body).toEqual({ email: 'a@b.co', password: 'secret-password', device });
    expect(f.calls[0]!.auth).toBeNull();
  });

  it('does not keep tokens when two-step verification is needed', async () => {
    const store = new MemoryTokens();
    const f = fakeFetch({ 'POST /mobile/auth/login': () => ({ status: 200, body: { mfaRequired: true, challenge: 'c1' } }), 'POST /mobile/auth/mfa/verify': () => ({ status: 200, body: tokens(2) }) });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    expect(await api.login('a@b.co', 'pw-123456789', device)).toEqual({ mfaRequired: true, challenge: 'c1' });
    expect(store.value).toBeNull();
    await api.verifyMfa('c1', '123456', device);
    expect(store.value?.accessToken).toBe('access-2');
  });

  it('refreshes shortly before the token expires, once, however many requests are waiting', async () => {
    let now = 0;
    const store = new MemoryTokens();
    let refreshes = 0;
    const f = fakeFetch({
      'POST /mobile/auth/refresh': async (c) => {
        refreshes++;
        expect(c.body).toEqual({ refreshToken: tokens(1).refreshToken });
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200, body: tokens(2) };
      },
      'GET /help': (c) => ({ status: 200, body: { auth: c.auth } }),
    });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl, now: () => now });
    store.value = { ...tokens(1), expiresAt: 900_000 };
    now = 900_000 - REFRESH_EARLY_MS + 1;
    const results = await Promise.all([api.get<{ auth: string }>('/help'), api.get<{ auth: string }>('/help'), api.get<{ auth: string }>('/help')]);
    expect(refreshes).toBe(1);
    expect(results.map((r) => r.auth)).toEqual(['Bearer access-2', 'Bearer access-2', 'Bearer access-2']);
    expect(store.value?.refreshToken).toBe(tokens(2).refreshToken);
  });

  it('retries once after a 401 with a fresh token', async () => {
    const store = new MemoryTokens();
    store.value = { ...tokens(1), expiresAt: Date.now() + 600_000 };
    const f = fakeFetch({
      'POST /mobile/auth/refresh': () => ({ status: 200, body: tokens(2) }),
      'GET /help': (c) => (c.auth === 'Bearer access-1' ? { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Expired' } } } : { status: 200, body: { ok: 1 } }),
    });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    expect(await api.get('/help')).toEqual({ ok: 1 });
    expect(f.calls.map((c) => c.path)).toEqual(['/help', '/mobile/auth/refresh', '/help']);
  });

  it('forgets the tokens and says so when the refresh is refused', async () => {
    const store = new MemoryTokens();
    store.value = { ...tokens(1), expiresAt: 0 };
    let signedOut = 0;
    const f = fakeFetch({ 'POST /mobile/auth/refresh': () => ({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } } }) });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl, onSignedOut: () => signedOut++ });
    await expect(api.get('/help')).rejects.toMatchObject({ status: 401 });
    expect(store.value).toBeNull();
    expect(signedOut).toBe(1);
  });

  it('keeps the tokens when phones are only blocked, so reinstating carries on', async () => {
    const store = new MemoryTokens();
    store.value = { ...tokens(1), expiresAt: 0 };
    const blocked = { status: 403, body: { error: { code: 'MOBILE_ACCESS_BLOCKED', message: 'Mobile access is suspended.', details: [{ path: 'reason', message: 'SUSPENDED' }] } } };
    const f = fakeFetch({ 'POST /mobile/auth/refresh': () => blocked });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    const err = (await api.get('/help').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.blockReason).toBe('SUSPENDED');
    expect(store.value).not.toBeNull();
  });

  it('turns server errors and lost connections into typed errors', async () => {
    const store = new MemoryTokens();
    store.value = { ...tokens(1), expiresAt: Date.now() + 600_000 };
    const f = fakeFetch({ 'GET /support/tickets': () => ({ status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'Check the fields.', details: [{ path: 'subject', message: 'Too short' }] } } }) });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    await expect(api.get('/support/tickets')).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: [{ path: 'subject', message: 'Too short' }] });
    const offline = new ApiClient({ server: SERVER, store, fetch: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch });
    await expect(offline.get('/help')).rejects.toBeInstanceOf(NetworkError);
  });

  it('signs out locally even when the server cannot be reached', async () => {
    const store = new MemoryTokens();
    store.value = { ...tokens(1), expiresAt: Date.now() + 600_000 };
    const api = new ApiClient({ server: SERVER, store, fetch: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch });
    await api.logout();
    expect(store.value).toBeNull();
  });

  it('confirms the password before a delete and sends the one-time pass with it', async () => {
    const store = new MemoryTokens();
    await store.set({ ...tokens(1), expiresAt: Date.now() + 900_000 });
    const f = fakeFetch({ 'POST /auth/confirm-password': () => ({ status: 200, body: { token: 'pass-9', expiresAt: '2026-11-23T13:00:00.000Z' } }), 'DELETE /mobile/records/leads/l1': () => ({ status: 204 }) });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    await api.deleteConfirmed('/mobile/records/leads/l1', 'my-password-1');
    expect(f.calls[0]).toMatchObject({ method: 'POST', path: '/auth/confirm-password', body: { password: 'my-password-1' } });
    expect(f.calls[1]).toMatchObject({ method: 'DELETE', path: '/mobile/records/leads/l1', confirmation: 'pass-9' });
  });
});
