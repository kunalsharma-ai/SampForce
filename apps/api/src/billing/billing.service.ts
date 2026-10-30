import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  type BillingOverview,
  type BillingProviderKey,
  type CatalogPlan,
  type CheckoutInput,
  downgradeBlockers,
  effectiveEntitlements,
  type Interval,
  type InvoiceRow,
  monthlyCreditAllowance,
  PLAN_CATALOG,
  PLAN_ENTITLEMENTS,
  type PlanCode,
  SELF_SERVE_PLANS,
  type SelfServePlan,
  TRIAL_SEATS,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { BillingProviders } from './billing-providers';
import { BillingProviderError, InvalidSignatureError, type ParsedEvent, type ProviderSubscription } from './providers';

const DAY = 86_400_000;
const MINUTE = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const LIVE = ['ACTIVE', 'TRIALING', 'PAST_DUE'];

type SubRow = Prisma.SubscriptionGetPayload<object>;

const notConfigured = (what: string) => new ServiceUnavailableException({ code: 'BILLING_NOT_CONFIGURED', message: `${what} is not configured for this deployment.` });
const providerFailed = (err: unknown) =>
  new ServiceUnavailableException({ code: 'BILLING_PROVIDER_ERROR', message: err instanceof BillingProviderError ? err.message : 'The billing provider could not be reached. Try again shortly.' });

/**
 * Subscriptions, checkout, seats and invoices. DealFlow never sees card details: buyers pay on the
 * provider's hosted page and the provider's signed webhooks are the source of truth for what was paid.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private lastSweep = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly providers: BillingProviders,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── Reads ─────────────

  overview(auth: AuthContext): Promise<BillingOverview> {
    return this.prisma.run(auth, async (tx) => {
      const sub = await this.subscription(tx, auth.tenantId);
      const ent = effectiveEntitlements(sub);
      const [members, pending, pipelines, used, runs, ai] = await Promise.all([
        tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE' } }),
        tx.invitation.count({ where: { tenantId: auth.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
        tx.pipeline.count({ where: { tenantId: auth.tenantId, deletedAt: null } }),
        tx.aiUsage.aggregate({ where: { tenantId: auth.tenantId, createdAt: { gte: monthStart() } }, _sum: { credits: true } }),
        tx.workflowExecution.count({ where: { tenantId: auth.tenantId, startedAt: { gte: monthStart() } } }),
        tx.aiSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { monthlyCreditCap: true } }),
      ]);
      const allowance = monthlyCreditAllowance(ent.appliedPlan, members);
      const cap = ai?.monthlyCreditCap ?? null;
      const stripe = this.providers.get('STRIPE');
      return {
        plan: { code: ent.planCode, name: PLAN_CATALOG.find((p) => p.code === ent.planCode)?.name ?? ent.planCode },
        appliedPlan: ent.appliedPlan,
        status: sub.status,
        interval: sub.billingInterval,
        seats: sub.seats,
        seatLimit: ent.seatLimit,
        restricted: ent.restricted,
        provider: sub.provider,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        trialEndsAt: sub.status === 'TRIALING' ? (sub.trialEndsAt?.toISOString() ?? null) : null,
        trialAvailable: !sub.trialUsedAt && sub.planCode === 'free',
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        pastDueSince: sub.pastDueSince?.toISOString() ?? null,
        graceEndsAt: sub.status === 'PAST_DUE' && sub.pastDueSince ? new Date(sub.pastDueSince.getTime() + this.env.BILLING_GRACE_DAYS * DAY).toISOString() : null,
        providers: { STRIPE: stripe.configured, RAZORPAY: this.providers.get('RAZORPAY').configured },
        portalAvailable: stripe.configured && sub.provider === 'STRIPE' && !!sub.providerCustomerId,
        usage: {
          members: { used: members, limit: ent.seatLimit },
          pendingInvitations: pending,
          pipelines: { used: pipelines, limit: ent.entitlements.maxPipelines },
          aiCredits: { used: used._sum.credits ?? 0, limit: cap === null ? allowance : Math.min(allowance, cap) },
          automationRuns: { used: runs, limit: ent.entitlements.automationRunsPerMonth },
        },
        catalog: this.catalog(),
        salesContact: this.env.SALES_CONTACT_EMAIL ?? null,
        pricingPublished: this.env.PRICING_PUBLISHED,
        trialDays: this.env.TRIAL_DAYS,
      };
    });
  }

  /** The rate card with which provider/interval combinations can actually be bought here. */
  catalog(): CatalogPlan[] {
    const selfServe = new Set<string>(SELF_SERVE_PLANS);
    return PLAN_CATALOG.map((p) => {
      const can = (k: BillingProviderKey, i: Interval) => selfServe.has(p.code) && this.providers.get(k).configured && !!this.providers.get(k).priceId(p.code, i);
      return {
        code: p.code, name: p.name, audience: p.audience, monthly: p.monthly, annualMonthly: p.annualMonthly,
        entitlements: PLAN_ENTITLEMENTS[p.code], selfServe: selfServe.has(p.code),
        checkout: { STRIPE: { MONTH: can('STRIPE', 'MONTH'), YEAR: can('STRIPE', 'YEAR') }, RAZORPAY: { MONTH: can('RAZORPAY', 'MONTH'), YEAR: can('RAZORPAY', 'YEAR') } },
      };
    });
  }

  invoices(auth: AuthContext): Promise<InvoiceRow[]> {
    return this.prisma.run(auth, async (tx) =>
      (await tx.invoice.findMany({ where: { tenantId: auth.tenantId }, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }], take: 100 })).map(toInvoiceRow),
    );
  }

  // ───────────── Changes requested by the workspace ─────────────

  async checkout(auth: AuthContext, input: CheckoutInput, meta: RequestMeta): Promise<{ url: string }> {
    const adapter = this.providers.get(input.provider);
    if (!adapter.configured) throw notConfigured(input.provider === 'STRIPE' ? 'Stripe' : 'Razorpay');
    const priceId = adapter.priceId(input.planCode, input.interval);
    if (!priceId) throw new BadRequestException({ code: 'PRICE_NOT_CONFIGURED', message: 'That plan and billing interval cannot be bought online yet.' });

    const { sub, email, members } = await this.prisma.run(auth, async (tx) => ({
      sub: await this.subscription(tx, auth.tenantId),
      email: (await tx.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { email: true } })).email,
      members: await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE' } }),
    }));
    if (sub.providerSubscriptionId && sub.planCode !== 'free' && LIVE.includes(sub.status)) {
      throw new ConflictException({ code: 'ALREADY_SUBSCRIBED', message: 'This workspace already has a paid subscription. Change its plan or seats instead.' });
    }
    if (sub.provider === 'NONE' && sub.planCode !== 'free' && sub.status === 'ACTIVE') {
      throw new ConflictException({ code: 'MANAGED_PLAN', message: 'This workspace’s plan is managed by the DealFlow team. Contact them to change it.' });
    }
    if (input.seats < members) throw new BadRequestException({ code: 'TOO_FEW_SEATS', message: `The workspace has ${members} active members; buy at least that many seats.` });

    const web = this.env.PUBLIC_WEB_URL.replace(/\/$/, '');
    let result: { url: string; subscriptionId: string | null };
    try {
      result = await adapter.checkout({
        tenantId: auth.tenantId, email, priceId, seats: input.seats, interval: input.interval,
        customerId: sub.provider === input.provider ? sub.providerCustomerId : null,
        successUrl: `${web}/app/billing?checkout=success`, cancelUrl: `${web}/app/billing?checkout=canceled`,
      });
    } catch (err) {
      this.log.warn({ err: errorMessage(err), provider: input.provider }, 'checkout failed');
      throw providerFailed(err);
    }
    await this.prisma.run(auth, async (tx) => {
      // Razorpay creates the subscription before payment; remember it so its webhooks find this workspace.
      if (result.subscriptionId) await tx.subscription.update({ where: { tenantId: auth.tenantId }, data: { provider: input.provider, providerSubscriptionId: result.subscriptionId } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'billing.checkout_started', entityType: 'subscription', entityId: sub.id,
        metadata: { provider: input.provider, planCode: input.planCode, interval: input.interval, seats: input.seats }, meta,
      });
    });
    return { url: result.url };
  }

  async portal(auth: AuthContext): Promise<{ url: string }> {
    const sub = await this.prisma.run(auth, (tx) => this.subscription(tx, auth.tenantId));
    const stripe = this.providers.get('STRIPE');
    if (!stripe.configured) throw notConfigured('Stripe');
    if (sub.provider !== 'STRIPE' || !sub.providerCustomerId) throw new ConflictException({ code: 'NO_BILLING_ACCOUNT', message: 'There is no Stripe billing account for this workspace yet.' });
    try {
      return { url: await stripe.portal(sub.providerCustomerId, `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/app/billing`) };
    } catch (err) {
      throw providerFailed(err);
    }
  }

  async setSeats(auth: AuthContext, seats: number, meta: RequestMeta) {
    const { sub, used } = await this.prisma.run(auth, async (tx) => ({
      sub: await this.subscription(tx, auth.tenantId),
      used:
        (await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE' } })) +
        (await tx.invitation.count({ where: { tenantId: auth.tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } })),
    }));
    if (seats < used) throw new BadRequestException({ code: 'TOO_FEW_SEATS', message: `${used} seats are in use, counting pending invitations. Remove members or revoke invitations first.` });
    return this.change(auth, sub, { seats }, meta, 'billing.seats_changed', { from: sub.seats, to: seats });
  }

  async changePlan(auth: AuthContext, planCode: SelfServePlan, interval: Interval, meta: RequestMeta) {
    const { sub, members, pipelines } = await this.prisma.run(auth, async (tx) => ({
      sub: await this.subscription(tx, auth.tenantId),
      members: await tx.membership.count({ where: { tenantId: auth.tenantId, status: 'ACTIVE' } }),
      pipelines: await tx.pipeline.count({ where: { tenantId: auth.tenantId, deletedAt: null } }),
    }));
    if (sub.planCode === planCode && sub.billingInterval === interval) throw new BadRequestException({ code: 'NO_CHANGE', message: 'The workspace is already on that plan.' });
    const blockers = downgradeBlockers(planCode, sub.seats, { members, pipelines });
    if (blockers.length) {
      throw new ConflictException({ code: 'DOWNGRADE_BLOCKED', message: 'Current usage is above that plan’s limits.', details: blockers.map((message) => ({ path: 'planCode', message })) });
    }
    const adapter = this.liveAdapter(sub);
    const priceId = adapter.priceId(planCode, interval);
    if (!priceId) throw new BadRequestException({ code: 'PRICE_NOT_CONFIGURED', message: 'That plan and billing interval cannot be bought online yet.' });
    return this.change(auth, sub, { priceId }, meta, 'billing.plan_changed', { from: { planCode: sub.planCode, interval: sub.billingInterval }, to: { planCode, interval } });
  }

  async setCancel(auth: AuthContext, cancel: boolean, meta: RequestMeta) {
    const sub = await this.prisma.run(auth, (tx) => this.subscription(tx, auth.tenantId));
    const adapter = this.liveAdapter(sub);
    if (sub.cancelAtPeriodEnd === cancel) return { appliesAt: 'cycle_end' as const };
    let remote: ProviderSubscription | null;
    try {
      remote = await adapter.setCancelAtPeriodEnd(sub.providerSubscriptionId!, cancel);
    } catch (err) {
      if (err instanceof BillingProviderError && err.status === 409) throw new ConflictException({ code: 'NOT_SUPPORTED', message: err.message });
      throw providerFailed(err);
    }
    await this.prisma.run(auth, async (tx) => {
      if (remote) await this.applySubscription(tx, auth.tenantId, adapter.key, remote);
      else await tx.subscription.update({ where: { tenantId: auth.tenantId }, data: { cancelAtPeriodEnd: cancel } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: cancel ? 'billing.cancel_scheduled' : 'billing.cancel_withdrawn', entityType: 'subscription', entityId: sub.id, meta });
    });
    return { appliesAt: 'cycle_end' as const };
  }

  /** One free trial of a paid plan per workspace, without payment details. */
  startTrial(auth: AuthContext, planCode: SelfServePlan, meta: RequestMeta) {
    return this.prisma.run(auth, async (tx) => {
      const sub = await this.subscription(tx, auth.tenantId);
      if (sub.trialUsedAt) throw new ConflictException({ code: 'TRIAL_USED', message: 'This workspace has already used its free trial.' });
      if (sub.planCode !== 'free') throw new ConflictException({ code: 'TRIAL_UNAVAILABLE', message: 'Trials are for workspaces on the Free plan.' });
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + this.env.TRIAL_DAYS * DAY);
      await tx.subscription.update({
        where: { tenantId: auth.tenantId },
        data: { planCode, status: 'TRIALING', seats: TRIAL_SEATS, trialEndsAt, trialUsedAt: now, currentPeriodStart: now, currentPeriodEnd: trialEndsAt },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'billing.trial_started', entityType: 'subscription', entityId: sub.id, metadata: { planCode, trialEndsAt: trialEndsAt.toISOString() }, meta });
      return { trialEndsAt: trialEndsAt.toISOString() };
    });
  }

  private liveAdapter(sub: SubRow) {
    if (sub.provider === 'NONE' || !sub.providerSubscriptionId || sub.planCode === 'free' || !LIVE.includes(sub.status) || sub.status === 'TRIALING') {
      throw new ConflictException({ code: 'NO_PAID_SUBSCRIPTION', message: 'This workspace has no paid subscription to change. Choose a plan first.' });
    }
    const adapter = this.providers.get(sub.provider);
    if (!adapter.configured) throw notConfigured(sub.provider === 'STRIPE' ? 'Stripe' : 'Razorpay');
    return adapter;
  }

  private async change(auth: AuthContext, sub: SubRow, change: { seats?: number; priceId?: string }, meta: RequestMeta, action: string, metadata: Record<string, unknown>) {
    const adapter = this.liveAdapter(sub);
    let remote: ProviderSubscription | null;
    try {
      remote = await adapter.changeSubscription(sub.providerSubscriptionId!, change);
    } catch (err) {
      throw providerFailed(err);
    }
    await this.prisma.run(auth, async (tx) => {
      if (remote) await this.applySubscription(tx, auth.tenantId, adapter.key, remote);
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action, entityType: 'subscription', entityId: sub.id, metadata: { ...metadata, appliesAt: adapter.changesApply }, meta });
    });
    return { appliesAt: adapter.changesApply };
  }

  // ───────────── Provider webhooks ─────────────

  async handleWebhook(key: BillingProviderKey, raw: Buffer | undefined, headers: Record<string, string | string[] | undefined>): Promise<{ received: true; duplicate?: true; ignored?: string }> {
    const adapter = this.providers.get(key);
    if (!adapter.configured) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    if (!raw?.length) throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'Webhook signature could not be verified.' });
    let ev: ParsedEvent;
    try {
      ev = adapter.verifyWebhook(raw, headers);
    } catch (err) {
      if (err instanceof InvalidSignatureError || err instanceof SyntaxError) {
        this.log.warn({ provider: key, reason: errorMessage(err) }, 'rejected billing webhook');
        throw new BadRequestException({ code: 'INVALID_SIGNATURE', message: 'Webhook signature could not be verified.' });
      }
      throw err;
    }
    const tenantId = await this.resolveTenant(ev);
    if (!tenantId) {
      this.log.warn({ provider: key, type: ev.type, eventId: ev.id }, 'billing webhook for an unknown workspace');
      return { received: true, ignored: 'unknown_workspace' };
    }
    // Event order is not guaranteed, so read the subscription's current state rather than trusting the payload.
    // A provider outage here fails the request and the provider retries later.
    const remote = ev.subscriptionId ? await adapter.getSubscription(ev.subscriptionId) : null;
    if (remote?.tenantId && remote.tenantId !== tenantId) {
      this.log.error({ provider: key, eventId: ev.id }, 'billing webhook workspace mismatch');
      return { received: true, ignored: 'workspace_mismatch' };
    }
    return this.prisma.run({ tenantId }, async (tx) => {
      const { count } = await tx.billingEvent.createMany({ data: [{ tenantId, provider: key, providerEventId: ev.id, type: ev.type }], skipDuplicates: true });
      if (count === 0) return { received: true as const, duplicate: true as const };
      if (remote) await this.applySubscription(tx, tenantId, key, remote, ev.type);
      if (ev.invoice) {
        const { id, issuedAt, ...rest } = ev.invoice;
        const inv = { ...rest, issuedAt: issuedAt ?? new Date() };
        await tx.invoice.upsert({
          where: { provider_providerInvoiceId: { provider: key, providerInvoiceId: id } },
          create: { tenantId, provider: key, providerInvoiceId: id, ...inv },
          update: inv,
        });
      }
      if (ev.paymentFailed) {
        await this.notifyBilling(tx, tenantId, {
          type: 'billing.payment_failed', title: 'A payment for DealFlow failed',
          body: `Paid features stay on for ${this.env.BILLING_GRACE_DAYS} days while you update the payment method.`, link: '/app/billing',
        });
      }
      return { received: true as const };
    });
  }

  /** Finds the workspace: a provider reference already on file wins; otherwise the metadata DealFlow set at checkout. */
  private async resolveTenant(ev: ParsedEvent): Promise<string | null> {
    for (const ref of ev.refs) {
      const rows = await this.prisma.$transaction((tx) => tx.$queryRaw<{ t: string | null }[]>`SELECT app_billing_tenant(${ref})::text AS t`);
      if (rows[0]?.t) return rows[0].t;
    }
    if (ev.tenantHint && UUID.test(ev.tenantHint)) {
      const exists = await this.prisma.run({ tenantId: ev.tenantHint }, (tx) => tx.tenant.findUnique({ where: { id: ev.tenantHint! }, select: { id: true } }));
      if (exists) return exists.id;
    }
    return null;
  }

  /** Mirrors the provider's subscription onto the workspace. */
  async applySubscription(tx: TenantTx, tenantId: string, provider: BillingProviderKey, remote: ProviderSubscription, eventType?: string): Promise<void> {
    if (!remote.status) return;
    const current = await this.subscription(tx, tenantId);
    if (current.providerSubscriptionId && current.providerSubscriptionId !== remote.id && remote.status === 'CANCELED') return; // an older subscription ending
    if (remote.status === 'CANCELED') {
      await tx.subscription.update({
        where: { tenantId },
        data: { planCode: 'free', status: 'ACTIVE', seats: 1, billingInterval: 'MONTH', providerSubscriptionId: null, cancelAtPeriodEnd: false, pastDueSince: null, currentPeriodEnd: null, trialEndsAt: null },
      });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'billing.subscription_ended', entityType: 'subscription', entityId: current.id, metadata: { provider, planCode: current.planCode, eventType } });
      await this.notifyBilling(tx, tenantId, { type: 'billing.subscription_ended', title: 'Your paid DealFlow plan has ended', body: 'The workspace is on the Free plan now. All data is kept.', link: '/app/billing' });
      return;
    }
    if (!remote.planCode) this.log.warn({ provider, subscriptionId: remote.id }, 'subscription price is not in the configured price map; keeping the current plan');
    const planCode = remote.planCode ?? current.planCode;
    const data = {
      planCode,
      status: remote.status,
      billingInterval: remote.interval ?? current.billingInterval,
      seats: remote.seats,
      provider,
      providerCustomerId: remote.customerId ?? current.providerCustomerId,
      providerSubscriptionId: remote.id,
      currentPeriodStart: remote.currentPeriodStart ?? current.currentPeriodStart,
      currentPeriodEnd: remote.currentPeriodEnd,
      trialEndsAt: remote.trialEndsAt,
      // Razorpay does not report a scheduled cancellation on the subscription, so DealFlow keeps its own flag there.
      cancelAtPeriodEnd: provider === 'STRIPE' ? remote.cancelAtPeriodEnd : current.cancelAtPeriodEnd,
      pastDueSince: remote.status === 'PAST_DUE' || remote.status === 'UNPAID' ? (current.pastDueSince ?? new Date()) : null,
    };
    await tx.subscription.update({ where: { tenantId }, data });
    const changed = current.planCode !== planCode || current.status !== remote.status || current.seats !== remote.seats;
    if (changed) {
      await this.audit.record(tx, {
        tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'billing.subscription_synced', entityType: 'subscription', entityId: current.id,
        metadata: { provider, eventType, from: { planCode: current.planCode, status: current.status, seats: current.seats }, to: { planCode, status: remote.status, seats: remote.seats } },
      });
    }
  }

  // ───────────── Worker: trial expiry and dunning ─────────────

  /** At most once a minute: ends lapsed trials and moves past-due workspaces to unpaid when the grace period is over. */
  async runDue(force = false): Promise<number> {
    if (!force && Date.now() - this.lastSweep < MINUTE) return 0;
    this.lastSweep = Date.now();
    const graceStart = new Date(Date.now() - this.env.BILLING_GRACE_DAYS * DAY);
    const due = await claim<{ tenant_id: string }>(
      this.prisma,
      Prisma.sql`SELECT tenant_id FROM subscriptions
                 WHERE (status = 'TRIALING' AND trial_ends_at < now() AND provider_subscription_id IS NULL)
                    OR (status = 'PAST_DUE' AND past_due_since < ${graceStart})
                 LIMIT 200`,
    );
    let n = 0;
    for (const { tenant_id: tenantId } of due) {
      try {
        n += await this.prisma.run({ tenantId }, async (tx) => {
          const ended = await tx.subscription.updateMany({
            where: { tenantId, status: 'TRIALING', trialEndsAt: { lt: new Date() }, providerSubscriptionId: null },
            data: { planCode: 'free', status: 'ACTIVE', seats: 1, trialEndsAt: null, currentPeriodEnd: null },
          });
          if (ended.count) {
            await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'billing.trial_ended', entityType: 'subscription' });
            await this.notifyBilling(tx, tenantId, { type: 'billing.trial_ended', title: 'Your DealFlow trial has ended', body: 'The workspace is back on the Free plan. All data is kept; choose a plan to continue with paid features.', link: '/app/billing' });
            return 1;
          }
          const lapsed = await tx.subscription.updateMany({ where: { tenantId, status: 'PAST_DUE', pastDueSince: { lt: graceStart } }, data: { status: 'UNPAID' } });
          if (lapsed.count) {
            await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'billing.grace_ended', entityType: 'subscription' });
            await this.notifyBilling(tx, tenantId, { type: 'billing.unpaid', title: 'Paid features are paused', body: 'The grace period for the failed payment has ended, so Free plan limits apply until it is paid. No data has been removed.', link: '/app/billing' });
            return 1;
          }
          return 0;
        });
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'billing sweep failed');
      }
    }
    return n;
  }

  // ───────────── Helpers ─────────────

  /** Every workspace has a subscription row (Free at sign-up); create one defensively for older data. */
  async subscription(tx: TenantTx, tenantId: string): Promise<SubRow> {
    return (await tx.subscription.findUnique({ where: { tenantId } })) ?? (await tx.subscription.create({ data: { tenantId, planCode: 'free' } }));
  }

  private async notifyBilling(tx: TenantTx, tenantId: string, n: { type: string; title: string; body: string; link: string }) {
    const people = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE', role: { permissions: { has: 'billing:manage' } } }, select: { userId: true } });
    await this.notifications.send(tx, tenantId, people.map((p) => p.userId), n);
  }
}

export function toInvoiceRow(r: Prisma.InvoiceGetPayload<object>): InvoiceRow {
  return {
    id: r.id, provider: r.provider as BillingProviderKey, number: r.number, status: r.status, currency: r.currency,
    totalCents: r.totalCents, amountPaidCents: r.amountPaidCents, taxCents: r.taxCents,
    periodStart: r.periodStart?.toISOString() ?? null, periodEnd: r.periodEnd?.toISOString() ?? null,
    hostedUrl: r.hostedUrl, pdfUrl: r.pdfUrl, issuedAt: r.issuedAt?.toISOString() ?? null, paidAt: r.paidAt?.toISOString() ?? null,
  };
}

export const isPlanCode = (v: string): v is PlanCode => v in PLAN_ENTITLEMENTS;
