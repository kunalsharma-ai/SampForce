import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { FEATURE_KEYS, type FeatureKey, normaliseFeatures, type OperatorFeatureOverridesInput, type OperatorPlanDefinitionInput, type OperatorPlanRow, type OperatorWorkspaceFeatures, PLAN_CATALOG, PLAN_ENTITLEMENTS, type PlanCode } from '@dealflow/types';
import type { DeploymentSettingRow, OperatorOpenInvoice, OperatorPaymentInput, OperatorPlanInput, OperatorProviderRow, OperatorSettings, OperatorTenantDetail, OperatorTenantRow, PlatformAuditRow, ProviderCheckKey, ProviderKey, ProviderKeysUpdateInput, ProviderWebhookStatus } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { BillingProviders } from '../billing/billing-providers';
import { BillingService, PAYMENT_INSTRUCTIONS_KEY, toInvoiceRow } from '../billing/billing.service';
import { entitlementsFor, planDefinitions } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { HunterClient } from '../finder/hunter';
import { DeepgramClient } from '../meetings/deepgram';
import { ApolloClient } from '../prospects/apollo';
import { fingerprintOf, isManagedKey, MANAGED_KEY_NAMES, MANAGED_KEYS, type ManagedKeyName, parseManagedValue, ProviderKeysService } from '../common/provider-keys';
import { readReceipt, receiptKey, WEBHOOK_RECEIPT_PREFIX } from '../common/webhook-receipts';
import { DEPLOYMENT_SETTINGS } from './deployment-settings';
import { ConnectionTests } from './connection-tests';
import { type CatalogueProvider, PROVIDER_CATALOGUE } from './provider-catalogue';
import { PROVIDER_CHECK_PREFIX, readProviderCheck, type StoredCheck } from './provider-checks';
import type { OperatorContext } from './operator-auth';

type ScanTx = Prisma.TransactionClient;

/**
 * Platform operations. Listing reads only tenants, subscriptions, membership counts, support grants and
 * invoices across workspaces (the `operator_scan` policies). Member lists and the workspace audit log
 * are shown only while that workspace has granted support access. Operators never read CRM records.
 */
@Injectable()
export class OperatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly sellers: BillingProviders,
    private readonly apollo: ApolloClient,
    private readonly hunter: HunterClient,
    private readonly deepgram: DeepgramClient,
    private readonly tests: ConnectionTests,
    private readonly keys: ProviderKeysService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async login(email: string, password: string, ip: string | null): Promise<OperatorContext> {
    const op = await this.prisma.platformOperator.findUnique({ where: { email } });
    const ok = await this.passwords.verify(op?.passwordHash ?? null, password);
    if (!op || !ok || op.status !== 'ACTIVE') {
      await this.log(null, 'operator.login_failed', null, { email }, ip);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    await this.prisma.platformOperator.update({ where: { id: op.id }, data: { lastLoginAt: new Date() } });
    await this.log(op.id, 'operator.login', null, {}, ip);
    return { id: op.id, email: op.email, name: op.name, role: op.role };
  }

  private scan<T>(fn: (tx: ScanTx) => Promise<T>): Promise<T> {
    return this.prisma.run({ operatorScan: true }, (tx) => fn(tx));
  }

  async tenants(op: OperatorContext, q: { search?: string }, ip: string | null): Promise<OperatorTenantRow[]> {
    const rows = await this.scan((tx) => this.tenantRows(tx, q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { slug: { contains: q.search, mode: 'insensitive' } }] } : {}));
    await this.log(op.id, 'tenants.listed', null, { search: q.search ?? null, results: rows.length }, ip);
    return rows;
  }

  private async tenantRows(tx: ScanTx, where: Prisma.TenantWhereInput): Promise<OperatorTenantRow[]> {
    const now = new Date();
    const tenants = await tx.tenant.findMany({
      where: { deletedAt: null, ...where },
      include: {
        subscription: true,
        _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
        supportGrants: { where: { revokedAt: null, expiresAt: { gt: now } }, orderBy: { expiresAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return tenants.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, status: t.status, isDemo: t.isDemo, createdAt: t.createdAt.toISOString(), members: t._count.memberships,
      subscription: t.subscription
        ? { planCode: t.subscription.planCode, status: t.subscription.status, seats: t.subscription.seats, provider: t.subscription.provider, currentPeriodEnd: t.subscription.currentPeriodEnd?.toISOString() ?? null, trialEndsAt: t.subscription.trialEndsAt?.toISOString() ?? null }
        : null,
      supportAccessUntil: t.supportGrants[0]?.expiresAt.toISOString() ?? null,
    }));
  }

  async tenant(op: OperatorContext, id: string, ip: string | null): Promise<OperatorTenantDetail> {
    const { row, invoices } = await this.scan(async (tx) => ({
      row: (await this.tenantRows(tx, { id }))[0],
      invoices: await tx.invoice.findMany({ where: { tenantId: id }, orderBy: { issuedAt: 'desc' }, take: 24 }),
    }));
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
    let support: OperatorTenantDetail['support'] = null;
    if (row.supportAccessUntil) {
      support = await this.prisma.run({ tenantId: id }, async (tx) => {
        const [members, audit] = await Promise.all([
          tx.membership.findMany({ where: { tenantId: id, status: 'ACTIVE' }, include: { user: { select: { name: true, email: true } }, role: { select: { name: true } } }, orderBy: { createdAt: 'asc' }, take: 200 }),
          tx.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, actorType: true, createdAt: true, entityType: true } }),
        ]);
        return {
          members: members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role.name, joinedAt: m.createdAt.toISOString() })),
          audit: audit.map((a) => ({ action: a.action, actorType: a.actorType, createdAt: a.createdAt.toISOString(), entityType: a.entityType })),
        };
      });
    }
    await this.log(op.id, support ? 'tenant.viewed_with_support_access' : 'tenant.viewed', id, {}, ip);
    return { ...row, invoices: invoices.map(toInvoiceRow), support, features: await this.workspaceFeatures(id) };
  }

  // ───────────── Plan features (ADR 0057) ─────────────

  private async workspaceFeatures(id: string): Promise<OperatorWorkspaceFeatures> {
    return this.prisma.run({ tenantId: id }, async (tx) => {
      const [ent, rows] = await Promise.all([
        entitlementsFor(tx, id),
        tx.tenantFeatureOverride.findMany({ where: { tenantId: id }, orderBy: { feature: 'asc' } }),
      ]);
      const known = new Set<string>(FEATURE_KEYS);
      return {
        appliedPlan: ent.appliedPlan,
        planFeatures: ent.entitlements.features,
        overrides: rows.filter((r) => known.has(r.feature)).map((r) => ({ feature: r.feature as FeatureKey, enabled: r.enabled, reason: r.reason, updatedBy: r.updatedBy, updatedAt: r.updatedAt.toISOString() })),
        effective: ent.features,
      };
    });
  }

  async plans(): Promise<OperatorPlanRow[]> {
    const [defs, rows, counts] = await Promise.all([
      planDefinitions(this.prisma as unknown as TenantTx),
      this.prisma.plan.findMany({ select: { code: true, updatedAt: true } }),
      this.scan((tx) => tx.subscription.groupBy({ by: ['planCode'], _count: { _all: true } })),
    ]);
    const updated = new Map(rows.map((r) => [r.code, r.updatedAt]));
    const count = new Map(counts.map((c) => [c.planCode, c._count._all]));
    return PLAN_CATALOG.map((p) => {
      const d = defs[p.code];
      const shipped = new Set(PLAN_ENTITLEMENTS[p.code].features);
      const live = new Set(d.features);
      return {
        code: p.code,
        name: p.name,
        features: d.features,
        limits: { maxUsers: d.maxUsers, maxPipelines: d.maxPipelines, monthlyAiCredits: d.monthlyAiCredits, automationRunsPerMonth: d.automationRunsPerMonth },
        changedFromDefault: FEATURE_KEYS.filter((k) => shipped.has(k) !== live.has(k)),
        workspaces: count.get(p.code) ?? 0,
        updatedAt: (updated.get(p.code) ?? new Date(0)).toISOString(),
      };
    });
  }

  /** Changes a plan's features and limits for every workspace on it. Applies on each workspace's next request. */
  async setPlanDefinition(op: OperatorContext, code: PlanCode, input: OperatorPlanDefinitionInput, ip: string | null): Promise<OperatorPlanRow[]> {
    const before = (await planDefinitions(this.prisma as unknown as TenantTx))[code];
    const features = normaliseFeatures(input.features);
    const next = { ...input.limits, features };
    await this.prisma.plan.update({ where: { code }, data: { entitlements: next as unknown as Prisma.InputJsonValue } });
    const added = features.filter((f) => !before.features.includes(f));
    const removed = before.features.filter((f) => !features.includes(f));
    await this.log(op.id, 'plan.definition_changed', null, {
      plan: code, reason: input.reason, added, removed,
      limits: { from: { maxUsers: before.maxUsers, maxPipelines: before.maxPipelines, monthlyAiCredits: before.monthlyAiCredits, automationRunsPerMonth: before.automationRunsPerMonth }, to: input.limits },
    }, ip);
    return this.plans();
  }

  /** Grants (true) or withholds (false) features for one workspace; null hands the feature back to the plan. */
  async setFeatureOverrides(op: OperatorContext, id: string, input: OperatorFeatureOverridesInput, ip: string | null): Promise<OperatorTenantDetail> {
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!tenant) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      const changes: { feature: string; enabled: boolean | null }[] = [];
      for (const [feature, enabled] of Object.entries(input.overrides) as [FeatureKey, boolean | null][]) {
        if (enabled === null) {
          const del = await tx.tenantFeatureOverride.deleteMany({ where: { tenantId: id, feature } });
          if (del.count) changes.push({ feature, enabled: null });
        } else {
          await tx.tenantFeatureOverride.upsert({
            where: { tenantId_feature: { tenantId: id, feature } },
            create: { tenantId: id, feature, enabled, reason: input.reason, updatedBy: op.email },
            update: { enabled, reason: input.reason, updatedBy: op.email },
          });
          changes.push({ feature, enabled });
        }
      }
      await this.audit.record(tx, {
        tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.features_overridden', entityType: 'tenant', entityId: id,
        metadata: { operator: op.email, reason: input.reason, changes },
      });
    });
    await this.log(op.id, 'tenant.features_overridden', id, { overrides: input.overrides, reason: input.reason }, ip);
    return this.tenant(op, id, ip);
  }

  /** Manual plan changes for sales-led deals, credits and corrections. Recorded in both audit logs. */
  async setPlan(op: OperatorContext, id: string, input: OperatorPlanInput, ip: string | null) {
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const before = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      const now = new Date();
      await tx.subscription.update({
        where: { tenantId: id },
        data: {
          planCode: input.planCode, seats: input.seats, status: input.status,
          trialEndsAt: input.status === 'TRIALING' ? (input.trialEndsAt ? new Date(input.trialEndsAt) : before.trialEndsAt) : null,
          ...(input.status === 'TRIALING' ? { trialUsedAt: before.trialUsedAt ?? now } : {}),
          pastDueSince: input.status === 'PAST_DUE' || input.status === 'UNPAID' ? (before.pastDueSince ?? now) : null,
        },
      });
      await this.audit.record(tx, {
        tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.plan_overridden', entityType: 'subscription', entityId: before.id,
        metadata: { operator: op.email, reason: input.reason, from: { planCode: before.planCode, seats: before.seats, status: before.status }, to: { planCode: input.planCode, seats: input.seats, status: input.status } },
      });
    });
    await this.log(op.id, 'tenant.plan_overridden', id, { ...input }, ip);
    return this.tenant(op, id, ip);
  }

  /** Records that an offline invoice was paid; the plan it names starts or renews. Recorded in both audit logs. */
  async recordPayment(op: OperatorContext, id: string, invoiceId: string, input: OperatorPaymentInput, ip: string | null) {
    const today = new Date().toISOString().slice(0, 10);
    if (input.receivedOn && input.receivedOn > today) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The payment date cannot be in the future.', details: [{ path: 'receivedOn', message: 'Not in the future' }] });
    // A past date keeps the time of recording, so a payment entered today is not back-dated to midnight.
    const receivedAt = input.receivedOn && input.receivedOn !== today ? new Date(`${input.receivedOn}T12:00:00Z`) : new Date();
    const invoice = await this.prisma.run({ tenantId: id }, (tx) => this.billing.recordOfflinePayment(tx, id, invoiceId, { reference: input.reference, receivedAt, operator: op.email }));
    await this.log(op.id, 'tenant.offline_payment_recorded', id, { invoiceId, number: invoice.number, reference: input.reference, receivedOn: receivedAt.toISOString().slice(0, 10) }, ip);
    return this.tenant(op, id, ip);
  }

  async voidInvoice(op: OperatorContext, id: string, invoiceId: string, reason: string, ip: string | null) {
    await this.prisma.run({ tenantId: id }, (tx) => this.billing.voidOfflineInvoice(tx, id, invoiceId, reason, op.email));
    await this.log(op.id, 'tenant.invoice_voided', id, { invoiceId, reason }, ip);
    return this.tenant(op, id, ip);
  }

  async openInvoices(): Promise<OperatorOpenInvoice[]> {
    return this.scan(async (tx) => {
      const rows = await tx.invoice.findMany({ where: { provider: 'OFFLINE', status: 'OPEN' }, orderBy: { issuedAt: 'asc' }, take: 200, include: { tenant: { select: { id: true, name: true } } } });
      return rows.map((r) => ({ ...toInvoiceRow(r), tenant: r.tenant }));
    });
  }

  async settings(): Promise<OperatorSettings> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: PAYMENT_INSTRUCTIONS_KEY } });
    const by = row?.updatedById ? await this.prisma.platformOperator.findUnique({ where: { id: row.updatedById }, select: { email: true } }) : null;
    const paymentInstructions = await this.billing.paymentInstructions(this.prisma as unknown as TenantTx);
    return {
      paymentInstructions,
      paymentInstructionsSource: row?.value ? 'console' : paymentInstructions ? 'config' : 'none',
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: by?.email ?? null,
    };
  }

  /** Bank details and other payment instructions for offline invoices. Empty removes the console value. */
  async setPaymentInstructions(op: OperatorContext, instructions: string, ip: string | null): Promise<OperatorSettings> {
    if (instructions) {
      await this.prisma.platformSetting.upsert({
        where: { key: PAYMENT_INSTRUCTIONS_KEY },
        create: { key: PAYMENT_INSTRUCTIONS_KEY, value: instructions, updatedById: op.id },
        update: { value: instructions, updatedById: op.id },
      });
    } else {
      await this.prisma.platformSetting.deleteMany({ where: { key: PAYMENT_INSTRUCTIONS_KEY } });
    }
    // The full text is kept in the log so a changed bank account can always be traced.
    await this.log(op.id, 'settings.payment_instructions_updated', null, { instructions: instructions || null }, ip);
    return this.settings();
  }

  async setSuspended(op: OperatorContext, id: string, suspended: boolean, reason: string, ip: string | null) {
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id } });
      if (!t || t.deletedAt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Workspace not found.' });
      if (t.status === 'PENDING_DELETION') throw new ForbiddenException({ code: 'PENDING_DELETION', message: 'This workspace is scheduled for deletion.' });
      await tx.tenant.update({ where: { id }, data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' } });
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: suspended ? 'tenant.suspended' : 'tenant.reactivated', entityType: 'tenant', entityId: id, metadata: { operator: op.email, reason } });
    });
    await this.log(op.id, suspended ? 'tenant.suspended' : 'tenant.reactivated', id, { reason }, ip);
    return this.tenant(op, id, ip);
  }

  async auditLog(q: { tenantId?: string }): Promise<PlatformAuditRow[]> {
    const rows = await this.prisma.platformAuditLog.findMany({
      where: q.tenantId ? { targetTenantId: q.tenantId } : {},
      include: { operator: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, operator: r.operator, action: r.action, targetTenantId: r.targetTenantId, metadata: r.metadata as Record<string, unknown>, createdAt: r.createdAt.toISOString() }));
  }

  // ───── Provider setup: keys entered here or in the deployment's secrets, and a no-cost connection test for each ─────

  private fingerprint(p: CatalogueProvider): string | null {
    const values = p.tested.map((n) => this.env[n] as string | undefined);
    if (!values.length) return null;
    return values.some(Boolean) ? fingerprintOf(values.map((v) => v ?? '').join('\n')) : null;
  }

  /** Absolute URL on this deployment's public address, for pasting into a provider's console. */
  private publicUrl(path: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}${path}`;
  }

  private webhookStatus(p: CatalogueProvider, raw: string | undefined): ProviderWebhookStatus | null {
    if (!p.webhook) return null;
    const r = readReceipt(raw);
    const key = receiptKey(this.env, p.webhook);
    const current = r.lastVerified && key && r.lastVerified.key === key ? r.lastVerified : null;
    const state: ProviderWebhookStatus['state'] =
      r.lastRejected && (!current || r.lastRejected.at > current.at) ? 'rejected' : current ? 'verified' : r.lastVerified ? 'stale' : 'waiting';
    return { state, lastVerified: r.lastVerified ? { at: r.lastVerified.at, event: r.lastVerified.event } : null, lastRejected: r.lastRejected };
  }

  async providers(): Promise<OperatorProviderRow[]> {
    const rows = await this.prisma.platformSetting.findMany({ where: { OR: [{ key: { startsWith: PROVIDER_CHECK_PREFIX } }, { key: { startsWith: WEBHOOK_RECEIPT_PREFIX } }] } });
    const checks = new Map(rows.filter((r) => r.key.startsWith(PROVIDER_CHECK_PREFIX)).map((r) => [r.key.slice(PROVIDER_CHECK_PREFIX.length), readProviderCheck(r.value)]));
    const receipts = new Map(rows.filter((r) => r.key.startsWith(WEBHOOK_RECEIPT_PREFIX)).map((r) => [r.key.slice(WEBHOOK_RECEIPT_PREFIX.length), r.value]));
    const states = new Map(MANAGED_KEY_NAMES.map((n) => [n, this.keys.state(n)]));
    const editorIds = [...new Set([...states.values()].map((s) => s.updatedById).filter((x): x is string => !!x))];
    const editors = new Map((editorIds.length ? await this.prisma.platformOperator.findMany({ where: { id: { in: editorIds } }, select: { id: true, email: true } }) : []).map((o) => [o.id, o.email]));
    return PROVIDER_CATALOGUE.map((p) => {
      const env = p.fields.map((f) => {
        const st = states.get(f.name)!;
        const value: unknown = this.env[f.name];
        return {
          name: f.name, label: f.label, required: f.required, secret: MANAGED_KEYS[f.name].secret,
          input: f.switch ? ('switch' as const) : MANAGED_KEYS[f.name].secret ? ('secret' as const) : ('text' as const),
          set: value !== undefined && value !== null && value !== '',
          source: st.source,
          hint: st.hint,
          updatedAt: st.updatedAt, updatedBy: st.updatedById ? (editors.get(st.updatedById) ?? null) : null, help: f.help ?? null,
        };
      });
      const configured = env.filter((x) => x.required).every((x) => x.set);
      const checkable = p.tested.length > 0;
      const stored = checks.get(p.key) ?? null;
      // A test made with other keys (or before fingerprints were kept) is shown, but proves nothing now.
      const fp = this.fingerprint(p);
      const current = stored && stored.key !== null && stored.key === fp ? stored : null;
      const lastCheck = stored ? { ok: stored.ok, at: stored.at, message: stored.message, by: stored.by, stale: !current } : null;
      const state = !configured ? 'not_configured' : !current ? 'configured' : current.ok ? 'verified' : 'failed';
      const appStatus = p.key === 'checkout' ? this.checkoutStatus() : !configured ? p.app.off : state === 'verified' && p.app.verified ? p.app.verified : p.app.on;
      const setup = {
        consoleUrl: p.setup.consoleUrl ?? null, consoleLabel: p.setup.consoleLabel ?? null, steps: p.setup.steps,
        urls: (p.setup.urls ?? []).map((u) => ({ label: u.label, url: this.publicUrl(u.path), where: u.where })),
      };
      return { key: p.key, name: p.name, usedFor: p.usedFor, env, configured, checkable, checkNote: p.checkNote, lastCheck, state, appStatus, setup, webhook: this.webhookStatus(p, receipts.get(p.webhook ?? '')) };
    });
  }

  /** What workspaces see for billing right now, in one line. */
  private checkoutStatus(): string {
    if (!this.env.ONLINE_PAYMENTS_ENABLED) return 'Offline invoices only: workspaces request an invoice and you mark it paid';
    const sellers = [this.sellers.sells('STRIPE') && 'Stripe', this.sellers.sells('RAZORPAY') && 'Razorpay'].filter(Boolean);
    return sellers.length ? `Online checkout with ${sellers.join(' and ')}, and offline invoices` : 'Online payments are on, but neither Stripe nor Razorpay has its keys set, so checkout says it is not configured';
  }

  /** The settings that stay in the deployment's environment, with why (ADR 0053). Secret values are never returned. */
  deploymentSettings(): DeploymentSettingRow[] {
    return DEPLOYMENT_SETTINGS.map((d) => {
      const value: unknown = this.env[d.name];
      const set = value !== undefined && value !== null && value !== '';
      return { name: d.name, set, value: d.show && set ? String(value) : null, why: d.why };
    });
  }

  /**
   * Saves or removes console values for one provider's keys. They apply at once in this process and within
   * PROVIDER_KEYS_REFRESH_SECONDS everywhere else. The audit log records which key changed and its fingerprint, never the value.
   */
  async setProviderKeys(op: OperatorContext, key: ProviderKey, input: ProviderKeysUpdateInput, ip: string | null): Promise<OperatorProviderRow> {
    const p = PROVIDER_CATALOGUE.find((x) => x.key === key)!;
    const allowed = new Set<string>(p.fields.map((f) => f.name));
    const changes: Partial<Record<ManagedKeyName, string | null>> = {};
    const details: { path: string; message: string }[] = [];
    for (const [name, raw] of Object.entries(input.values)) {
      if (!allowed.has(name) || !isManagedKey(name)) {
        details.push({ path: `values.${name}`, message: `${p.name} does not use ${name}.` });
        continue;
      }
      if (raw === null) {
        changes[name] = null;
        continue;
      }
      const parsed = parseManagedValue(name, raw);
      const extra = parsed.ok ? (p.fields.find((f) => f.name === name)?.validate?.(parsed.value) ?? null) : null;
      if (!parsed.ok) details.push({ path: `values.${name}`, message: parsed.message });
      else if (extra) details.push({ path: `values.${name}`, message: extra });
      else changes[name] = parsed.value;
    }
    if (details.length) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: details[0]!.message, details });
    const done = await this.keys.apply(changes, op.id);
    for (const d of done) {
      await this.log(op.id, d.action === 'set' ? 'provider_key.set' : 'provider_key.cleared', null, { provider: key, name: d.name, fingerprint: d.fingerprint, ...(MANAGED_KEYS[d.name].secret ? { last4: d.hint } : { value: d.hint }) }, ip);
    }
    return (await this.providers()).find((r) => r.key === key)!;
  }

  async checkProvider(op: OperatorContext, key: ProviderCheckKey, ip: string | null): Promise<OperatorProviderRow> {
    const p = PROVIDER_CATALOGUE.find((x) => x.key === key)!;
    const missing = p.fields.filter((f) => f.required && !this.env[f.name]).map((f) => f.name);
    if (missing.length) throw new BadRequestException({ code: 'NOT_CONFIGURED', message: `Add ${missing.join(' and ')} first, here or in the deployment's secrets.` });
    const run: Record<ProviderCheckKey, () => Promise<string>> = {
      apollo: () => this.apollo.check(), hunter: () => this.hunter.check(), deepgram: () => this.deepgram.check(),
      anthropic: () => this.tests.anthropic(), google: () => this.tests.google(), microsoft: () => this.tests.microsoft(),
      slack: () => this.tests.slack(), zoom: () => this.tests.zoom(), docusign: () => this.tests.docusign(),
      smtp: () => this.tests.smtp(), zapier: () => this.tests.zapier(), stripe: () => this.tests.stripe(), razorpay: () => this.tests.razorpay(),
    };
    const fingerprint = this.fingerprint(p);
    let result: StoredCheck;
    try {
      result = { ok: true, at: new Date().toISOString(), message: (await run[key]()).slice(0, 300), by: op.email, key: fingerprint };
    } catch (err) {
      const message = err instanceof Error && err.name !== 'TimeoutError' ? err.message : 'The provider did not answer in time.';
      result = { ok: false, at: new Date().toISOString(), message: message.slice(0, 300), by: op.email, key: fingerprint };
    }
    const k = PROVIDER_CHECK_PREFIX + key;
    await this.prisma.platformSetting.upsert({ where: { key: k }, create: { key: k, value: JSON.stringify(result), updatedById: op.id }, update: { value: JSON.stringify(result), updatedById: op.id } });
    await this.log(op.id, 'provider.checked', null, { provider: key, ok: result.ok, message: result.message }, ip);
    return (await this.providers()).find((r) => r.key === key)!;
  }

  async log(operatorId: string | null, action: string, targetTenantId: string | null, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}
