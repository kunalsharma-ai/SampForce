import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Slack Web API calls SampForce makes (oauth.v2.access, auth.test, conversations.list,
 * chat.postMessage, auth.revoke). Shapes follow Slack's published docs; passing these tests does not prove Slack
 * accepts the app. Slack answers HTTP 200 with ok:false for errors, which this copies.
 */
export interface SlackFixture {
  url: string;
  posts: { channel: string; text: string; token: string }[];
  calls: string[];
  /** Tokens Slack would no longer accept (app removed). */
  revoked: Set<string>;
  close(): Promise<void>;
}

export const SLACK_CLIENT = { id: 'slack-client-id', secret: 'slack-client-secret' };

export async function startSlackFixture(port = 0): Promise<SlackFixture> {
  const posts: SlackFixture['posts'] = [];
  const calls: string[] = [];
  const revoked = new Set<string>();
  let n = 0;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      calls.push(path);
      const ok = (body: object) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, ...body }));
      const fail = (error: string) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error }));
      const form = Object.fromEntries(new URLSearchParams(raw));
      const auth = req.headers.authorization ?? '';
      if (path === '/health') return res.writeHead(200).end('ok');
      // The consent screen: approves at once and sends the browser back with a code, as Slack does after "Allow".
      if (path === '/oauth/v2/authorize') {
        const q = new URL(req.url ?? '/', 'http://x').searchParams;
        if (q.get('client_id') !== SLACK_CLIENT.id || !q.get('redirect_uri')) return res.writeHead(400).end('bad request');
        const back = new URL(q.get('redirect_uri')!);
        back.searchParams.set('code', 'good-code');
        back.searchParams.set('state', q.get('state') ?? '');
        return res.writeHead(302, { location: back.toString() }).end();
      }
      if (path === '/api/oauth.v2.access') {
        const expected = `Basic ${Buffer.from(`${SLACK_CLIENT.id}:${SLACK_CLIENT.secret}`).toString('base64')}`;
        if (auth !== expected) return fail('invalid_client_id');
        if (form.code !== 'good-code') return fail('invalid_code');
        return ok({ access_token: `xoxb-test-${++n}`, token_type: 'bot', scope: 'chat:write,chat:write.public,channels:read,groups:read', bot_user_id: 'U0BOT', team: { id: 'T0ACME', name: 'Acme Sales' } });
      }
      const token = auth.replace(/^Bearer /, '');
      if (!token.startsWith('xoxb-test-')) return fail('not_authed');
      if (revoked.has(token)) return fail('token_revoked');
      if (path === '/api/auth.test') return ok({ team_id: 'T0ACME', team: 'Acme Sales', user_id: 'U0BOT', bot_id: 'B0BOT' });
      if (path === '/api/auth.revoke') {
        revoked.add(token);
        return ok({ revoked: true });
      }
      if (path === '/api/conversations.list') {
        return ok({
          channels: [
            { id: 'C0SALES', name: 'sales', is_private: false, is_member: true },
            { id: 'C0WINS', name: 'deal-wins', is_private: false, is_member: false },
            { id: 'G0LEADS', name: 'leadership', is_private: true, is_member: true },
          ],
          response_metadata: { next_cursor: '' },
        });
      }
      if (path === '/api/chat.postMessage') {
        const body = JSON.parse(raw || '{}') as { channel?: string; text?: string };
        if (!body.channel || !['C0SALES', 'C0WINS', 'G0LEADS'].includes(body.channel)) return fail('channel_not_found');
        posts.push({ channel: body.channel, text: body.text ?? '', token });
        return ok({ channel: body.channel, ts: `1700000000.${String(posts.length).padStart(6, '0')}` });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, posts, calls, revoked, close: () => new Promise((r) => server.close(() => r())) };
}

// Run on its own (Playwright): `tsx test/fixtures/slack-fixture.ts`, port from SLACK_FIXTURE_PORT.
if (process.argv[1]?.endsWith('slack-fixture.ts')) {
  void startSlackFixture(Number(process.env.SLACK_FIXTURE_PORT ?? 4500)).then((f) => console.warn(`Slack fixture on ${f.url}`));
}
