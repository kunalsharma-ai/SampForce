import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stand-in for a workspace's own Stripe or Razorpay account, for card payments on proposals. It answers the calls
 * SampForce makes (a key check, a Checkout Session or a Payment Link) and serves a hosted "pay" page that, like the
 * real providers, sends a signed webhook to the endpoint registered for that account and then returns the payer.
 * Webhook endpoints are registered with POST /_fixture/endpoints, the stand-in for the provider dashboard.
 * Shapes follow the providers' published APIs; none of this has been compared with a live response.
 *
 * Keys: Stripe `sk_test_good…` (full) or `rk_test_good…` (restricted: cannot read /v1/account); anything else is
 * refused with 401, and a key containing `nocheckout` gets 403 on Checkout. Razorpay: key id `rzp_test_good…` with
 * secret `goodSecret1234567890abcd`.
 */
export const STRIPE_KEY = 'sk_test_goodFixture01';
export const STRIPE_WHSEC = 'whsec_fixtureCardPayments01';
export const RAZORPAY_KEY_ID = 'rzp_test_goodFixture';
export const RAZORPAY_KEY_SECRET = 'goodSecret1234567890abcd';
export const RAZORPAY_WHSEC = 'razorpay-fixture-webhook-secret';

export interface FixtureSession {
  provider: 'stripe' | 'razorpay';
  id: string;
  key: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string | null;
  status: 'open' | 'paid' | 'expired';
}

export interface CardPaymentsFixture {
  url: string;
  sessions: FixtureSession[];
  calls: string[];
  /** Registers a webhook endpoint for an account, as an admin does in the provider dashboard. */
  register(key: string, endpoint: string, secret: string): void;
  /** The webhook body and headers the provider would send for this session. */
  webhookFor(id: string, outcome: 'paid' | 'expired', opts?: { amount?: number; secret?: string; at?: number }): { body: string; headers: Record<string, string> };
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });

export function stripeSignature(secret: string, body: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

export function razorpaySignature(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function startCardPaymentsFixture(port = 0): Promise<CardPaymentsFixture> {
  const sessions: FixtureSession[] = [];
  const calls: string[] = [];
  const endpoints = new Map<string, { url: string; secret: string }>();
  let url = '';
  let n = 0;

  const webhookFor: CardPaymentsFixture['webhookFor'] = (id, outcome, opts = {}) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new Error(`no session ${id}`);
    const secret = opts.secret ?? endpoints.get(s.key)?.secret ?? (s.provider === 'stripe' ? STRIPE_WHSEC : RAZORPAY_WHSEC);
    const amount = opts.amount ?? s.amount;
    if (s.provider === 'stripe') {
      const body = JSON.stringify({
        id: `evt_${++n}`,
        object: 'event',
        type: outcome === 'paid' ? 'checkout.session.completed' : 'checkout.session.expired',
        data: { object: { id: s.id, object: 'checkout.session', payment_status: outcome === 'paid' ? 'paid' : 'unpaid', payment_intent: outcome === 'paid' ? `pi_${s.id.slice(3)}` : null, amount_total: amount, currency: s.currency.toLowerCase(), metadata: s.metadata, client_reference_id: s.reference, customer_details: { email: s.customerEmail ?? 'payer@example.test' } } },
      });
      return { body, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(secret, body, opts.at) } as Record<string, string> };
    }
    const body = JSON.stringify({
      entity: 'event',
      event: outcome === 'paid' ? 'payment_link.paid' : 'payment_link.expired',
      payload: {
        payment_link: { entity: { id: s.id, amount: s.amount, currency: s.currency, reference_id: s.reference, notes: s.metadata, status: outcome } },
        ...(outcome === 'paid' ? { payment: { entity: { id: `pay_${s.id.slice(6)}`, amount, currency: s.currency, email: s.customerEmail ?? 'payer@example.test', status: 'captured' } } } : {}),
      },
    });
    return { body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': razorpaySignature(secret, body) } };
  };

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://fixture');
    const body = await read(req);
    if (u.pathname === '/health') return void res.writeHead(200).end('ok');
    if (u.pathname === '/_fixture/endpoints' && req.method === 'POST') {
      const r = JSON.parse(body) as { key: string; url: string; secret: string };
      endpoints.set(r.key, { url: r.url, secret: r.secret });
      return void json(res, 200, { ok: true });
    }
    if (u.pathname === '/_fixture/sessions') return void json(res, 200, sessions);

    // Hosted pages: what the payer sees on the provider's site.
    const page = u.pathname.match(/^\/(checkout|rzp)\/([A-Za-z0-9_]+)(\/pay|\/cancel)?$/);
    if (page) {
      const s = sessions.find((x) => x.id === page[2]);
      if (!s) return void res.writeHead(404).end('Not found');
      if (page[3] === '/cancel') return void res.writeHead(303, { location: s.cancelUrl }).end();
      if (page[3] === '/pay' && req.method === 'POST') {
        if (s.status === 'open') {
          s.status = 'paid';
          const ep = endpoints.get(s.key);
          if (ep) {
            const w = webhookFor(s.id, 'paid');
            await fetch(ep.url, { method: 'POST', headers: w.headers, body: w.body }).catch(() => undefined);
          }
        }
        return void res.writeHead(303, { location: s.successUrl }).end();
      }
      const minor = s.currency === 'JPY' ? s.amount : s.amount / 100;
      const brand = s.provider === 'stripe' ? 'Stripe Checkout (test stand-in)' : 'Razorpay payment link (test stand-in)';
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="en"><head><title>${brand}</title></head><body><main><p>${brand}</p><h1>${esc(s.description)}</h1><p data-testid="amount">${esc(s.currency.toUpperCase())} ${minor.toFixed(s.currency === 'JPY' ? 0 : 2)}</p><form method="post" action="${page[1] === 'checkout' ? '/checkout' : '/rzp'}/${s.id}/pay"><button type="submit">Pay with test card</button></form><a href="/${page[1]}/${s.id}/cancel">Cancel</a></main></body></html>`);
    }

    calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname.startsWith('/v1/checkout') || u.pathname === '/v1/account') {
      const key = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!/^(sk|rk)_(test|live)_good/.test(key)) return void json(res, 401, { error: { type: 'invalid_request_error', message: 'Invalid API Key provided.' } });
      if (u.pathname === '/v1/account') {
        if (key.startsWith('rk_')) return void json(res, 403, { error: { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint.' } });
        return void json(res, 200, { id: 'acct_fixture', object: 'account', settings: { dashboard: { display_name: 'Globex Payments' } } });
      }
      if (key.includes('nocheckout')) return void json(res, 403, { error: { type: 'invalid_request_error', message: 'This key cannot create Checkout Sessions (rak_checkout_session_write).' } });
      if (req.method === 'GET') return void json(res, 200, { object: 'list', data: [], has_more: false });
      const f = new URLSearchParams(body);
      const amount = Number(f.get('line_items[0][price_data][unit_amount]'));
      const currency = f.get('line_items[0][price_data][currency]') ?? '';
      if (f.get('mode') !== 'payment' || !Number.isInteger(amount) || amount <= 0 || !/^[a-z]{3}$/.test(currency) || !f.get('success_url')) return void json(res, 400, { error: { type: 'invalid_request_error', message: 'Missing or invalid parameters.' } });
      const metadata = Object.fromEntries([...f.entries()].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]));
      const id = `cs_test_${++n}${Date.now().toString(36)}`;
      sessions.push({ provider: 'stripe', id, key, amount, currency: currency.toUpperCase(), description: f.get('line_items[0][price_data][product_data][name]') ?? '', reference: f.get('client_reference_id') ?? '', metadata, successUrl: f.get('success_url')!, cancelUrl: f.get('cancel_url') ?? '', customerEmail: f.get('customer_email'), status: 'open' });
      return void json(res, 200, { id, object: 'checkout.session', url: `${url}/checkout/${id}` });
    }
    if (u.pathname === '/v1/payment_links') {
      const [keyId, secret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
      if (!keyId?.startsWith('rzp_test_good') && !keyId?.startsWith('rzp_live_good')) return void json(res, 401, { error: { code: 'BAD_REQUEST_ERROR', description: 'The api key provided is invalid' } });
      if (secret !== RAZORPAY_KEY_SECRET) return void json(res, 401, { error: { code: 'BAD_REQUEST_ERROR', description: 'The api key/secret provided is invalid' } });
      if (req.method === 'GET') return void json(res, 200, { payment_links: [] });
      const r = JSON.parse(body) as { amount: number; currency: string; description: string; reference_id: string; notes: Record<string, string>; callback_url: string; expire_by: number; customer?: { email?: string }; accept_partial: boolean };
      if (!Number.isInteger(r.amount) || r.amount < 100 || r.accept_partial !== false || r.expire_by < Date.now() / 1000 + 15 * 60) return void json(res, 400, { error: { code: 'BAD_REQUEST_ERROR', description: 'Invalid payment link request.' } });
      const id = `plink_${++n}${Date.now().toString(36)}`;
      sessions.push({ provider: 'razorpay', id, key: keyId, amount: r.amount, currency: r.currency, description: r.description, reference: r.reference_id, metadata: r.notes, successUrl: `${r.callback_url}&razorpay_payment_link_id=${id}&razorpay_payment_link_status=paid`, cancelUrl: r.callback_url.split('?')[0]!, customerEmail: r.customer?.email ?? null, status: 'open' });
      return void json(res, 200, { id, short_url: `${url}/rzp/${id}`, status: 'created' });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    sessions,
    calls,
    register: (key, endpoint, secret) => void endpoints.set(key, { url: endpoint, secret }),
    webhookFor,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// Run on its own (Playwright): `tsx test/fixtures/card-payments-fixture.ts`, port from CARD_PAYMENTS_FIXTURE_PORT.
if (process.argv[1]?.endsWith('card-payments-fixture.ts')) {
  void startCardPaymentsFixture(Number(process.env.CARD_PAYMENTS_FIXTURE_PORT ?? 4900)).then((f) => console.warn(`Card payments fixture on ${f.url}`));
}
