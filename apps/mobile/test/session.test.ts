import { defaultMobileConfig, FEATURE_KEYS, type MobileSession, PERMISSIONS, resolveMobileConfig } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { CONFIG_KEY, configOwner, readCachedConfig, syncConfig } from '../src/lib/config-sync';
import { SERVER_KEY, SessionController } from '../src/lib/session-controller';
import { type Call, device, fakeFetch, MemoryKv, MemoryTokens, tokens } from './fakes';

const config = resolveMobileConfig(defaultMobileConfig(), { level: 'EXECUTIVE', features: [...FEATURE_KEYS], permissions: [...PERMISSIONS] });

const session = (over: Partial<MobileSession> = {}): MobileSession => ({
  user: { id: 'u1', name: 'Field Exec', email: 'exec@example.com' },
  organisation: { id: 'tenant-1', name: 'Config Org', brandColor: null },
  level: 'EXECUTIVE',
  designation: null,
  role: 'member',
  permissions: ['companies:read', 'companies:write'],
  workspaces: [],
  device: { id: 'device-1', platform: 'IOS' },
  configVersion: 3,
  ...over,
});

/** A server with a session and a published configuration version, counting config downloads. */
function server(state: { session: MobileSession; version: number }) {
  return fakeFetch({
    'POST /mobile/auth/login': () => ({ status: 200, body: tokens(1) }),
    'POST /mobile/auth/logout': () => ({ status: 204 }),
    'GET /mobile/session': () => ({ status: 200, body: { ...state.session, configVersion: state.version } }),
    'GET /mobile/config': (c: Call) => {
      const known = new URL(`https://x${c.path}`).searchParams.get('known');
      return known !== null && Number(known) === state.version ? { status: 200, body: { version: state.version, unchanged: true, config: null } } : { status: 200, body: { version: state.version, unchanged: false, config } };
    },
  });
}

describe('configuration copy', () => {
  it('belongs to one person, organisation, level and role', () => {
    const a = configOwner(session());
    expect(configOwner(session({ permissions: ['companies:write', 'companies:read'] }))).toBe(a);
    expect(configOwner(session({ level: 'MANAGER' }))).not.toBe(a);
    expect(configOwner(session({ role: 'viewer' }))).not.toBe(a);
    expect(configOwner(session({ organisation: { id: 'tenant-2', name: 'Other', brandColor: null } }))).not.toBe(a);
  });

  it('downloads once, then only asks whether the version changed', async () => {
    const kv = new MemoryKv();
    const state = { session: session(), version: 3 };
    const f = server(state);
    const get = <T>(p: string) => f.impl(`https://x/api/v1${p}`).then((r) => r.json() as Promise<T>);
    await syncConfig({ get }, { ...state.session, configVersion: 3 }, kv);
    expect((await readCachedConfig(kv))?.version).toBe(3);
    // Same version: no request at all.
    await syncConfig({ get }, { ...state.session, configVersion: 3 }, kv);
    expect(f.calls.length).toBe(1);
    // A new version is published: the phone asks with what it has, and gets the new one.
    state.version = 4;
    const c = await syncConfig({ get }, { ...state.session, configVersion: 4 }, kv);
    expect(f.calls[1]!.path).toBe('/mobile/config?known=3');
    expect(c.version).toBe(4);
    // The person moves to another level: the copy is not theirs any more, so it is fetched whole.
    await syncConfig({ get }, { ...state.session, level: 'MANAGER', configVersion: 4 }, kv);
    expect(f.calls[2]!.path).toBe('/mobile/config');
  });

  it('ignores a damaged copy', async () => {
    const kv = new MemoryKv();
    await kv.setItem(CONFIG_KEY, '{not json');
    expect(await readCachedConfig(kv)).toBeNull();
  });
});

describe('session controller', () => {
  const make = (f: ReturnType<typeof fakeFetch>, kv = new MemoryKv(), store = new MemoryTokens()) =>
    new SessionController({ tokens: store, kv, device: async () => device, defaultServer: 'https://crm.example.com', language: () => 'en', fetch: f.impl });

  it('starts signed out without tokens, then signs in and loads the session and configuration', async () => {
    const state = { session: session(), version: 3 };
    const f = server(state);
    const kv = new MemoryKv();
    const c = make(f, kv);
    await c.start();
    expect(c.state).toEqual({ status: 'signedOut', server: 'https://crm.example.com', error: null });
    await c.signIn('my-crm.example.org', 'exec@example.com', 'password-123');
    expect(c.state).toMatchObject({ status: 'signedIn', server: 'https://my-crm.example.org', configVersion: 3, session: { level: 'EXECUTIVE' } });
    expect(await kv.getItem(SERVER_KEY)).toBe('https://my-crm.example.org');
    if (c.state.status === 'signedIn') expect(c.state.config.tabs.length).toBeGreaterThan(0);
  });

  it('refuses an address without HTTPS before sending the password anywhere', async () => {
    const f = server({ session: session(), version: 1 });
    const c = make(f);
    await c.signIn('http://crm.example.com', 'exec@example.com', 'password-123');
    expect(c.state).toMatchObject({ status: 'signedOut', error: expect.stringContaining('https://') });
    expect(f.calls).toEqual([]);
  });

  it('shows the server message when the organisation is not approved for phones', async () => {
    const f = fakeFetch({ 'POST /mobile/auth/login': () => ({ status: 403, body: { error: { code: 'MOBILE_ACCESS_BLOCKED', message: 'Your organisation is waiting for approval.', details: [{ path: 'reason', message: 'NOT_APPROVED' }] } } }) });
    const c = make(f);
    await c.signIn('crm.example.com', 'exec@example.com', 'password-123');
    expect(c.state).toMatchObject({ status: 'signedOut', error: 'Your organisation is waiting for approval.' });
  });

  it('moves the whole app to "blocked" when a screen hits a block, and back once reinstated', async () => {
    const state = { session: session(), version: 1 };
    let blocked = false;
    const base = server(state);
    const f = fakeFetch({
      'POST /mobile/auth/login': () => ({ status: 200, body: tokens(1) }),
      'GET /mobile/session': async (call) => (blocked ? { status: 403, body: { error: { code: 'MOBILE_ACCESS_BLOCKED', message: 'Suspended.', details: [{ path: 'reason', message: 'SUSPENDED' }] } } } : { status: 200, body: (await (await base.impl(`https://x/api/v1${call.path}`)).json()) as object }),
      'GET /mobile/config': async (call) => ({ status: 200, body: (await (await base.impl(`https://x/api/v1${call.path}`)).json()) as object }),
    });
    const c = make(f);
    await c.signIn('crm.example.com', 'exec@example.com', 'password-123');
    blocked = true;
    await c.reload();
    expect(c.state).toMatchObject({ status: 'blocked', reason: 'SUSPENDED', message: 'Suspended.' });
    blocked = false;
    await c.reload();
    expect(c.state.status).toBe('signedIn');
  });

  it('asks for the two-step code and finishes sign-in with it', async () => {
    const state = { session: session(), version: 1 };
    const base = server(state);
    const f = fakeFetch({
      'POST /mobile/auth/login': () => ({ status: 200, body: { mfaRequired: true, challenge: 'ch-1' } }),
      'POST /mobile/auth/mfa/verify': (call) => ((call.body as { code: string }).code === '123456' ? { status: 200, body: tokens(1) } : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'That code is not right.' } } }),
      'GET /mobile/session': async (call) => ({ status: 200, body: (await (await base.impl(`https://x/api/v1${call.path}`)).json()) as object }),
      'GET /mobile/config': async (call) => ({ status: 200, body: (await (await base.impl(`https://x/api/v1${call.path}`)).json()) as object }),
    });
    const c = make(f);
    await c.signIn('crm.example.com', 'exec@example.com', 'password-123');
    expect(c.state).toMatchObject({ status: 'mfa', challenge: 'ch-1' });
    await c.verifyMfa('000 000');
    expect(c.state).toMatchObject({ status: 'mfa', error: 'That code is not right.' });
    await c.verifyMfa('123 456');
    expect(c.state.status).toBe('signedIn');
  });

  it('signs out on the server, forgets the tokens and the configuration copy', async () => {
    const f = server({ session: session(), version: 2 });
    const kv = new MemoryKv();
    const store = new MemoryTokens();
    const c = make(f, kv, store);
    await c.signIn('crm.example.com', 'exec@example.com', 'password-123');
    expect(await kv.getItem(CONFIG_KEY)).not.toBeNull();
    await c.signOut();
    expect(f.calls.at(-1)).toMatchObject({ method: 'POST', path: '/mobile/auth/logout', auth: 'Bearer access-1' });
    expect(store.value).toBeNull();
    expect(await kv.getItem(CONFIG_KEY)).toBeNull();
    expect(c.state.status).toBe('signedOut');
  });
});
