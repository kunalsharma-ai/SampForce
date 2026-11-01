import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for Zoom OAuth (General app), the REST API v2 calls DealFlow makes and a transcript download, following
 * Zoom's published docs. Nothing here is real and it has not been compared with live Zoom responses.
 */
export const ZOOM_APP = { id: 'zoom-client-id', secret: 'zoom-client-secret', webhookSecret: 'zoom-webhook-secret' };
export const ZOOM_ACCOUNT = 'ZACCT123';

export const ZOOM_VTT = `WEBVTT

1
00:00:01.200 --> 00:00:04.500
Priya Raman: Thanks for joining. Can we go over pricing for 40 seats?

2
00:00:05.000 --> 00:00:09.100
Owen Price: Yes. We need SSO and an answer by Friday.

3
00:00:09.500 --> 00:00:12.000
Priya Raman: I'll send the proposal tomorrow.
`;

export interface ZoomFixture {
  url: string;
  calls: string[];
  meetings: { id: string; host: string; body: Record<string, unknown> }[];
  /** Access tokens that now answer 401 (expired early); refresh still works. */
  expired: Set<string>;
  /** Refresh tokens Zoom no longer accepts (app removed). */
  deadRefresh: Set<string>;
  /** Emails that are not users in the made-up Zoom account (every other email is). */
  notUsers: Set<string>;
  liveRefreshTokens(): string[];
  /** Makes every access token issued so far answer 401, as if it expired early. */
  expireAll(): void;
  close(): Promise<void>;
}

export async function startZoomFixture(port = 0): Promise<ZoomFixture> {
  const calls: string[] = [];
  const meetings: ZoomFixture['meetings'] = [];
  const expired = new Set<string>();
  const deadRefresh = new Set<string>();
  const notUsers = new Set<string>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  let n = 0;
  let meetingSeq = 85_000_000_000;
  const issue = () => {
    n++;
    const a = `zat-${n}`;
    const r = `zrt-${n}`;
    access.add(a);
    refresh.add(r);
    return { access_token: a, refresh_token: r, token_type: 'bearer', expires_in: 3599, scope: 'meeting:write:meeting:admin user:read:user:admin' };
  };
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === '/health') return json(200, { ok: true });
      if (u.pathname === '/oauth/authorize') {
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'good-code');
        back.searchParams.set('state', u.searchParams.get('state') ?? '');
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      const basicOk = req.headers.authorization === `Basic ${Buffer.from(`${ZOOM_APP.id}:${ZOOM_APP.secret}`).toString('base64')}`;
      if (u.pathname === '/oauth/token') {
        if (!basicOk) return json(401, { reason: 'Invalid client_id or client_secret', error: 'invalid_client' });
        const p = new URLSearchParams(raw);
        if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good-code' ? json(200, issue()) : json(400, { reason: 'Invalid authorization code', error: 'invalid_grant' });
        if (p.get('grant_type') === 'refresh_token') {
          const rt = p.get('refresh_token') ?? '';
          if (!refresh.has(rt) || deadRefresh.has(rt)) return json(400, { reason: 'Invalid Token!', error: 'invalid_grant' });
          // Zoom rotates refresh tokens: the old one stops working.
          refresh.delete(rt);
          return json(200, issue());
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (u.pathname === '/oauth/revoke') {
        access.delete(u.searchParams.get('token') ?? '');
        return json(200, { status: 'success' });
      }
      if (u.pathname.startsWith('/rec/download/')) {
        if (req.headers.authorization !== 'Bearer dl-token') return json(401, { code: 124, message: 'Invalid access token.' });
        res.writeHead(200, { 'content-type': 'text/vtt' });
        return res.end(ZOOM_VTT);
      }
      if (u.pathname.startsWith('/v2/')) {
        const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!access.has(token) || expired.has(token)) return json(401, { code: 124, message: 'Invalid access token.' });
        if (u.pathname === '/v2/users/me') return json(200, { id: 'zu_owner', email: 'owner@zoom.test', first_name: 'Olivia', last_name: 'Owner', account_id: ZOOM_ACCOUNT });
        const m = u.pathname.match(/^\/v2\/users\/([^/]+)\/meetings$/);
        if (m && req.method === 'POST') {
          const host = decodeURIComponent(m[1]!);
          if (notUsers.has(host)) return json(404, { code: 1001, message: 'User does not exist: ' + host });
          const body = JSON.parse(raw) as { topic: string; start_time: string; duration: number };
          const id = String(++meetingSeq);
          meetings.push({ id, host, body });
          return json(201, { id: Number(id), uuid: `uuid-${id}`, host_email: host, topic: body.topic, start_time: body.start_time, duration: body.duration, join_url: `https://zoom.test/j/${id}` });
        }
      }
      json(404, { code: 404, message: 'Not found' });
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, meetings, expired, deadRefresh, notUsers, liveRefreshTokens: () => [...refresh], expireAll: () => access.forEach((t) => expired.add(t)), close: () => new Promise((r) => server.close(() => r())) };
}

/** Signs a Zoom event the way Zoom does, for tests that post events to DealFlow. */
export function signZoomEvent(body: object, secret = ZOOM_APP.webhookSecret, ts = Math.floor(Date.now() / 1000)): { raw: string; headers: Record<string, string> } {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'content-type': 'application/json', 'x-zm-request-timestamp': String(ts), 'x-zm-signature': `v0=${createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}` } };
}

export function transcriptEvent(fixtureUrl: string, zoomMeetingId: string, accountId = ZOOM_ACCOUNT): object {
  return {
    event: 'recording.transcript_completed',
    event_ts: Date.now(),
    download_token: 'dl-token',
    payload: {
      account_id: accountId,
      object: { id: Number(zoomMeetingId), uuid: `uuid-${zoomMeetingId}`, recording_files: [{ id: 'f1', file_type: 'TRANSCRIPT', file_extension: 'VTT', status: 'completed', download_url: `${fixtureUrl}/rec/download/f1` }] },
    },
  };
}

// Run on its own (Playwright): `tsx test/fixtures/zoom-fixture.ts`, port from ZOOM_FIXTURE_PORT.
if (process.argv[1]?.endsWith('zoom-fixture.ts')) {
  void startZoomFixture(Number(process.env.ZOOM_FIXTURE_PORT ?? 4700)).then((f) => console.warn(`Zoom fixture on ${f.url}`));
}
