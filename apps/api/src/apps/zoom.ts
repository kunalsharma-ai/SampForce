import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { TranscriptSegment } from '@dealflow/types';
import { assertPublicUrl } from '../common/net-guard';
import { API_ENV, type ApiEnv } from '../common/env';

export interface ZoomTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

export interface ZoomUser {
  id: string;
  email: string;
  accountId: string;
  name: string;
}

export interface ZoomCreatedMeeting {
  id: string;
  joinUrl: string;
  startTime: string;
  duration: number;
}

/**
 * Zoom answered with an error. `revoked` means the connection itself no longer works (the app was removed or the
 * refresh token is no longer valid); reconnecting is the only fix.
 */
export class ZoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly revoked = false,
  ) {
    super(message);
  }
}

const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024;

/**
 * Zoom OAuth (General app, admin-managed) and REST API v2: users/me, create a meeting for a user in the account,
 * and download a transcript file. Plus the event-notification signature and URL validation. Tested against a local
 * stand-in that follows Zoom's published API; not yet against Zoom itself.
 */
@Injectable()
export class ZoomClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  missingConfig(): string[] {
    return [!this.env.ZOOM_CLIENT_ID && 'ZOOM_CLIENT_ID', !this.env.ZOOM_CLIENT_SECRET && 'ZOOM_CLIENT_SECRET'].filter((x): x is string => !!x);
  }

  /** Transcript import needs Zoom to send events, which are verified with this secret. */
  get webhookConfigured(): boolean {
    return !!this.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const u = new URL('/oauth/authorize', this.env.ZOOM_AUTH_BASE_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', this.env.ZOOM_CLIENT_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  }

  exchangeCode(code: string, redirectUri: string): Promise<ZoomTokens> {
    return this.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  }

  /** Zoom rotates the refresh token on every refresh; the caller must store the new one. */
  refresh(refreshToken: string): Promise<ZoomTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(accessToken: string): Promise<void> {
    const u = new URL('/oauth/revoke', this.env.ZOOM_AUTH_BASE_URL);
    u.searchParams.set('token', accessToken);
    await fetch(u, { method: 'POST', headers: { authorization: this.basic() }, signal: AbortSignal.timeout(10_000) });
  }

  async me(accessToken: string): Promise<ZoomUser> {
    const body = await this.api<{ id: string; email: string; account_id: string; first_name?: string; last_name?: string }>(accessToken, 'GET', '/users/me');
    return { id: body.id, email: body.email, accountId: body.account_id, name: [body.first_name, body.last_name].filter(Boolean).join(' ') || body.email };
  }

  async createMeeting(
    accessToken: string,
    hostEmail: string,
    m: { topic: string; startTime: string; duration: number; timezone?: string; agenda?: string; recordToCloud: boolean },
  ): Promise<ZoomCreatedMeeting> {
    const body = await this.api<{ id: number | string; join_url: string; start_time: string; duration: number }>(accessToken, 'POST', `/users/${encodeURIComponent(hostEmail)}/meetings`, {
      topic: m.topic,
      type: 2,
      start_time: m.startTime,
      duration: m.duration,
      ...(m.timezone ? { timezone: m.timezone } : {}),
      ...(m.agenda ? { agenda: m.agenda.slice(0, 2000) } : {}),
      settings: { auto_recording: m.recordToCloud ? 'cloud' : 'none', join_before_host: false, waiting_room: true },
    });
    return { id: String(body.id), joinUrl: body.join_url, startTime: body.start_time, duration: body.duration };
  }

  /** Downloads a transcript (WebVTT) with the download token from Zoom's event. Only Zoom hosts, at most 5 MB. */
  async downloadTranscript(url: string, downloadToken: string): Promise<string> {
    let target = await assertPublicUrl(url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    if (!this.env.ALLOW_PRIVATE_NETWORK_TARGETS && !/(^|\.)zoom\.us$/i.test(target.hostname)) throw new ZoomError('bad_url', 'The transcript link is not on zoom.us.');
    // Zoom redirects downloads to its file storage; follow at most three hops, checking each one, and send the
    // token only to zoom.us itself.
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      const onZoom = /(^|\.)zoom\.us$/i.test(target.hostname) || hop === 0;
      res = await fetch(target, { headers: onZoom ? { authorization: `Bearer ${downloadToken}` } : {}, redirect: 'manual', signal: AbortSignal.timeout(30_000) }).catch(() => {
        throw new ZoomError('download_failed', 'Zoom could not be reached for the transcript.');
      });
      const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!next) break;
      if (hop === 3) throw new ZoomError('download_failed', 'Zoom redirected the transcript download too many times.');
      target = await assertPublicUrl(new URL(next, target).toString(), this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    }
    if (!res) throw new ZoomError('download_failed', 'Zoom could not be reached for the transcript.');
    if (res.status === 401 || res.status === 403) throw new ZoomError('download_expired', 'Zoom no longer allows this transcript to be downloaded (the link expired).');
    if (!res.ok) throw new ZoomError('download_failed', `Zoom answered HTTP ${res.status} for the transcript.`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_TRANSCRIPT_BYTES) throw new ZoomError('too_large', 'The transcript is larger than 5 MB.');
    const text = await res.text();
    if (text.length > MAX_TRANSCRIPT_BYTES) throw new ZoomError('too_large', 'The transcript is larger than 5 MB.');
    return text;
  }

  /** Zoom event notifications: `x-zm-signature` is v0= HMAC-SHA256 of "v0:{timestamp}:{body}" with the secret token. */
  verifySignature(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined, now = Date.now()): boolean {
    const secret = this.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    if (!secret || !timestamp || !signature) return false;
    const ts = Number(timestamp);
    // Zoom sends seconds; refuse anything more than five minutes off to stop replays.
    if (!Number.isFinite(ts) || Math.abs(now - ts * 1000) > 5 * 60_000) return false;
    const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody.toString('utf8')}`).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** The answer to Zoom's endpoint.url_validation challenge. */
  urlValidation(plainToken: string): { plainToken: string; encryptedToken: string } {
    return { plainToken, encryptedToken: createHmac('sha256', this.env.ZOOM_WEBHOOK_SECRET_TOKEN!).update(plainToken).digest('hex') };
  }

  private async token(params: Record<string, string>): Promise<ZoomTokens> {
    const res = await fetch(new URL('/oauth/token', this.env.ZOOM_AUTH_BASE_URL), {
      method: 'POST',
      headers: { authorization: this.basic(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new ZoomError('unavailable', 'Zoom could not be reached.');
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; reason?: string; error?: string };
    if (!res.ok || !body.access_token || !body.refresh_token) {
      const revoked = body.error === 'invalid_grant' || body.error === 'invalid_client' || res.status === 401;
      throw new ZoomError(body.error ?? 'token_failed', revoked ? 'Zoom no longer accepts the DealFlow connection. Reconnect Zoom in Integrations.' : `Zoom refused the sign-in (${body.reason ?? body.error ?? res.status}).`, revoked);
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000, scopes: (body.scope ?? '').split(/[ ,]+/).filter(Boolean) };
  }

  private async api<T>(accessToken: string, method: string, path: string, json?: object): Promise<T> {
    const base = this.env.ZOOM_API_BASE_URL.replace(/\/$/, '');
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${accessToken}`, ...(json ? { 'content-type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new ZoomError('unavailable', e instanceof Error && e.name === 'TimeoutError' ? 'Zoom did not answer in time.' : 'Zoom could not be reached.');
    }
    const body = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
    if (res.ok) return body;
    if (res.status === 401) throw new ZoomError('unauthorized', 'Zoom refused the access token.', false);
    if (res.status === 429) throw new ZoomError('ratelimited', 'Zoom is limiting requests. Try again in a minute.');
    if (body.code === 1001) throw new ZoomError('user_not_found', `${decodeURIComponent(path.split('/')[2] ?? '')} is not a user in the connected Zoom account. Ask your Zoom admin to add them, or schedule from Zoom.`);
    throw new ZoomError(`http_${res.status}`, body.message ? `Zoom: ${body.message}` : `Zoom answered HTTP ${res.status}.`);
  }

  private basic(): string {
    return `Basic ${Buffer.from(`${this.env.ZOOM_CLIENT_ID}:${this.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`;
  }
}

/**
 * Turns a Zoom WebVTT transcript into plain "Name: words" lines and segments. Zoom writes each cue as
 * "Name: text"; names are numbered in order of first appearance for the segment speaker index.
 */
export function parseZoomVtt(vtt: string): { text: string; segments: TranscriptSegment[] } {
  const speakers = new Map<string, number>();
  const segments: TranscriptSegment[] = [];
  const lines: string[] = [];
  const blocks = vtt.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const rows = block.split('\n').filter(Boolean);
    const timing = rows.findIndex((r) => r.includes('-->'));
    if (timing < 0) continue;
    const [from, to] = rows[timing]!.split('-->').map((t) => seconds(t.trim()));
    const said = rows.slice(timing + 1).join(' ').trim();
    if (!said) continue;
    const m = said.match(/^([^:]{1,80}):\s+(.*)$/);
    const name = m ? m[1]!.trim() : null;
    const words = m ? m[2]! : said;
    let speaker: number | null = null;
    if (name) {
      if (!speakers.has(name)) speakers.set(name, speakers.size);
      speaker = speakers.get(name)!;
    }
    segments.push({ speaker, start: from ?? 0, end: to ?? 0, text: words });
    lines.push(name ? `${name}: ${words}` : words);
  }
  return { text: lines.join('\n').slice(0, 200_000), segments: segments.slice(0, 5000) };
}

function seconds(t: string): number | null {
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]!.padEnd(3, '0')) / 1000;
}
