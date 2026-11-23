import { z } from 'zod';
import type { CustomFieldEntity } from './custom-fields';
import type { FeatureKey } from './features';
import type { Permission } from './permissions';
import { type ActionGrants, actionAllowed, type WorkspaceAction } from './workspaces';
import { WORKSPACE_LEVELS_FOR_MOBILE, type MobileWorkspaceLevel } from './mobile';

/*
 * The Mobile Configuration Center (ADR 0072, M2). The Super Workspace edits a draft and publishes it; each publish is a
 * numbered version kept for rollback. The phone asks for the configuration resolved for the signed-in person (their
 * level, their plan, their permissions) and the API applies the same field rules to every record it sends or accepts.
 */

export const MOBILE_LEVELS = WORKSPACE_LEVELS_FOR_MOBILE;

/** The CRM modules the app offers, each tied to the existing SampForce feature behind it (null = core CRM, every plan). */
export const MOBILE_MODULES = ['dashboard', 'companies', 'contacts', 'follow_ups', 'tasks', 'deals', 'targets', 'reports', 'chat', 'notifications', 'profile'] as const;
export type MobileModuleKey = (typeof MOBILE_MODULES)[number];

export interface MobileModuleDef {
  key: MobileModuleKey;
  label: string;
  description: string;
  /** Feature that must be in the plan and the person's workspace (ADR 0071); its action grants narrow the module. */
  feature: FeatureKey | null;
  /** Custom fields of this entity can be shown on the phone. */
  customFieldEntity: CustomFieldEntity | null;
  /** Records here can be created, edited or deleted on the phone (dashboard, reports and profile only show). */
  records: boolean;
  /** Role permissions needed to see (read) and change (write) these records, as on the web. */
  permission: { read: Permission; write: Permission } | null;
  /** Always on: the app needs it to work. */
  required?: boolean;
}

export const MOBILE_MODULE_DEFS: MobileModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'The home screen with the cards you choose for each workspace level.', feature: null, customFieldEntity: null, records: false, permission: { read: 'dashboard:read', write: 'dashboard:read' }, required: true },
  { key: 'companies', label: 'Leads and companies', description: 'Company leads with their status, owner and contact details.', feature: 'account_management', customFieldEntity: 'COMPANY', records: true, permission: { read: 'companies:read', write: 'companies:write' } },
  { key: 'contacts', label: 'Contacts', description: 'Employees and points of contact at client companies.', feature: 'contact_management', customFieldEntity: 'CONTACT', records: true, permission: { read: 'contacts:read', write: 'contacts:write' } },
  { key: 'follow_ups', label: 'Follow-ups', description: 'Calls, meetings and reminders due with clients.', feature: 'follow_up_management', customFieldEntity: 'FOLLOW_UP', records: true, permission: { read: 'activities:read', write: 'activities:write' } },
  { key: 'tasks', label: 'Tasks', description: 'Tasks assigned to people, with priority and due date.', feature: 'task_management', customFieldEntity: null, records: true, permission: { read: 'activities:read', write: 'activities:write' } },
  { key: 'deals', label: 'Sales pipeline', description: 'Deals by stage, with amount and expected close date.', feature: 'opportunity_management', customFieldEntity: 'OPPORTUNITY', records: true, permission: { read: 'deals:read', write: 'deals:write' } },
  { key: 'targets', label: 'Sales targets', description: 'Targets and how much of them is achieved.', feature: 'sales_target_management', customFieldEntity: null, records: false, permission: { read: 'dashboard:read', write: 'dashboard:read' } },
  { key: 'reports', label: 'Sales reports', description: 'Ready-made sales reports, read only.', feature: 'reports', customFieldEntity: null, records: false, permission: { read: 'reports:read', write: 'reports:read' } },
  { key: 'chat', label: 'Internal chat', description: 'The same team chat as on the web.', feature: 'team_chat', customFieldEntity: null, records: false, permission: null },
  { key: 'notifications', label: 'Notifications', description: 'In-app and push notifications.', feature: 'notifications', customFieldEntity: null, records: false, permission: null },
  { key: 'profile', label: 'Profile', description: 'The person’s own profile and photo.', feature: null, customFieldEntity: null, records: false, permission: null, required: true },
];
export const MOBILE_MODULE_BY_KEY = Object.fromEntries(MOBILE_MODULE_DEFS.map((m) => [m.key, m])) as Record<MobileModuleKey, MobileModuleDef>;

/** Record modules, the ones with fields. */
export type MobileRecordModule = 'companies' | 'contacts' | 'follow_ups' | 'tasks' | 'deals';
export const MOBILE_RECORD_MODULES: MobileRecordModule[] = ['companies', 'contacts', 'follow_ups', 'tasks', 'deals'];

export interface MobileFieldDef {
  key: string;
  label: string;
  /** Always shown: the record makes no sense without it (a lead's name). Can still be read only. */
  required?: boolean;
  /** Never editable on the phone (numbers, dates the server sets). */
  readOnly?: boolean;
  /** Sensitive by default: off for Executives until the Super Workspace switches it on. */
  sensitive?: boolean;
}

/** The built-in fields of each record module, by their names in the API. Custom fields are added as `cf.<key>`. */
export const MOBILE_FIELDS: Record<MobileRecordModule, MobileFieldDef[]> = {
  companies: [
    { key: 'name', label: 'Company name', required: true },
    { key: 'leadNumber', label: 'Lead number', readOnly: true },
    { key: 'status', label: 'Lead status' },
    { key: 'owner', label: 'Assigned to' },
    { key: 'primaryEmail', label: 'Email address' },
    { key: 'primaryPhone', label: 'Phone number' },
    { key: 'website', label: 'Website' },
    { key: 'industry', label: 'Industry' },
    { key: 'country', label: 'Country' },
    { key: 'city', label: 'City' },
    { key: 'address', label: 'Address' },
    { key: 'companySize', label: 'Company size' },
    { key: 'nextFollowUpAt', label: 'Next follow-up', readOnly: true },
    { key: 'notes', label: 'Notes' },
    { key: 'createdAt', label: 'Created', readOnly: true },
  ],
  contacts: [
    { key: 'firstName', label: 'First name', required: true },
    { key: 'lastName', label: 'Last name' },
    { key: 'jobTitle', label: 'Job title' },
    { key: 'company', label: 'Company' },
    { key: 'email', label: 'Email address' },
    { key: 'phone', label: 'Phone number' },
    { key: 'department', label: 'Department' },
    { key: 'city', label: 'City' },
    { key: 'owner', label: 'Assigned to' },
    { key: 'nextFollowUpAt', label: 'Next follow-up' },
    { key: 'remarks', label: 'Remarks' },
  ],
  follow_ups: [
    { key: 'title', label: 'Follow-up', required: true },
    { key: 'dueAt', label: 'Follow-up date' },
    { key: 'followUpType', label: 'Type' },
    { key: 'company', label: 'Company' },
    { key: 'contact', label: 'Contact' },
    { key: 'assignee', label: 'Assigned to' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'outcome', label: 'Outcome' },
    { key: 'remarks', label: 'Remarks' },
  ],
  tasks: [
    { key: 'title', label: 'Task', required: true },
    { key: 'description', label: 'Description' },
    { key: 'dueAt', label: 'Due date' },
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'assignee', label: 'Assigned to' },
    { key: 'company', label: 'Company' },
  ],
  deals: [
    { key: 'name', label: 'Deal name', required: true },
    { key: 'dealNumber', label: 'Deal number', readOnly: true },
    { key: 'stage', label: 'Stage' },
    { key: 'amount', label: 'Amount', sensitive: true },
    { key: 'probability', label: 'Probability' },
    { key: 'expectedCloseDate', label: 'Expected close date' },
    { key: 'company', label: 'Company' },
    { key: 'owner', label: 'Owner' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
  ],
};

/** What a level may do with one field. View is the floor: editing, setting or clearing a field you cannot see is refused. */
export const fieldRuleSchema = z.object({ view: z.boolean(), edit: z.boolean(), create: z.boolean(), delete: z.boolean() }).strict();
export type FieldRule = z.infer<typeof fieldRuleSchema>;

/** Record actions on the phone, per module and level. */
export const recordRuleSchema = z.object({ view: z.boolean(), create: z.boolean(), edit: z.boolean(), delete: z.boolean() }).strict();
export type RecordRule = z.infer<typeof recordRuleSchema>;

export const MOBILE_DASHBOARD_CARDS = [
  'todays_target',
  'leads_today',
  'pending_follow_ups',
  'my_tasks',
  'personal_performance',
  'team_performance',
  'executive_ranking',
  'team_tasks',
  'organisation_performance',
  'workspace_performance',
  'targets_achievement',
  'pipeline_summary',
  'announcements',
] as const;
export type MobileDashboardCard = (typeof MOBILE_DASHBOARD_CARDS)[number];

export const MOBILE_DASHBOARD_CARD_DEFS: Record<MobileDashboardCard, { label: string; description: string; levels: MobileWorkspaceLevel[]; module: MobileModuleKey }> = {
  todays_target: { label: 'Today’s target', description: 'Leads to generate today and progress so far.', levels: ['EXECUTIVE', 'MANAGER'], module: 'targets' },
  leads_today: { label: 'Leads today', description: 'Leads created today.', levels: ['EXECUTIVE', 'MANAGER', 'SUPER'], module: 'companies' },
  pending_follow_ups: { label: 'Pending follow-ups', description: 'Follow-ups due today and overdue.', levels: ['EXECUTIVE', 'MANAGER'], module: 'follow_ups' },
  my_tasks: { label: 'My tasks', description: 'Open tasks assigned to me.', levels: ['EXECUTIVE', 'MANAGER', 'SUPER'], module: 'tasks' },
  personal_performance: { label: 'My performance', description: 'Leads, calls and won deals this month.', levels: ['EXECUTIVE'], module: 'dashboard' },
  team_performance: { label: 'Team performance', description: 'The team’s leads, follow-ups and wins.', levels: ['MANAGER'], module: 'dashboard' },
  executive_ranking: { label: 'Executive ranking', description: 'Executives ranked by achievement.', levels: ['MANAGER', 'SUPER'], module: 'dashboard' },
  team_tasks: { label: 'Team tasks', description: 'Open and overdue tasks of the team.', levels: ['MANAGER', 'SUPER'], module: 'tasks' },
  organisation_performance: { label: 'Organisation performance', description: 'Sales across the organisation.', levels: ['SUPER'], module: 'dashboard' },
  workspace_performance: { label: 'Manager and executive performance', description: 'Each workspace’s results side by side.', levels: ['SUPER'], module: 'dashboard' },
  targets_achievement: { label: 'Targets and achievement', description: 'Targets set and how much is achieved.', levels: ['SUPER', 'MANAGER'], module: 'targets' },
  pipeline_summary: { label: 'Pipeline', description: 'Open deals by stage.', levels: ['SUPER', 'MANAGER', 'EXECUTIVE'], module: 'deals' },
  announcements: { label: 'Announcements', description: 'Important notices from the organisation.', levels: ['SUPER', 'MANAGER', 'EXECUTIVE'], module: 'notifications' },
};

export const MOBILE_NOTIFICATION_TYPES = ['task_assigned', 'task_due_soon', 'task_overdue', 'chat_message', 'lead_assigned', 'follow_up_reminder', 'target_update', 'announcement', 'account_status'] as const;
export type MobileNotificationType = (typeof MOBILE_NOTIFICATION_TYPES)[number];

/** Things the phone can do with a record beyond editing it. */
export const MOBILE_PHONE_ACTIONS = ['call', 'email', 'whatsapp', 'directions', 'share'] as const;
export type MobilePhoneAction = (typeof MOBILE_PHONE_ACTIONS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #00D9FF');
const levelRecord = <T extends z.ZodTypeAny>(item: T) => z.object({ SUPER: item, MANAGER: item, EXECUTIVE: item }).strict();

/** A logo is kept as a small data URL with the configuration, so a published version carries the logo it had. */
export const MOBILE_LOGO_MAX_CHARS = 400_000;
export const mobileLogoSchema = z
  .string()
  .max(MOBILE_LOGO_MAX_CHARS, 'The logo is too large. Use an image under 250 KB.')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG, JPEG or WebP image.');

export const mobileBrandingSchema = z
  .object({
    appName: z.string().trim().min(2, 'Use 2 to 30 characters for the app name.').max(30, 'Use 2 to 30 characters for the app name.'),
    primaryColor: hex,
    accentColor: hex,
    theme: z.enum(['system', 'light', 'dark']),
    /** null shows the organisation's initials. */
    logoDataUrl: mobileLogoSchema.nullable(),
  })
  .strict();

const moduleSettingSchema = z.object({ enabled: z.boolean(), levels: levelRecord(recordRuleSchema) }).strict();
const fieldKeySchema = z.string().regex(/^(cf\.)?[A-Za-z][A-Za-z0-9_]{0,60}$/, 'Use a field from the list.');

/**
 * What the Super Workspace edits. Anything left out falls back to the defaults (`normalizeMobileConfig`), so an older
 * saved configuration keeps working when a module or field is added.
 */
export const mobileAppConfigSchema = z
  .object({
    branding: mobileBrandingSchema,
    modules: z.record(z.enum(MOBILE_MODULES), moduleSettingSchema),
    /** module -> field key (built in, or `cf.<key>` for a custom field) -> level -> rule. */
    fields: z.record(z.enum(['companies', 'contacts', 'follow_ups', 'tasks', 'deals']), z.record(fieldKeySchema, levelRecord(fieldRuleSchema))),
    /** Dashboard cards per level, in the order shown. A card that is not listed is off. */
    dashboard: levelRecord(z.array(z.object({ card: z.enum(MOBILE_DASHBOARD_CARDS), showChart: z.boolean() }).strict()).max(MOBILE_DASHBOARD_CARDS.length)),
    /** Bottom tabs per level, in order (up to 5). Every other module the person can use goes under More. */
    navigation: levelRecord(z.array(z.enum(MOBILE_MODULES)).max(5, 'Choose up to 5 tabs.')),
    chat: z.object({ enabled: z.boolean() }).strict(),
    notifications: z.object({ enabled: z.boolean(), types: z.record(z.enum(MOBILE_NOTIFICATION_TYPES), z.boolean()) }).strict(),
    profilePictures: z.object({ visible: z.boolean() }).strict(),
    phoneActions: levelRecord(z.array(z.enum(MOBILE_PHONE_ACTIONS)).max(MOBILE_PHONE_ACTIONS.length)),
  })
  .strict();
export type MobileAppConfigInput = z.infer<typeof mobileAppConfigSchema>;

/** A configuration with every module, field, level and type filled in. */
export interface MobileAppConfig {
  branding: z.infer<typeof mobileBrandingSchema>;
  modules: Record<MobileModuleKey, { enabled: boolean; levels: Record<MobileWorkspaceLevel, RecordRule> }>;
  fields: Record<MobileRecordModule, Record<string, Record<MobileWorkspaceLevel, FieldRule>>>;
  dashboard: Record<MobileWorkspaceLevel, { card: MobileDashboardCard; showChart: boolean }[]>;
  navigation: Record<MobileWorkspaceLevel, MobileModuleKey[]>;
  chat: { enabled: boolean };
  notifications: { enabled: boolean; types: Record<MobileNotificationType, boolean> };
  profilePictures: { visible: boolean };
  phoneActions: Record<MobileWorkspaceLevel, MobilePhoneAction[]>;
}

export const mobilePublishSchema = z.object({ note: z.string().trim().max(200).optional() }).strict();
export const mobileRollbackSchema = z.object({ version: z.number().int().min(1) }).strict();

const ALL = <T>(v: T): Record<MobileWorkspaceLevel, T> => ({ SUPER: v, MANAGER: v, EXECUTIVE: v });

function defaultRecordRule(level: MobileWorkspaceLevel, records: boolean): RecordRule {
  if (!records) return { view: true, create: false, edit: false, delete: false };
  return { view: true, create: true, edit: true, delete: level === 'SUPER' };
}

/** The built-in rule for a field: everything a level may do with the record, sensitive fields hidden from Executives. */
export function defaultFieldRule(def: MobileFieldDef | undefined, level: MobileWorkspaceLevel): FieldRule {
  const view = !(def?.sensitive && level === 'EXECUTIVE');
  const change = view && !def?.readOnly;
  return { view, edit: change, create: change, delete: change && !def?.required };
}

const DEFAULT_TABS: Record<MobileWorkspaceLevel, MobileModuleKey[]> = {
  SUPER: ['dashboard', 'companies', 'deals', 'chat', 'profile'],
  MANAGER: ['dashboard', 'companies', 'tasks', 'chat', 'profile'],
  EXECUTIVE: ['dashboard', 'companies', 'follow_ups', 'tasks', 'profile'],
};

/** The layout phones use until the Super Workspace publishes its own. */
export function defaultMobileConfig(): MobileAppConfig {
  return normalizeMobileConfig({
    branding: { appName: 'SampForce', primaryColor: '#0EA5E9', accentColor: '#7C3AED', theme: 'system', logoDataUrl: null },
    modules: {},
    fields: {},
    dashboard: Object.fromEntries(MOBILE_LEVELS.map((l) => [l, MOBILE_DASHBOARD_CARDS.filter((c) => MOBILE_DASHBOARD_CARD_DEFS[c].levels.includes(l)).map((card) => ({ card, showChart: true }))])) as MobileAppConfigInput['dashboard'],
    navigation: DEFAULT_TABS,
    chat: { enabled: true },
    notifications: { enabled: true, types: {} },
    profilePictures: { visible: true },
    phoneActions: ALL([...MOBILE_PHONE_ACTIONS]),
  });
}

/**
 * Fills in what is missing and makes the rules consistent, the same way on the web and the API:
 * - required modules stay on, and every level can at least view them;
 * - a level cannot create, edit or delete records it cannot view, and modules without records only show;
 * - view is the floor for a field: no editing, setting or clearing a field the level cannot see;
 * - read-only fields can never be changed on the phone, required fields are always shown and never cleared;
 * - dashboard cards are kept only for levels they suit, once each; tabs only for enabled modules, once each.
 */
export function normalizeMobileConfig(input: MobileAppConfigInput): MobileAppConfig {
  const modules = {} as MobileAppConfig['modules'];
  for (const def of MOBILE_MODULE_DEFS) {
    const given = input.modules[def.key];
    const levels = {} as Record<MobileWorkspaceLevel, RecordRule>;
    for (const level of MOBILE_LEVELS) {
      const r = given?.levels[level] ?? defaultRecordRule(level, def.records);
      const view = def.required ? true : r.view;
      levels[level] = { view, create: def.records && view && r.create, edit: def.records && view && r.edit, delete: def.records && view && r.delete };
    }
    modules[def.key] = { enabled: def.required ? true : (given?.enabled ?? true), levels };
  }

  const fields = {} as MobileAppConfig['fields'];
  for (const module of MOBILE_RECORD_MODULES) {
    const given = input.fields[module] ?? {};
    const out: Record<string, Record<MobileWorkspaceLevel, FieldRule>> = {};
    const builtIn = MOBILE_FIELDS[module];
    const keys = [...builtIn.map((f) => f.key), ...Object.keys(given).filter((k) => k.startsWith('cf.'))];
    for (const key of keys) {
      const def = builtIn.find((f) => f.key === key);
      const perLevel = {} as Record<MobileWorkspaceLevel, FieldRule>;
      for (const level of MOBILE_LEVELS) {
        const r = given[key]?.[level] ?? defaultFieldRule(def, level);
        const view = def?.required ? true : r.view;
        const change = view && !def?.readOnly;
        perLevel[level] = { view, edit: change && r.edit, create: change && r.create, delete: change && !def?.required && r.delete };
      }
      out[key] = perLevel;
    }
    fields[module] = out;
  }

  const dashboard = {} as MobileAppConfig['dashboard'];
  const navigation = {} as MobileAppConfig['navigation'];
  const phoneActions = {} as MobileAppConfig['phoneActions'];
  for (const level of MOBILE_LEVELS) {
    const seen = new Set<MobileDashboardCard>();
    dashboard[level] = input.dashboard[level].filter((c) => MOBILE_DASHBOARD_CARD_DEFS[c.card].levels.includes(level) && !seen.has(c.card) && seen.add(c.card));
    navigation[level] = [...new Set(input.navigation[level])].filter((m) => modules[m].enabled && modules[m].levels[level].view).slice(0, 5);
    phoneActions[level] = [...new Set(input.phoneActions[level])];
  }

  const types = Object.fromEntries(MOBILE_NOTIFICATION_TYPES.map((t) => [t, input.notifications.types[t] ?? true])) as Record<MobileNotificationType, boolean>;
  return {
    branding: input.branding,
    modules,
    fields,
    dashboard,
    navigation,
    chat: { enabled: modules.chat.enabled && input.chat.enabled },
    notifications: { enabled: input.notifications.enabled, types },
    profilePictures: input.profilePictures,
    phoneActions,
  };
}

/** One module as the signed-in person may use it on the phone. */
export interface MobileResolvedModule {
  key: MobileModuleKey;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

/** The configuration for one person: only what their level, plan and role allow. The phone draws exactly this. */
export interface MobileResolvedConfig {
  level: MobileWorkspaceLevel;
  branding: MobileAppConfig['branding'];
  modules: MobileResolvedModule[];
  /** Only the fields the person may see; each says what they may do with it. */
  fields: Partial<Record<MobileRecordModule, Record<string, Omit<FieldRule, 'view'>>>>;
  dashboard: { card: MobileDashboardCard; showChart: boolean }[];
  tabs: MobileModuleKey[];
  more: MobileModuleKey[];
  chat: { enabled: boolean };
  notifications: { enabled: boolean; types: MobileNotificationType[] };
  profilePictures: { visible: boolean };
  phoneActions: MobilePhoneAction[];
}

export interface MobileAccessContext {
  level: MobileWorkspaceLevel;
  /** Effective features of the person's workspace (the plan, narrowed down the hierarchy, ADR 0071). */
  features: readonly string[];
  /** The workspace's action grants (ADR 0071). Left out by the web preview, which shows the configuration alone. */
  actions?: ActionGrants;
  /** The person's role permissions. */
  permissions: readonly string[];
}

/** Black or white, whichever reads better on a branding colour (WCAG relative luminance). Web preview and app share it. */
export function readableTextOn(hex: string): '#FFFFFF' | '#000000' {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
}

/** Narrows a configuration to one person. Used by the API for the phone and by the web for the preview. */
export function resolveMobileConfig(config: MobileAppConfig, who: MobileAccessContext): MobileResolvedConfig {
  const { level } = who;
  const features = new Set(who.features);
  const perms = new Set(who.permissions);
  const modules: MobileResolvedModule[] = [];
  for (const def of MOBILE_MODULE_DEFS) {
    const m = config.modules[def.key];
    const rule = m.levels[level];
    if (!m.enabled || !rule.view) continue;
    if (def.feature && !features.has(def.feature)) continue;
    if (def.permission && !perms.has(def.permission.read)) continue;
    const granted = (action: WorkspaceAction) => !who.actions || !def.feature || actionAllowed(who.actions, def.feature as FeatureKey, action);
    if (!granted('view')) continue;
    const write = !def.permission || perms.has(def.permission.write);
    modules.push({ key: def.key, create: write && rule.create && granted('create'), edit: write && rule.edit && granted('edit'), delete: write && rule.delete && granted('delete') });
  }
  const open = new Map(modules.map((m) => [m.key, m]));
  const fields: MobileResolvedConfig['fields'] = {};
  for (const module of MOBILE_RECORD_MODULES) {
    const m = open.get(module);
    if (!m) continue;
    const out: Record<string, Omit<FieldRule, 'view'>> = {};
    for (const [key, rules] of Object.entries(config.fields[module])) {
      const r = rules[level];
      if (r.view) out[key] = { edit: m.edit && r.edit, create: m.create && r.create, delete: m.edit && r.delete };
    }
    fields[module] = out;
  }
  const tabs = config.navigation[level].filter((k) => open.has(k));
  return {
    level,
    branding: config.branding,
    modules,
    fields,
    dashboard: config.dashboard[level].filter((c) => open.has(MOBILE_DASHBOARD_CARD_DEFS[c.card].module)),
    tabs,
    more: modules.map((m) => m.key).filter((k) => !tabs.includes(k)),
    chat: { enabled: config.chat.enabled && open.has('chat') },
    notifications: { enabled: config.notifications.enabled, types: config.notifications.enabled ? MOBILE_NOTIFICATION_TYPES.filter((t) => config.notifications.types[t]) : [] },
    profilePictures: config.profilePictures,
    phoneActions: config.phoneActions[level],
  };
}

/** A published version, as the Configuration Center lists it. */
export interface MobileConfigVersionRow {
  version: number;
  publishedAt: string;
  publishedBy: string | null;
  note: string | null;
  /** The older version this one put back, for a rollback. */
  restoredFrom: number | null;
}

/** Everything the Super Workspace's Configuration Center needs. */
export interface MobileConfigCenter {
  draft: MobileAppConfig;
  draftUpdatedAt: string | null;
  draftUpdatedBy: string | null;
  /** The draft differs from the published version (or nothing is published yet). */
  unpublishedChanges: boolean;
  published: MobileConfigVersionRow | null;
  versions: MobileConfigVersionRow[];
  /** Custom fields that can be shown on the phone, per module. */
  customFields: Partial<Record<MobileRecordModule, { key: string; label: string }[]>>;
  /** The plan's features, so the screen can say which modules the plan leaves out. */
  features: string[];
}

/** What the phone gets from GET /mobile/config. `unchanged` when it already has this version. */
export interface MobileConfigResponse {
  version: number;
  unchanged: boolean;
  config: MobileResolvedConfig | null;
}
