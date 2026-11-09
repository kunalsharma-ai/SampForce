import { z } from 'zod';
import { PLAN_CODES, type PlanCode } from './plan-codes';

/*
 * Plan features (ADR 0057). Every part of SampForce that a plan can include or leave out has a key here. Platform
 * operators decide which features each plan includes, and can grant or withhold a feature for one workspace; the
 * API refuses a feature's routes, public pages and background work when the workspace's plan does not include it.
 *
 * What is never a feature: signing in, the core CRM records (leads, contacts, companies, accounts, deals, pipelines,
 * activities and tasks), search, import and export, custom fields, team members, settings, billing, notifications and
 * the audit log. Without those a workspace cannot work or pay, so every plan has them.
 */

export const FEATURE_GROUPS = ['Sales', 'Engage', 'Intelligence', 'Revenue', 'Apps', 'Administration'] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const FEATURE_KEYS = [
  // Sales
  'territories',
  'quotes',
  'proposals',
  'contracts',
  // Engage
  'email_sync',
  'team_inbox',
  'email_templates',
  'sequences',
  'email_finder',
  'prospect_lists',
  'browser_extension',
  'marketing',
  'campaigns',
  'website_visitors',
  'meeting_intelligence',
  'voice_notes',
  // Intelligence
  'ai_assistant',
  'automation',
  'sales_intelligence',
  'forecasting',
  'revenue_intelligence',
  'reports',
  'gamification',
  // Revenue
  'client_portal',
  'customer_success',
  // Apps
  'slack',
  'teams',
  'zoom',
  'docusign',
  'card_payments',
  'whatsapp',
  'sms',
  'api_access',
  'webhooks',
  // Administration
  'custom_roles',
  'sso_scim',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const featureKeySchema = z.enum(FEATURE_KEYS);

export interface FeatureDef {
  key: FeatureKey;
  group: FeatureGroup;
  label: string;
  description: string;
  /** The cheapest plan that includes it by default. Operators can change any plan's list in the console. */
  defaultFrom: PlanCode;
  /** Workspace pages (path prefixes under /app) that belong to the feature and show the upgrade page without it. */
  paths: string[];
}

export const FEATURES: FeatureDef[] = [
  { key: 'territories', group: 'Sales', label: 'Sales territories', description: 'Territories with rules that route leads and deals to their owners.', defaultFrom: 'growth', paths: ['/app/settings/territories'] },
  { key: 'quotes', group: 'Sales', label: 'Quotes and catalogue', description: 'Products, price books, quotes with approvals and PDFs, and the Quick Bid Studio.', defaultFrom: 'launch', paths: ['/app/quotes'] },
  { key: 'proposals', group: 'Sales', label: 'Proposals', description: 'Proposals built from quotes, shared by link and accepted online.', defaultFrom: 'growth', paths: [] },
  { key: 'contracts', group: 'Sales', label: 'Contracts', description: 'Contract register, renewals and reminders.', defaultFrom: 'growth', paths: ['/app/contracts'] },

  { key: 'email_sync', group: 'Engage', label: 'Mailbox and calendar sync', description: 'Gmail and Microsoft 365 email and calendar sync, and sending from your own mailbox.', defaultFrom: 'free', paths: [] },
  { key: 'team_inbox', group: 'Engage', label: 'Team inbox', description: 'Shared conversation threads with status, owners and internal notes.', defaultFrom: 'growth', paths: ['/app/communication'] },
  { key: 'email_templates', group: 'Engage', label: 'Email templates', description: 'Email templates, the block designer and workspace merge fields.', defaultFrom: 'launch', paths: [] },
  { key: 'sequences', group: 'Engage', label: 'Email sequences', description: 'Multi-step email sequences with send windows, tracking and reply detection.', defaultFrom: 'launch', paths: ['/app/sequences'] },
  { key: 'email_finder', group: 'Engage', label: 'Email finder', description: 'Find and verify work email addresses.', defaultFrom: 'growth', paths: ['/app/finder'] },
  { key: 'prospect_lists', group: 'Engage', label: 'Prospect lists', description: 'Prospect lists from files, the extension and Apollo.io.', defaultFrom: 'growth', paths: ['/app/prospects'] },
  { key: 'browser_extension', group: 'Engage', label: 'Browser extension', description: 'The SampForce browser extension for capturing leads from web pages.', defaultFrom: 'launch', paths: [] },
  { key: 'marketing', group: 'Engage', label: 'Segments and lead forms', description: 'Segments and hosted lead forms with recorded consent.', defaultFrom: 'launch', paths: ['/app/marketing'] },
  { key: 'campaigns', group: 'Engage', label: 'Campaigns', description: 'Campaign tracking with first-touch attribution.', defaultFrom: 'launch', paths: ['/app/campaigns'] },
  { key: 'website_visitors', group: 'Engage', label: 'Website visitors', description: 'Consent-aware website tracking and enquiries.', defaultFrom: 'professional', paths: ['/app/website-visitors'] },
  { key: 'meeting_intelligence', group: 'Engage', label: 'Meeting recordings', description: 'Meeting recordings, transcripts and AI summaries.', defaultFrom: 'growth', paths: ['/app/meetings/records'] },
  { key: 'voice_notes', group: 'Engage', label: 'Voice to CRM', description: 'Voice notes turned into suggested CRM updates.', defaultFrom: 'professional', paths: [] },

  { key: 'ai_assistant', group: 'Intelligence', label: 'AI assistant and agents', description: 'Copilot, AI agents, email writing and AI analysis, within the plan’s AI credits.', defaultFrom: 'free', paths: ['/app/agents'] },
  { key: 'automation', group: 'Intelligence', label: 'Automation Studio', description: 'Workflows with triggers, conditions and actions, within the plan’s monthly runs.', defaultFrom: 'free', paths: ['/app/automation'] },
  { key: 'sales_intelligence', group: 'Intelligence', label: 'Sales intelligence', description: 'Deal health, next best actions and record intelligence.', defaultFrom: 'growth', paths: ['/app/deals/health'] },
  { key: 'forecasting', group: 'Intelligence', label: 'Forecasting', description: 'Weighted and scenario forecasts, snapshots and forecast planning.', defaultFrom: 'growth', paths: ['/app/forecasting'] },
  { key: 'revenue_intelligence', group: 'Intelligence', label: 'Revenue intelligence', description: 'Revenue analytics, targets and exchange rates.', defaultFrom: 'professional', paths: ['/app/revenue'] },
  { key: 'reports', group: 'Intelligence', label: 'Reports and dashboards', description: 'Report builder, custom dashboards and the immersive views.', defaultFrom: 'free', paths: ['/app/reports'] },
  { key: 'gamification', group: 'Intelligence', label: 'Sales gamification', description: 'Points, leaderboards, badges and competitions.', defaultFrom: 'growth', paths: ['/app/gamification'] },

  { key: 'client_portal', group: 'Revenue', label: 'Client portal', description: 'A signed-in portal where customers follow projects and approve proposals.', defaultFrom: 'professional', paths: ['/app/portal'] },
  { key: 'customer_success', group: 'Revenue', label: 'Customer success', description: 'Health scores, churn risk, escalations and renewals.', defaultFrom: 'professional', paths: ['/app/customer-success'] },

  { key: 'slack', group: 'Apps', label: 'Slack', description: 'CRM alerts in Slack channels.', defaultFrom: 'growth', paths: [] },
  { key: 'teams', group: 'Apps', label: 'Microsoft Teams', description: 'CRM alerts in Teams channels.', defaultFrom: 'growth', paths: [] },
  { key: 'zoom', group: 'Apps', label: 'Zoom', description: 'Zoom meetings and transcripts.', defaultFrom: 'growth', paths: [] },
  { key: 'docusign', group: 'Apps', label: 'DocuSign', description: 'Send contracts and proposals for e-signature.', defaultFrom: 'professional', paths: [] },
  { key: 'card_payments', group: 'Apps', label: 'Card payments', description: 'Take card payments on proposals.', defaultFrom: 'professional', paths: [] },
  { key: 'whatsapp', group: 'Apps', label: 'WhatsApp', description: 'WhatsApp Business messages from CRM records.', defaultFrom: 'professional', paths: [] },
  { key: 'sms', group: 'Apps', label: 'SMS', description: 'SMS through your Twilio account.', defaultFrom: 'professional', paths: [] },
  { key: 'api_access', group: 'Apps', label: 'API and Zapier', description: 'Workspace API keys and the Zapier app.', defaultFrom: 'growth', paths: [] },
  { key: 'webhooks', group: 'Apps', label: 'Webhooks', description: 'Signed webhooks to your own systems.', defaultFrom: 'growth', paths: [] },

  { key: 'custom_roles', group: 'Administration', label: 'Custom roles', description: 'Roles with your own permission sets beyond the five standard roles.', defaultFrom: 'professional', paths: [] },
  { key: 'sso_scim', group: 'Administration', label: 'Single sign-on and SCIM', description: 'OpenID Connect sign-in and SCIM provisioning.', defaultFrom: 'free', paths: [] },
];

/** The plan feature behind each workspace app (the keys of APP_KEYS in apps.ts). */
export const APP_FEATURES = { slack: 'slack', teams: 'teams', zoom: 'zoom', docusign: 'docusign', payments: 'card_payments', whatsapp: 'whatsapp', twilio: 'sms' } as const satisfies Record<string, FeatureKey>;

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f])) as Record<FeatureKey, FeatureDef>;

/** The features a plan includes before any operator changes it: everything from `defaultFrom` up. */
export function defaultPlanFeatures(plan: PlanCode): FeatureKey[] {
  const rank = PLAN_CODES.indexOf(plan);
  return FEATURES.filter((f) => PLAN_CODES.indexOf(f.defaultFrom) <= rank).map((f) => f.key);
}

/** Keeps known keys only, in catalogue order, without duplicates: a stored list may hold keys a later release removed. */
export function normaliseFeatures(list: readonly string[]): FeatureKey[] {
  const set = new Set(list);
  return FEATURE_KEYS.filter((k) => set.has(k));
}

/** A grant (true) or withholding (false) of one feature for one workspace, whatever its plan says. */
export interface FeatureOverride {
  feature: FeatureKey;
  enabled: boolean;
}

/** The plan's features with the workspace's overrides applied. */
export function applyFeatureOverrides(planFeatures: readonly FeatureKey[], overrides: readonly FeatureOverride[]): FeatureKey[] {
  const set = new Set<FeatureKey>(planFeatures);
  for (const o of overrides) {
    if (o.enabled) set.add(o.feature);
    else set.delete(o.feature);
  }
  return FEATURE_KEYS.filter((k) => set.has(k));
}

/** The feature a workspace page belongs to, by the longest matching path prefix, or null for pages every plan has. */
export function featureForPath(pathname: string): FeatureKey | null {
  let best: { key: FeatureKey; len: number } | null = null;
  for (const f of FEATURES) {
    for (const p of f.paths) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && (!best || p.length > best.len)) best = { key: f.key, len: p.length };
    }
  }
  return best?.key ?? null;
}

/** The cheapest catalogue plan whose current feature list includes the feature, for "Included from …" hints. */
export function cheapestPlanWith(feature: FeatureKey, planFeatures: Partial<Record<PlanCode, readonly FeatureKey[]>>): PlanCode | null {
  return PLAN_CODES.find((p) => (planFeatures[p] ?? defaultPlanFeatures(p)).includes(feature)) ?? null;
}

// ───────────── Operator console ─────────────

const limit = z.number().int().min(0).max(100_000_000);

/** An operator changes what a plan includes. Applies to every workspace on the plan at once. */
export const operatorPlanDefinitionSchema = z
  .object({
    features: z.array(featureKeySchema).max(FEATURE_KEYS.length),
    limits: z
      .object({
        maxUsers: limit.min(1).nullable(),
        maxPipelines: limit.min(1).nullable(),
        monthlyAiCredits: limit,
        automationRunsPerMonth: limit,
      })
      .strict(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type OperatorPlanDefinitionInput = z.infer<typeof operatorPlanDefinitionSchema>;

/** An operator grants or withholds features for one workspace. `null` removes the override (the plan decides again). */
export const operatorFeatureOverridesSchema = z
  .object({
    overrides: z.record(featureKeySchema, z.boolean().nullable()).refine((o) => Object.keys(o).length > 0, 'Change at least one feature'),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type OperatorFeatureOverridesInput = z.infer<typeof operatorFeatureOverridesSchema>;

export interface OperatorPlanRow {
  code: PlanCode;
  name: string;
  features: FeatureKey[];
  limits: { maxUsers: number | null; maxPipelines: number | null; monthlyAiCredits: number; automationRunsPerMonth: number };
  /** Features that differ from the shipped defaults, so the console can show what was changed. */
  changedFromDefault: FeatureKey[];
  workspaces: number;
  updatedAt: string;
}

export interface OperatorWorkspaceFeatures {
  /** The plan whose features apply now (Free while a paid plan is unpaid or canceled). */
  appliedPlan: PlanCode;
  planFeatures: FeatureKey[];
  overrides: (FeatureOverride & { reason: string; updatedBy: string; updatedAt: string })[];
  /** What the workspace can use now. */
  effective: FeatureKey[];
}
