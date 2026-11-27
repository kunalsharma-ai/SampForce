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

export const FEATURE_GROUPS = ['CRM', 'Sales', 'Communication', 'Engage', 'Intelligence', 'Revenue', 'Apps', 'Administration'] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const FEATURE_KEYS = [
  // Sales
  'territories',
  'rfqs',
  'lead_transfers',
  'revenue_attribution',
  'manager_dashboard',
  'senior_dashboard',
  'instructions',
  'client_concerns',
  'quotes',
  'proposals',
  'contracts',
  // Engage
  'email_sync',
  'team_inbox',
  'team_chat',
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
  'docusign',
  'card_payments',
  'whatsapp',
  'sms',
  'sampbidx',
  'sampbidx_chat',
  'api_access',
  'webhooks',
  // Administration
  'custom_roles',
  'sso_scim',
  // ADR 0062
  'custom_fields_advanced',
  'excel_export',
  // ADR 0071: the core CRM, communication and administration modules join the catalogue so plans and workspaces
  // can switch them, with their subfeatures.
  'lead_management',
  'lead_assignment',
  'lead_conversion',
  'lead_merge',
  'account_management',
  'company_branches',
  'company_files',
  'company_enrichment',
  'company_owner_changes',
  'lead_drafts',
  'contact_management',
  'duplicate_checks',
  'opportunity_management',
  'deal_board',
  'deal_bulk_update',
  'deal_cloning',
  'deal_history',
  'sales_pipeline',
  'activity_tracking',
  'interactions',
  // ADR 0080
  'rfq_contributors',
  'follow_up_management',
  'follow_up_rescheduling',
  'record_timeline',
  'global_search',
  'data_import',
  'data_export',
  'task_management',
  'notifications',
  'workspace_management',
  'user_management',
  'permission_management',
  'sales_target_management',
  'audit_log',
  'crm_configuration',
  // ADR 0072
  'mobile_app',
  // ADR 0082: the Leads and Accounts pages, hidden until the Console Admin switches them on.
  'leads_section',
  'accounts_section',
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
  /**
   * Pages that belong to the feature at exactly this path, not below it: the Leads list is hidden without
   * `leads_section` while a lead's own page, linked from notifications and other records, still opens.
   */
  exactPaths?: string[];
  /** A subfeature: only available while this feature is (ADR 0071). */
  parent?: FeatureKey;
  /**
   * Catalogue version that added the key. Plan lists saved before that version did not know it, so they include it
   * when its `defaultFrom` says so (see parsePlanEntitlements); lists saved since then are taken as written.
   */
  since?: number;
  /**
   * In no plan until the Console Admin adds it to a plan or grants it to one organisation: a module the Console
   * switches on deliberately (SampBidx chat).
   */
  optIn?: boolean;
}

export const FEATURES: FeatureDef[] = [
  { key: 'rfqs', group: 'Sales', label: 'RFQs', description: 'Requests for quotation with LOI, IR and CPI pricing, deadlines, reports and conversion to deals.', defaultFrom: 'free', paths: ['/app/rfqs'] },
  { key: 'lead_transfers', group: 'Sales', label: 'Lead transfers', description: 'Requests to move a lead to a manager or senior person, approved, rejected or reassigned by them.', defaultFrom: 'free', paths: [] },
  { key: 'revenue_attribution', group: 'Sales', label: 'Revenue attribution', description: 'Revenue records for won deals, split between the people who won them without counting anything twice.', defaultFrom: 'free', paths: [] },
  { key: 'manager_dashboard', group: 'Sales', label: 'Manager dashboard', description: 'The team Command Center: team KPIs, the employee performance table, comparisons and follow-up monitoring.', defaultFrom: 'free', paths: [] },
  { key: 'senior_dashboard', group: 'Sales', label: 'Senior management dashboard', description: 'The organisation Command Center: department performance, rankings, revenue analytics and business insights.', defaultFrom: 'free', paths: [] },
  { key: 'instructions', group: 'Sales', label: 'Manager instructions', description: 'Instructions from managers to their team, acknowledged and completed by the people who receive them.', defaultFrom: 'free', paths: [] },
  { key: 'client_concerns', group: 'Sales', label: 'Client concerns', description: 'Client concerns and rejections with severity, deadlines and escalation to senior management.', defaultFrom: 'free', paths: [] },
  { key: 'territories', group: 'Sales', label: 'Sales territories', description: 'Territories with rules that route leads and deals to their owners.', defaultFrom: 'growth', paths: ['/app/settings/territories'] },
  { key: 'quotes', group: 'Sales', label: 'Quotes and catalogue', description: 'Products, price books, quotes with approvals and PDFs, and the Quick Bid Studio.', defaultFrom: 'launch', paths: ['/app/quotes'] },
  { key: 'proposals', group: 'Sales', label: 'Proposals', description: 'Proposals built from quotes, shared by link and accepted online.', defaultFrom: 'growth', paths: [] },
  { key: 'contracts', group: 'Sales', label: 'Contracts', description: 'Contract register, renewals and reminders.', defaultFrom: 'growth', paths: ['/app/contracts'] },

  { key: 'email_sync', group: 'Engage', label: 'Mailbox and calendar sync', description: 'Gmail and Microsoft 365 email and calendar sync, and sending from your own mailbox.', defaultFrom: 'free', paths: [] },
  { key: 'team_inbox', group: 'Engage', label: 'Team inbox', description: 'Shared conversation threads with status, owners and internal notes.', defaultFrom: 'growth', paths: ['/app/communication'] },
  { key: 'team_chat', group: 'Communication', label: 'Internal chat', description: 'Direct messages, group channels and a support line to super admins, served by your own SampForce server so it also works on an office network without internet.', defaultFrom: 'free', paths: ['/app/chat'] },
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

  { key: 'docusign', group: 'Apps', label: 'DocuSign', description: 'Send contracts and proposals for e-signature.', defaultFrom: 'professional', paths: [] },
  { key: 'card_payments', group: 'Apps', label: 'Card payments', description: 'Take card payments on proposals.', defaultFrom: 'professional', paths: [] },
  { key: 'whatsapp', group: 'Apps', label: 'WhatsApp', description: 'WhatsApp Business messages from CRM records.', defaultFrom: 'professional', paths: [] },
  { key: 'sms', group: 'Apps', label: 'SMS', description: 'SMS through your Twilio account.', defaultFrom: 'professional', paths: [] },
  { key: 'sampbidx', group: 'Apps', label: 'SampBidx', description: 'Send RFQs and RFQ emails to SampBidx for bidding, and follow their status.', defaultFrom: 'free', paths: [] },
  { key: 'sampbidx_chat', group: 'Communication', label: 'Chat with SampBidx team', description: 'Talk with the SampBidx bidding team inside Team chat: a general line and one chat per RFQ sent to SampBidx. The Console Admin allows it for the Super Workspace, which hands it down to its Manager and Executive Workspaces.', defaultFrom: 'free', paths: [], parent: 'team_chat', since: 4, optIn: true },
  { key: 'api_access', group: 'Apps', label: 'API and Zapier', description: 'Workspace API keys and the Zapier app.', defaultFrom: 'growth', paths: [] },
  { key: 'webhooks', group: 'Apps', label: 'Webhooks', description: 'Signed webhooks to your own systems.', defaultFrom: 'growth', paths: [] },

  { key: 'custom_roles', group: 'Administration', label: 'Custom roles', description: 'Roles with your own permission sets beyond the five standard roles.', defaultFrom: 'professional', paths: [] },
  { key: 'sso_scim', group: 'Administration', label: 'Single sign-on and SCIM', description: 'OpenID Connect sign-in and SCIM provisioning.', defaultFrom: 'free', paths: [] },
  { key: 'custom_fields_advanced', group: 'Administration', label: 'Advanced custom fields', description: 'All 14 custom field types, fields on follow-ups and RFQs, and fields shown or edited by some designations only.', defaultFrom: 'growth', paths: [] },
  { key: 'excel_export', group: 'Administration', label: 'Excel export', description: 'Export companies, employees, leads, deals and RFQs as Excel workbooks.', defaultFrom: 'launch', paths: [], parent: 'data_export' },

  // ADR 0071: core modules and their subfeatures. Every plan includes them unless an operator takes them out.
  { key: 'lead_management', group: 'CRM', label: 'Lead management', description: 'Inbound leads: capture, qualify, own and work them.', defaultFrom: 'free', paths: ['/app/leads'], since: 2 },
  { key: 'lead_assignment', group: 'CRM', label: 'Lead assignment', description: 'Assign inbound leads to an owner.', defaultFrom: 'free', paths: [], parent: 'lead_management', since: 2 },
  { key: 'lead_conversion', group: 'CRM', label: 'Lead conversion', description: 'Convert an inbound lead into a company, contact and deal.', defaultFrom: 'free', paths: [], parent: 'lead_management', since: 2 },
  { key: 'lead_merge', group: 'CRM', label: 'Duplicate leads and merging', description: 'Find duplicate inbound leads and merge them.', defaultFrom: 'free', paths: [], parent: 'lead_management', since: 2 },
  { key: 'account_management', group: 'CRM', label: 'Account management', description: 'Company leads (accounts) with their dashboard, status and owner.', defaultFrom: 'free', paths: ['/app/companies'], since: 2 },
  { key: 'company_branches', group: 'CRM', label: 'Company branches', description: 'Branches and offices of a company.', defaultFrom: 'free', paths: [], parent: 'account_management', since: 2 },
  { key: 'company_files', group: 'CRM', label: 'Company files', description: 'Files kept on a company.', defaultFrom: 'free', paths: [], parent: 'account_management', since: 2 },
  { key: 'company_enrichment', group: 'CRM', label: 'Company auto-fill', description: 'Fill missing company details from the company’s own website and Wikidata, with the source of every value and undo.', defaultFrom: 'free', paths: [], parent: 'account_management', since: 3 },
  { key: 'company_owner_changes', group: 'CRM', label: 'Company owner changes', description: 'Change a company’s owner with a reason, and its owner history.', defaultFrom: 'free', paths: [], parent: 'account_management', since: 2 },
  { key: 'lead_drafts', group: 'CRM', label: 'New lead wizard drafts', description: 'Save the new lead wizard as a draft and finish it later.', defaultFrom: 'free', paths: [], parent: 'account_management', since: 2 },
  { key: 'contact_management', group: 'CRM', label: 'Contact management', description: 'Employees and points of contact of companies.', defaultFrom: 'free', paths: ['/app/contacts'], since: 2 },
  { key: 'duplicate_checks', group: 'CRM', label: 'Duplicate checks', description: 'Warn about existing companies and contacts while typing a new one.', defaultFrom: 'free', paths: [], parent: 'contact_management', since: 2 },
  { key: 'opportunity_management', group: 'CRM', label: 'Opportunity management', description: 'Deals with value, stage, owner and close date.', defaultFrom: 'free', paths: ['/app/deals'], since: 2 },
  { key: 'deal_board', group: 'CRM', label: 'Deal board', description: 'The pipeline board of deals by stage.', defaultFrom: 'free', paths: [], parent: 'opportunity_management', since: 2 },
  { key: 'deal_bulk_update', group: 'CRM', label: 'Bulk deal updates', description: 'Change many deals at once.', defaultFrom: 'free', paths: [], parent: 'opportunity_management', since: 2 },
  { key: 'deal_cloning', group: 'CRM', label: 'Deal cloning', description: 'Copy a deal into a new one.', defaultFrom: 'free', paths: [], parent: 'opportunity_management', since: 2 },
  { key: 'deal_history', group: 'CRM', label: 'Deal stage history', description: 'Every stage change of a deal.', defaultFrom: 'free', paths: [], parent: 'opportunity_management', since: 2 },
  { key: 'sales_pipeline', group: 'CRM', label: 'Sales pipelines', description: 'Pipelines and their stages.', defaultFrom: 'free', paths: ['/app/pipelines'], since: 2 },
  { key: 'activity_tracking', group: 'CRM', label: 'Calls and activities', description: 'Calls, meetings, emails and notes logged on records.', defaultFrom: 'free', paths: ['/app/activities'], since: 2 },
  { key: 'interactions', group: 'CRM', label: 'Client interactions', description: 'Interactions recorded on a company with their outcome.', defaultFrom: 'free', paths: ['/app/calls'], parent: 'activity_tracking', since: 2 },
  { key: 'rfq_contributors', group: 'CRM', label: 'RFQ contributors and communication stages', description: 'Mark which employees share RFQs, give each employee a colour-coded communication stage with its history, and filter a company’s employees by RFQ activity and follow-ups.', defaultFrom: 'free', paths: [], parent: 'contact_management', since: 5 },
  { key: 'follow_up_management', group: 'CRM', label: 'Follow-up management', description: 'Follow-ups with type, due date, reminders and outcome.', defaultFrom: 'free', paths: ['/app/follow-ups'], since: 2 },
  { key: 'follow_up_rescheduling', group: 'CRM', label: 'Follow-up rescheduling', description: 'Move a follow-up to a new date, counted on the follow-up.', defaultFrom: 'free', paths: [], parent: 'follow_up_management', since: 2 },
  { key: 'record_timeline', group: 'CRM', label: 'Record timeline', description: 'The history of everything that happened on a record.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'global_search', group: 'CRM', label: 'Global search', description: 'Search every record from the top bar.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'data_import', group: 'CRM', label: 'Data import', description: 'Import companies, contacts and leads from CSV and Excel files.', defaultFrom: 'free', paths: ['/app/settings/import'], since: 2 },
  { key: 'data_export', group: 'CRM', label: 'Data export', description: 'Export records as CSV files.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'task_management', group: 'Communication', label: 'Task assignment', description: 'Tasks assigned to people and workspaces, with priority, due date and status.', defaultFrom: 'free', paths: ['/app/tasks'], since: 2 },
  { key: 'notifications', group: 'Communication', label: 'Notifications', description: 'The notification inbox in the top bar.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'workspace_management', group: 'Administration', label: 'Workspace management', description: 'Create and manage Manager and Executive Workspaces within the subscription’s limits.', defaultFrom: 'free', paths: ['/app/settings/workspaces'], since: 2 },
  { key: 'user_management', group: 'Administration', label: 'User management', description: 'Invite people, change their roles and teams.', defaultFrom: 'free', paths: ['/app/team'], since: 2 },
  { key: 'permission_management', group: 'Administration', label: 'Permission management', description: 'Roles, and the features and actions each workspace hands down.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'sales_target_management', group: 'Administration', label: 'Sales target management', description: 'Set and distribute sales targets.', defaultFrom: 'free', paths: ['/app/targets'], since: 2 },
  { key: 'audit_log', group: 'Administration', label: 'Audit log', description: 'Who changed what, and when.', defaultFrom: 'free', paths: [], since: 2 },
  { key: 'crm_configuration', group: 'Administration', label: 'CRM configuration', description: 'Statuses, departments, designations, lead numbering and other CRM settings.', defaultFrom: 'free', paths: ['/app/settings/crm'], since: 2 },
  { key: 'mobile_app', group: 'Apps', label: 'Mobile app', description: 'The SampForce app for iPhone and Android, once the Console Admin approves it and the Super Workspace switches it on.', defaultFrom: 'free', paths: ['/app/settings/mobile'], since: 2 },
  // ADR 0082 (redesign R2): the separate Leads and Accounts pages are off for every organisation until the Console Admin
  // switches them on. Companies and their contacts are where leads are worked now.
  { key: 'leads_section', group: 'CRM', label: 'Leads page', description: 'The separate Leads page for inbound leads. Hidden unless the Console Admin switches it on; companies and contacts hold the leads otherwise.', defaultFrom: 'free', paths: [], exactPaths: ['/app/leads'], parent: 'lead_management', since: 4, optIn: true },
  { key: 'accounts_section', group: 'CRM', label: 'Accounts page', description: 'The separate Accounts page. Hidden unless the Console Admin switches it on; Companies is the account list otherwise.', defaultFrom: 'free', paths: ['/app/accounts'], parent: 'account_management', since: 4, optIn: true },
];

/** The catalogue version this release writes with every plan list it saves (see FeatureDef.since). */
export const FEATURE_CATALOG_VERSION = 5;

/** Subfeatures of a feature, in catalogue order. */
export function subfeaturesOf(feature: FeatureKey): FeatureKey[] {
  return FEATURES.filter((f) => f.parent === feature).map((f) => f.key);
}

/** Drops every subfeature whose parent feature is missing: a subfeature never works without its feature. */
export function withParents(list: readonly FeatureKey[]): FeatureKey[] {
  const set = new Set(list);
  return list.filter((k) => {
    const parent = FEATURES.find((f) => f.key === k)?.parent;
    return !parent || set.has(parent);
  });
}

/** The plan feature behind each workspace app (the keys of APP_KEYS in apps.ts). */
export const APP_FEATURES = { docusign: 'docusign', payments: 'card_payments', whatsapp: 'whatsapp', twilio: 'sms', sampbidx: 'sampbidx' } as const satisfies Record<string, FeatureKey>;

export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f])) as Record<FeatureKey, FeatureDef>;

/** The features a plan includes before any operator changes it: everything from `defaultFrom` up. */
export function defaultPlanFeatures(plan: PlanCode): FeatureKey[] {
  const rank = PLAN_CODES.indexOf(plan);
  return FEATURES.filter((f) => !f.optIn && PLAN_CODES.indexOf(f.defaultFrom) <= rank).map((f) => f.key);
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
    // An exact page wins over a prefix of the same length.
    for (const p of f.exactPaths ?? []) if (pathname === p && (!best || p.length + 0.5 > best.len)) best = { key: f.key, len: p.length + 0.5 };
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
        maxManagerWorkspaces: limit.nullable().optional(),
        maxExecutiveWorkspaces: limit.nullable().optional(),
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
  appliedPlan: string;
  planFeatures: FeatureKey[];
  overrides: (FeatureOverride & { reason: string; updatedBy: string; updatedAt: string })[];
  /** What the workspace can use now. */
  effective: FeatureKey[];
}
