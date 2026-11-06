import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Google and Microsoft endpoints SampForce calls. It implements only the
 * request and response shapes the adapters use, so the adapters are exercised end to end over HTTP
 * without real accounts. Passing these tests does not prove the live providers accept our app;
 * that needs real OAuth client credentials (see docs/INTEGRATIONS.md).
 */
export interface FixtureState {
  revoked: boolean;
  requests: { method: string; path: string; body: string; headers: IncomingMessage['headers'] }[];
  gmailMessages: GmailFixtureMessage[];
  googleEvents: unknown[];
  graphMessages: unknown[];
  graphEvents: unknown[];
  sent: { provider: 'google' | 'microsoft'; body: string }[];
}

export interface GmailFixtureMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  internalDate: number;
  labels?: string[];
  threadId?: string;
}

export interface ProviderFixture {
  url: string;
  state: FixtureState;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });

export async function startProviderFixture(): Promise<ProviderFixture> {
  const state: FixtureState = { revoked: false, requests: [], gmailMessages: [], googleEvents: [], graphMessages: [], graphEvents: [], sent: [] };
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    const body = await read(req);
    state.requests.push({ method: req.method ?? 'GET', path: url.pathname, body, headers: req.headers });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload === null ? '' : JSON.stringify(payload));
    };
    const authed = () => {
      if (state.revoked || !(req.headers.authorization ?? '').startsWith('Bearer at-')) {
        json(401, { error: { message: 'Invalid Credentials' } });
        return false;
      }
      return true;
    };
    const p = url.pathname;

    // ── OAuth token endpoints ──
    if (req.method === 'POST' && (p === '/google/token' || /\/oauth2\/v2\.0\/token$/.test(p))) {
      const form = new URLSearchParams(body);
      // Like Google and Microsoft, the client is checked before the code.
      if (!form.get('client_id') || !form.get('client_secret') || form.get('client_secret')!.includes('wrong')) return json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      if (state.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      if (form.get('grant_type') === 'authorization_code' && form.get('code') !== 'good-code') return json(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
      return json(200, { access_token: `at-${Date.now()}`, refresh_token: 'rt-1', expires_in: 3600, scope: 'openid email' });
    }

    // ── Google ──
    if (p === '/oauth2/v3/userinfo') return authed() && json(200, { email: 'Rep@Seller.test' });
    if (p === '/gmail/v1/users/me/messages') {
      if (!authed()) return;
      const after = Number((url.searchParams.get('q') ?? '').replace('after:', '')) * 1000;
      const ids = state.gmailMessages.filter((m) => m.internalDate > after).sort((a, b) => b.internalDate - a.internalDate).map((m) => ({ id: m.id }));
      return json(200, { messages: ids });
    }
    const gm = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
    if (gm && req.method === 'GET') {
      if (!authed()) return;
      const m = state.gmailMessages.find((x) => x.id === decodeURIComponent(gm[1]!));
      if (!m) return json(404, { error: { message: 'Not found' } });
      return json(200, {
        id: m.id,
        threadId: m.threadId ?? `t-${m.id}`,
        internalDate: String(m.internalDate),
        snippet: m.body.slice(0, 40),
        labelIds: m.labels ?? ['INBOX'],
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: `"Sender" <${m.from}>` },
            { name: 'To', value: m.to },
            { name: 'Subject', value: m.subject },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(m.body).toString('base64url') } }],
        },
      });
    }
    if (p === '/gmail/v1/users/me/messages/send' && req.method === 'POST') {
      if (!authed()) return;
      state.sent.push({ provider: 'google', body });
      return json(200, { id: `sent-${state.sent.length}`, threadId: (JSON.parse(body) as { threadId?: string }).threadId ?? 'thread-sent' });
    }
    if (p === '/calendar/v3/calendars/primary/events') return authed() && json(200, { items: state.googleEvents });

    // ── Microsoft Graph ──
    if (p === '/v1.0/me') return authed() && json(200, { mail: null, userPrincipalName: 'rep@seller.test' });
    if (p === '/v1.0/me/mailFolders/inbox/messages') return authed() && json(200, { value: state.graphMessages });
    if (p === '/v1.0/me/calendarView') return authed() && json(200, { value: state.graphEvents });
    if (p === '/v1.0/me/sendMail' && req.method === 'POST') {
      if (!authed()) return;
      state.sent.push({ provider: 'microsoft', body });
      return json(202, null);
    }
    json(404, { error: { message: `fixture has no route for ${req.method} ${p}` } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Points the adapters at the fixture. Call before the app is created (env is read at startup). */
export function providerEnv(base: string): Record<string, string> {
  return {
    GOOGLE_CLIENT_ID: 'fixture-google-client',
    GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    GOOGLE_AUTH_BASE_URL: `${base}/google`,
    GOOGLE_TOKEN_URL: `${base}/google/token`,
    GOOGLE_API_BASE_URL: base,
    GMAIL_API_BASE_URL: base,
    MICROSOFT_CLIENT_ID: 'fixture-ms-client',
    MICROSOFT_CLIENT_SECRET: 'fixture-ms-secret',
    MICROSOFT_LOGIN_BASE_URL: `${base}/ms`,
    MICROSOFT_GRAPH_BASE_URL: base,
  };
}
