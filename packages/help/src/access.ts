import { type FeatureKey, featureForPath, type LanguageCode, type Permission, type WorkspaceLevel } from '@dealflow/types';
import { type HelpAudience, HELP_CATEGORIES, type HelpCategory, type HelpCategoryId } from './categories';
import { CONSOLE_FAQS, HELP_FAQS, type HelpFaq } from './faqs';
import { HELP_TOPICS, type HelpId, PAGE_HELP, helpText } from './topics';
import type { HelpTopic } from './types';

/** Who is reading the Help Center: decides which questions and guides they see. */
export interface HelpReader {
  audience: HelpAudience;
  /** Features the reader's workspace may use now (plan narrowed by the hierarchy). Ignored for the console. */
  features?: readonly FeatureKey[];
  level?: WorkspaceLevel | null;
  permissions?: readonly string[];
}

/** Which category each page's guide belongs to. A page left out here never appears in the guide (see HIDDEN_GUIDES). */
export const GUIDE_CATEGORY: Readonly<Partial<Record<HelpId, HelpCategoryId>>> = {
  'page.commandCenter': 'start',
  'page.help': 'start',
  'page.notifications': 'start',
  'page.accountSecurity': 'account',
  'page.themeStudio': 'account',
  'page.workspaces': 'workspaces',
  'page.mobileAccess': 'mobile',
  'page.announcements': 'workspaces',
  'page.mobileConfiguration': 'mobile',
  'page.team': 'workspaces',
  'page.administration': 'workspaces',
  'page.workspaceSecurity': 'workspaces',
  'page.leads': 'crm',
  'page.leadRecord': 'crm',
  'page.newCompanyLead': 'crm',
  'page.contacts': 'crm',
  'page.contactRecord': 'crm',
  'page.companies': 'crm',
  'page.companyRecord': 'crm',
  'page.accounts': 'crm',
  'page.deals': 'deals',
  'page.dealRecord': 'deals',
  'page.dealHealth': 'deals',
  'page.pipelines': 'deals',
  'page.pipelineJourney': 'deals',
  'page.rfqs': 'deals',
  'page.activities': 'work',
  'page.followUps': 'work',
  'page.calls': 'work',
  'page.tasks': 'work',
  'page.targets': 'work',
  'page.teamStatus': 'work',
  'page.approvals': 'work',
  'page.meetings': 'work',
  'page.meetingRecord': 'work',
  'page.communication': 'communication',
  'page.chat': 'communication',
  'page.sequences': 'outreach',
  'page.sequenceEditor': 'outreach',
  'page.finder': 'outreach',
  'page.prospects': 'outreach',
  'page.prospectList': 'outreach',
  'page.websiteVisitors': 'outreach',
  'page.marketing': 'outreach',
  'page.campaigns': 'outreach',
  'page.quotes': 'documents',
  'page.quoteEditor': 'documents',
  'page.quickBid': 'documents',
  'page.bidTemplates': 'documents',
  'page.contracts': 'documents',
  'page.contractRecord': 'documents',
  'page.agents': 'ai',
  'page.automation': 'ai',
  'page.workflowEditor': 'ai',
  'page.reports': 'insights',
  'page.reportEditor': 'insights',
  'page.dashboards': 'insights',
  'page.dashboard': 'insights',
  'page.pipelineFlow': 'insights',
  'page.galaxy': 'insights',
  'page.globe': 'insights',
  'page.replay': 'insights',
  'page.forecasting': 'insights',
  'page.revenue': 'insights',
  'page.gamification': 'insights',
  'page.portal': 'customers',
  'page.customerSuccess': 'customers',
  'page.integrations': 'apps',
  'page.settings': 'data',
  'page.customFields': 'data',
  'page.import': 'data',
  'page.territories': 'data',
  'page.crmConfiguration': 'data',
  'page.billing': 'billing',
  'page.helpQueries': 'support',
  // Console
  'page.consoleOverview': 'console-clients',
  'page.operatorWorkspaces': 'console-clients',
  'page.consoleClient': 'console-clients',
  'page.operatorWorkspace': 'console-clients',
  'page.operatorMobile': 'console-clients',
  'page.operatorPlans': 'console-plans',
  'page.operatorWorkspaceRules': 'console-plans',
  'page.operatorWorkspaceManagement': 'console-clients',
  'page.operatorProviders': 'console-providers',
  'page.operatorSettings': 'console-providers',
  'page.operatorLocations': 'console-providers',
  'page.operatorChat': 'console-support',
  'page.operatorSupport': 'console-support',
  'page.operatorHelp': 'console-support',
  'page.operatorHelpManage': 'console-support',
  'page.operatorAudit': 'console-security',
  'page.operatorNotifications': 'console-support',
  'page.operatorOperators': 'console-security',
  'page.operatorRoles': 'console-security',
  'page.operatorAccount': 'console-security',
  'page.operatorSecurity': 'console-security',
};

/** Pages with help but no guide entry: the Marketplace has not shipped, so the guide must not promise it. */
export const HIDDEN_GUIDES: readonly HelpId[] = ['page.marketplace'];

/**
 * Pages that need more than their plan feature: a permission the page itself checks, or a workspace level. A reader
 * who cannot open the page does not get its guide either.
 */
const GUIDE_RULES: Readonly<Partial<Record<HelpId, { permission?: Permission; levels?: readonly WorkspaceLevel[]; feature?: FeatureKey }>>> = {
  'page.workspaces': { levels: ['SUPER', 'MANAGER'] },
  'page.team': { permission: 'members:read' },
  'page.administration': { permission: 'audit:read' },
  'page.workspaceSecurity': { permission: 'tenant:manage' },
  'page.mobileAccess': { permission: 'tenant:manage', levels: ['SUPER'], feature: 'mobile_app' },
  'page.mobileConfiguration': { permission: 'tenant:manage', levels: ['SUPER'], feature: 'mobile_app' },
  'page.integrations': { permission: 'integrations:manage' },
  'page.billing': { permission: 'billing:read' },
  'page.customFields': { permission: 'tenant:manage' },
  'page.crmConfiguration': { permission: 'crm:configure' },
  'page.import': { feature: 'data_import' },
  'page.pipelines': { permission: 'pipelines:read' },
  'page.pipelineJourney': { permission: 'companies:read' },
  'page.agents': { permission: 'ai:use', feature: 'ai_assistant' },
  'page.automation': { permission: 'automation:manage' },
  'page.workflowEditor': { permission: 'automation:manage' },
  'page.reports': { permission: 'reports:read' },
  'page.reportEditor': { permission: 'reports:read' },
  'page.dashboards': { permission: 'reports:read' },
  'page.dashboard': { permission: 'reports:read' },
  'page.contracts': { permission: 'contracts:read' },
  'page.contractRecord': { permission: 'contracts:read' },
  'page.campaigns': { permission: 'marketing:read' },
  'page.prospects': { permission: 'prospects:read' },
  'page.prospectList': { permission: 'prospects:read' },
};

/** The routes each page topic explains (`page.dealRecord` → `/app/deals/[id]`). */
const ROUTES_OF = new Map<HelpId, string[]>();
for (const [route, id] of Object.entries(PAGE_HELP)) ROUTES_OF.set(id, [...(ROUTES_OF.get(id) ?? []), route]);

/** The page's first route with a fixed address, for an "Open page" link. */
export function guideHref(id: HelpId): string | undefined {
  return ROUTES_OF.get(id)?.find((r) => !r.includes('['));
}

/** The plan feature a page belongs to, worked out from the same paths the API uses to lock pages. */
export function guideFeature(id: HelpId): FeatureKey | null {
  const rule = GUIDE_RULES[id]?.feature;
  if (rule) return rule;
  for (const route of ROUTES_OF.get(id) ?? []) {
    const feature = featureForPath(route.replace(/\[[^\]]+\]/g, 'x'));
    if (feature) return feature;
  }
  return null;
}

function allowed(reader: HelpReader, rule: { feature?: FeatureKey | null; permission?: Permission; levels?: readonly WorkspaceLevel[] }): boolean {
  if (reader.audience === 'console') return true;
  if (rule.feature && reader.features && !reader.features.includes(rule.feature)) return false;
  if (rule.permission && reader.permissions && !reader.permissions.includes(rule.permission)) return false;
  // No level means the Super Workspace (organisations that have not set up a hierarchy).
  if (rule.levels && !rule.levels.includes(reader.level ?? 'SUPER')) return false;
  return true;
}

export interface HelpGuide {
  id: HelpId;
  category: HelpCategoryId;
  href?: string;
  topic: HelpTopic;
  /** Sections and settings on the page, explained by the same "i" buttons. */
  sections: { id: HelpId; topic: HelpTopic }[];
}

/** Which page a section topic belongs to, by the prefix of its id (`quote.lines` → the quote page). */
const SECTION_PAGES: Readonly<Record<string, HelpId[]>> = {
  commandCenter: ['page.commandCenter'],
  record: ['page.leadRecord', 'page.contactRecord', 'page.companyRecord', 'page.dealRecord'],
  lead: ['page.leadRecord'],
  deal: ['page.dealRecord'],
  deals: ['page.deals'],
  activities: ['page.activities'],
  sequences: ['page.sequenceEditor'],
  prospects: ['page.prospectList'],
  visitors: ['page.websiteVisitors'],
  marketing: ['page.marketing'],
  quotes: ['page.quotes'],
  quote: ['page.quoteEditor'],
  contract: ['page.contractRecord'],
  revenue: ['page.revenue'],
  agents: ['page.agents'],
  automation: ['page.workflowEditor'],
  forecasting: ['page.forecasting'],
  reports: ['page.reports'],
  gamification: ['page.gamification'],
  team: ['page.team'],
  integrations: ['page.integrations'],
  billing: ['page.billing'],
  settings: ['page.settings'],
  theme: ['page.themeStudio'],
  admin: ['page.administration'],
  security: ['page.workspaceSecurity'],
  account: ['page.accountSecurity'],
};

/** Every guide entry once, in category order, with the sections of each page. */
export function allGuides(): HelpGuide[] {
  const pages = new Map<HelpId, HelpGuide>();
  for (const cat of HELP_CATEGORIES)
    for (const [id, c] of Object.entries(GUIDE_CATEGORY) as [HelpId, HelpCategoryId][])
      if (c === cat.id && !HIDDEN_GUIDES.includes(id)) pages.set(id, { id, category: c, href: guideHref(id), topic: HELP_TOPICS[id], sections: [] });
  for (const id of Object.keys(HELP_TOPICS) as HelpId[]) {
    if (id.startsWith('page.')) continue;
    for (const page of SECTION_PAGES[id.split('.')[0]!] ?? []) pages.get(page)?.sections.push({ id, topic: HELP_TOPICS[id] });
  }
  return [...pages.values()];
}

const audienceOf = (c: HelpCategoryId): HelpAudience => HELP_CATEGORIES.find((x) => x.id === c)!.audience;

/** The guides this reader can use: their audience, their plan's features, their level and their role. */
export function guidesFor(reader: HelpReader): HelpGuide[] {
  return allGuides().filter((g) => audienceOf(g.category) === reader.audience && allowed(reader, { ...GUIDE_RULES[g.id], feature: guideFeature(g.id) }));
}

/** What a page needs: its plan feature, a role permission and the workspace levels that use it (none = everyone). */
export function guideRequirements(id: HelpId): { feature: FeatureKey | null; permission: Permission | null; levels: readonly WorkspaceLevel[] | null } {
  const rule = GUIDE_RULES[id];
  return { feature: rule?.feature ?? guideFeature(id), permission: rule?.permission ?? null, levels: rule?.levels ?? null };
}

/** Why a reader cannot use a page: their plan lacks the feature, their role the permission, or their workspace level. */
export interface RestrictedGuide {
  guide: HelpGuide;
  reason: 'feature' | 'permission' | 'level';
  feature?: FeatureKey;
  permission?: Permission;
}

/**
 * The pages this reader cannot use, with the reason, so Help can explain why and who can grant it instead of
 * pretending the feature does not exist. The first rule that fails is the reason, plan first.
 */
export function restrictedGuides(reader: HelpReader): RestrictedGuide[] {
  if (reader.audience === 'console') return [];
  const out: RestrictedGuide[] = [];
  for (const g of allGuides()) {
    if (audienceOf(g.category) !== reader.audience) continue;
    const rule = { ...GUIDE_RULES[g.id], feature: guideFeature(g.id) ?? undefined };
    if (allowed(reader, rule)) continue;
    if (rule.feature && !allowed(reader, { feature: rule.feature })) out.push({ guide: g, reason: 'feature', feature: rule.feature });
    else if (rule.permission && !allowed(reader, { permission: rule.permission })) out.push({ guide: g, reason: 'permission', permission: rule.permission });
    else out.push({ guide: g, reason: 'level' });
  }
  return out;
}

/** The questions this reader can use, by the same rules. A question that links a guide also needs that guide. */
export function faqsFor(reader: HelpReader): HelpFaq[] {
  const list = reader.audience === 'console' ? CONSOLE_FAQS : HELP_FAQS;
  const guides = new Set(guidesFor(reader).map((g) => g.id));
  return list.filter((q) => allowed(reader, q) && (!q.guide || guides.has(q.guide) || !GUIDE_CATEGORY[q.guide]));
}

/** The categories with at least one question or guide for this reader, in display order. */
export function categoriesFor(reader: HelpReader, faqs = faqsFor(reader), guides = guidesFor(reader)): HelpCategory[] {
  const used = new Set<string>([...faqs.map((q) => q.category), ...guides.map((g) => g.category)]);
  return HELP_CATEGORIES.filter((c) => c.audience === reader.audience && used.has(c.id));
}

/** Lower case without accents, so "factur" finds "Facturación" and "e-mail" finds "email". */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ًͯ-ٟ]/g, '')
    .toLowerCase()
    .replace(/[-‐‑’'`]/g, '')
    .replace(/\s+/g, ' ');
}

export type HelpHit = { kind: 'faq'; faq: HelpFaq; score: number } | { kind: 'guide'; guide: HelpGuide; score: number };

/**
 * Searches questions and guides in the reader's language (English always matches too, so a German reader typing
 * "pipeline" still finds it). Every word must appear; words in a question or title count more than in an answer.
 * `title` translates a guide title, which lives in the web phrase tables.
 */
export function searchHelp(
  query: string,
  language: LanguageCode,
  items: { faqs: readonly HelpFaq[]; guides: readonly HelpGuide[] },
  title: (english: string) => string = (s) => s,
  options: { partial?: boolean } = {},
): HelpHit[] {
  const all = foldText(query).split(' ').filter((w) => w.length > 0);
  // A partial search (the suggestions under "Raise a query") reads a whole sentence, so it skips short words and
  // needs only half of the rest to match; the search box needs every word.
  const long = all.filter((w) => w.length >= 4);
  const words = options.partial && long.length ? long : all;
  if (words.length === 0) return [];
  const needed = options.partial ? Math.ceil(words.length / 2) : words.length;
  const score = (strong: string[], weak: string[]): number => {
    const s = foldText(strong.join(' '));
    const w = foldText(weak.join(' '));
    let total = 0;
    let matched = 0;
    for (const word of words) {
      if (s.includes(word)) total += 3;
      else if (w.includes(word)) total += 1;
      else if (!options.partial) return 0;
      else continue;
      matched += 1;
    }
    return matched >= needed ? total : 0;
  };
  const hits: HelpHit[] = [];
  for (const faq of items.faqs) {
    const s = score([helpText(faq.q, language), faq.q[0]], [helpText(faq.a, language), faq.a[0]]);
    if (s > 0) hits.push({ kind: 'faq', faq, score: s + 0.5 });
  }
  for (const guide of items.guides) {
    const parts = [guide.topic, ...guide.sections.map((x) => x.topic)];
    const s = score(
      [title(guide.topic.title), guide.topic.title, ...guide.sections.map((x) => title(x.topic.title))],
      parts.flatMap((t) => [helpText(t.what, language), helpText(t.how, language), helpText(t.where, language), t.what[0]]),
    );
    if (s > 0) hits.push({ kind: 'guide', guide, score: s });
  }
  return hits.sort((a, b) => b.score - a.score);
}
