import type { MobileDeviceInfo, MobileLoginResponse, MobileTokens } from '@dealflow/types';

/**
 * The phone's API client (ADR 0072). Tokens travel in the Authorization header, never in cookies. The access token is
 * refreshed a little before it expires, and once more if the server still says 401. Refresh tokens rotate: a refresh
 * that fails means the phone was signed out (or the token was reused), so the stored tokens are dropped.
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token stops working. */
  expiresAt: number;
  tenantId: string;
  deviceId: string;
}

export interface TokenStore {
  get(): Promise<StoredTokens | null>;
  set(tokens: StoredTokens | null): Promise<void>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Why the organisation's phones are stopped (see MobileBlockReason), when that is the problem. */
  get blockReason(): string | null {
    return this.code === 'MOBILE_ACCESS_BLOCKED' ? (this.details[0]?.message ?? null) : null;
  }
}

/** Thrown when the server could not be reached at all. */
export class NetworkError extends Error {
  constructor(message = 'The server could not be reached.') {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Refresh this long before the access token runs out, so a request never leaves with a token about to expire. */
export const REFRESH_EARLY_MS = 30_000;

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])$/;

/**
 * Turns what the person typed as the server address into an origin. HTTPS is required, except for a server on the
 * same machine (development and the Android emulator's 10.0.2.2). Returns null for anything else.
 */
export function normalizeServer(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.test(url.hostname))) return null;
  return url.origin;
}

export interface ApiClientOptions {
  server: string;
  store: TokenStore;
  fetch?: typeof fetch;
  /** The phone's language, sent so server messages come back translated. */
  language?: () => string;
  /** Called when the stored tokens stop working (signed out elsewhere, refresh reused, device removed). */
  onSignedOut?: () => void;
  now?: () => number;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A request body sent as is, with its own content type. */
class RawBody {
  constructor(
    readonly data: Blob,
    readonly type: string,
  ) {}
}

export class ApiClient {
  private refreshing: Promise<StoredTokens | null> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.now = opts.now ?? Date.now;
  }

  get server(): string {
    return this.opts.server;
  }

  /** A signed-in request. */
  get<T>(path: string): Promise<T> {
    return this.authed<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.authed<T>('POST', path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.authed<T>('PUT', path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.authed<T>('PATCH', path, body);
  }
  delete(path: string): Promise<void> {
    return this.authed<void>('DELETE', path);
  }
  /**
   * Deletes after confirming the person's password (workspace redesign W1): the server checks it, hands back a one-time
   * pass, and refuses the delete without one.
   */
  async deleteConfirmed(path: string, password: string): Promise<void> {
    const pass = await this.authed<{ token: string }>('POST', '/auth/confirm-password', { password });
    return this.authed<void>('DELETE', path, undefined, false, { 'x-password-confirmation': pass.token });
  }
  /**
   * Carries out an action a manager approved (ADR 0098): the same method, path and body as asked for, with the
   * approval's id, and the person's password when the action deletes.
   */
  async carryOut<T>(action: { method: Method; path: string; body?: unknown }, approvalId: string, password?: string): Promise<T> {
    const headers: Record<string, string> = { 'x-approval-id': approvalId };
    if (password) headers['x-password-confirmation'] = (await this.authed<{ token: string }>('POST', '/auth/confirm-password', { password })).token;
    return this.authed<T>(action.method, action.path, action.body, false, headers);
  }
  /** Sends a file as the raw request body (a photo upload). */
  putFile<T>(path: string, data: Blob, contentType: string): Promise<T> {
    return this.authed<T>('PUT', path, new RawBody(data, contentType));
  }
  /** A signed-in file download (a photo), as a Blob. */
  getFile(path: string): Promise<Blob> {
    return this.authed<Blob>('GET', path, undefined, true);
  }

  async login(email: string, password: string, device: MobileDeviceInfo): Promise<MobileLoginResponse> {
    const res = await this.send<MobileLoginResponse>('POST', '/mobile/auth/login', { email, password, device }, null);
    if (!('mfaRequired' in res)) await this.keep(res);
    return res;
  }

  async verifyMfa(challenge: string, code: string, device: MobileDeviceInfo): Promise<MobileTokens> {
    const res = await this.send<MobileTokens>('POST', '/mobile/auth/mfa/verify', { challenge, code, device }, null);
    await this.keep(res);
    return res;
  }

  /** Moves the phone to another organisation of the same person. The server issues new tokens for it. */
  async switchWorkspace(tenantId: string): Promise<MobileTokens> {
    const res = await this.authed<MobileTokens>('POST', '/mobile/auth/switch-workspace', { tenantId });
    await this.keep(res);
    return res;
  }

  /** Signs this phone out on the server, then forgets the tokens even if the server could not be reached. */
  async logout(): Promise<void> {
    try {
      if (await this.opts.store.get()) await this.authed<void>('POST', '/mobile/auth/logout');
    } catch {
      // Signing out locally must always work, offline too.
    } finally {
      await this.opts.store.set(null);
    }
  }

  async hasTokens(): Promise<boolean> {
    return (await this.opts.store.get()) !== null;
  }

  private async keep(t: MobileTokens): Promise<StoredTokens> {
    const stored: StoredTokens = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: this.now() + t.expiresIn * 1000, tenantId: t.tenantId, deviceId: t.deviceId };
    await this.opts.store.set(stored);
    return stored;
  }

  private async authed<T>(method: Method, path: string, body?: unknown, asBlob = false, extra?: Record<string, string>): Promise<T> {
    let tokens = await this.opts.store.get();
    if (!tokens) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
    if (tokens.expiresAt - REFRESH_EARLY_MS <= this.now()) tokens = await this.refresh(tokens);
    if (!tokens) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.');
    try {
      return await this.send<T>(method, path, body, tokens.accessToken, asBlob, extra);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const fresh = await this.refresh(tokens);
      if (!fresh) throw e;
      return this.send<T>(method, path, body, fresh.accessToken, asBlob, extra);
    }
  }

  /** One refresh at a time: concurrent requests wait for the same one, so a rotated token is never sent twice. */
  private refresh(used: StoredTokens): Promise<StoredTokens | null> {
    this.refreshing ??= (async () => {
      try {
        const current = await this.opts.store.get();
        // Another request already refreshed while this one waited.
        if (current && current.refreshToken !== used.refreshToken && current.expiresAt - REFRESH_EARLY_MS > this.now()) return current;
        if (!current) return null;
        const res = await this.send<MobileTokens>('POST', '/mobile/auth/refresh', { refreshToken: current.refreshToken }, null);
        return await this.keep(res);
      } catch (e) {
        // 401: signed out, removed or a reused token. A block (403) is not a sign-out: when the organisation is
        // reinstated the phone carries on with the same tokens.
        if (e instanceof ApiError && e.status === 401) {
          await this.opts.store.set(null);
          this.opts.onSignedOut?.();
          return null;
        }
        throw e;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async send<T>(method: Method, path: string, body: unknown, accessToken: string | null, asBlob = false, extra?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { accept: asBlob ? '*/*' : 'application/json', ...extra };
    const language = this.opts.language?.();
    if (language) headers['accept-language'] = language;
    if (body instanceof RawBody) headers['content-type'] = body.type;
    else if (body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.server}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : body instanceof RawBody ? body.data : JSON.stringify(body) });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 204) return undefined as T;
    if (asBlob && res.ok) return (await res.blob()) as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: ApiErrorBody } | null)?.error;
      throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Something went wrong. Try again.', err?.details ?? []);
    }
    return json as T;
  }
}
