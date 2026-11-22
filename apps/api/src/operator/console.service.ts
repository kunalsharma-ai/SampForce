import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, provisionTenant, slugify, transactionLock, type TenantTx } from '@dealflow/database';
import {
  type ActionGrants,
  type ClientState,
  type ConsoleAuthorityInput,
  type ConsoleClientCreated,
  type ConsoleClientDetail,
  type ConsoleClientRow,
  type ConsoleHistoryRow,
  type ConsoleOverview,
  type ConsolePlanCreateInput,
  type ConsolePlanRow,
  type ConsolePlanTerms,
  type ConsolePlanUpdateInput,
  type ConsoleRenewInput,
  type ConsoleSubscription,
  type ConsoleSubscriptionInput,
  CUSTOM_PLAN_PREFIX,
  DEFAULT_WORKSPACE_DESIGNATION,
  FEATURE_CATALOG_VERSION,
  isPlanCode,
  normaliseFeatures,
  PAYMENT_STATUSES,
  type PaymentStatus,
  parseActionGrants,
  PLAN_CATALOG,
  type PlanEntitlements,
  SUPPORT_LEVELS,
  type z,
  type consoleClientCreateSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { entitlementsFor, planDefinitions } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { INVITATION_TTL_MS } from '../tenants/invitations.service';
import { levelOf, nameKeyOf } from '../workspaces/access';
import type { OperatorContext } from './operator-auth';

const DAY = 86_400_000;
type ClientCreate = z.output<typeof consoleClientCreateSchema>;
type PlanRow = { code: string; name: string; custom: boolean; terms: unknown; entitlements: unknown; updatedAt: Date };

/** Platform-log actions that make up a client's subscription history. */
const HISTORY_ACTIONS = [
  'client.created', 'client.subscription_changed', 'client.renewed', 'client.state_changed', 'client.authority_changed',
  'client.administrator_invited', 'tenant.plan_overridden', 'tenant.features_overridden', 'tenant.suspended', 'tenant.reactivated', 'tenant.offline_payment_recorded',
];

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Client organisation not found.' };

/** Adds whole months, keeping the day where the month has it (31 January + 1 month = 28 or 29 February). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const money = (cents: number | null | undefined, currency: string) => (cents === null || cents === undefined ? 'priced per client' : `${currency} ${(cents / 100).toFixed(2)}`);

/**
 * The Console Admin's client organisations, plans and workspace limits (ADR 0071, part 2). Every change is written to
 * the platform audit log with the reason, and to the client's own audit log, so the client's subscription history can
 * be shown in both places. Client CRM records are never read here.
 */
@Injectable()
export class ConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───────────── Plans ─────────────

  private termsOf(row: Pick<PlanRow, 'code' | 'terms'>): ConsolePlanTerms {
    const s = (row.terms && typeof row.terms === 'object' ? row.terms : {}) as Partial<ConsolePlanTerms>;
    const shipped = PLAN_CATALOG.find((p) => p.code === row.code);
    return {
      description: typeof s.description === 'string' ? s.description : (shipped?.audience ?? null),
      priceCents: typeof s.priceCents === 'number' ? s.priceCents : s.priceCents === null ? null : shipped?.monthly !== null && shipped?.monthly !== undefined ? shipped.monthly * 100 : null,
      currency: typeof s.currency === 'string' ? s.currency : 'USD',
      billingFrequency: s.billingFrequency === 'YEAR' ? 'YEAR' : 'MONTH',
      supportLevel: SUPPORT_LEVELS.includes(s.supportLevel as never) ? s.supportLevel! : 'STANDARD',
      durationMonths: typeof s.durationMonths === 'number' && s.durationMonths >= 1 ? s.durationMonths : s.billingFrequency === 'YEAR' ? 12 : 1,
      autoRenew: typeof s.autoRenew === 'boolean' ? s.autoRenew : true,
      upgradeTo: Array.isArray(s.upgradeTo) ? s.upgradeTo.filter((x): x is string => typeof x === 'string') : [],
      available: typeof s.available === 'boolean' ? s.available : true,
    };
  }

  private async planRows(): Promise<PlanRow[]> {
    return this.prisma.plan.findMany({ select: { code: true, name: true, custom: true, terms: true, entitlements: true, updatedAt: true }, orderBy: { createdAt: 'asc' } });
  }

  async plans(): Promise<ConsolePlanRow[]> {
    const [rows, defs, counts] = await Promise.all([
      this.planRows(),
      planDefinitions(this.prisma as unknown as TenantTx),
      this.prisma.run({ operatorScan: true }, (tx) => tx.subscription.groupBy({ by: ['planCode'], _count: { _all: true } })),
    ]);
    const count = new Map(counts.map((c) => [c.planCode, c._count._all]));
    // Shipped plans first, in price order, then the Console's own in the order they were made.
    const order = (r: PlanRow) => (isPlanCode(r.code) ? PLAN_CATALOG.findIndex((p) => p.code === r.code) : 100);
    return [...rows].sort((a, b) => order(a) - order(b)).map((r) => this.planRow(r, defs[r.code]!, count.get(r.code) ?? 0));
  }

  private planRow(r: PlanRow, d: PlanEntitlements, clients: number): ConsolePlanRow {
    return {
      code: r.code, name: r.name, custom: r.custom || !isPlanCode(r.code), features: d.features,
      limits: { maxUsers: d.maxUsers, maxPipelines: d.maxPipelines, monthlyAiCredits: d.monthlyAiCredits, automationRunsPerMonth: d.automationRunsPerMonth, maxManagerWorkspaces: d.maxManagerWorkspaces, maxExecutiveWorkspaces: d.maxExecutiveWorkspaces },
      terms: this.termsOf(r), clients, updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async assertKnownPlans(codes: string[]): Promise<void> {
    if (!codes.length) return;
    const found = new Set((await this.prisma.plan.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) throw new BadRequestException({ code: 'UNKNOWN_PLAN', message: `There is no plan "${missing[0]}".`, details: missing.map((m) => ({ path: 'upgradeTo', message: m })) });
  }

  async createPlan(op: OperatorContext, input: ConsolePlanCreateInput, ip: string | null): Promise<ConsolePlanRow[]> {
    const nameKey = nameKeyOf(input.name);
    const rows = await this.planRows();
    if (rows.some((r) => nameKeyOf(r.name) === nameKey)) throw new ConflictException({ code: 'PLAN_NAME_TAKEN', message: 'A plan with this name already exists.' });
    await this.assertKnownPlans(input.terms.upgradeTo);
    const base = `${CUSTOM_PLAN_PREFIX}${slugify(input.name).replace(/-/g, '_').slice(0, 40) || 'plan'}`;
    const code = rows.some((r) => r.code === base) ? `${base}_${randomBytes(2).toString('hex')}` : base;
    const features = normaliseFeatures(input.features);
    await this.prisma.plan.create({
      data: {
        code, name: input.name, custom: true, isPublic: false,
        monthlyPriceCents: input.terms.billingFrequency === 'MONTH' ? input.terms.priceCents : null,
        entitlements: { ...input.limits, features, catalogVersion: FEATURE_CATALOG_VERSION } as Prisma.InputJsonValue,
        terms: input.terms as unknown as Prisma.InputJsonValue,
      },
    });
    await this.log(op.id, 'plan.created', null, { plan: code, name: input.name, reason: input.reason, features: features.length, limits: input.limits, terms: input.terms }, ip);
    return this.plans();
  }

  /**
   * Changes a plan for every client on it. Features and limits apply on each client's next request, down through every
   * workspace (they are recomputed, not copied). Shipped plans keep their names.
   */
  async updatePlan(op: OperatorContext, code: string, input: ConsolePlanUpdateInput, ip: string | null): Promise<ConsolePlanRow[]> {
    const row = (await this.planRows()).find((r) => r.code === code);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Plan not found.' });
    const custom = row.custom || !isPlanCode(code);
    if (input.name && !custom && input.name !== row.name) throw new BadRequestException({ code: 'SHIPPED_PLAN_NAME', message: 'Shipped plans keep their names. Create a new plan instead.' });
    if (input.name && nameKeyOf(input.name) !== nameKeyOf(row.name) && (await this.planRows()).some((r) => nameKeyOf(r.name) === nameKeyOf(input.name!)))
      throw new ConflictException({ code: 'PLAN_NAME_TAKEN', message: 'A plan with this name already exists.' });
    if (input.terms?.upgradeTo) await this.assertKnownPlans(input.terms.upgradeTo.filter((c) => c !== code));
    const before = (await planDefinitions(this.prisma as unknown as TenantTx))[code]!;
    const features = input.features ? normaliseFeatures(input.features) : before.features;
    const limits = input.limits ?? { maxUsers: before.maxUsers, maxPipelines: before.maxPipelines, monthlyAiCredits: before.monthlyAiCredits, automationRunsPerMonth: before.automationRunsPerMonth, maxManagerWorkspaces: before.maxManagerWorkspaces, maxExecutiveWorkspaces: before.maxExecutiveWorkspaces };
    const terms = { ...this.termsOf(row), ...(input.terms ?? {}) };
    await this.prisma.plan.update({
      where: { code },
      data: {
        ...(input.name ? { name: input.name } : {}),
        entitlements: { ...limits, features, catalogVersion: FEATURE_CATALOG_VERSION } as Prisma.InputJsonValue,
        terms: terms as unknown as Prisma.InputJsonValue,
      },
    });
    await this.log(op.id, 'plan.definition_changed', null, {
      plan: code, reason: input.reason, added: features.filter((f) => !before.features.includes(f)), removed: before.features.filter((f) => !features.includes(f)),
      limits: { from: { ...before, features: undefined }, to: limits }, ...(input.terms ? { terms: input.terms } : {}), ...(input.name ? { name: { from: row.name, to: input.name } } : {}),
    }, ip);
    return this.plans();
  }

  // ───────────── Client organisations ─────────────

  private stateOf(tenantStatus: string, subStatus: string | null): ClientState {
    if (tenantStatus === 'SUSPENDED') return subStatus === 'CANCELED' ? 'DEACTIVATED' : 'SUSPENDED';
    return 'ACTIVE';
  }

  private subscriptionOf(
    sub: Prisma.SubscriptionGetPayload<object>,
    plans: Map<string, PlanRow>,
    defs: Record<string, PlanEntitlements>,
  ): ConsoleSubscription {
    const plan = plans.get(sub.planCode);
    const def = defs[sub.planCode] ?? defs.free!;
    const terms = plan ? this.termsOf(plan) : null;
    return {
      planCode: sub.planCode,
      planName: plan?.name ?? sub.planCode,
      status: sub.status,
      seats: sub.seats,
      billingFrequency: sub.billingInterval,
      startedOn: day(sub.currentPeriodStart)!,
      renewsOn: day(sub.currentPeriodEnd),
      durationMonths: sub.durationMonths ?? terms?.durationMonths ?? null,
      priceCents: sub.priceCents ?? terms?.priceCents ?? null,
      currency: sub.currency ?? terms?.currency ?? 'USD',
      paymentStatus: PAYMENT_STATUSES.includes(sub.paymentStatus as PaymentStatus) ? (sub.paymentStatus as PaymentStatus) : null,
      autoRenew: sub.autoRenew,
      limits: { managers: sub.maxManagerWorkspaces ?? def.maxManagerWorkspaces, executives: sub.maxExecutiveWorkspaces ?? def.maxExecutiveWorkspaces },
      limitsSetForClient: { managers: sub.maxManagerWorkspaces !== null, executives: sub.maxExecutiveWorkspaces !== null },
    };
  }

  private async rows(where: Prisma.TenantWhereInput): Promise<ConsoleClientRow[]> {
    const [plans, defs] = await Promise.all([this.planRows(), planDefinitions(this.prisma as unknown as TenantTx)]);
    const byCode = new Map(plans.map((p) => [p.code, p]));
    return this.prisma.run({ operatorScan: true }, async (tx) => {
      const tenants = await tx.tenant.findMany({
        where: { deletedAt: null, ...where },
        include: { subscription: true, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const ids = tenants.map((t) => t.id);
      const [nodes, owners] = await Promise.all([
        tx.workspaceNode.groupBy({ by: ['tenantId', 'level'], where: { tenantId: { in: ids }, archivedAt: null }, _count: { _all: true } }),
        tx.membership.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, status: 'ACTIVE' }, _count: { _all: true } }),
      ]);
      const count = (t: string, level: string) => nodes.find((n) => n.tenantId === t && n.level === level)?._count._all ?? 0;
      const staffed = new Set(owners.map((o) => o.tenantId));
      return tenants.map((t) => ({
        id: t.id, name: t.name, state: this.stateOf(t.status, t.subscription?.status ?? null), createdAt: t.createdAt.toISOString(), people: t._count.memberships,
        subscription: t.subscription ? this.subscriptionOf(t.subscription, byCode, defs) : null,
        usage: { managers: count(t.id, 'MANAGER'), executives: count(t.id, 'EXECUTIVE') },
        awaitingAdministrator: !staffed.has(t.id),
      }));
    });
  }

  async clients(op: OperatorContext, search: string | undefined, ip: string | null): Promise<ConsoleClientRow[]> {
    const rows = await this.rows(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] } : {});
    await this.log(op.id, 'clients.listed', null, { search: search ?? null, results: rows.length }, ip);
    return rows;
  }

  async client(op: OperatorContext | null, id: string, ip: string | null): Promise<ConsoleClientDetail> {
    const row = (await this.rows({ id }))[0];
    if (!row) throw new NotFoundException(NOT_FOUND);
    const detail = await this.prisma.run({ tenantId: id }, async (tx) => {
      const [nodes, ent, owners, invite, people] = await Promise.all([
        tx.workspaceNode.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'asc' } }),
        entitlementsFor(tx, id),
        tx.membership.findMany({ where: { tenantId: id, status: 'ACTIVE', role: { key: 'owner' } }, include: { user: { select: { name: true, email: true } } }, take: 20 }),
        tx.invitation.findFirst({ where: { tenantId: id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, role: { key: 'owner' } }, orderBy: { createdAt: 'desc' } }),
        tx.membership.groupBy({ by: ['workspaceNodeId'], where: { tenantId: id, status: 'ACTIVE' }, _count: { _all: true } }),
      ]);
      const root = nodes.find((n) => n.level === 'SUPER' && !n.parentId);
      const peopleIn = (nodeId: string | null) => people.find((p) => p.workspaceNodeId === nodeId)?._count._all ?? 0;
      // People without a workspace belong to the Super Workspace.
      const rootPeople = peopleIn(null) + (root ? peopleIn(root.id) : 0);
      const rootRow = {
        id: root?.id ?? `root:${id}`, level: 'SUPER' as const, name: root && root.name !== 'Super Workspace' ? root.name : row.name, designation: root?.designation ?? DEFAULT_WORKSPACE_DESIGNATION.SUPER,
        parentId: null, people: rootPeople, features: ent.features.length, canCreateExecutives: root?.canCreateExecutives ?? true, archived: false,
      };
      return {
        authority: { actions: root?.actions ? parseActionGrants(root.actions) : null, canCreateExecutives: root?.canCreateExecutives ?? true },
        features: ent.features,
        workspaces: [
          rootRow,
          ...nodes.filter((n) => n !== root).map((n) => ({
            id: n.id, level: levelOf(n.level), name: n.name, designation: n.designation, parentId: n.parentId ?? rootRow.id, people: peopleIn(n.id),
            features: n.features.length, canCreateExecutives: n.canCreateExecutives, archived: !!n.archivedAt,
          })),
        ],
        administrators: owners.map((o) => ({ name: o.user.name, email: o.user.email, designation: root?.designation ?? null })),
        pendingAdministrator: invite ? { email: invite.email, expiresAt: invite.expiresAt.toISOString() } : null,
      };
    });
    const history = await this.history(id);
    if (op) await this.log(op.id, 'client.viewed', id, {}, ip);
    return { ...row, ...detail, history };
  }

  private async history(tenantId: string): Promise<ConsoleHistoryRow[]> {
    const rows = await this.prisma.platformAuditLog.findMany({
      where: { targetTenantId: tenantId, action: { in: HISTORY_ACTIONS } },
      include: { operator: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return { at: r.createdAt.toISOString(), by: r.operator?.email ?? null, action: r.action, reason: typeof m.reason === 'string' ? m.reason : null, changes: Array.isArray(m.changes) ? m.changes.filter((c): c is string => typeof c === 'string') : [] };
    });
  }

  private async planFor(code: string): Promise<{ row: PlanRow; terms: ConsolePlanTerms }> {
    const row = (await this.planRows()).find((r) => r.code === code);
    if (!row) throw new BadRequestException({ code: 'UNKNOWN_PLAN', message: `There is no plan "${code}".`, details: [{ path: 'planCode', message: code }] });
    return { row, terms: this.termsOf(row) };
  }

  private inviteUrl(token: string): string {
    const origin = this.env.WEB_ORIGINS.split(',')[0]!.trim().replace(/\/$/, '');
    return `${origin}/invite/${token}`;
  }

  /** A new owner invitation for the client's administrator; any earlier one for the client stops working. */
  private async inviteAdministrator(tx: TenantTx, op: OperatorContext, tenantId: string, email: string): Promise<string> {
    const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId, key: 'owner' } } });
    if (!role) throw new NotFoundException(NOT_FOUND);
    await tx.invitation.updateMany({ where: { tenantId, roleId: role.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = randomBytes(32).toString('base64url');
    const row = await tx.invitation.create({
      data: { tenantId, email, roleId: role.id, tokenHash: TokenService.hashRefresh(token), invitedById: `operator:${op.id}`, workspaceNodeId: null, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) },
    });
    await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'member.invited', entityType: 'invitation', entityId: row.id, metadata: { email, role: 'owner', operator: op.email } });
    return this.inviteUrl(token);
  }

  /**
   * Creates a client organisation: the organisation, its Super Workspace, the subscription on the chosen plan with its
   * term, price and limits, and an invitation for its administrator, who becomes the Super Workspace's owner.
   */
  async createClient(op: OperatorContext, input: ClientCreate, ip: string | null): Promise<ConsoleClientCreated> {
    const { row: plan, terms } = await this.planFor(input.planCode);
    const tenantId = randomUUID();
    const slug = `${slugify(input.organisation.name)}-${randomBytes(3).toString('hex')}`;
    const start = input.startsOn ? new Date(`${input.startsOn}T00:00:00Z`) : new Date();
    const months = input.durationMonths ?? terms.durationMonths;
    const frequency = input.billingFrequency ?? terms.billingFrequency;
    const currency = input.currency ?? terms.currency;
    const price = input.priceCents !== undefined ? input.priceCents : terms.priceCents;
    const changes = [
      `Organisation: ${input.organisation.name}`,
      `Plan: ${plan.name}`,
      `Term: ${months} months from ${day(start)} to ${day(addMonths(start, months))}`,
      `Price: ${money(price, currency)} per ${frequency === 'YEAR' ? 'year' : 'month'}`,
      `Payment: ${input.paymentStatus}`,
      `Manager Workspaces: ${input.maxManagerWorkspaces ?? 'plan limit'}`,
      `Executive Workspaces: ${input.maxExecutiveWorkspaces ?? 'plan limit'}`,
      `Super Workspace creates Executive Workspaces: ${input.superCanCreateExecutives ? 'yes' : 'no'}`,
    ];
    const inviteUrl = await this.prisma.run({ tenantId }, async (tx) => {
      await provisionTenant(tx, { tenantId, name: input.organisation.name, slug, planCode: plan.code });
      if (input.organisation.currency || input.organisation.timezone)
        await tx.tenant.update({ where: { id: tenantId }, data: { ...(input.organisation.currency ? { defaultCurrency: input.organisation.currency } : {}), ...(input.organisation.timezone ? { defaultTimezone: input.organisation.timezone } : {}) } });
      await tx.subscription.update({
        where: { tenantId },
        data: {
          planCode: plan.code, status: 'ACTIVE', seats: input.seats, billingInterval: frequency, currentPeriodStart: start, currentPeriodEnd: addMonths(start, months),
          priceCents: price, currency, paymentStatus: input.paymentStatus, durationMonths: months, autoRenew: input.autoRenew ?? terms.autoRenew,
          maxManagerWorkspaces: input.maxManagerWorkspaces ?? null, maxExecutiveWorkspaces: input.maxExecutiveWorkspaces ?? null,
        },
      });
      await tx.workspaceNode.create({
        data: {
          tenantId, level: 'SUPER', name: 'Super Workspace', nameKey: nameKeyOf('Super Workspace'), parentId: null,
          designation: input.administrator.designation ?? DEFAULT_WORKSPACE_DESIGNATION.SUPER, features: [], actions: null as never, canCreateExecutives: input.superCanCreateExecutives,
        },
      });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'tenant.created', entityType: 'tenant', entityId: tenantId, metadata: { name: input.organisation.name, plan: plan.code, operator: op.email, changes } });
      return this.inviteAdministrator(tx, op, tenantId, input.administrator.email);
    });
    await this.log(op.id, 'client.created', tenantId, { reason: input.reason ?? 'New client', changes, administrator: input.administrator.email }, ip);
    return { client: await this.client(null, tenantId, ip), inviteUrl };
  }

  async resendAdministrator(op: OperatorContext, id: string, email: string | undefined, ip: string | null): Promise<ConsoleClientCreated> {
    const inviteUrl = await this.prisma.run({ tenantId: id }, async (tx) => {
      if (!(await tx.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
      const pending = await tx.invitation.findFirst({ where: { tenantId: id, acceptedAt: null, revokedAt: null, role: { key: 'owner' } }, orderBy: { createdAt: 'desc' } });
      const to = email ?? pending?.email;
      if (!to) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Enter the administrator’s email address.', details: [{ path: 'email', message: 'Required' }] });
      return this.inviteAdministrator(tx, op, id, to);
    });
    await this.log(op.id, 'client.administrator_invited', id, { reason: 'Administrator invitation sent', changes: [`Invitation for ${email ?? 'the administrator'}`] }, ip);
    return { client: await this.client(null, id, ip), inviteUrl };
  }

  /**
   * Changes a client's subscription: plan, seats, term, price, payment status and workspace limits. The change applies to
   * the Super Workspace and every workspace below it on their next request. Existing workspaces above a lowered limit stay;
   * new ones are refused until the client is back under it.
   */
  async setSubscription(op: OperatorContext, id: string, input: ConsoleSubscriptionInput, ip: string | null): Promise<ConsoleClientDetail> {
    const plan = input.planCode ? await this.planFor(input.planCode) : null;
    const changes: string[] = [];
    await this.prisma.run({ tenantId: id }, async (tx) => {
      await transactionLock(tx, `workspaces:${id}`);
      const before = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (!before) throw new NotFoundException(NOT_FOUND);
      const data: Prisma.SubscriptionUncheckedUpdateInput = {};
      const note = (label: string, from: unknown, to: unknown) => {
        if (String(from ?? '') !== String(to ?? '')) changes.push(`${label}: ${from ?? 'none'} → ${to ?? 'none'}`);
      };
      if (plan && plan.row.code !== before.planCode) {
        const old = (await this.planRows()).find((r) => r.code === before.planCode);
        const allowed = old ? this.termsOf(old).upgradeTo : [];
        if (allowed.length && !allowed.includes(plan.row.code) && plan.row.code !== 'free')
          throw new BadRequestException({ code: 'PLAN_CHANGE_NOT_ALLOWED', message: `${old!.name} can only move to the plans its settings list. Change the plan’s upgrade settings first.` });
        data.planCode = plan.row.code;
        note('Plan', old?.name ?? before.planCode, plan.row.name);
      }
      if (input.seats !== undefined) (data.seats = input.seats), note('Seats', before.seats, input.seats);
      if (input.billingFrequency) (data.billingInterval = input.billingFrequency), note('Billing', before.billingInterval, input.billingFrequency);
      if (input.renewsOn) {
        const end = new Date(`${input.renewsOn}T00:00:00Z`);
        if (end <= before.currentPeriodStart) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The renewal date must be after the subscription started.', details: [{ path: 'renewsOn', message: 'After the start date' }] });
        data.currentPeriodEnd = end;
        note('Renews on', day(before.currentPeriodEnd), input.renewsOn);
      }
      if (input.durationMonths !== undefined) (data.durationMonths = input.durationMonths), note('Term (months)', before.durationMonths, input.durationMonths);
      if (input.priceCents !== undefined) (data.priceCents = input.priceCents), note('Price', money(before.priceCents, before.currency ?? 'USD'), money(input.priceCents, input.currency ?? before.currency ?? 'USD'));
      if (input.currency) (data.currency = input.currency), note('Currency', before.currency, input.currency);
      if (input.paymentStatus) (data.paymentStatus = input.paymentStatus), note('Payment', before.paymentStatus, input.paymentStatus);
      if (input.autoRenew !== undefined) (data.autoRenew = input.autoRenew), note('Renews by itself', before.autoRenew ? 'yes' : 'no', input.autoRenew ? 'yes' : 'no');
      if (input.maxManagerWorkspaces !== undefined) (data.maxManagerWorkspaces = input.maxManagerWorkspaces), note('Manager Workspaces', before.maxManagerWorkspaces ?? 'plan limit', input.maxManagerWorkspaces ?? 'plan limit');
      if (input.maxExecutiveWorkspaces !== undefined) (data.maxExecutiveWorkspaces = input.maxExecutiveWorkspaces), note('Executive Workspaces', before.maxExecutiveWorkspaces ?? 'plan limit', input.maxExecutiveWorkspaces ?? 'plan limit');
      if (!changes.length) return;
      await tx.subscription.update({ where: { tenantId: id }, data });
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.subscription_changed', entityType: 'subscription', entityId: before.id, metadata: { operator: op.email, reason: input.reason, changes } });
    });
    if (changes.length) await this.log(op.id, 'client.subscription_changed', id, { reason: input.reason, changes }, ip);
    return this.client(null, id, ip);
  }

  /** Another term from the current renewal date (or today, if it has passed), optionally on a new plan. */
  async renew(op: OperatorContext, id: string, input: ConsoleRenewInput, ip: string | null): Promise<ConsoleClientDetail> {
    const changes: string[] = [];
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const before = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (!before) throw new NotFoundException(NOT_FOUND);
      const plan = await this.planFor(input.planCode ?? before.planCode);
      const months = input.months ?? before.durationMonths ?? plan.terms.durationMonths;
      const now = new Date();
      const from = before.currentPeriodEnd && before.currentPeriodEnd > now ? before.currentPeriodEnd : now;
      const end = addMonths(from, months);
      changes.push(`Renewed for ${months} months: ${day(from)} to ${day(end)}`);
      if (plan.row.code !== before.planCode) changes.push(`Plan: ${(await this.planRows()).find((r) => r.code === before.planCode)?.name ?? before.planCode} → ${plan.row.name}`);
      if (input.paymentStatus) changes.push(`Payment: ${before.paymentStatus ?? 'none'} → ${input.paymentStatus}`);
      await tx.subscription.update({
        where: { tenantId: id },
        data: {
          planCode: plan.row.code, status: 'ACTIVE', currentPeriodStart: from, currentPeriodEnd: end, durationMonths: months, pastDueSince: null, cancelAtPeriodEnd: false,
          ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'billing.subscription_renewed', entityType: 'subscription', entityId: before.id, metadata: { operator: op.email, reason: input.reason, changes } });
    });
    await this.log(op.id, 'client.renewed', id, { reason: input.reason, changes }, ip);
    return this.client(null, id, ip);
  }

  /**
   * Activate, suspend or deactivate. Suspended: nobody in the client signs in; the subscription is kept. Deactivated:
   * the subscription is canceled as well. The data stays in both cases, and activating restores access.
   */
  async setState(op: OperatorContext, id: string, state: ClientState, reason: string, ip: string | null): Promise<ConsoleClientDetail> {
    const changes: string[] = [];
    await this.prisma.run({ tenantId: id }, async (tx) => {
      const t = await tx.tenant.findFirst({ where: { id, deletedAt: null }, include: { subscription: true } });
      if (!t) throw new NotFoundException(NOT_FOUND);
      if (t.status === 'PENDING_DELETION') throw new ForbiddenException({ code: 'PENDING_DELETION', message: 'This client is scheduled for deletion.' });
      const before = this.stateOf(t.status, t.subscription?.status ?? null);
      if (before === state) return;
      changes.push(`Status: ${before} → ${state}`);
      await tx.tenant.update({ where: { id }, data: { status: state === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED' } });
      if (t.subscription) {
        if (state === 'DEACTIVATED') await tx.subscription.update({ where: { tenantId: id }, data: { status: 'CANCELED' } });
        else if (state === 'ACTIVE' && t.subscription.status === 'CANCELED') await tx.subscription.update({ where: { tenantId: id }, data: { status: 'ACTIVE', pastDueSince: null } });
      }
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: `tenant.${state.toLowerCase()}`, entityType: 'tenant', entityId: id, metadata: { operator: op.email, reason, changes } });
    });
    if (changes.length) {
      // Sessions of a suspended client end at their next request: the workspace guard refuses a suspended tenant.
      await this.log(op.id, 'client.state_changed', id, { reason, changes }, ip);
    }
    return this.client(null, id, ip);
  }

  /** The Super Workspace's ceiling: which actions it may use in each module, and whether it creates Executive Workspaces. */
  async setAuthority(op: OperatorContext, id: string, input: ConsoleAuthorityInput, ip: string | null): Promise<ConsoleClientDetail> {
    const changes: string[] = [];
    await this.prisma.run({ tenantId: id }, async (tx) => {
      if (!(await tx.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } }))) throw new NotFoundException(NOT_FOUND);
      await transactionLock(tx, `workspaces:${id}`);
      let root = await tx.workspaceNode.findFirst({ where: { tenantId: id, level: 'SUPER', parentId: null } });
      root ??= await tx.workspaceNode.create({
        data: { tenantId: id, level: 'SUPER', name: 'Super Workspace', nameKey: nameKeyOf('Super Workspace'), parentId: null, designation: DEFAULT_WORKSPACE_DESIGNATION.SUPER, features: [], actions: null as never, canCreateExecutives: true },
      });
      const data: Prisma.WorkspaceNodeUpdateInput = {};
      if (input.actions !== undefined) {
        const before = root.actions ? parseActionGrants(root.actions) : null;
        const next: ActionGrants | null = input.actions ? parseActionGrants(input.actions) : null;
        data.actions = next === null ? null : (next as Prisma.InputJsonValue);
        for (const line of describeActions(before, next)) changes.push(line);
      }
      if (input.canCreateExecutives !== undefined && input.canCreateExecutives !== root.canCreateExecutives) {
        data.canCreateExecutives = input.canCreateExecutives;
        changes.push(`Super Workspace creates Executive Workspaces: ${root.canCreateExecutives ? 'yes' : 'no'} → ${input.canCreateExecutives ? 'yes' : 'no'}`);
      }
      if (!changes.length) return;
      await tx.workspaceNode.update({ where: { id: root.id }, data });
      await this.audit.record(tx, { tenantId: id, actorUserId: null, actorType: 'PLATFORM_ADMIN', action: 'workspace.permissions_changed', entityType: 'workspace', entityId: root.id, metadata: { operator: op.email, reason: input.reason, changes } });
    });
    if (changes.length) await this.log(op.id, 'client.authority_changed', id, { reason: input.reason, changes }, ip);
    return this.client(null, id, ip);
  }

  // ───────────── Overview ─────────────

  async overview(): Promise<ConsoleOverview> {
    const rows = await this.rows({});
    const clients = rows.filter((r) => r.subscription);
    const now = Date.now();
    const plansSold = new Map<string, { code: string; name: string; clients: number }>();
    const mrr = new Map<string, number>();
    const owed = new Map<string, { cents: number; clients: Set<string> }>();
    const addOwed = (currency: string, cents: number, id: string) => {
      const o = owed.get(currency) ?? { cents: 0, clients: new Set<string>() };
      o.cents += cents;
      o.clients.add(id);
      owed.set(currency, o);
    };
    for (const r of clients) {
      const s = r.subscription!;
      const live = r.state === 'ACTIVE' && s.status !== 'CANCELED' && s.status !== 'UNPAID';
      if (!live) continue;
      const p = plansSold.get(s.planCode) ?? { code: s.planCode, name: s.planName, clients: 0 };
      p.clients += 1;
      plansSold.set(s.planCode, p);
      if (s.priceCents !== null && s.paymentStatus !== 'WAIVED') {
        const monthly = s.billingFrequency === 'YEAR' ? Math.round(s.priceCents / 12) : s.priceCents;
        mrr.set(s.currency, (mrr.get(s.currency) ?? 0) + monthly);
        if (s.paymentStatus === 'PENDING' || s.paymentStatus === 'OVERDUE') addOwed(s.currency, s.priceCents, r.id);
      }
    }
    const openInvoices = await this.prisma.run({ operatorScan: true }, (tx) => tx.invoice.findMany({ where: { status: 'OPEN' }, select: { tenantId: true, totalCents: true, amountPaidCents: true, currency: true }, take: 2000 }));
    for (const inv of openInvoices) addOwed(inv.currency.toUpperCase(), Math.max(0, inv.totalCents - inv.amountPaidCents), inv.tenantId);
    const soon = now + 30 * DAY;
    const renewals = clients
      .filter((r) => r.state === 'ACTIVE' && r.subscription!.renewsOn && new Date(`${r.subscription!.renewsOn}T00:00:00Z`).getTime() <= soon && r.subscription!.status !== 'CANCELED')
      .sort((a, b) => a.subscription!.renewsOn!.localeCompare(b.subscription!.renewsOn!))
      .map((r) => ({ id: r.id, name: r.name, renewsOn: r.subscription!.renewsOn!, planName: r.subscription!.planName, autoRenew: r.subscription!.autoRenew }));
    const attention: ConsoleOverview['needsAttention'] = [];
    for (const r of rows) {
      const s = r.subscription;
      if (r.state === 'SUSPENDED') attention.push({ id: r.id, name: r.name, why: 'Suspended' });
      else if (s?.paymentStatus === 'OVERDUE' || s?.status === 'PAST_DUE' || s?.status === 'UNPAID') attention.push({ id: r.id, name: r.name, why: 'Payment overdue' });
      else if (r.state === 'ACTIVE' && s?.renewsOn && new Date(`${s.renewsOn}T00:00:00Z`).getTime() < now) attention.push({ id: r.id, name: r.name, why: 'Renewal date has passed' });
      else if (r.awaitingAdministrator && r.state === 'ACTIVE') attention.push({ id: r.id, name: r.name, why: 'Administrator has not joined yet' });
      else if (s && ((s.limits.managers !== null && r.usage.managers > s.limits.managers) || (s.limits.executives !== null && r.usage.executives > s.limits.executives)))
        attention.push({ id: r.id, name: r.name, why: 'More workspaces than the subscription allows' });
    }
    return {
      clients: { total: rows.length, active: rows.filter((r) => r.state === 'ACTIVE').length, suspended: rows.filter((r) => r.state === 'SUSPENDED').length, deactivated: rows.filter((r) => r.state === 'DEACTIVATED').length },
      // Every client organisation has exactly one Super Workspace.
      superWorkspaces: rows.length,
      subscriptions: {
        active: clients.filter((r) => r.state === 'ACTIVE' && (r.subscription!.status === 'ACTIVE' || r.subscription!.status === 'PAST_DUE')).length,
        trialing: clients.filter((r) => r.state === 'ACTIVE' && r.subscription!.status === 'TRIALING').length,
        inactive: clients.filter((r) => r.state !== 'ACTIVE' || r.subscription!.status === 'CANCELED' || r.subscription!.status === 'UNPAID').length,
      },
      plansSold: [...plansSold.values()].sort((a, b) => b.clients - a.clients),
      monthlyRecurring: [...mrr.entries()].map(([currency, cents]) => ({ currency, cents })),
      outstanding: [...owed.entries()].map(([currency, o]) => ({ currency, cents: o.cents, clients: o.clients.size })),
      workspaces: { managers: rows.reduce((a, r) => a + r.usage.managers, 0), executives: rows.reduce((a, r) => a + r.usage.executives, 0) },
      renewals: renewals.slice(0, 20),
      needsAttention: attention.slice(0, 50),
    };
  }

  private async log(operatorId: string, action: string, targetTenantId: string | null, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}

/** Lines such as "CRM: view, create → view" for the history, per module whose actions changed. */
function describeActions(before: ActionGrants | null, next: ActionGrants | null): string[] {
  if (!before && !next) return [];
  if (!next) return ['Super Workspace actions: every action'];
  // A module missing from a stored ceiling has no actions; no ceiling at all means every action.
  const modules = [...new Set([...Object.keys(before ?? {}), ...Object.keys(next)])];
  const out: string[] = [];
  for (const m of modules) {
    const a = before ? ((before as Record<string, string[] | undefined>)[m]?.join(', ') ?? '') : 'every action';
    const b = (next as Record<string, string[] | undefined>)[m]?.join(', ') ?? '';
    if (a !== b) out.push(`${m}: ${a || 'none'} → ${b || 'none'}`);
  }
  return out;
}
