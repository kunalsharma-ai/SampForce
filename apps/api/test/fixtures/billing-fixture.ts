import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the Stripe and Razorpay endpoints DealFlow calls, plus helpers that sign
 * webhooks the way each provider documents. It implements only the shapes the adapters use. Passing
 * these tests does not prove either live provider accepts DealFlow's requests; that needs test-mode
 * keys and a real webhook endpoint (see docs/BILLING.md).
 */
export const STRIPE_WEBHOOK_SECRET = 'whsec_fixture_secret';
export const RAZORPAY_WEBHOOK_SECRET = 'rzp_fixture_webhook_secret';

export interface BillingFixtureState {
  requests: { method: string; path: string; body: string }[];
  stripeSubs: Record<string, Record<string, unknown>>;
  razorpaySubs: Record<string, Record<string, unknown>>;
}

export interface BillingFixture {
  url: string;
  state: BillingFixtureState;
  close(): Promise<void>;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString()));
    req.on('end', () => resolve(data));
  });

export function billingEnv(url: string): Record<string, string> {
  return {
    ONLINE_PAYMENTS_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET,
    STRIPE_API_BASE_URL: url,
    STRIPE_PRICES: 'launch:MONTH=price_launch_m,growth:MONTH=price_growth_m,growth:YEAR=price_growth_y,professional:MONTH=price_pro_m',
    RAZORPAY_KEY_ID: 'rzp_test_fixture',
    RAZORPAY_KEY_SECRET: 'rzp_fixture_secret',
    RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_API_BASE_URL: url,
    RAZORPAY_PLANS: 'growth:MONTH=plan_growth_m,professional:MONTH=plan_pro_m',
  };
}

export function stripeSubscription(id: string, o: { customer: string; price: string; quantity: number; status?: string; tenantId?: string; cancel?: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id, object: 'subscription', customer: o.customer, status: o.status ?? 'active', cancel_at_period_end: o.cancel ?? false,
    metadata: o.tenantId ? { tenant_id: o.tenantId } : {},
    items: { data: [{ id: `si_${id}`, quantity: o.quantity, price: { id: o.price }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
  };
}

export async function startBillingFixture(): Promise<BillingFixture> {
  const state: BillingFixtureState = { requests: [], stripeSubs: {}, razorpaySubs: {} };
  let n = 0;
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture');
    const body = await read(req);
    state.requests.push({ method: req.method ?? 'GET', path: url.pathname, body });
    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const auth = req.headers.authorization ?? '';
    const p = url.pathname;

    if (auth.startsWith('Bearer ')) {
      if (auth !== 'Bearer sk_test_fixture') return json(401, { error: { message: 'Invalid API key' } });
      const form = new URLSearchParams(body);
      if (req.method === 'POST' && p === '/v1/checkout/sessions') return json(200, { id: `cs_${++n}`, url: `https://checkout.stripe.test/c/cs_${n}` });
      if (req.method === 'POST' && p === '/v1/billing_portal/sessions') return json(200, { url: `https://billing.stripe.test/p/${form.get('customer')}` });
      const m = /^\/v1\/subscriptions\/([\w-]+)$/.exec(p);
      if (m) {
        const sub = state.stripeSubs[m[1]!];
        if (!sub) return json(404, { error: { message: 'No such subscription' } });
        if (req.method === 'POST') {
          const item = (sub.items as { data: Record<string, unknown>[] }).data[0]!;
          if (form.has('items[0][quantity]')) item.quantity = Number(form.get('items[0][quantity]'));
          if (form.has('items[0][price]')) item.price = { id: form.get('items[0][price]') };
          if (form.has('cancel_at_period_end')) sub.cancel_at_period_end = form.get('cancel_at_period_end') === 'true';
        }
        return json(200, sub);
      }
      return json(404, { error: { message: `fixture: no route ${req.method} ${p}` } });
    }

    if (auth.startsWith('Basic ')) {
      if (Buffer.from(auth.slice(6), 'base64').toString() !== 'rzp_test_fixture:rzp_fixture_secret') return json(401, { error: { description: 'Authentication failed' } });
      const b = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      if (req.method === 'POST' && p === '/v1/subscriptions') {
        const id = `sub_rzp${++n}`;
        state.razorpaySubs[id] = { id, entity: 'subscription', plan_id: b.plan_id, quantity: b.quantity, status: 'created', notes: b.notes, customer_id: null, short_url: `https://rzp.test/i/${id}` };
        return json(200, state.razorpaySubs[id]);
      }
      const m = /^\/v1\/subscriptions\/([\w-]+)(\/cancel)?$/.exec(p);
      if (m) {
        const sub = state.razorpaySubs[m[1]!];
        if (!sub) return json(400, { error: { description: 'The id provided does not exist' } });
        if (req.method === 'PATCH') sub.pending_update = b;
        if (m[2]) sub.cancel_requested = b;
        return json(200, sub);
      }
      return json(404, { error: { description: `fixture: no route ${req.method} ${p}` } });
    }
    json(401, { error: { message: 'Missing credentials' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, state, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** A Stripe-Signature header for `body`, as Stripe computes it. */
export function stripeSignature(body: string, at = Math.floor(Date.now() / 1000), secret = STRIPE_WEBHOOK_SECRET): string {
  return `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
}

export function razorpaySignature(body: string, secret = RAZORPAY_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
