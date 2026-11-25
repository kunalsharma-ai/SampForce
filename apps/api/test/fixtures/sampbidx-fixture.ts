import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for SampBidx's inbound API v1, exactly as docs/integrations/sampbidx-api.md describes it: GET /v1/ping,
 * POST /v1/rfqs and POST /v1/rfq-emails (multipart), under /api (so the base URL is `${url}/api`). It is not
 * SampBidx: it shows SampForce keeps to the document, and SampBidx's own team must build the same endpoints.
 *
 * It also takes chat messages (POST /v1/messages, ADR 0078) and lists them at GET /__messages.
 *
 * SBX.key is accepted; any other key gets 401. An RFQ whose project name contains "REFUSE" gets 422. POST /__fail
 * with {"count": n} makes the next n sends answer 503. GET /__received lists what arrived (for browser tests).
 */
export const SBX = { key: 'sbx_test_key_0123456789', account: 'Frequent Research Bids' };

export interface SbxPart {
  name: string;
  filename: string | null;
  contentType: string;
  size: number;
  text: string | null;
}

export interface SbxReceived {
  id: string;
  path: string;
  idempotencyKey: string | null;
  transferId: string | null;
  json: Record<string, unknown>;
  parts: SbxPart[];
}

export interface SbxMessage {
  id: string;
  idempotencyKey: string | null;
  json: Record<string, unknown>;
  parts: SbxPart[];
}

export interface SampbidxFixture {
  url: string;
  received: SbxReceived[];
  /** Chat messages SampBidx accepted, once each. */
  messages: SbxMessage[];
  calls: string[];
  failNext(n: number): void;
  close(): Promise<void>;
}

/** Signs a status callback the way SampBidx must: sha256=HMAC(secret, `${timestamp}.${body}`). */
export function sbxSign(secret: string, body: string, timestamp = String(Math.floor(Date.now() / 1000))): { timestamp: string; signature: string } {
  return { timestamp, signature: `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` };
}

function parseMultipart(body: Buffer, contentType: string): SbxPart[] & { raw?: never } {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return [];
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  const parts: SbxPart[] = [];
  let pos = body.indexOf(boundary);
  while (pos >= 0) {
    const start = pos + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(boundary, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const sep = chunk.indexOf('\r\n\r\n');
    const head = chunk.subarray(0, sep).toString('utf8');
    const data = chunk.subarray(sep + 4);
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? '';
    const star = /filename\*=UTF-8''([^;\r\n]+)/i.exec(head)?.[1];
    const plain = /filename="([^"]*)"/.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? 'text/plain';
    parts.push({ name, filename: star ? decodeURIComponent(star) : (plain ?? null), contentType: type, size: data.length, text: type.startsWith('application/json') || type === 'message/rfc822' ? data.toString('utf8') : null });
    pos = next;
  }
  return parts;
}

export async function startSampbidxFixture(port = 0): Promise<SampbidxFixture> {
  const received: SbxReceived[] = [];
  const messages: SbxMessage[] = [];
  const messageByKey = new Map<string, SbxMessage>();
  const calls: string[] = [];
  const byKey = new Map<string, SbxReceived>();
  let failures = 0;
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (u.pathname === '/health') return void res.writeHead(200).end('ok');
      if (u.pathname === '/__received') return void json(200, received);
      if (u.pathname === '/__messages') return void json(200, messages);
      if (u.pathname === '/__fail' && req.method === 'POST') {
        failures = Number((JSON.parse(raw.toString() || '{}') as { count?: number }).count ?? 1);
        return void json(200, { failing: failures });
      }
      calls.push(`${req.method} ${u.pathname}`);
      // SampBidx's API lives under /api; anything else is not it.
      if (!u.pathname.startsWith('/api/v1/')) return void json(404, { error: { message: 'Not found' } });
      const path = u.pathname.slice('/api'.length);
      if (req.headers.authorization !== `Bearer ${SBX.key}`) return void json(401, { error: { message: 'Invalid API key' } });
      if (req.method === 'GET' && path === '/v1/ping') return void json(200, { ok: true, account: { name: SBX.account }, apiVersion: 'v1' });
      if (req.method === 'POST' && path === '/v1/messages') {
        if (failures > 0) {
          failures--;
          return void json(503, { error: { message: 'Temporarily unavailable' } });
        }
        const idem = (req.headers['idempotency-key'] as string | undefined) ?? null;
        if (idem && messageByKey.has(idem)) return void json(200, { id: messageByKey.get(idem)!.id, duplicate: true });
        const parts = parseMultipart(raw, String(req.headers['content-type'] ?? ''));
        const main = parts.find((p) => p.name === 'message');
        if (!main?.text) return void json(400, { error: { message: 'Missing the "message" part' } });
        const rec: SbxMessage = { id: `MSG-${randomBytes(3).toString('hex').toUpperCase()}`, idempotencyKey: idem, json: JSON.parse(main.text) as Record<string, unknown>, parts };
        messages.push(rec);
        if (idem) messageByKey.set(idem, rec);
        return void json(201, { id: rec.id });
      }
      if (req.method === 'POST' && (path === '/v1/rfqs' || path === '/v1/rfq-emails')) {
        if (failures > 0) {
          failures--;
          return void json(503, { error: { message: 'Temporarily unavailable' } });
        }
        const idem = (req.headers['idempotency-key'] as string | undefined) ?? null;
        if (idem && byKey.has(idem)) {
          const prior = byKey.get(idem)!;
          return void json(200, { id: prior.id, url: `https://sampbidx.example/bids/${prior.id}`, status: 'received', duplicate: true });
        }
        const parts = parseMultipart(raw, String(req.headers['content-type'] ?? ''));
        const main = parts.find((p) => p.name === (path === '/v1/rfqs' ? 'rfq' : 'email'));
        if (!main?.text) return void json(400, { error: { message: `Missing the "${path === '/v1/rfqs' ? 'rfq' : 'email'}" part` } });
        const body = JSON.parse(main.text) as Record<string, unknown>;
        const project = String((body.rfq as { projectName?: string } | undefined)?.projectName ?? '');
        if (project.includes('REFUSE')) return void json(422, { error: { message: 'Target audience is required for this market' } });
        const rec: SbxReceived = { id: `SBX-${randomBytes(3).toString('hex').toUpperCase()}`, path, idempotencyKey: idem, transferId: (req.headers['x-sampforce-transfer-id'] as string | undefined) ?? null, json: body, parts };
        received.push(rec);
        if (idem) byKey.set(idem, rec);
        return void json(201, { id: rec.id, url: `https://sampbidx.example/bids/${rec.id}`, status: 'received' });
      }
      json(404, { error: { message: 'Not found' } });
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    received,
    messages,
    calls,
    failNext: (n) => void (failures = n),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// Run on its own (Playwright): `tsx test/fixtures/sampbidx-fixture.ts`, port from SAMPBIDX_FIXTURE_PORT.
if (process.argv[1]?.endsWith('sampbidx-fixture.ts')) {
  void startSampbidxFixture(Number(process.env.SAMPBIDX_FIXTURE_PORT ?? 4970)).then((f) => console.warn(`SampBidx fixture on ${f.url}`));
}
