'use client';

import { usePathname } from 'next/navigation';
import { actionAllowed, type ActionGrants, FEATURE_BY_KEY, type FeatureKey, featureForPath } from '@dealflow/types';
import { useSession } from './session';

/**
 * Plan features (ADR 0057). The API is the authority: it refuses anything outside the workspace's plan. The web app
 * reads the same list from the session so it can say so up front, with a lock in the menu and an upgrade page,
 * instead of showing a page that fails.
 */
export function useFeatures(): { ready: boolean; has: (f: FeatureKey) => boolean; features: FeatureKey[] } {
  const { data } = useSession();
  const list = data?.tenant.features ?? [];
  const set = new Set(list);
  // Until the session loads nothing is reported as locked, so pages never flash the upgrade page.
  return { ready: !!data, has: (f) => !data || set.has(f), features: list };
}

export function useHasFeature(feature: FeatureKey): boolean {
  return useFeatures().has(feature);
}

/** The feature a workspace page belongs to when the plan leaves it out, or null when the page can open. */
export function useLockedFeature(pathname: string): FeatureKey | null {
  const { has, ready } = useFeatures();
  const feature = featureForPath(pathname);
  return ready && feature && !has(feature) ? feature : null;
}

/**
 * Pages of a section the Console Admin switches on deliberately (opt-in features such as the Leads and Accounts pages,
 * ADR 0082). While off they are left out of the sidebar, search and shortcuts, not shown with a lock, so the menu holds
 * only what the organisation uses. Opening one by its address still says it is switched off.
 */
export function useSwitchedOff(): (href: string) => boolean {
  const { has, ready } = useFeatures();
  const { data } = useSession();
  // Sections the Console withholds from this workspace's level (R8, ADR 0092) are left out the same way.
  const consoleHidden = new Set(data?.workspace?.hiddenSections ?? []);
  const withheld = (f: FeatureKey): boolean => {
    for (let k: FeatureKey | undefined = f; k; k = FEATURE_BY_KEY[k]?.parent) if (consoleHidden.has(k)) return true;
    return false;
  };
  return (href) => {
    const f = featureForPath(href.split('?')[0]!);
    // Left out until the session loads too, so a switched-off section never flashes into the menu.
    return !!f && ((FEATURE_BY_KEY[f].optIn === true && (!ready || !has(f))) || withheld(f));
  };
}

/** Whether new inbound leads can be created from menus: only while the Leads page is switched on. */
export function useLeadsSectionOn(): boolean {
  return useFeatures().has('leads_section');
}

export const featureLabel = (f: FeatureKey) => FEATURE_BY_KEY[f].label;

/** True for an API error that says the plan does not include something, so a widget can show the upgrade hint. */
export function isPlanRefusal(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'FEATURE_NOT_IN_PLAN';
}

/** True when the organisation's plan has the feature but the caller's workspace was not given it (ADR 0071). */
export function useWithheldByWorkspace(feature: FeatureKey): boolean {
  const { data } = useSession();
  if (!data) return false;
  return data.tenant.planFeatures.includes(feature) && !data.tenant.features.includes(feature);
}

/**
 * Whether the caller's workspace may delete in a feature (workspace redesign W2). Delete is a permission the workspace
 * above turns on; it is off for every new Manager and Executive Workspace. Without a feature, the page's own feature is
 * used. Delete buttons are hidden where this is false; the API refuses the delete anyway.
 */
export function useCanDelete(feature?: FeatureKey | null): boolean {
  const { data } = useSession();
  const pathname = usePathname();
  if (!data) return false;
  const f = feature ?? featureForPath(pathname ?? '');
  const actions = data.workspace?.actions as ActionGrants | undefined;
  if (!f || !actions) return true;
  return actionAllowed(actions, f, 'delete');
}

/** The catalogue feature of each CRM list, the same mapping the API uses for its permissions. */
export const ENTITY_FEATURE: Record<'leads' | 'contacts' | 'companies' | 'deals', FeatureKey> = {
  leads: 'lead_management',
  contacts: 'contact_management',
  companies: 'account_management',
  deals: 'opportunity_management',
};
