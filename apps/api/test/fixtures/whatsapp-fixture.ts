import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for the Meta Graph API endpoints DealFlow uses for WhatsApp Business (Cloud API), plus builders for the
 * webhook deliveries Meta sends, signed with X-Hub-Signature-256. Shapes follow Meta's published Cloud API
 * reference; none of this has been compared with a live response.
 *
 * Token `EAAgood…` works, `EAArevoked…` is refused with error 190. Number 1000000001 belongs to business account
 * 2000000001. Sending to 447700900999 fails with 131026 (not on WhatsApp).
 */
export const WA = {
  phoneNumberId: '1000000001',
  wabaId: '2000000001',
  token: 'EAAgoodFixtureToken0123456789abcdef',
  appSecret: '0123456789abcdef0123456789abcdef',
  undeliverable: '447700900999',
};

export interface WaSent {
  to: string;
  type: string;
  template?: { name: string; language: { code: string }; components?: { type: string; parameters: { type: string; text: string }[] }[] };
  text?: { body: string };
  id: string;
}

export interface WhatsappFixture {
  url: string;
  sent: WaSent[];
  calls: string[];
  close(): Promise<void>;
}

const TEMPLATES = [
  { name: 'proposal_ready', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, your proposal {{2}} is ready. Reply here with any questions.' }] },
  { name: 'hello_world', language: 'en_US', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'HEADER', format: 'TEXT', text: 'Hello' }, { type: 'BODY', text: 'Welcome and congratulations!' }] },
  { name: 'promo_image', language: 'en', category: 'MARKETING', status: 'APPROVED', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'New offer {{1}}' }] },
  { name: 'still_in_review', language: 'en', category: 'UTILITY', status: 'PENDING', components: [{ type: 'BODY', text: 'Pending' }] },
];

const NUMBERS: Record<string, { display_phone_number: string; verified_name: string; quality_rating: string }> = {
  [WA.phoneNumberId]: { display_phone_number: '+44 7700 900123', verified_name: 'Globex Sales', quality_rating: 'GREEN' },
};

export function waSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** A delivery with one inbound text message, as Meta sends it. */
export function waInbound(from: string, text: string, opts: { id?: string; name?: string; phoneNumberId?: string; at?: number } = {}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WA.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '447700900123', phone_number_id: opts.phoneNumberId ?? WA.phoneNumberId },
              contacts: [{ profile: { name: opts.name ?? 'Gia' }, wa_id: from }],
              messages: [{ from, id: opts.id ?? `wamid.in${Math.random().toString(36).slice(2)}`, timestamp: String(Math.floor((opts.at ?? Date.now()) / 1000)), type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

/** A delivery with one status update for a message DealFlow sent. */
export function waStatus(id: string, status: 'sent' | 'delivered' | 'read' | 'failed', to: string, error?: { code: number; title: string }): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WA.wabaId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '447700900123', phone_number_id: WA.phoneNumberId },
              statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to, ...(error ? { errors: [{ ...error, message: error.title }] } : {}) }],
            },
          },
        ],
      },
    ],
  });
}

export async function startWhatsappFixture(port = 0): Promise<WhatsappFixture> {
  const sent: WaSent[] = [];
  const calls: string[] = [];
  let n = 0;
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (u.pathname === '/health') return void res.writeHead(200).end('ok');
      calls.push(`${req.method} ${u.pathname}`);
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!token.startsWith('EAAgood')) return void json(401, { error: { message: 'Error validating access token: Session has expired.', type: 'OAuthException', code: 190, fbtrace_id: 'fx' } });
      const parts = u.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && parts.length === 1) {
        const num = NUMBERS[parts[0]!];
        if (!num) return void json(400, { error: { message: `Unsupported get request. Object with ID '${parts[0]}' does not exist.`, type: 'GraphMethodException', code: 100 } });
        return void json(200, { id: parts[0], ...num });
      }
      if (req.method === 'GET' && parts[1] === 'phone_numbers') return void json(200, { data: parts[0] === WA.wabaId ? [{ id: WA.phoneNumberId }] : [] });
      if (req.method === 'GET' && parts[1] === 'message_templates') return void json(200, { data: parts[0] === WA.wabaId ? TEMPLATES : [] });
      if (req.method === 'POST' && parts[1] === 'messages' && parts[0] === WA.phoneNumberId) {
        const b = JSON.parse(raw) as Omit<WaSent, 'id'> & { messaging_product?: string };
        if (b.messaging_product !== 'whatsapp' || !/^\d{8,15}$/.test(b.to ?? '')) return void json(400, { error: { message: 'Invalid parameter', code: 100 } });
        if (b.to === WA.undeliverable) return void json(400, { error: { message: 'Message undeliverable', code: 131026, error_data: { details: 'Message undeliverable.' } } });
        if (b.type === 'template') {
          const t = TEMPLATES.find((x) => x.name === b.template?.name && x.language === b.template?.language.code && x.status === 'APPROVED');
          if (!t) return void json(404, { error: { message: 'Template name does not exist in the translation', code: 132001 } });
          const want = new Set([...(t.components.find((c) => c.type === 'BODY')?.text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
          const got = b.template?.components?.find((c) => c.type === 'body')?.parameters.length ?? 0;
          if (want !== got) return void json(400, { error: { message: 'Number of parameters does not match the expected number of params', code: 132000 } });
        } else if (b.type !== 'text' || !b.text?.body) return void json(400, { error: { message: 'Invalid parameter', code: 100 } });
        const id = `wamid.fx${++n}${Date.now().toString(36)}`;
        sent.push({ ...b, id });
        return void json(200, { messaging_product: 'whatsapp', contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id, message_status: 'accepted' }] });
      }
      json(404, { error: { message: 'Unknown path', code: 100 } });
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sent, calls, close: () => new Promise((r) => server.close(() => r())) };
}

// Run on its own (Playwright): `tsx test/fixtures/whatsapp-fixture.ts`, port from WHATSAPP_FIXTURE_PORT.
if (process.argv[1]?.endsWith('whatsapp-fixture.ts')) {
  void startWhatsappFixture(Number(process.env.WHATSAPP_FIXTURE_PORT ?? 4950)).then((f) => console.warn(`WhatsApp fixture on ${f.url}`));
}
