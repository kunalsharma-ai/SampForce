import type { MobileDeviceInfo, MobileResolvedConfig, MobileSession } from '@dealflow/types';
import { ApiClient, ApiError, NetworkError, normalizeServer, type TokenStore } from './api';
import { CONFIG_KEY, type KeyValueStore, syncConfig } from './config-sync';

/**
 * The app's sign-in state, kept out of React so it can be tested on its own. Screens read `state` and call the
 * methods; the provider in session.tsx re-renders on every change.
 */

export type SessionState =
  | { status: 'starting' }
  | { status: 'signedOut'; server: string; error: string | null }
  | { status: 'mfa'; server: string; challenge: string; error: string | null }
  /** The organisation's phones are stopped (Console, plan or Super Workspace). The tokens are kept. */
  | { status: 'blocked'; server: string; reason: string | null; message: string }
  /** Signed in, but the server could not be reached to load the session. */
  | { status: 'unreachable'; server: string; message: string }
  | { status: 'signedIn'; server: string; session: MobileSession; config: MobileResolvedConfig; configVersion: number };

export const SERVER_KEY = 'sampforce.server';

export interface SessionDeps {
  tokens: TokenStore;
  kv: KeyValueStore;
  device: () => Promise<MobileDeviceInfo>;
  defaultServer: string;
  language: () => string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class SessionController {
  private current: SessionState = { status: 'starting' };
  private readonly listeners = new Set<(s: SessionState) => void>();
  private client: ApiClient | null = null;
  private busy: Promise<void> | null = null;

  constructor(private readonly deps: SessionDeps) {}

  get state(): SessionState {
    return this.current;
  }

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The signed-in client for screens. Throws before sign-in. */
  get api(): ApiClient {
    if (!this.client || this.current.status !== 'signedIn') throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
    return this.client;
  }

  private set(s: SessionState) {
    this.current = s;
    for (const fn of this.listeners) fn(s);
  }

  private clientFor(server: string): ApiClient {
    if (this.client?.server === server) return this.client;
    this.client = new ApiClient({
      server,
      store: this.deps.tokens,
      fetch: this.deps.fetch,
      now: this.deps.now,
      language: this.deps.language,
      onSignedOut: () => this.set({ status: 'signedOut', server, error: 'You were signed out. Sign in again.' }),
    });
    return this.client;
  }

  private async server(): Promise<string> {
    return (await this.deps.kv.getItem(SERVER_KEY)) ?? this.deps.defaultServer;
  }

  /** On app start: carry on with stored tokens, or show sign-in. */
  async start(): Promise<void> {
    const server = await this.server();
    const api = this.clientFor(server);
    if (!(await api.hasTokens())) return this.set({ status: 'signedOut', server, error: null });
    await this.reload();
  }

  /** Loads the session and its configuration again (on start, on returning to the app, after a switch). */
  reload(): Promise<void> {
    this.busy ??= this.load().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async load(): Promise<void> {
    const server = await this.server();
    const api = this.clientFor(server);
    try {
      const session = await api.get<MobileSession>('/mobile/session');
      const cfg = await syncConfig(api, session, this.deps.kv);
      this.set({ status: 'signedIn', server, session, config: cfg.config, configVersion: cfg.version });
    } catch (e) {
      this.fail(server, e);
    }
  }

  /** Screens hand errors here so a block or a sign-out anywhere changes the whole app. Returns true if it did. */
  report(e: unknown): boolean {
    if (this.current.status !== 'signedIn') return false;
    const server = this.current.server;
    if (e instanceof ApiError && (e.blockReason || e.status === 401)) {
      this.fail(server, e);
      return true;
    }
    return false;
  }

  private fail(server: string, e: unknown) {
    if (e instanceof ApiError && e.blockReason) return this.set({ status: 'blocked', server, reason: e.blockReason, message: e.message });
    if (e instanceof ApiError && e.status === 401) return this.set({ status: 'signedOut', server, error: 'You were signed out. Sign in again.' });
    if (e instanceof NetworkError) return this.set({ status: 'unreachable', server, message: e.message });
    this.set({ status: 'unreachable', server, message: e instanceof Error ? e.message : 'Something went wrong. Try again.' });
  }

  async signIn(serverInput: string, email: string, password: string): Promise<void> {
    const server = normalizeServer(serverInput);
    if (!server) return this.set({ status: 'signedOut', server: serverInput, error: 'Enter the server address with https://, for example https://crm.example.com.' });
    await this.deps.kv.setItem(SERVER_KEY, server);
    const api = this.clientFor(server);
    try {
      const res = await api.login(email.trim(), password, await this.deps.device());
      if ('mfaRequired' in res) return this.set({ status: 'mfa', server, challenge: res.challenge, error: null });
    } catch (e) {
      return this.set({ status: 'signedOut', server, error: this.signInError(e) });
    }
    await this.reload();
  }

  async verifyMfa(code: string): Promise<void> {
    if (this.current.status !== 'mfa') return;
    const { server, challenge } = this.current;
    try {
      await this.clientFor(server).verifyMfa(challenge, code.replace(/\s+/g, ''), await this.deps.device());
    } catch (e) {
      const expired = e instanceof ApiError && e.status === 401 && /challenge/i.test(e.message);
      if (expired) return this.set({ status: 'signedOut', server, error: e.message });
      return this.set({ status: 'mfa', server, challenge, error: this.signInError(e) });
    }
    await this.reload();
  }

  async switchWorkspace(tenantId: string): Promise<void> {
    await this.api.switchWorkspace(tenantId);
    await this.deps.kv.removeItem(CONFIG_KEY);
    await this.reload();
  }

  async signOut(): Promise<void> {
    const server = await this.server();
    await this.clientFor(server).logout();
    await this.deps.kv.removeItem(CONFIG_KEY);
    this.set({ status: 'signedOut', server, error: null });
  }

  private signInError(e: unknown): string {
    if (e instanceof NetworkError) return 'The server could not be reached. Check the address and your connection.';
    if (e instanceof ApiError) return e.message;
    return 'Something went wrong. Try again.';
  }
}
