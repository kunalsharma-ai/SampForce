import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import {
  attributionRuleOf,
  attributionRuleSchema,
  type AttributionRule,
  BUILT_IN_OPTIONS,
  type CurrencyRateInput,
  type CurrencySettings,
  type CurrencySettingsInput,
  DEFAULT_DASHBOARD_POLICY,
  DEFAULT_NOTIFICATION_SETTINGS,
  type DashboardPolicy,
  dashboardPolicySchema,
  DESIGNATION_TIERS,
  type DesignationTier,
  type ExportPolicy,
  type ExportPolicyRow,
  exportPolicySchema,
  type ExportRolePolicy,
  type NotificationSettings,
  notificationSettingsSchema,
  type OptionListKind,
  type OptionRow,
  type OptionUpdate,
  z,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { notFound } from './crm-helpers';

const invalid = (path: string, message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path, message }] });

/** Reads the workspace's notification settings (defaults when none are stored or they no longer parse). */
export async function notificationSettingsOf(tx: TenantTx, tenantId: string): Promise<NotificationSettings> {
  const row = await tx.crmSettings.findUnique({ where: { tenantId }, select: { notifications: true } });
  const parsed = notificationSettingsSchema.safeParse(row?.notifications ?? undefined);
  return parsed.success ? parsed.data : DEFAULT_NOTIFICATION_SETTINGS;
}

/** The dashboard policy of each tier (defaults for tiers nobody configured). */
export function dashboardPoliciesOf(stored: unknown): Record<DesignationTier, DashboardPolicy> {
  const list = z.array(dashboardPolicySchema).safeParse(stored ?? []);
  const byTier = new Map((list.success ? list.data : []).map((p) => [p.tier, p]));
  return Object.fromEntries(DESIGNATION_TIERS.map((t) => [t, byTier.get(t) ?? DEFAULT_DASHBOARD_POLICY(t)])) as Record<DesignationTier, DashboardPolicy>;
}

/**
 * The dashboard policy that applies to the caller: their designation's tier and that tier's policy. People without a
 * designation have none (they see every widget, as before). Used by the Command Center layouts.
 */
export async function dashboardPolicyOfMember(tx: TenantTx, auth: Pick<AuthContext, 'membershipId' | 'tenantId'>): Promise<{ tier: DesignationTier | null; policy: DashboardPolicy | null }> {
  const m = await tx.membership.findFirst({ where: { id: auth.membershipId, tenantId: auth.tenantId }, select: { designationId: true } });
  const d = m?.designationId ? await tx.designation.findFirst({ where: { id: m.designationId, tenantId: auth.tenantId }, select: { tier: true } }) : null;
  const tier = d && (DESIGNATION_TIERS as readonly string[]).includes(d.tier) ? (d.tier as DesignationTier) : null;
  if (!tier) return { tier: null, policy: null };
  const stored = (await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { dashboardPolicies: true } }))?.dashboardPolicies;
  return { tier, policy: dashboardPoliciesOf(stored)[tier] };
}

/**
 * The rest of Settings → CRM configuration (ADR 0062): RFQ and deal status labels, follow-up categories,
 * notification settings, currencies, export permissions, dashboard policies and the revenue attribution rule.
 */
@Injectable()
export class CrmAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── RFQ and deal statuses, follow-up categories ─────────────

  options(auth: AuthContext, kind: OptionListKind): Promise<OptionRow[]> {
    return this.prisma.run(auth, (tx) => this.optionsIn(tx, auth.tenantId, kind));
  }

  async optionsIn(tx: TenantTx, tenantId: string, kind: OptionListKind, withCounts = true): Promise<OptionRow[]> {
    const rows = await tx.crmOption.findMany({ where: { tenantId, kind } });
    const byValue = new Map(rows.map((r) => [r.value, r]));
    const used = withCounts ? await this.usage(tx, tenantId, kind) : new Map<string, number>();
    const builtIn = BUILT_IN_OPTIONS[kind].map((b, i): OptionRow => {
      const r = byValue.get(b.value);
      return { kind, value: b.value, label: r?.label ?? b.label, color: r?.color ?? b.color, description: r?.description ?? null, position: r?.position ?? i, active: r?.active ?? true, builtIn: true, used: used.get(b.value) ?? 0 };
    });
    const builtInValues = new Set(BUILT_IN_OPTIONS[kind].map((b) => b.value));
    const custom = rows
      .filter((r) => !builtInValues.has(r.value))
      .map((r): OptionRow => ({ kind, value: r.value, label: r.label, color: r.color, description: r.description ?? null, position: r.position, active: r.active, builtIn: false, used: used.get(r.value) ?? 0 }));
    return [...builtIn, ...custom].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  }

  private async usage(tx: TenantTx, tenantId: string, kind: OptionListKind): Promise<Map<string, number>> {
    if (kind === 'RFQ_STATUS') {
      const g = await tx.rfq.groupBy({ by: ['status'], where: { tenantId, deletedAt: null }, _count: { _all: true } });
      return new Map(g.map((x) => [x.status, x._count._all]));
    }
    if (kind === 'DEAL_STATUS') {
      const g = await tx.opportunity.groupBy({ by: ['status'], where: { tenantId, deletedAt: null }, _count: { _all: true } });
      return new Map(g.map((x) => [x.status, x._count._all]));
    }
    const g = await tx.task.groupBy({ by: ['followUpType'], where: { tenantId, deletedAt: null, followUpType: { not: null } }, _count: { _all: true } });
    return new Map(g.filter((x) => x.followUpType).map((x) => [x.followUpType!, x._count._all]));
  }

  createOption(auth: AuthContext, kind: OptionListKind, input: { label: string; color: string; description?: string | null }, meta: RequestMeta): Promise<OptionRow> {
    return this.prisma.run(auth, async (tx) => {
      if (kind !== 'FOLLOW_UP_TYPE') throw invalid('kind', 'RFQ and deal statuses are fixed; rename or hide them instead');
      const existing = await this.optionsIn(tx, auth.tenantId, kind, false);
      if (existing.length >= 60) throw new BadRequestException({ code: 'LIMIT_REACHED', message: 'You can have up to 60 follow-up categories.' });
      if (existing.some((o) => o.label.toLowerCase() === input.label.toLowerCase())) throw new ConflictException({ code: 'NAME_TAKEN', message: 'That name is already used.' });
      const slug = input.label.normalize('NFKD').replace(/[^\w\s]/g, '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '').slice(0, 30) || 'CATEGORY';
      let value = `C_${slug}`;
      for (let n = 2; existing.some((o) => o.value === value); n++) value = `C_${slug}_${n}`;
      await tx.crmOption.create({
        data: { tenantId: auth.tenantId, kind, value, label: input.label, color: input.color, description: input.description ?? null, position: existing.length, builtIn: false },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_option.created', entityType: 'crm_option', metadata: { kind, value }, meta });
      return (await this.optionsIn(tx, auth.tenantId, kind)).find((o) => o.value === value)!;
    });
  }

  updateOption(auth: AuthContext, kind: OptionListKind, value: string, input: OptionUpdate, meta: RequestMeta): Promise<OptionRow> {
    return this.prisma.run(auth, async (tx) => {
      const list = await this.optionsIn(tx, auth.tenantId, kind, false);
      const current = list.find((o) => o.value === value);
      if (!current) throw notFound('Option');
      if (input.label && list.some((o) => o.value !== value && o.label.toLowerCase() === input.label!.toLowerCase())) throw new ConflictException({ code: 'NAME_TAKEN', message: 'That name is already used.' });
      if (input.active === false && list.filter((o) => o.active && o.value !== value).length === 0) throw invalid('active', 'Keep at least one option switched on');
      // Won, lost and open drive reports and conversion: they can be renamed but never hidden.
      if (input.active === false && (kind === 'DEAL_STATUS' || (kind === 'RFQ_STATUS' && ['RECEIVED', 'WON', 'LOST'].includes(value)))) throw invalid('active', 'This status is needed and cannot be hidden');
      await tx.crmOption.upsert({
        where: { tenantId_kind_value: { tenantId: auth.tenantId, kind, value } },
        create: {
          tenantId: auth.tenantId, kind, value, builtIn: current.builtIn, position: current.position,
          label: input.label ?? current.label, color: input.color ?? current.color, description: input.description !== undefined ? input.description : current.description, active: input.active ?? current.active,
        },
        update: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_option.updated', entityType: 'crm_option', metadata: { kind, value, changed: Object.keys(input) }, meta });
      return (await this.optionsIn(tx, auth.tenantId, kind)).find((o) => o.value === value)!;
    });
  }

  reorderOptions(auth: AuthContext, kind: OptionListKind, values: string[], meta: RequestMeta): Promise<OptionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const list = await this.optionsIn(tx, auth.tenantId, kind, false);
      const known = new Set(list.map((o) => o.value));
      if (values.length !== known.size || new Set(values).size !== values.length || values.some((v) => !known.has(v))) throw invalid('values', 'must list every option once');
      for (const [position, value] of values.entries()) {
        const o = list.find((x) => x.value === value)!;
        await tx.crmOption.upsert({
          where: { tenantId_kind_value: { tenantId: auth.tenantId, kind, value } },
          create: { tenantId: auth.tenantId, kind, value, label: o.label, color: o.color, description: o.description, active: o.active, builtIn: o.builtIn, position },
          update: { position },
        });
      }
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_option.reordered', entityType: 'crm_option', metadata: { kind }, meta });
      return this.optionsIn(tx, auth.tenantId, kind);
    });
  }

  /** Only added follow-up categories can be deleted, and only while no follow-up uses them. */
  deleteOption(auth: AuthContext, kind: OptionListKind, value: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const o = (await this.optionsIn(tx, auth.tenantId, kind)).find((x) => x.value === value);
      if (!o) throw notFound('Option');
      if (o.builtIn) throw invalid('value', 'Built-in options can be hidden, not deleted');
      if (o.used > 0) throw new ConflictException({ code: 'IN_USE', message: 'Records use this option. Switch it off instead; they keep it.' });
      await tx.crmOption.deleteMany({ where: { tenantId: auth.tenantId, kind, value } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_option.deleted', entityType: 'crm_option', metadata: { kind, value }, meta });
    });
  }

  /** A value chosen for a record must be a switched-on option (a record may keep one that was switched off later). */
  async assertOption(tx: TenantTx, tenantId: string, kind: OptionListKind, value: string, path: string, current?: string | null): Promise<void> {
    if (value === current) return;
    const o = (await this.optionsIn(tx, tenantId, kind, false)).find((x) => x.value === value);
    if (!o) throw invalid(path, 'is not one of the options');
    if (!o.active) throw invalid(path, 'is switched off in CRM configuration');
  }

  // ───────────── Notifications ─────────────

  notifications(auth: AuthContext): Promise<NotificationSettings> {
    return this.prisma.run(auth, (tx) => notificationSettingsOf(tx, auth.tenantId));
  }

  setNotifications(auth: AuthContext, input: NotificationSettings, meta: RequestMeta): Promise<NotificationSettings> {
    return this.prisma.run(auth, async (tx) => {
      const value = { disabled: [...new Set(input.disabled)], reminders: input.reminders };
      await this.save(tx, auth, { notifications: value as Prisma.InputJsonValue });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.notifications_updated', entityType: 'tenant', entityId: auth.tenantId, metadata: value, meta });
      return value;
    });
  }

  // ───────────── Currency ─────────────

  currency(auth: AuthContext): Promise<CurrencySettings> {
    return this.prisma.run(auth, (tx) => this.currencyIn(tx, auth.tenantId));
  }

  private async currencyIn(tx: TenantTx, tenantId: string): Promise<CurrencySettings> {
    const [tenant, settings, rates, rfqCur, dealCur] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } }),
      tx.crmSettings.findUnique({ where: { tenantId }, select: { enabledCurrencies: true } }),
      tx.exchangeRate.findMany({ where: { tenantId }, orderBy: [{ currency: 'asc' }, { effectiveDate: 'desc' }], distinct: ['currency'], select: { currency: true, rate: true, effectiveDate: true } }),
      tx.rfq.groupBy({ by: ['currency'], where: { tenantId, deletedAt: null } }),
      tx.opportunity.groupBy({ by: ['currency'], where: { tenantId, deletedAt: null } }),
    ]);
    const base = tenant.defaultCurrency;
    const known = new Set([base, ...rates.map((r) => r.currency)]);
    const used = new Set([...rfqCur.map((r) => r.currency), ...dealCur.map((r) => r.currency)]);
    return {
      baseCurrency: base,
      enabled: settings?.enabledCurrencies ?? [],
      rates: rates.map((r) => ({ currency: r.currency, rate: Number(r.rate), effectiveDate: r.effectiveDate.toISOString().slice(0, 10) })),
      missingRates: [...used].filter((c) => !known.has(c)).sort(),
    };
  }

  /**
   * Rates are stored into the base currency, so changing the base asks for new rates: totals leave a currency out
   * until it has one (they never mix currencies silently).
   */
  setCurrency(auth: AuthContext, input: CurrencySettingsInput, meta: RequestMeta): Promise<CurrencySettings> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } });
      const enabled = [...new Set([input.baseCurrency, ...input.enabled])];
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { defaultCurrency: input.baseCurrency } });
      await this.save(tx, auth, { enabledCurrencies: enabled });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.currency_updated', entityType: 'tenant', entityId: auth.tenantId,
        metadata: { from: before.defaultCurrency, to: input.baseCurrency, enabled }, meta,
      });
      return this.currencyIn(tx, auth.tenantId);
    });
  }

  addRate(auth: AuthContext, input: CurrencyRateInput, meta: RequestMeta): Promise<CurrencySettings> {
    return this.prisma.run(auth, async (tx) => {
      const base = (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } })).defaultCurrency;
      if (input.currency === base) throw invalid('currency', 'The base currency needs no rate');
      const effectiveDate = new Date(`${input.effectiveDate}T00:00:00.000Z`);
      await tx.exchangeRate.upsert({
        where: { tenantId_currency_effectiveDate: { tenantId: auth.tenantId, currency: input.currency, effectiveDate } },
        create: { tenantId: auth.tenantId, currency: input.currency, rate: input.rate, effectiveDate, createdById: auth.userId },
        update: { rate: input.rate, createdById: auth.userId },
      });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'exchange_rate.saved', entityType: 'tenant', entityId: auth.tenantId, metadata: { ...input, base }, meta });
      return this.currencyIn(tx, auth.tenantId);
    });
  }

  removeRate(auth: AuthContext, currency: string, meta: RequestMeta): Promise<CurrencySettings> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.exchangeRate.deleteMany({ where: { tenantId: auth.tenantId, currency } });
      if (!count) throw notFound('Exchange rate');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'exchange_rate.removed', entityType: 'tenant', entityId: auth.tenantId, metadata: { currency }, meta });
      return this.currencyIn(tx, auth.tenantId);
    });
  }

  // ───────────── Export permissions ─────────────

  exportPolicy(auth: AuthContext): Promise<ExportPolicyRow[]> {
    return this.prisma.run(auth, (tx) => this.exportPolicyIn(tx, auth.tenantId));
  }

  private async exportPolicyIn(tx: TenantTx, tenantId: string): Promise<ExportPolicyRow[]> {
    const [roles, settings] = await Promise.all([
      tx.role.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, key: true, permissions: true } }),
      tx.crmSettings.findUnique({ where: { tenantId }, select: { exportPolicy: true } }),
    ]);
    const stored = exportPolicySchema.safeParse(settings?.exportPolicy ?? { roles: [] });
    const byRole = new Map((stored.success ? stored.data.roles : []).map((p) => [p.roleId, p]));
    return roles.map((r) => {
      const p = byRole.get(r.id);
      return {
        roleId: r.id, roleName: r.name, hasExportPermission: r.permissions.includes('data:export'), isDefault: !p,
        policy: p ?? { roleId: r.id, entities: ['companies', 'contacts', 'leads', 'deals', 'rfqs'], formats: ['csv', 'xlsx'], withoutContactDetails: false },
      };
    });
  }

  setExportPolicy(auth: AuthContext, input: ExportPolicy, meta: RequestMeta): Promise<ExportPolicyRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const roles = new Set((await tx.role.findMany({ where: { tenantId: auth.tenantId }, select: { id: true } })).map((r) => r.id));
      const bad = input.roles.findIndex((r) => !roles.has(r.roleId));
      if (bad >= 0) throw invalid(`roles.${bad}.roleId`, 'refers to a role that does not exist');
      const unique = [...new Map(input.roles.map((r) => [r.roleId, r])).values()];
      await this.save(tx, auth, { exportPolicy: { roles: unique } as Prisma.InputJsonValue });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.export_policy_updated', entityType: 'tenant', entityId: auth.tenantId, metadata: { roles: unique.length }, meta });
      return this.exportPolicyIn(tx, auth.tenantId);
    });
  }

  /** The export rules of the caller's role, or undefined when none are stored (everything allowed). */
  async exportPolicyFor(tx: TenantTx, auth: AuthContext): Promise<ExportRolePolicy | undefined> {
    const m = await tx.membership.findFirst({ where: { id: auth.membershipId, tenantId: auth.tenantId }, select: { roleId: true } });
    const settings = await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { exportPolicy: true } });
    const stored = exportPolicySchema.safeParse(settings?.exportPolicy ?? { roles: [] });
    return stored.success && m ? stored.data.roles.find((r) => r.roleId === m.roleId) : undefined;
  }

  // ───────────── Dashboard policies ─────────────

  dashboardPolicies(auth: AuthContext): Promise<DashboardPolicy[]> {
    return this.prisma.run(auth, async (tx) => Object.values(dashboardPoliciesOf((await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { dashboardPolicies: true } }))?.dashboardPolicies)));
  }

  setDashboardPolicy(auth: AuthContext, input: DashboardPolicy, meta: RequestMeta): Promise<DashboardPolicy[]> {
    return this.prisma.run(auth, async (tx) => {
      const current = dashboardPoliciesOf((await tx.crmSettings.findUnique({ where: { tenantId: auth.tenantId }, select: { dashboardPolicies: true } }))?.dashboardPolicies);
      const seen = new Set<string>();
      const layout = input.defaultLayout?.filter((w) => !seen.has(w.id) && seen.add(w.id)) ?? null;
      current[input.tier] = { ...input, allowedWidgets: input.allowedWidgets ? [...new Set(input.allowedWidgets)] : null, defaultLayout: layout };
      await this.save(tx, auth, { dashboardPolicies: Object.values(current) as unknown as Prisma.InputJsonValue });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.dashboard_policy_updated', entityType: 'tenant', entityId: auth.tenantId, metadata: { tier: input.tier, canCustomize: input.canCustomize }, meta });
      return Object.values(current);
    });
  }

  /** The caller's tier (from their designation) and its policy; null tier for people without a designation. */
  dashboardPolicyFor(tx: TenantTx, auth: AuthContext): Promise<{ tier: DesignationTier | null; policy: DashboardPolicy | null }> {
    return dashboardPolicyOfMember(tx, auth);
  }

  // ───────────── Revenue attribution rule ─────────────

  attribution(auth: AuthContext): Promise<AttributionRule> {
    return this.prisma.run(auth, async (tx) => attributionRuleOf((await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { revenueAttribution: true } })).revenueAttribution));
  }

  /** Applies to deals won from now on; the revenue records service re-applies it to earlier records on request. */
  setAttribution(auth: AuthContext, input: AttributionRule, meta: RequestMeta): Promise<AttributionRule> {
    return this.prisma.run(auth, async (tx) => {
      const rule = attributionRuleSchema.parse(input);
      const before = attributionRuleOf((await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { revenueAttribution: true } })).revenueAttribution);
      await tx.tenant.update({ where: { id: auth.tenantId }, data: { revenueAttribution: rule as unknown as Prisma.InputJsonValue } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.attribution_updated', entityType: 'tenant', entityId: auth.tenantId, metadata: { from: before, to: rule }, meta });
      return rule;
    });
  }

  private async save(tx: TenantTx, auth: AuthContext, data: Prisma.CrmSettingsUncheckedUpdateInput & Partial<Pick<Prisma.CrmSettingsUncheckedCreateInput, 'notifications' | 'exportPolicy' | 'dashboardPolicies' | 'enabledCurrencies'>>): Promise<void> {
    await tx.crmSettings.upsert({
      where: { tenantId: auth.tenantId },
      create: { tenantId: auth.tenantId, updatedById: auth.userId, ...(data as Omit<Prisma.CrmSettingsUncheckedCreateInput, 'tenantId'>) },
      update: { ...data, updatedById: auth.userId },
    });
  }
}
