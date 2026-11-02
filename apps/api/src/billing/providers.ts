import { createHmac, timingSafeEqual } from 'node:crypto';
import { type BillingProviderKey, type Interval, PLAN_CODES, type PlanCode, type SubscriptionState } from '@dealflow/types';
import type { ApiEnv } from '../common/env';

/**
 * Stripe and Razorpay adapters over plain HTTPS. They implement only the calls DealFlow makes and are
 * exercised against local fixtures (test/fixtures/billing-fixture.ts) that mimic those shapes; they have
 * not been run against either provider's test mode. Card and bank details never pass through DealFlow:
 * buyers pay on the provider's hosted page.
 */

const TIMEOUT_MS = 15_000;
/** Stripe's default tolerance for webhook timestamps. */
const STRIPE_TOLERANCE_S = 300;

export class BillingProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class InvalidSignatureError extends Error {}

export interface ProviderSubscription {
  id: string;
  customerId: string | null;
  /** null = a state DealFlow does not act on (e.g. a checkout that never completed). */
  status: SubscriptionState | null;
  planCode: PlanCode | null;
  interval: Interval | null;
  seats: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  tenantId: string | null;
}

export interface ProviderInvoice {
  id: string;
  number: string | null;
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  issuedAt: Date | null;
  paidAt: Date | null;
}

/** A verified webhook, reduced to what DealFlow acts on. */
export interface ParsedEvent {
  id: string;
  type: string;
  tenantHint: string | null;
  /** Provider customer or subscription id, used to find the workspace when no hint is present. */
  refs: string[];
  subscriptionId: string | null;
  invoice: ProviderInvoice | null;
  paymentFailed: boolean;
}

export interface CheckoutRequest {
  tenantId: string;
  email: string;
  customerId: string | null;
  priceId: string;
  seats: number;
  interval: Interval;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingAdapter {
  readonly key: BillingProviderKey;
  readonly configured: boolean;
  readonly hasPortal: boolean;
  /** Whether a seat or plan change takes effect now (prorated) or at the next billing cycle. */
  readonly changesApply: 'now' | 'cycle_end';
  priceId(plan: PlanCode, interval: Interval): string | null;
  checkout(req: CheckoutRequest): Promise<{ url: string; subscriptionId: string | null }>;
  portal(customerId: string, returnUrl: string): Promise<string>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  changeSubscription(id: string, change: { seats?: number; priceId?: string }): Promise<ProviderSubscription | null>;
  setCancelAtPeriodEnd(id: string, cancel: boolean): Promise<ProviderSubscription | null>;
  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>, now?: Date): ParsedEvent;
}

/** Parses `plan:INTERVAL=id,...`. Unknown plans or intervals are rejected so a typo cannot sell the wrong plan. */
export function parsePriceMap(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^([a-z_]+):(MONTH|YEAR)=(\S+)$/.exec(part);
    if (!m || !PLAN_CODES.includes(m[1] as PlanCode) || m[1] === 'free') throw new Error(`Invalid billing price mapping "${part}"`);
    map.set(`${m[1]}:${m[2]}`, m[3]!);
  }
  return map;
}

function reverse(map: Map<string, string>, id: string | null | undefined): { planCode: PlanCode; interval: Interval } | null {
  if (!id) return null;
  for (const [k, v] of map) {
    if (v === id) {
      const [planCode, interval] = k.split(':') as [PlanCode, Interval];
      return { planCode, interval };
    }
  }
  return null;
}

const secs = (v: unknown): Date | null => (typeof v === 'number' && v > 0 ? new Date(v * 1000) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const int = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const header = (h: Record<string, string | string[] | undefined>, k: string) => {
  const v = h[k];
  return Array.isArray(v) ? v[0] : v;
};

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page.
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; description?: string } } | null)?.error;
    throw new BillingProviderError(err?.message || err?.description ? `Billing provider request failed (${res.status}): ${err.message ?? err.description}` : `Billing provider request failed (${res.status})`, res.status);
  }
  return json as T;
}

/** Stripe's form encoding: nested keys as `a[b][0][c]=v`. */
export function stripeForm(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') out.push(...stripeForm(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

// ───────────── Stripe ─────────────

const STRIPE_STATUS: Record<string, SubscriptionState | null> = {
  trialing: 'TRIALING',
  active: 'ACTIVE',
  past_due: 'PAST_DUE',
  unpaid: 'UNPAID',
  paused: 'UNPAID',
  canceled: 'CANCELED',
  incomplete: null,
  incomplete_expired: null,
};

const STRIPE_INVOICE_STATUS: Record<string, ProviderInvoice['status']> = { draft: 'DRAFT', open: 'OPEN', paid: 'PAID', void: 'VOID', uncollectible: 'UNCOLLECTIBLE' };

type StripeObj = Record<string, unknown>;

export class StripeAdapter implements BillingAdapter {
  readonly key = 'STRIPE' as const;
  readonly hasPortal = true;
  readonly changesApply = 'now' as const;
  private readonly prices: Map<string, string>;

  constructor(private readonly env: ApiEnv) {
    this.prices = parsePriceMap(env.STRIPE_PRICES);
  }

  get configured(): boolean {
    return !!this.env.STRIPE_SECRET_KEY && !!this.env.STRIPE_WEBHOOK_SECRET;
  }

  priceId(plan: PlanCode, interval: Interval): string | null {
    return this.prices.get(`${plan}:${interval}`) ?? null;
  }

  private req<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    return call<T>(`${this.env.STRIPE_API_BASE_URL}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? stripeForm(body).join('&') : undefined,
    });
  }

  async checkout(r: CheckoutRequest) {
    const tax = this.env.STRIPE_AUTOMATIC_TAX;
    const session = await this.req<{ id: string; url: string }>('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      client_reference_id: r.tenantId,
      ...(r.customerId ? { customer: r.customerId, ...(tax ? { customer_update: { address: 'auto' } } : {}) } : { customer_email: r.email }),
      line_items: { 0: { price: r.priceId, quantity: r.seats } },
      allow_promotion_codes: 'true',
      subscription_data: { metadata: { tenant_id: r.tenantId } },
      metadata: { tenant_id: r.tenantId },
      ...(tax ? { automatic_tax: { enabled: 'true' } } : {}),
      success_url: r.successUrl,
      cancel_url: r.cancelUrl,
    });
    return { url: session.url, subscriptionId: null };
  }

  async portal(customerId: string, returnUrl: string): Promise<string> {
    return (await this.req<{ url: string }>('POST', '/v1/billing_portal/sessions', { customer: customerId, return_url: returnUrl })).url;
  }

  toSubscription(s: StripeObj): ProviderSubscription {
    const item = ((s.items as { data?: StripeObj[] } | undefined)?.data ?? [])[0] ?? {};
    const price = (item.price ?? {}) as StripeObj;
    const plan = reverse(this.prices, str(price.id));
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    return {
      id: String(s.id),
      customerId: str(s.customer),
      status: STRIPE_STATUS[String(s.status)] ?? null,
      planCode: plan?.planCode ?? null,
      interval: plan?.interval ?? null,
      seats: Math.max(1, int(item.quantity, 1)),
      // Newer API versions keep the period on the subscription item; older ones on the subscription.
      currentPeriodStart: secs(item.current_period_start) ?? secs(s.current_period_start),
      currentPeriodEnd: secs(item.current_period_end) ?? secs(s.current_period_end),
      cancelAtPeriodEnd: s.cancel_at_period_end === true,
      trialEndsAt: secs(s.trial_end),
      tenantId: str(meta.tenant_id),
    };
  }

  async getSubscription(id: string) {
    return this.toSubscription(await this.req<StripeObj>('GET', `/v1/subscriptions/${encodeURIComponent(id)}`));
  }

  async changeSubscription(id: string, change: { seats?: number; priceId?: string }) {
    const current = await this.req<StripeObj>('GET', `/v1/subscriptions/${encodeURIComponent(id)}`);
    const item = ((current.items as { data?: StripeObj[] } | undefined)?.data ?? [])[0];
    if (!item) throw new BillingProviderError('The Stripe subscription has no items', 409);
    const updated = await this.req<StripeObj>('POST', `/v1/subscriptions/${encodeURIComponent(id)}`, {
      items: { 0: { id: item.id, ...(change.priceId ? { price: change.priceId } : {}), ...(change.seats ? { quantity: change.seats } : {}) } },
      proration_behavior: 'create_prorations',
    });
    return this.toSubscription(updated);
  }

  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    return this.toSubscription(await this.req<StripeObj>('POST', `/v1/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: String(cancel) }));
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>, now = new Date()): ParsedEvent {
    const sig = header(headers, 'stripe-signature') ?? '';
    const parts = sig.split(',').map((p) => p.trim().split('=') as [string, string]);
    const t = parts.find(([k]) => k === 't')?.[1];
    const v1 = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
    if (!t || !/^\d+$/.test(t) || v1.length === 0 || !this.env.STRIPE_WEBHOOK_SECRET) throw new InvalidSignatureError('Missing Stripe signature');
    if (Math.abs(now.getTime() / 1000 - Number(t)) > STRIPE_TOLERANCE_S) throw new InvalidSignatureError('Stripe signature timestamp outside tolerance');
    const expected = createHmac('sha256', this.env.STRIPE_WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
    if (!v1.some((v) => safeEqualHex(v, expected))) throw new InvalidSignatureError('Stripe signature mismatch');

    const event = JSON.parse(raw.toString('utf8')) as { id: string; type: string; data?: { object?: StripeObj } };
    const obj = event.data?.object ?? {};
    const meta = (obj.metadata ?? {}) as Record<string, unknown>;
    const parsed: ParsedEvent = { id: String(event.id), type: String(event.type), tenantHint: null, refs: [], subscriptionId: null, invoice: null, paymentFailed: false };

    if (event.type === 'checkout.session.completed') {
      parsed.tenantHint = str(obj.client_reference_id) ?? str(meta.tenant_id);
      parsed.subscriptionId = str(obj.subscription);
    } else if (event.type.startsWith('customer.subscription.')) {
      parsed.tenantHint = str(meta.tenant_id);
      parsed.subscriptionId = str(obj.id);
    } else if (event.type.startsWith('invoice.')) {
      const parent = (obj.parent ?? {}) as { subscription_details?: { subscription?: unknown; metadata?: Record<string, unknown> } };
      parsed.subscriptionId = str(obj.subscription) ?? str(parent.subscription_details?.subscription);
      parsed.tenantHint = str(parent.subscription_details?.metadata?.tenant_id) ?? str((obj.subscription_details as { metadata?: Record<string, unknown> } | undefined)?.metadata?.tenant_id);
      const transitions = (obj.status_transitions ?? {}) as StripeObj;
      parsed.invoice = {
        id: String(obj.id),
        number: str(obj.number),
        status: STRIPE_INVOICE_STATUS[String(obj.status)] ?? 'OPEN',
        currency: String(obj.currency ?? 'usd').toUpperCase(),
        subtotalCents: int(obj.subtotal),
        taxCents: int(obj.tax) || ((obj.total_taxes as { amount?: number }[] | undefined) ?? []).reduce((a, x) => a + int(x.amount), 0),
        totalCents: int(obj.total),
        amountPaidCents: int(obj.amount_paid),
        periodStart: secs(obj.period_start),
        periodEnd: secs(obj.period_end),
        hostedUrl: str(obj.hosted_invoice_url),
        pdfUrl: str(obj.invoice_pdf),
        issuedAt: secs(transitions.finalized_at) ?? secs(obj.created),
        paidAt: secs(transitions.paid_at),
      };
      parsed.paymentFailed = event.type === 'invoice.payment_failed';
    }
    parsed.refs = [parsed.subscriptionId, str(obj.customer)].filter((x): x is string => !!x);
    return parsed;
  }
}

// ───────────── Razorpay ─────────────

const RAZORPAY_STATUS: Record<string, SubscriptionState | null> = {
  created: null,
  authenticated: 'ACTIVE',
  active: 'ACTIVE',
  resumed: 'ACTIVE',
  pending: 'PAST_DUE',
  halted: 'UNPAID',
  paused: 'UNPAID',
  cancelled: 'CANCELED',
  completed: 'CANCELED',
  expired: 'CANCELED',
};

/** Billing cycles to authorise up front: ten years either way, renewable afterwards. */
const RAZORPAY_TOTAL_COUNT: Record<Interval, number> = { MONTH: 120, YEAR: 10 };

export class RazorpayAdapter implements BillingAdapter {
  readonly key = 'RAZORPAY' as const;
  readonly hasPortal = false;
  readonly changesApply = 'cycle_end' as const;
  private readonly plans: Map<string, string>;

  constructor(private readonly env: ApiEnv) {
    this.plans = parsePriceMap(env.RAZORPAY_PLANS);
  }

  get configured(): boolean {
    return !!this.env.RAZORPAY_KEY_ID && !!this.env.RAZORPAY_KEY_SECRET && !!this.env.RAZORPAY_WEBHOOK_SECRET;
  }

  priceId(plan: PlanCode, interval: Interval): string | null {
    return this.plans.get(`${plan}:${interval}`) ?? null;
  }

  private req<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: object): Promise<T> {
    const auth = Buffer.from(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    return call<T>(`${this.env.RAZORPAY_API_BASE_URL}${path}`, {
      method,
      headers: { authorization: `Basic ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async checkout(r: CheckoutRequest) {
    const sub = await this.req<{ id: string; short_url: string }>('POST', '/v1/subscriptions', {
      plan_id: r.priceId,
      quantity: r.seats,
      total_count: RAZORPAY_TOTAL_COUNT[r.interval],
      customer_notify: 1,
      notes: { tenant_id: r.tenantId },
    });
    return { url: sub.short_url, subscriptionId: sub.id };
  }

  portal(): Promise<string> {
    return Promise.reject(new BillingProviderError('Razorpay has no customer portal', 409));
  }

  toSubscription(s: Record<string, unknown>): ProviderSubscription {
    const plan = reverse(this.plans, str(s.plan_id));
    const notes = (s.notes ?? {}) as Record<string, unknown>;
    return {
      id: String(s.id),
      customerId: str(s.customer_id),
      status: RAZORPAY_STATUS[String(s.status)] ?? null,
      planCode: plan?.planCode ?? null,
      interval: plan?.interval ?? null,
      seats: Math.max(1, int(s.quantity, 1)),
      currentPeriodStart: secs(s.current_start),
      currentPeriodEnd: secs(s.current_end),
      // Razorpay reports a scheduled cancellation through `ended_at`/status; DealFlow records its own flag on request.
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      tenantId: str(notes.tenant_id),
    };
  }

  async getSubscription(id: string) {
    return this.toSubscription(await this.req<Record<string, unknown>>('GET', `/v1/subscriptions/${encodeURIComponent(id)}`));
  }

  /** Razorpay applies quantity and plan changes from the next cycle; DealFlow updates when the webhook confirms. */
  async changeSubscription(id: string, change: { seats?: number; priceId?: string }) {
    await this.req('PATCH', `/v1/subscriptions/${encodeURIComponent(id)}`, {
      ...(change.priceId ? { plan_id: change.priceId } : {}),
      ...(change.seats ? { quantity: change.seats } : {}),
      schedule_change_at: 'cycle_end',
    });
    return null;
  }

  async setCancelAtPeriodEnd(id: string, cancel: boolean) {
    if (!cancel) throw new BillingProviderError('Razorpay cannot undo a scheduled cancellation; subscribe again after the period ends.', 409);
    await this.req('POST', `/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: 1 });
    return null;
  }

  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): ParsedEvent {
    const sig = header(headers, 'x-razorpay-signature') ?? '';
    if (!sig || !this.env.RAZORPAY_WEBHOOK_SECRET) throw new InvalidSignatureError('Missing Razorpay signature');
    const expected = createHmac('sha256', this.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
    if (!safeEqualHex(sig, expected)) throw new InvalidSignatureError('Razorpay signature mismatch');

    const event = JSON.parse(raw.toString('utf8')) as {
      event: string;
      created_at?: number;
      payload?: { subscription?: { entity?: Record<string, unknown> }; payment?: { entity?: Record<string, unknown> } };
    };
    const sub = event.payload?.subscription?.entity ?? {};
    const pay = event.payload?.payment?.entity;
    const subscriptionId = str(sub.id);
    // Razorpay sends an event id header; fall back to a digest so retries of the same body still deduplicate.
    const id = header(headers, 'x-razorpay-event-id') ?? `${event.event}:${subscriptionId}:${expected.slice(0, 32)}`;
    const parsed: ParsedEvent = {
      id,
      type: String(event.event),
      tenantHint: str((sub.notes as Record<string, unknown> | undefined)?.tenant_id),
      refs: [subscriptionId, str(sub.customer_id)].filter((x): x is string => !!x),
      subscriptionId,
      invoice: null,
      paymentFailed: event.event === 'subscription.pending' || event.event === 'subscription.halted',
    };
    if (event.event === 'subscription.charged' && pay) {
      const paidAt = secs(pay.created_at) ?? secs(event.created_at);
      parsed.invoice = {
        id: str(pay.invoice_id) ?? String(pay.id),
        number: null,
        status: 'PAID',
        currency: String(pay.currency ?? 'INR').toUpperCase(),
        subtotalCents: int(pay.amount),
        taxCents: int(pay.tax),
        totalCents: int(pay.amount),
        amountPaidCents: int(pay.amount),
        periodStart: secs(sub.current_start),
        periodEnd: secs(sub.current_end),
        hostedUrl: null,
        pdfUrl: null,
        issuedAt: paidAt,
        paidAt,
      };
    }
    return parsed;
  }
}
