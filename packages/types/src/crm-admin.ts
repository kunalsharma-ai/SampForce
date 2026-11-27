import { z } from 'zod';
import { FOLLOW_UP_TYPES, RFQ_STATUSES } from './company-work';
import { DESIGNATION_TIERS, type DesignationTier } from './company-crm';
import { DASHBOARD_WIDGETS } from './dashboard';
import { TIER_DASHBOARD_WIDGETS } from './command-center';

/*
 * The rest of Settings → CRM configuration (ADR 0062): how RFQ and deal statuses and follow-up categories are
 * labelled, which notifications the workspace sends and when reminders go out, the currencies it works in, who may
 * export what, and which dashboard widgets each designation tier gets.
 */

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour such as #3b82f6');
const description = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

// ───────────── RFQ and deal statuses, follow-up categories ─────────────

/**
 * RFQ and deal statuses drive behaviour (a won RFQ converts to a deal, lost deals count as lost), so their set is
 * fixed and an administrator renames, recolours, describes, reorders and hides them. Follow-up categories are a
 * free list: the built-in ones can be renamed or hidden, and new ones added.
 */
export const OPTION_LIST_KINDS = ['RFQ_STATUS', 'DEAL_STATUS', 'FOLLOW_UP_TYPE'] as const;
export type OptionListKind = (typeof OPTION_LIST_KINDS)[number];

export const DEAL_STATUS_VALUES = ['OPEN', 'WON', 'LOST'] as const;

type BuiltIn = { value: string; label: string; color: string };
export const BUILT_IN_OPTIONS: Record<OptionListKind, readonly BuiltIn[]> = {
  RFQ_STATUS: [
    { value: 'RECEIVED', label: 'Received', color: '#06b6d4' },
    { value: 'UNDER_EVALUATION', label: 'Under evaluation', color: '#3b82f6' },
    { value: 'PRICING', label: 'Pricing in progress', color: '#a855f7' },
    { value: 'QUOTATION_SUBMITTED', label: 'Quotation submitted', color: '#6366f1' },
    { value: 'NEGOTIATION', label: 'Negotiation', color: '#14b8a6' },
    { value: 'WON', label: 'Won', color: '#15803d' },
    { value: 'LOST', label: 'Lost', color: '#ef4444' },
    { value: 'CANCELLED', label: 'Cancelled', color: '#64748b' },
    { value: 'ON_HOLD', label: 'On hold', color: '#f59e0b' },
  ],
  DEAL_STATUS: [
    { value: 'OPEN', label: 'Open', color: '#3b82f6' },
    { value: 'WON', label: 'Won', color: '#15803d' },
    { value: 'LOST', label: 'Lost', color: '#ef4444' },
  ],
  FOLLOW_UP_TYPE: [
    { value: 'CALL', label: 'Call', color: '#a855f7' },
    { value: 'EMAIL', label: 'Email', color: '#3b82f6' },
    { value: 'MEETING', label: 'Meeting', color: '#7c3aed' },
    { value: 'LINKEDIN', label: 'LinkedIn', color: '#0a66c2' },
    { value: 'WHATSAPP', label: 'WhatsApp', color: '#22c55e' },
    { value: 'RFQ', label: 'RFQ', color: '#06b6d4' },
    { value: 'VISIT', label: 'Visit', color: '#f97316' },
    { value: 'OTHER', label: 'Other', color: '#64748b' },
  ],
};

// Keeps the built-in lists in step with the enums the records use.
const _rfq: readonly string[] = RFQ_STATUSES;
const _fu: readonly string[] = FOLLOW_UP_TYPES;
if (BUILT_IN_OPTIONS.RFQ_STATUS.some((o) => !_rfq.includes(o.value)) || BUILT_IN_OPTIONS.FOLLOW_UP_TYPE.some((o) => !_fu.includes(o.value))) {
  throw new Error('BUILT_IN_OPTIONS is out of step with RFQ_STATUSES or FOLLOW_UP_TYPES');
}

/** A follow-up category added by an administrator is stored on follow-ups as `C_<slug>`. */
export const CUSTOM_OPTION_VALUE = /^C_[A-Z0-9_]{1,40}$/;

export const optionInputSchema = z.object({ label: z.string().trim().min(1, 'Enter a name').max(80), color: hex, description });
export const optionUpdateSchema = z
  .object({ label: z.string().trim().min(1, 'Enter a name').max(80).optional(), color: hex.optional(), description, active: z.boolean().optional() })
  .strict();
export type OptionUpdate = z.infer<typeof optionUpdateSchema>;
export const optionReorderSchema = z.object({ kind: z.enum(OPTION_LIST_KINDS), values: z.array(z.string().max(60)).min(1).max(100) });

export interface OptionRow {
  kind: OptionListKind;
  value: string;
  label: string;
  color: string;
  description: string | null;
  position: number;
  active: boolean;
  builtIn: boolean;
  /** Records using it (shown before hiding or deleting). */
  used: number;
}

// ───────────── Notification settings ─────────────

/**
 * Notification categories an administrator can switch off for the whole workspace. A category matches notification
 * types exactly or by prefix (`rfq.` matches `rfq.assigned`). Billing, security and failure alerts are not here and
 * are always sent.
 */
export const NOTIFICATION_CATEGORIES = [
  { key: 'lead_assigned', label: 'New company assigned', types: ['lead.assigned', 'company.assigned', 'prospect_list.assigned'] },
  { key: 'lead_reassigned', label: 'Company reassigned', types: ['company.reassigned', 'lead.reassigned'] },
  { key: 'follow_up_assigned', label: 'Follow-up assigned', types: ['followup.assigned', 'task.assigned'] },
  { key: 'follow_up_reminder', label: 'Follow-up reminder', types: ['followup.reminder', 'followup.daily', 'task.due_soon'] },
  { key: 'follow_up_overdue', label: 'Follow-up overdue', types: ['followup.overdue', 'task.overdue'] },
  // Redesign R10: the events added by the redesign get categories, so they can be muted and silenced like the rest.
  { key: 'task_updates', label: 'Task progress and comments', types: ['task.updated', 'task.commented', 'task.completed'] },
  { key: 'team_status', label: 'Team status: check-in, breaks and check-out', types: ['team.status'] },
  { key: 'manager_remarks', label: 'Manager remarks', types: ['remark.', 'manager_remark.'] },
  { key: 'instructions', label: 'Senior management instructions', types: ['instruction.'] },
  { key: 'lead_transfers', label: 'Company transfer requests and decisions', types: ['lead_transfer.', 'transfer.'] },
  { key: 'rfqs', label: 'RFQ assigned', types: ['rfq.assigned', 'rfq.received'] },
  { key: 'rfq_deadline', label: 'RFQ deadline reminder', types: ['rfq.deadline'] },
  { key: 'concerns', label: 'Client concern escalation', types: ['escalation.', 'concern.'] },
  { key: 'deal_won', label: 'Deal won', types: ['deal.won'] },
  { key: 'deal_lost', label: 'Deal lost', types: ['deal.lost'] },
  { key: 'deal_health', label: 'Deal health and churn risk', types: ['deal.health_dropped', 'customer.churn_risk'] },
  { key: 'targets', label: 'Target achievement', types: ['target.'] },
  { key: 'announcements', label: 'Important announcements', types: ['announcement.'] },
  { key: 'quotes', label: 'Quotes and approvals', types: ['quote.', 'approval.requested'] },
  { key: 'contracts', label: 'Contract renewals', types: ['contract.'] },
  { key: 'messages', label: 'Incoming SMS, WhatsApp and inbox', types: ['sms.received', 'whatsapp.received', 'inbox.'] },
  { key: 'portal', label: 'Client portal activity', types: ['portal.'] },
  { key: 'sequences', label: 'Sequence updates', types: ['sequence.'] },
  { key: 'visitors', label: 'High-intent website visitors', types: ['visitor.'] },
  { key: 'gamification', label: 'Badges and competitions', types: ['gamification.'] },
  { key: 'workflows', label: 'Workflow notifications', types: ['workflow.notify'] },
] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORIES)[number]['key'];
const CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key) as [NotificationCategoryKey, ...NotificationCategoryKey[]];

/** The category a notification type belongs to, or null when it is always sent. */
export function notificationCategoryOf(type: string): NotificationCategoryKey | null {
  for (const c of NOTIFICATION_CATEGORIES) {
    if ((c.types as readonly string[]).some((t) => (t.endsWith('.') ? type.startsWith(t) : type === t))) return c.key;
  }
  return null;
}

export const notificationSettingsSchema = z
  .object({
    /** Categories switched off. Everything else is on. */
    disabled: z.array(z.enum(CATEGORY_KEYS)).max(CATEGORY_KEYS.length).default([]),
    reminders: z
      .object({
        /** Minutes before a follow-up is due to remind its owner; null sends no reminder. */
        followUpBeforeMinutes: z.number().int().min(5).max(10_080).nullable(),
        /** Tell the owner (and the follow-up's manager) once when a follow-up becomes overdue. */
        followUpOverdue: z.boolean(),
        overdueNotifiesManager: z.boolean(),
        /** Days before an open RFQ's submission deadline to remind its owner; null sends none. */
        rfqDeadlineDays: z.number().int().min(1).max(60).nullable(),
      })
      .strict(),
  })
  .strict();
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  disabled: [],
  reminders: { followUpBeforeMinutes: 60, followUpOverdue: true, overdueNotifiesManager: true, rfqDeadlineDays: 2 },
};

// ───────────── Currency ─────────────

export const currencySettingsSchema = z
  .object({
    /** Totals, targets and revenue are reported in this currency. */
    baseCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    /** Currencies offered first in pickers (RFQs, deals, currency fields). Others can still be typed. */
    enabled: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)).max(60).default([]),
  })
  .strict();
export type CurrencySettingsInput = z.infer<typeof currencySettingsSchema>;

export const currencyRateSchema = z
  .object({
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code'),
    /** 1 unit of `currency` is `rate` units of the base currency. */
    rate: z.number().positive().max(1e9),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type CurrencyRateInput = z.infer<typeof currencyRateSchema>;

export interface CurrencySettings {
  baseCurrency: string;
  enabled: string[];
  /** Latest rate per currency, into the base currency. */
  rates: { currency: string; rate: number; effectiveDate: string }[];
  /** Currencies used on records that have no rate, so totals leave them out. */
  missingRates: string[];
}

// ───────────── Export permissions ─────────────

export const EXPORT_ENTITY_KEYS = ['companies', 'contacts', 'leads', 'deals', 'rfqs'] as const;
export type ExportEntityKey = (typeof EXPORT_ENTITY_KEYS)[number];
export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Who may export what. A role needs the `data:export` permission to export at all; this narrows it to some
 * record types and formats. A role with no entry may export every type in every format (as before).
 */
export const exportRolePolicySchema = z
  .object({
    roleId: z.string().uuid(),
    entities: z.array(z.enum(EXPORT_ENTITY_KEYS)).max(EXPORT_ENTITY_KEYS.length),
    formats: z.array(z.enum(EXPORT_FORMATS)).max(EXPORT_FORMATS.length),
    /** Leave contact details (emails, phones, links) out of exports even where the role can see them. */
    withoutContactDetails: z.boolean().default(false),
  })
  .strict();
export const exportPolicySchema = z.object({ roles: z.array(exportRolePolicySchema).max(100) }).strict();
export type ExportPolicy = z.infer<typeof exportPolicySchema>;
export type ExportRolePolicy = z.infer<typeof exportRolePolicySchema>;

export interface ExportPolicyRow {
  roleId: string;
  roleName: string;
  /** Without data:export the role cannot export, whatever the policy says. */
  hasExportPermission: boolean;
  policy: ExportRolePolicy;
  /** True when no entry is stored (everything allowed). */
  isDefault: boolean;
}

export function allowsExport(policy: ExportRolePolicy | undefined, entity: ExportEntityKey, format: ExportFormat): boolean {
  if (!policy) return true;
  return policy.entities.includes(entity) && policy.formats.includes(format);
}

// ───────────── Dashboard widget permissions and default layouts ─────────────

/**
 * Per designation tier: which dashboard widgets people of that tier may have, the layout they start with, and
 * whether they may change it. Widget ids are strings from `dashboardWidgetCatalog`, so dashboards added later
 * extend the catalogue without changing stored policies (unknown ids are dropped when read).
 */
export const dashboardPolicyWidgetSchema = z.object({ id: z.string().min(1).max(60), size: z.enum(['half', 'full']), hidden: z.boolean().default(false) }).strict();
export const dashboardPolicySchema = z
  .object({
    tier: z.enum(DESIGNATION_TIERS),
    /** null: every widget in the catalogue. */
    allowedWidgets: z.array(z.string().min(1).max(60)).max(200).nullable(),
    /** null: the built-in default for the tier. */
    defaultLayout: z.array(dashboardPolicyWidgetSchema).max(200).nullable(),
    canCustomize: z.boolean(),
  })
  .strict();
export type DashboardPolicy = z.infer<typeof dashboardPolicySchema>;
export type DashboardPolicyWidget = z.infer<typeof dashboardPolicyWidgetSchema>;

export const DEFAULT_DASHBOARD_POLICY = (tier: DesignationTier): DashboardPolicy => ({ tier, allowedWidgets: null, defaultLayout: null, canCustomize: true });

/**
 * The widgets a tier's people can have: the sections of their role dashboard (Phases 4-6) and the widgets of the
 * analytics view of the Command Center. A policy's allowed list may name either.
 */
export function dashboardWidgetCatalog(tier: DesignationTier): { sections: string[]; analytics: string[] } {
  return { sections: [...TIER_DASHBOARD_WIDGETS[tier]], analytics: [...DASHBOARD_WIDGETS] };
}

/**
 * Applies a tier's policy to a person's layout: widgets outside the allowed list are dropped, and when the person
 * has no saved layout (or may not customise) the tier default is used. Pure, so the API and pages agree.
 */
export function applyDashboardPolicy(
  policy: DashboardPolicy,
  catalog: readonly string[],
  saved: DashboardPolicyWidget[] | null,
  builtInDefault: DashboardPolicyWidget[],
): { widgets: DashboardPolicyWidget[]; locked: boolean; allowed: string[] } {
  const known = new Set(catalog);
  const allowed = (policy.allowedWidgets ?? [...catalog]).filter((id) => known.has(id));
  const ok = new Set(allowed);
  const base = policy.defaultLayout ?? builtInDefault;
  const source = policy.canCustomize && saved ? saved : base;
  const seen = new Set<string>();
  const widgets = source.filter((w) => ok.has(w.id) && !seen.has(w.id) && seen.add(w.id));
  // Allowed widgets the layout does not mention are offered hidden at the end, so nothing allowed is unreachable.
  for (const id of allowed) if (!seen.has(id)) widgets.push({ id, size: 'half', hidden: true });
  return { widgets, locked: !policy.canCustomize, allowed };
}
