import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { OperatorOpenInvoice, OperatorPaymentInput, OperatorPlanInput, OperatorProviderRow, OperatorSettings, OperatorTenantDetail, OperatorTenantRow, PlatformAuditRow, ProviderCheckKey } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { BillingService, PAYMENT_INSTRUCTIONS_KEY, toInvoiceRow } from '../billing/billing.service';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { HunterClient } from '../finder/hunter';
import { DeepgramClient } from '../meetings/deepgram';
import { ApolloClient } from '../prospects/apollo';
import { currentCheck, keyFingerprint, PROVIDER_CHECK_PREFIX, readProviderCheck, type StoredCheck } from './provider-checks';
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
    private readonly apollo: ApolloClient,
    private readonly hunter: HunterClient,
    private readonly deepgram: DeepgramClient,
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.operator_scan', 'on', true)`;
      return fn(tx);
    });
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
    return { ...row, invoices: invoices.map(toInvoiceRow), support };
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
    const paymentInstructions = await this.billing.paymentInstructions(this.prisma);
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

  // ───── Provider setup: which deployment secrets are set, and a no-cost live check for each data provider ─────

  async providers(): Promise<OperatorProviderRow[]> {
    const rows = await this.prisma.platformSetting.findMany({ where: { key: { startsWith: PROVIDER_CHECK_PREFIX } } });
    const checks = new Map(rows.map((r) => [r.key.slice(PROVIDER_CHECK_PREFIX.length), readProviderCheck(r.value)]));
    const e = this.env;
    const v = (name: string, value: unknown, required = true) => ({ name, set: !!value, required });
    const keyEnv: Partial<Record<OperatorProviderRow['key'], string | undefined>> = { apollo: e.APOLLO_API_KEY, hunter: e.HUNTER_API_KEY, deepgram: e.DEEPGRAM_API_KEY };
    const row = (
      key: OperatorProviderRow['key'], name: string, usedFor: string, env: OperatorProviderRow['env'], checkNote: string | null,
      app: { off: string; on: string; verified?: string },
    ): OperatorProviderRow => {
      const configured = env.filter((x) => x.required).every((x) => x.set);
      const stored = checks.get(key) ?? null;
      const secret = keyEnv[key];
      // A check made with a different key (or before fingerprints were kept) is shown, but proves nothing now.
      const current = secret === undefined ? null : currentCheck(stored, secret);
      const lastCheck = stored ? { ok: stored.ok, at: stored.at, message: stored.message, by: stored.by, stale: !current } : null;
      const state = !configured ? 'not_configured' : !current ? 'configured' : current.ok ? 'verified' : 'failed';
      return { key, name, usedFor, env, configured, checkable: checkNote !== null, checkNote, lastCheck, state, appStatus: !configured ? app.off : state === 'verified' && app.verified ? app.verified : app.on };
    };
    return [
      row('apollo', 'Apollo.io', 'Prospect search and email reveal (Prospect Lists, browser extension)', [v('APOLLO_API_KEY', e.APOLLO_API_KEY)],
        'Runs one people search for a single result (Apollo returns no email addresses from search, and nothing is revealed).',
        { off: 'Mock Mode: labelled sample people', on: 'Pending Configuration until a call succeeds', verified: 'Connected in every workspace' }),
      row('hunter', 'Hunter.io', 'Email verification on prospects; data provider for the Email Finder', [v('HUNTER_API_KEY', e.HUNTER_API_KEY)],
        "Calls Hunter's account endpoint, which Hunter does not count as a search or verification.",
        { off: 'Pending Configuration', on: 'Key set: each workspace shows Connected after its first verification' }),
      row('deepgram', 'Deepgram', 'Transcription of meeting recordings and voice notes', [v('DEEPGRAM_API_KEY', e.DEEPGRAM_API_KEY), v('MEETING_UPLOAD_MAX_MB', e.MEETING_UPLOAD_MAX_MB, false)],
        "Lists the key's Deepgram projects. Nothing is transcribed, so nothing is billed.",
        { off: 'Pending Configuration', on: 'Configured, not yet verified until a workspace transcribes a recording' }),
      row('google', 'Google (Gmail, Calendar)', 'Mailbox sending and sync, calendar, meeting links', [v('GOOGLE_CLIENT_ID', e.GOOGLE_CLIENT_ID), v('GOOGLE_CLIENT_SECRET', e.GOOGLE_CLIENT_SECRET)], null,
        { off: 'No Connect button for Google', on: 'Each person connects their own Google account' }),
      row('microsoft', 'Microsoft 365 (Outlook, Graph)', 'Mailbox sending and sync, calendar, meeting links', [v('MICROSOFT_CLIENT_ID', e.MICROSOFT_CLIENT_ID), v('MICROSOFT_CLIENT_SECRET', e.MICROSOFT_CLIENT_SECRET), v('MICROSOFT_TENANT', e.MICROSOFT_TENANT, false)], null,
        { off: 'No Connect button for Microsoft', on: 'Each person connects their own Microsoft account' }),
      row('slack', 'Slack', 'Workspace app: "Post to Slack" workflow steps', [v('SLACK_CLIENT_ID', e.SLACK_CLIENT_ID), v('SLACK_CLIENT_SECRET', e.SLACK_CLIENT_SECRET)], null,
        { off: 'Pending Configuration: no Connect button', on: 'Each workspace admin connects their Slack; the connection is verified with auth.test' }),
      row('anthropic', 'Anthropic (Claude)', 'AI agents, email assistant, proposals, meeting and voice readings', [v('ANTHROPIC_API_KEY', e.ANTHROPIC_API_KEY)], null,
        { off: 'AI features show as not configured', on: 'AI features available' }),
      row('smtp', 'Email (SMTP)', 'Password resets, invitations, client portal email', [v('SMTP_URL', e.SMTP_URL), v('MAIL_FROM', e.MAIL_FROM)], null,
        { off: 'System email is not sent', on: 'System email is sent' }),
    ];
  }

  async checkProvider(op: OperatorContext, key: ProviderCheckKey, ip: string | null): Promise<OperatorProviderRow> {
    const client = { apollo: this.apollo, hunter: this.hunter, deepgram: this.deepgram }[key];
    if (!client.configured) throw new BadRequestException({ code: 'NOT_CONFIGURED', message: 'Set the key in the deployment secrets and restart the API first.' });
    const fingerprint = keyFingerprint({ apollo: this.env.APOLLO_API_KEY, hunter: this.env.HUNTER_API_KEY, deepgram: this.env.DEEPGRAM_API_KEY }[key]);
    let result: StoredCheck;
    try {
      result = { ok: true, at: new Date().toISOString(), message: await client.check(), by: op.email, key: fingerprint };
    } catch (err) {
      const message = err instanceof Error && err.name !== 'TimeoutError' ? err.message : 'The provider did not answer in time.';
      result = { ok: false, at: new Date().toISOString(), message: message.slice(0, 300), by: op.email, key: fingerprint };
    }
    const k = PROVIDER_CHECK_PREFIX + key;
    await this.prisma.platformSetting.upsert({ where: { key: k }, create: { key: k, value: JSON.stringify(result), updatedById: op.id }, update: { value: JSON.stringify(result), updatedById: op.id } });
    await this.log(op.id, 'provider.checked', null, { provider: key, ok: result.ok, message: result.message }, ip);
    return (await this.providers()).find((p) => p.key === key)!;
  }

  async log(operatorId: string | null, action: string, targetTenantId: string | null, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}
