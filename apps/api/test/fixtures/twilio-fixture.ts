import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { smsSegments } from '@dealflow/types';

/**
 * Stand-in for the Twilio REST API (2010-04-01) endpoints DealFlow uses for SMS, plus helpers to sign the requests
 * Twilio sends (X-Twilio-Signature). Shapes follow Twilio's published API reference; none of this has been compared
 * with a live response.
 *
 * Account TW.sid with TW.token is a full account owning TW.number (SMS) and TW.voiceOnly (no SMS). TW.trialSid is a
 * trial account. Any other token is refused with 20003. Texting TW.landline fails with 21614.
 */
export const TW = {
  sid: `AC${'0123456789abcdef'.repeat(2)}`,
  token: 'abcdef0123456789abcdef0123456789',
  trialSid: `AC${'fedcba9876543210'.repeat(2)}`,
  number: '+447700900100',
  voiceOnly: '+447700900101',
  landline: '+442079460000',
};

export interface TwSent {
  sid: string;
  to: string;
  from: string;
  body: string;
  statusCallback: string | null;
}

export interface TwilioFixture {
  url: string;
  sent: TwSent[];
  calls: string[];
  close(): Promise<void>;
}

export function twSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

/** The form fields Twilio posts for an inbound SMS. */
export function twInbound(from: string, body: string, opts: { sid?: string; to?: string; optOutType?: string } = {}): Record<string, string> {
  return {
    MessageSid: opts.sid ?? `SM${randomBytes(16).toString('hex')}`,
    SmsSid: opts.sid ?? `SM${randomBytes(16).toString('hex')}`,
    AccountSid: TW.sid,
    From: from,
    To: opts.to ?? TW.number,
    Body: body,
    NumMedia: '0',
    NumSegments: String(smsSegments(body).segments),
    ApiVersion: '2010-04-01',
    ...(opts.optOutType ? { OptOutType: opts.optOutType } : {}),
  };
}

/** The form fields Twilio posts to a status callback. */
export function twStatus(sid: string, status: string, to: string, errorCode?: number): Record<string, string> {
  return { MessageSid: sid, SmsSid: sid, AccountSid: TW.sid, From: TW.number, To: to, MessageStatus: status, SmsStatus: status, ApiVersion: '2010-04-01', ...(errorCode ? { ErrorCode: String(errorCode) } : {}) };
}

const ACCOUNTS: Record<string, { friendly_name: string; type: string }> = {
  [TW.sid]: { friendly_name: 'Globex Sales', type: 'Full' },
  [TW.trialSid]: { friendly_name: 'Globex Trial', type: 'Trial' },
};

export async function startTwilioFixture(port = 0): Promise<TwilioFixture> {
  const sent: TwSent[] = [];
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      const err = (status: number, code: number, message: string) => json(status, { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
      if (u.pathname === '/health') return void res.writeHead(200).end('ok');
      calls.push(`${req.method} ${u.pathname}`);
      const [user, pass] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
      const m = /^\/2010-04-01\/Accounts\/(AC[a-f0-9]{32})(\.json|\/IncomingPhoneNumbers\.json|\/Messages\.json)$/.exec(u.pathname);
      if (!m) return void err(404, 20404, 'The requested resource was not found');
      const sid = m[1]!;
      if (user !== sid || pass !== TW.token || !ACCOUNTS[sid]) return void err(401, 20003, 'Authenticate');
      if (req.method === 'GET' && m[2] === '.json') return void json(200, { sid, ...ACCOUNTS[sid], status: 'active' });
      if (req.method === 'GET' && m[2] === '/IncomingPhoneNumbers.json') {
        const want = u.searchParams.get('PhoneNumber');
        const all = [
          { sid: `PN${'1'.repeat(32)}`, phone_number: TW.number, capabilities: { sms: true, voice: true, mms: false } },
          { sid: `PN${'2'.repeat(32)}`, phone_number: TW.voiceOnly, capabilities: { sms: false, voice: true, mms: false } },
        ];
        return void json(200, { incoming_phone_numbers: all.filter((n) => !want || n.phone_number === want), page: 0, page_size: 20 });
      }
      if (req.method === 'POST' && m[2] === '/Messages.json') {
        const f = new URLSearchParams(raw);
        const to = f.get('To') ?? '';
        const from = f.get('From') ?? '';
        const body = f.get('Body') ?? '';
        if (!/^\+[1-9]\d{7,14}$/.test(to)) return void err(400, 21211, `The 'To' number ${to} is not a valid phone number.`);
        if (from !== TW.number) return void err(400, 21606, `The From phone number ${from} is not a valid, SMS-capable inbound phone number or short code for your account.`);
        if (!body) return void err(400, 21602, 'Message body is required.');
        if (body.length > 1600) return void err(400, 21617, 'The concatenated message body exceeds the 1600 character limit.');
        if (to === TW.landline) return void err(400, 21614, `'To' number is not a valid mobile number`);
        const msgSid = `SM${randomBytes(16).toString('hex')}`;
        sent.push({ sid: msgSid, to, from, body, statusCallback: f.get('StatusCallback') });
        return void json(201, { sid: msgSid, account_sid: sid, to, from, body, status: 'queued', num_segments: String(smsSegments(body).segments), direction: 'outbound-api', error_code: null, error_message: null, api_version: '2010-04-01' });
      }
      err(405, 20004, 'Method not allowed');
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sent, calls, close: () => new Promise((r) => server.close(() => r())) };
}

// Run on its own (Playwright): `tsx test/fixtures/twilio-fixture.ts`, port from TWILIO_FIXTURE_PORT.
if (process.argv[1]?.endsWith('twilio-fixture.ts')) {
  void startTwilioFixture(Number(process.env.TWILIO_FIXTURE_PORT ?? 4960)).then((f) => console.warn(`Twilio fixture on ${f.url}`));
}
