import type { LanguageCode } from '@dealflow/types';
import { engageHelp } from './topics-engage';
import { intelligenceHelp } from './topics-intelligence';
import { organizationHelp } from './topics-organization';
import { revenueHelp } from './topics-revenue';
import type { HelpText, HelpTopic } from './types';
import { workspaceHelp } from './topics-workspace';

export type { HelpText, HelpTopic } from './types';

/** Every help topic, by id: `page.*` explains a whole screen, anything else a section or setting on one. */
export const HELP_TOPICS = { ...workspaceHelp, ...engageHelp, ...revenueHelp, ...intelligenceHelp, ...organizationHelp } as const;
export type HelpId = keyof typeof HELP_TOPICS;

/** The help topic tables by area, so a test can check no id is defined twice. */
export const HELP_TABLES = { workspaceHelp, engageHelp, revenueHelp, intelligenceHelp, organizationHelp } as const;

/**
 * Which page topic explains each route. Patterns use Next.js `[param]` segments; a static route wins over a
 * dynamic one at the same place (`/app/reports/new` over `/app/reports/[id]`).
 */
export const PAGE_HELP: Readonly<Record<string, HelpId>> = {
  '/app': 'page.commandCenter',
  '/app/leads': 'page.leads',
  '/app/leads/[id]': 'page.leadRecord',
  '/app/contacts': 'page.contacts',
  '/app/contacts/[id]': 'page.contactRecord',
  '/app/companies': 'page.companies',
  '/app/companies/[id]': 'page.companyRecord',
  '/app/accounts': 'page.accounts',
  '/app/deals': 'page.deals',
  '/app/deals/health': 'page.dealHealth',
  '/app/deals/[id]': 'page.dealRecord',
  '/app/pipelines': 'page.pipelines',
  '/app/activities': 'page.activities',
  '/app/communication': 'page.communication',
  '/app/sequences': 'page.sequences',
  '/app/sequences/[id]': 'page.sequenceEditor',
  '/app/finder': 'page.finder',
  '/app/prospects': 'page.prospects',
  '/app/prospects/[id]': 'page.prospectList',
  '/app/website-visitors': 'page.websiteVisitors',
  '/app/meetings': 'page.meetings',
  '/app/meetings/records/[id]': 'page.meetingRecord',
  '/app/marketing': 'page.marketing',
  '/app/campaigns': 'page.campaigns',
  '/app/agents': 'page.agents',
  '/app/automation': 'page.automation',
  '/app/automation/[id]': 'page.workflowEditor',
  '/app/approvals': 'page.approvals',
  '/app/quotes': 'page.quotes',
  '/app/quotes/quick': 'page.quickBid',
  '/app/quotes/templates': 'page.bidTemplates',
  '/app/quotes/[id]': 'page.quoteEditor',
  '/app/contracts': 'page.contracts',
  '/app/contracts/[id]': 'page.contractRecord',
  '/app/revenue': 'page.revenue',
  '/app/forecasting': 'page.forecasting',
  '/app/portal': 'page.portal',
  '/app/customer-success': 'page.customerSuccess',
  '/app/reports': 'page.reports',
  '/app/reports/new': 'page.reportEditor',
  '/app/reports/[id]': 'page.reportEditor',
  '/app/reports/dashboards': 'page.dashboards',
  '/app/reports/dashboards/[id]': 'page.dashboard',
  '/app/reports/flow': 'page.pipelineFlow',
  '/app/reports/galaxy': 'page.galaxy',
  '/app/reports/globe': 'page.globe',
  '/app/reports/replay': 'page.replay',
  '/app/gamification': 'page.gamification',
  '/app/team': 'page.team',
  '/app/integrations': 'page.integrations',
  '/app/billing': 'page.billing',
  '/app/settings': 'page.settings',
  '/app/settings/appearance': 'page.themeStudio',
  '/app/settings/custom-fields': 'page.customFields',
  '/app/settings/import': 'page.import',
  '/app/settings/territories': 'page.territories',
  '/app/administration': 'page.administration',
  '/app/administration/security': 'page.workspaceSecurity',
  '/app/account/security': 'page.accountSecurity',
  '/app/help': 'page.help',
  '/app/marketplace': 'page.marketplace',
  '/operator': 'page.operatorWorkspaces',
  '/operator/tenants/[id]': 'page.operatorWorkspace',
  '/operator/plans': 'page.operatorPlans',
  '/operator/providers': 'page.operatorProviders',
  '/operator/audit': 'page.operatorAudit',
  '/operator/settings': 'page.operatorSettings',
};

const ROUTES = Object.entries(PAGE_HELP)
  .map(([pattern, id]) => ({ id, parts: pattern.split('/').filter(Boolean), dynamic: pattern.includes('[') }))
  // Static patterns first, so `/app/reports/new` is tried before `/app/reports/[id]`.
  .sort((a, b) => Number(a.dynamic) - Number(b.dynamic));

/** The page topic for a pathname (`/app/deals/abc123` → `page.dealRecord`), or undefined for a page without one. */
export function helpForPath(pathname: string): HelpId | undefined {
  const parts = pathname.split('?')[0]!.split('/').filter(Boolean);
  return ROUTES.find((r) => r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith('[') || p === parts[i]))?.id;
}

const COLUMN: Record<LanguageCode, number> = { en: 0, es: 1, fr: 2, de: 3, ar: 4 };

/** One help sentence in the reader's language. */
export function helpText(text: HelpText, language: LanguageCode): string {
  return text[COLUMN[language]] ?? text[0];
}

export function helpTopic(id: HelpId): HelpTopic {
  return HELP_TOPICS[id];
}
