import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for DocuSign's OAuth service, eSignature REST API v2.1 (the calls SampForce makes) and Connect messages,
 * following DocuSign's published docs. Nothing here is real and it has not been compared with live DocuSign responses.
 */
export const DOCUSIGN_APP = { key: 'ds-integration-key', secret: 'ds-secret-key', hmac: 'ds-connect-hmac-key' };
export const DOCUSIGN_ACCOUNT = 'ds-acct-1';

export interface FixtureEnvelope {
  envelopeId: string;
  status: string;
  emailSubject: string;
  signer: { name: string; email: string; tabs: Record<string, unknown[]> };
  pdfBytes: number;
  eventUrl: string | null;
  voidedReason?: string;
}

export interface DocusignFixture {
  url: string;
  calls: string[];
  envelopes: Map<string, FixtureEnvelope>;
  expireAll(): void;
  close(): Promise<void>;
}

export async function startDocusignFixture(port = 0): Promise<DocusignFixture> {
  const calls: string[] = [];
  const envelopes = new Map<string, FixtureEnvelope>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const expired = new Set<string>();
  let n = 0;
  let url = '';
  const issue = () => {
    n++;
    access.add(`dsat-${n}`);
    refresh.add(`dsrt-${n}`);
    return { access_token: `dsat-${n}`, refresh_token: `dsrt-${n}`, token_type: 'Bearer', expires_in: 28800 };
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
      if (u.pathname === '/oauth/auth') {
        const back = new URL(u.searchParams.get('redirect_uri')!);
        back.searchParams.set('code', 'good-code');
        back.searchParams.set('state', u.searchParams.get('state') ?? '');
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (u.pathname === '/oauth/token') {
        if (req.headers.authorization !== `Basic ${Buffer.from(`${DOCUSIGN_APP.key}:${DOCUSIGN_APP.secret}`).toString('base64')}`) return json(401, { error: 'invalid_client' });
        const p = new URLSearchParams(raw);
        if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good-code' ? json(200, issue()) : json(400, { error: 'invalid_grant' });
        if (p.get('grant_type') === 'refresh_token') {
          const rt = p.get('refresh_token') ?? '';
          if (!refresh.has(rt)) return json(400, { error: 'invalid_grant' });
          refresh.delete(rt);
          return json(200, issue());
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const authed = access.has(token) && !expired.has(token);
      if (u.pathname === '/oauth/userinfo') {
        if (!authed) return json(401, { error: 'invalid_token' });
        return json(200, { sub: 'ds-user-1', name: 'Lena Legal', email: 'lena@acme.test', accounts: [{ account_id: DOCUSIGN_ACCOUNT, is_default: true, account_name: 'Acme Legal', base_uri: url }] });
      }
      const m = u.pathname.match(/^\/restapi\/v2\.1\/accounts\/([^/]+)\/envelopes(?:\/([^/]+))?(\/documents\/combined)?$/);
      if (m) {
        if (!authed) return json(401, { errorCode: 'AUTHORIZATION_INVALID_TOKEN', message: 'The access token provided is expired, revoked or malformed.' });
        if (m[1] !== DOCUSIGN_ACCOUNT) return json(400, { errorCode: 'ACCOUNT_LACKS_PERMISSIONS', message: 'Unknown account.' });
        const id = m[2];
        if (!id && req.method === 'POST') {
          const b = JSON.parse(raw) as { emailSubject: string; status: string; documents: { documentBase64: string }[]; recipients: { signers: { name: string; email: string; tabs: Record<string, unknown[]> }[] }; eventNotification?: { url: string } };
          const pdf = Buffer.from(b.documents?.[0]?.documentBase64 ?? '', 'base64');
          if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return json(400, { errorCode: 'INVALID_DOCUMENT', message: 'The document is not a PDF.' });
          const s = b.recipients?.signers?.[0];
          if (!s?.email) return json(400, { errorCode: 'INVALID_RECIPIENT', message: 'A signer is required.' });
          const envelopeId = randomUUID();
          envelopes.set(envelopeId, { envelopeId, status: b.status, emailSubject: b.emailSubject, signer: { name: s.name, email: s.email, tabs: s.tabs }, pdfBytes: pdf.length, eventUrl: b.eventNotification?.url ?? null });
          return json(201, { envelopeId, status: 'sent', statusDateTime: new Date().toISOString(), uri: `/envelopes/${envelopeId}` });
        }
        const e = id ? envelopes.get(id) : undefined;
        if (!e) return json(404, { errorCode: 'ENVELOPE_DOES_NOT_EXIST', message: 'Envelope not found.' });
        if (m[3]) {
          res.writeHead(200, { 'content-type': 'application/pdf' });
          return res.end('%PDF-1.4\n% signed copy (stand-in)\n');
        }
        if (req.method === 'PUT') {
          const b = JSON.parse(raw) as { status?: string; voidedReason?: string };
          if (b.status === 'voided') {
            if (e.status === 'completed') return json(400, { errorCode: 'ENVELOPE_CANNOT_VOID_INVALID_STATE', message: 'Only envelopes in progress can be voided.' });
            e.status = 'voided';
            e.voidedReason = b.voidedReason;
          }
          return json(200, { envelopeId: e.envelopeId });
        }
        return json(200, {
          envelopeId: e.envelopeId,
          status: e.status,
          ...(e.status === 'completed' ? { completedDateTime: '2026-11-02T10:00:00Z' } : {}),
          ...(e.voidedReason ? { voidedReason: e.voidedReason } : {}),
          recipients: { signers: [{ name: e.signer.name, email: e.signer.email, status: e.status === 'completed' ? 'completed' : 'sent' }] },
        });
      }
      json(404, { errorCode: 'NOT_FOUND' });
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, envelopes, expireAll: () => access.forEach((t) => expired.add(t)), close: () => new Promise((r) => server.close(() => r())) };
}

/** A Connect 2.0 JSON message, signed the way DocuSign signs it (X-DocuSign-Signature-1). */
export function connectMessage(
  envelopeId: string,
  event: string,
  opts: { accountId?: string; signer?: { name: string; email: string; declinedReason?: string }; key?: string } = {},
): { raw: string; headers: Record<string, string> } {
  const body = {
    event,
    apiVersion: 'v2.1',
    uri: `/restapi/v2.1/accounts/${opts.accountId ?? DOCUSIGN_ACCOUNT}/envelopes/${envelopeId}`,
    retryCount: 0,
    configurationId: 101,
    generatedDateTime: new Date().toISOString(),
    data: {
      accountId: opts.accountId ?? DOCUSIGN_ACCOUNT,
      userId: 'ds-user-1',
      envelopeId,
      envelopeSummary: {
        status: event.replace('envelope-', ''),
        ...(event === 'envelope-completed' ? { completedDateTime: '2026-11-02T10:00:00Z' } : {}),
        recipients: { signers: opts.signer ? [{ ...opts.signer, recipientId: '1', status: event.replace('envelope-', '') }] : [] },
      },
    },
  };
  const raw = JSON.stringify(body);
  return { raw, headers: { 'content-type': 'application/json', 'x-docusign-signature-1': createHmac('sha256', opts.key ?? DOCUSIGN_APP.hmac).update(raw).digest('base64') } };
}

// Run on its own (Playwright): `tsx test/fixtures/docusign-fixture.ts`, port from DOCUSIGN_FIXTURE_PORT.
if (process.argv[1]?.endsWith('docusign-fixture.ts')) {
  void startDocusignFixture(Number(process.env.DOCUSIGN_FIXTURE_PORT ?? 4800)).then((f) => console.warn(`DocuSign fixture on ${f.url}`));
}
