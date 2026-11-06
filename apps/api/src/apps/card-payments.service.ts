import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { type AppConnection, Prisma, type QuotePayment } from '@dealflow/database';
import type { AppStatus, PaymentsConnectInput, PaymentsSettings, PublicProposal, QuotePaymentRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppError, AppsService } from './apps.service';
import { CardPaymentError, CardPaymentsClient, type PaymentKeys, toMinorUnits } from './card-payments';

type ProposalPayment = NonNullable<PublicProposal['payment']>;

/**
 * Card payments on accepted proposals, into the workspace's own Stripe or Razorpay account. SampForce never sees
 * card details: the customer pays on the provider's hosted page, and a payment counts only when the provider's
 * signed webhook confirms it with the amount that was asked.
 */
@Injectable()
export class CardPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly apps: AppsService,
    private readonly client: CardPaymentsClient,
    private readonly notifications: NotificationsService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Saves the keys after a live read proves them. The webhook URL stays the same when keys are replaced. */
  async connect(auth: AuthContext, input: PaymentsConnectInput, meta: RequestMeta): Promise<AppStatus> {
    const keys: PaymentKeys = input.provider === 'stripe' ? { provider: 'stripe', secretKey: input.secretKey, webhookSecret: input.webhookSecret } : { provider: 'razorpay', keyId: input.keyId, keySecret: input.keySecret, webhookSecret: input.webhookSecret };
    let checked: { mode: 'test' | 'live'; accountLabel: string };
    try {
      checked = await this.client.check(keys);
    } catch (e) {
      throw e instanceof CardPaymentError ? new AppError(e.message) : e;
    }
    const existing = await this.prisma.run(auth, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'PAYMENTS' } } }));
    const prior = existing?.settings as Partial<PaymentsSettings> | undefined;
    const hookId = existing?.externalAccountId ?? randomBytes(12).toString('hex');
    const settings: PaymentsSettings = {
      provider: input.provider,
      mode: checked.mode,
      webhookUrl: `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/apps/payments/webhooks/${hookId}`,
      // A different provider or secret has to prove its webhook again.
      lastWebhookAt: prior?.provider === input.provider && existing && this.keys(existing).webhookSecret === input.webhookSecret ? (prior.lastWebhookAt ?? null) : null,
    };
    const data = {
      externalAccountId: hookId,
      accountName: `${checked.accountLabel} (${checked.mode === 'live' ? 'live' : 'test mode'})`,
      scopes: [],
      credentialsEncrypted: this.box.seal(JSON.stringify(keys)),
      settings: settings as unknown as Prisma.InputJsonValue,
      status: 'CONNECTED' as const,
      lastError: null,
      lastUsedAt: new Date(),
      connectedById: auth.userId,
    };
    await this.prisma.run(auth, async (tx) => {
      const row = await tx.appConnection.upsert({ where: { tenantId_provider: { tenantId: auth.tenantId, provider: 'PAYMENTS' } }, create: { tenantId: auth.tenantId, provider: 'PAYMENTS', ...data }, update: data });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: existing ? 'app.keys_replaced' : 'app.connected', entityType: 'app_connection', entityId: row.id, metadata: { app: 'payments', provider: input.provider, mode: checked.mode }, meta });
    });
    const conn = await this.apps.requireConnection(auth.tenantId, 'payments');
    await this.apps.recordEvent(auth.tenantId, conn, { kind: 'keys.checked', ok: true, externalId: null, summary: `${input.provider === 'stripe' ? 'Stripe' : 'Razorpay'} keys checked (${checked.mode} mode)`, actorUserId: auth.userId });
    return (await this.apps.status(auth)).find((a) => a.key === 'payments')!;
  }

  /** What the proposal page shows: can this customer pay now, and have they paid. */
  async forProposal(tenantId: string, q: { id: string; status: string; isLatest: boolean; total: number; currency: string; expired: boolean }): Promise<ProposalPayment | undefined> {
    const conn = await this.connection(tenantId);
    if (!conn) return undefined;
    const provider = this.settings(conn).provider;
    const paid = await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.findFirst({ where: { tenantId, quoteId: q.id, status: 'paid' }, orderBy: { paidAt: 'desc' } }));
    if (paid) return { available: false, provider, paid: true, paidAt: paid.paidAt?.toISOString() ?? null, reason: null };
    const reason = payReason(q, conn);
    return { available: !reason, provider, paid: false, paidAt: null, reason };
  }

  /** Called from the public proposal link: creates a hosted payment page and returns its URL. */
  async start(tenantId: string, quoteId: string, token: string): Promise<{ url: string }> {
    const conn = await this.connection(tenantId);
    if (!conn) throw new ConflictException({ code: 'PAYMENTS_OFF', message: 'Card payment is not available for this proposal.' });
    const { q, email } = await this.prisma.run({ tenantId }, async (tx) => {
      const quote = await tx.quote.findFirst({ where: { id: quoteId, tenantId, shareEnabled: true }, include: { opportunity: { select: { contactId: true } } } });
      if (!quote) throw new NotFoundException({ code: 'NOT_FOUND', message: 'This proposal link is not valid or is no longer shared.' });
      const contact = quote.opportunity.contactId ? await tx.contact.findFirst({ where: { id: quote.opportunity.contactId, tenantId }, select: { email: true } }) : null;
      return { q: quote, email: contact?.email ?? null };
    });
    const total = q.total.toNumber();
    const expired = !!q.validUntil && q.validUntil.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10) && q.status === 'SENT';
    const reason = payReason({ status: q.status, isLatest: q.isLatest, total, currency: q.currency, expired }, conn);
    if (reason) throw new ConflictException({ code: 'CANNOT_PAY', message: reason });
    const already = await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.findFirst({ where: { tenantId, quoteId, status: 'paid' } }));
    if (already) throw new ConflictException({ code: 'ALREADY_PAID', message: 'This proposal has already been paid.' });
    const keys = this.keys(conn);
    const payment = await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.create({ data: { tenantId, connectionId: conn.id, quoteId, provider: keys.provider, amount: q.total, currency: q.currency } }));
    const base = `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/p/${token}`;
    const reference = `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`;
    try {
      const r = await this.client.createRequest(keys, { paymentId: payment.id, quoteId, tenantId, description: `${reference} ${q.title}`, amount: total, currency: q.currency, returnUrl: `${base}?payment=done`, cancelUrl: base, customerEmail: email });
      await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.update({ where: { id: payment.id }, data: { providerRef: r.ref } }));
      await this.apps.recordEvent(tenantId, conn, { kind: 'payment.started', ok: true, externalId: r.ref, summary: `Payment page opened for ${reference} (${q.currency} ${total.toFixed(2)})`, actorUserId: null, entityType: 'quote', entityId: quoteId });
      return { url: r.url };
    } catch (e) {
      await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.update({ where: { id: payment.id }, data: { status: 'failed' } }));
      const message = e instanceof CardPaymentError ? e.message : 'The payment page could not be opened.';
      await this.apps.recordEvent(tenantId, conn, { kind: 'payment.start_failed', ok: false, externalId: null, summary: `Payment page for ${reference} not opened: ${message}`, actorUserId: null, entityType: 'quote', entityId: quoteId });
      if (e instanceof CardPaymentError && (e.code === 'keys_refused' || e.code === 'permission')) {
        await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { status: 'ERROR', lastError: message } }));
      }
      throw new ConflictException({ code: 'PAYMENT_UNAVAILABLE', message: 'Card payment is not available right now. Please contact the seller.' });
    }
  }

  /** The provider's webhook for one workspace, found by the id in its URL and checked with that workspace's secret. */
  async webhook(hookId: string, raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<{ received: true }> {
    if (!/^[a-f0-9]{24}$/.test(hookId) || !raw) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const conn = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.app_provider', 'PAYMENTS', true), set_config('app.app_account', ${hookId}, true)`;
      return tx.appConnection.findFirst({ where: { provider: 'PAYMENTS', externalAccountId: hookId } });
    });
    if (!conn) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unknown webhook.' });
    const keys = this.keys(conn);
    let ev;
    try {
      ev = this.client.parseWebhook(keys, raw, headers);
    } catch (e) {
      if (e instanceof CardPaymentError && e.status === 401) throw new NotFoundException({ code: 'BAD_SIGNATURE', message: 'Signature check failed.' });
      throw e;
    }
    const tenantId = conn.tenantId;
    const settings = this.settings(conn);
    if (!settings.lastWebhookAt) {
      await this.prisma.run({ tenantId }, (tx) => tx.appConnection.update({ where: { id: conn.id }, data: { settings: { ...settings, lastWebhookAt: new Date().toISOString() } as unknown as Prisma.InputJsonValue } }));
    }
    if (ev.outcome === 'ignored' || !ev.paymentId || !/^[0-9a-f-]{36}$/.test(ev.paymentId)) return { received: true };
    const payment = await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.findFirst({ where: { id: ev.paymentId!, tenantId } }));
    if (!payment || payment.status === 'paid') return { received: true };

    if (ev.outcome === 'paid') {
      const asked = toMinorUnits(payment.amount.toNumber(), payment.currency);
      if (ev.amountMinor !== asked || (ev.currency && ev.currency !== payment.currency.toUpperCase())) {
        await this.apps.recordEvent(tenantId, conn, { kind: 'payment.mismatch', ok: false, externalId: ev.providerPaymentId, summary: `A payment for this proposal did not match the amount asked (${ev.currency ?? '?'} ${ev.amountMinor ?? '?'} vs ${payment.currency} ${asked}); not marked paid`, actorUserId: null, entityType: 'quote', entityId: payment.quoteId });
        return { received: true };
      }
      await this.prisma.run({ tenantId }, async (tx) => {
        const moved = await tx.quotePayment.updateMany({ where: { id: payment.id, status: { not: 'paid' } }, data: { status: 'paid', paidAt: new Date(), providerPaymentId: ev.providerPaymentId, payerEmail: ev.payerEmail?.slice(0, 254) ?? null } });
        if (!moved.count) return;
        const q = await tx.quote.findFirstOrThrow({ where: { id: payment.quoteId, tenantId } });
        const ref = `Q-${String(q.number).padStart(4, '0')}${q.version > 1 ? ` v${q.version}` : ''}`;
        await this.audit.record(tx, { tenantId, actorUserId: null, action: 'quote.paid', entityType: 'quote', entityId: q.id, metadata: { provider: payment.provider, amount: payment.amount.toNumber(), currency: payment.currency, providerPaymentId: ev.providerPaymentId } });
        if (q.createdById) {
          await this.notifications.send(tx, tenantId, [q.createdById], { type: 'quote.paid', title: `Proposal ${ref} was paid`, body: ev.payerEmail
            ? `${payment.currency} ${payment.amount.toNumber().toFixed(2)} by card from ${ev.payerEmail}, confirmed by ${payment.provider === 'stripe' ? 'Stripe' : 'Razorpay'}.`
            : `${payment.currency} ${payment.amount.toNumber().toFixed(2)} by card, confirmed by ${payment.provider === 'stripe' ? 'Stripe' : 'Razorpay'}.`, link: `/app/quotes/${q.id}` });
        }
      });
      await this.apps.recordEvent(tenantId, conn, { kind: 'payment.paid', ok: true, externalId: ev.providerPaymentId, summary: `Paid: ${payment.currency} ${payment.amount.toNumber().toFixed(2)}${ev.payerEmail ? ` by ${ev.payerEmail}` : ''}`, actorUserId: null, entityType: 'quote', entityId: payment.quoteId });
      return { received: true };
    }
    await this.prisma.run({ tenantId }, (tx) => tx.quotePayment.updateMany({ where: { id: payment.id, status: 'pending' }, data: { status: ev.outcome } }));
    return { received: true };
  }

  async listForQuote(auth: AuthContext, quoteId: string): Promise<QuotePaymentRow[]> {
    const rows = await this.prisma.run(auth, (tx) => tx.quotePayment.findMany({ where: { tenantId: auth.tenantId, quoteId }, orderBy: { createdAt: 'desc' }, take: 50 }));
    return rows.map(toRow);
  }

  private async connection(tenantId: string): Promise<AppConnection | null> {
    const c = await this.prisma.run({ tenantId }, (tx) => tx.appConnection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'PAYMENTS' } } }));
    return c && c.status !== 'DISCONNECTED' ? c : null;
  }

  private keys(conn: AppConnection): PaymentKeys {
    return JSON.parse(this.box.open(conn.credentialsEncrypted)) as PaymentKeys;
  }

  private settings(conn: AppConnection): PaymentsSettings {
    return conn.settings as unknown as PaymentsSettings;
  }
}

function payReason(q: { status: string; isLatest: boolean; total: number; currency: string; expired: boolean }, conn: AppConnection): string | null {
  if (conn.status === 'ERROR') return 'Card payment is not available right now. Please contact the seller.';
  if (!q.isLatest) return 'A newer version of this proposal exists.';
  if (q.status !== 'ACCEPTED') return 'Card payment opens once the proposal is accepted.';
  if (q.total <= 0) return 'This proposal has nothing to pay.';
  try {
    toMinorUnits(q.total, q.currency);
  } catch {
    return `Card payment in ${q.currency} is not available.`;
  }
  return null;
}

function toRow(r: QuotePayment): QuotePaymentRow {
  return {
    id: r.id,
    quoteId: r.quoteId,
    provider: r.provider as QuotePaymentRow['provider'],
    status: r.status as QuotePaymentRow['status'],
    amount: r.amount.toNumber(),
    currency: r.currency,
    payerEmail: r.payerEmail,
    providerPaymentId: r.providerPaymentId,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
