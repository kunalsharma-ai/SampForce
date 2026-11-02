import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { stripeForm } from '../billing/providers';
import { API_ENV, type ApiEnv } from '../common/env';

/** Keys of the workspace's own payment account, sealed at rest. */
export type PaymentKeys = { provider: 'stripe'; secretKey: string; webhookSecret: string } | { provider: 'razorpay'; keyId: string; keySecret: string; webhookSecret: string };

export class CardPaymentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** What a verified webhook says about one of DealFlow's payment requests. */
export interface PaymentEvent {
  /** quote_payments.id, from the metadata DealFlow set. */
  paymentId: string | null;
  outcome: 'paid' | 'expired' | 'failed' | 'ignored';
  providerPaymentId: string | null;
  payerEmail: string | null;
  /** Amount the provider reports, in minor units, to compare with what was asked. */
  amountMinor: number | null;
  currency: string | null;
}

// Stripe charges these in whole units; three-decimal currencies are not offered (amounts must end in 0 there).
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function toMinorUnits(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (THREE_DECIMAL.has(c)) throw new CardPaymentError('unsupported_currency', `Card payments in ${c} are not supported yet.`);
  return Math.round(amount * (ZERO_DECIMAL.has(c) ? 1 : 100));
}

/**
 * Card payments into the workspace's own Stripe or Razorpay account: a hosted Stripe Checkout Session or a Razorpay
 * Payment Link per request, a cheap read to prove the keys, and webhook verification with the workspace's secret.
 * Tested against a local stand-in following the providers' published APIs; not yet against Stripe or Razorpay.
 */
@Injectable()
export class CardPaymentsClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** A read that needs the same permission as creating a payment request, and charges nothing. */
  async check(keys: PaymentKeys): Promise<{ mode: 'test' | 'live'; accountLabel: string }> {
    if (keys.provider === 'stripe') {
      await this.stripe(keys, 'GET', '/v1/checkout/sessions?limit=1');
      // The account name is a nicety: restricted keys often cannot read the account.
      const acct = await this.stripe<{ id?: string; settings?: { dashboard?: { display_name?: string } }; business_profile?: { name?: string } }>(keys, 'GET', '/v1/account').catch(() => null);
      return { mode: keys.secretKey.includes('_live_') ? 'live' : 'test', accountLabel: acct?.settings?.dashboard?.display_name ?? acct?.business_profile?.name ?? acct?.id ?? 'Stripe account' };
    }
    await this.razorpay(keys, 'GET', '/v1/payment_links?count=1');
    return { mode: keys.keyId.startsWith('rzp_live_') ? 'live' : 'test', accountLabel: `Razorpay ${keys.keyId.slice(0, 14)}…` };
  }

  /** A hosted payment page for one amount. Returns the provider's id and the URL to send the payer to. */
  async createRequest(
    keys: PaymentKeys,
    r: { paymentId: string; quoteId: string; tenantId: string; description: string; amount: number; currency: string; returnUrl: string; cancelUrl: string; customerEmail?: string | null },
  ): Promise<{ ref: string; url: string }> {
    const minor = toMinorUnits(r.amount, r.currency);
    if (minor <= 0) throw new CardPaymentError('nothing_to_pay', 'This proposal has nothing to pay.');
    const metadata = { dealflow_payment_id: r.paymentId, dealflow_quote_id: r.quoteId, dealflow_tenant_id: r.tenantId };
    if (keys.provider === 'stripe') {
      const s = await this.stripe<{ id: string; url: string }>(keys, 'POST', '/v1/checkout/sessions', {
        mode: 'payment',
        client_reference_id: r.paymentId,
        success_url: r.returnUrl,
        cancel_url: r.cancelUrl,
        ...(r.customerEmail ? { customer_email: r.customerEmail } : {}),
        line_items: { 0: { quantity: 1, price_data: { currency: r.currency.toLowerCase(), unit_amount: minor, product_data: { name: r.description.slice(0, 250) } } } },
        metadata,
        payment_intent_data: { metadata },
      });
      return { ref: s.id, url: s.url };
    }
    const link = await this.razorpay<{ id: string; short_url: string }>(keys, 'POST', '/v1/payment_links', {
      amount: minor,
      currency: r.currency.toUpperCase(),
      accept_partial: false,
      description: r.description.slice(0, 2048),
      reference_id: r.paymentId,
      ...(r.customerEmail ? { customer: { email: r.customerEmail }, notify: { email: false, sms: false } } : {}),
      callback_url: r.returnUrl,
      callback_method: 'get',
      // Razorpay needs at least 15 minutes; the page creates a fresh link each time anyway.
      expire_by: Math.floor(Date.now() / 1000) + 24 * 3600,
      notes: metadata,
    });
    return { ref: link.id, url: link.short_url };
  }

  /** Verifies the webhook with the workspace's own secret and reads what it says. Throws on a bad signature. */
  parseWebhook(keys: PaymentKeys, raw: Buffer, headers: Record<string, string | string[] | undefined>, now = Date.now()): PaymentEvent {
    const h = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    if (keys.provider === 'stripe') {
      const parts = (h('stripe-signature') ?? '').split(',').map((p) => p.trim().split('=') as [string, string]);
      const t = parts.find(([k]) => k === 't')?.[1];
      const v1 = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
      if (!t || !/^\d+$/.test(t) || !v1.length || Math.abs(now / 1000 - Number(t)) > 300) throw new CardPaymentError('bad_signature', 'Signature check failed.', 401);
      const expected = createHmac('sha256', keys.webhookSecret).update(`${t}.`).update(raw).digest('hex');
      if (!v1.some((v) => safeEqual(v, expected))) throw new CardPaymentError('bad_signature', 'Signature check failed.', 401);
      const e = JSON.parse(raw.toString('utf8')) as { type?: string; data?: { object?: { id?: string; payment_status?: string; payment_intent?: string; amount_total?: number; currency?: string; metadata?: Record<string, string>; client_reference_id?: string; customer_details?: { email?: string } } } };
      const o = e.data?.object ?? {};
      const base = { paymentId: o.metadata?.dealflow_payment_id ?? o.client_reference_id ?? null, providerPaymentId: o.payment_intent ?? null, payerEmail: o.customer_details?.email ?? null, amountMinor: o.amount_total ?? null, currency: o.currency?.toUpperCase() ?? null };
      if ((e.type === 'checkout.session.completed' && o.payment_status === 'paid') || e.type === 'checkout.session.async_payment_succeeded') return { ...base, outcome: 'paid' };
      if (e.type === 'checkout.session.async_payment_failed') return { ...base, outcome: 'failed' };
      if (e.type === 'checkout.session.expired') return { ...base, outcome: 'expired' };
      return { ...base, outcome: 'ignored' };
    }
    const sig = h('x-razorpay-signature') ?? '';
    const expected = createHmac('sha256', keys.webhookSecret).update(raw).digest('hex');
    if (!sig || !safeEqual(sig, expected)) throw new CardPaymentError('bad_signature', 'Signature check failed.', 401);
    const e = JSON.parse(raw.toString('utf8')) as { event?: string; payload?: { payment_link?: { entity?: { reference_id?: string; amount?: number; currency?: string; notes?: Record<string, string> } }; payment?: { entity?: { id?: string; email?: string; amount?: number; currency?: string } } } };
    const link = e.payload?.payment_link?.entity ?? {};
    const pay = e.payload?.payment?.entity;
    const base = { paymentId: link.notes?.dealflow_payment_id ?? link.reference_id ?? null, providerPaymentId: pay?.id ?? null, payerEmail: pay?.email ?? null, amountMinor: pay?.amount ?? link.amount ?? null, currency: (pay?.currency ?? link.currency)?.toUpperCase() ?? null };
    if (e.event === 'payment_link.paid') return { ...base, outcome: 'paid' };
    if (e.event === 'payment_link.expired' || e.event === 'payment_link.cancelled') return { ...base, outcome: 'expired' };
    return { ...base, outcome: 'ignored' };
  }

  private async stripe<T>(keys: Extract<PaymentKeys, { provider: 'stripe' }>, method: string, path: string, form?: Record<string, unknown>): Promise<T> {
    return this.call<T>(`${this.env.STRIPE_API_BASE_URL.replace(/\/$/, '')}${path}`, method, `Bearer ${keys.secretKey}`, form ? { type: 'application/x-www-form-urlencoded', body: stripeForm(form).join('&') } : null, 'Stripe');
  }

  private async razorpay<T>(keys: Extract<PaymentKeys, { provider: 'razorpay' }>, method: string, path: string, json?: object): Promise<T> {
    return this.call<T>(`${this.env.RAZORPAY_API_BASE_URL.replace(/\/$/, '')}${path}`, method, `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64')}`, json ? { type: 'application/json', body: JSON.stringify(json) } : null, 'Razorpay');
  }

  private async call<T>(url: string, method: string, authorization: string, body: { type: string; body: string } | null, name: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, { method, headers: { authorization, ...(body ? { 'content-type': body.type } : {}) }, body: body?.body, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new CardPaymentError('unavailable', `${name} could not be reached.`, 502);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; description?: string } };
    if (res.ok) return json;
    const detail = json.error?.message ?? json.error?.description;
    if (res.status === 401) throw new CardPaymentError('keys_refused', detail ? `${name} refused the keys. ${detail}` : `${name} refused the keys.`);
    if (res.status === 403) throw new CardPaymentError('permission', detail ? `The ${name} key is missing a permission: ${detail}` : `The ${name} key is missing a permission.`);
    throw new CardPaymentError(`http_${res.status}`, detail ? `${name} answered HTTP ${res.status}: ${detail}.` : `${name} answered HTTP ${res.status}.`, res.status >= 500 ? 502 : 400);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
