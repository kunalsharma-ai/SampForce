'use client';

import { FEATURE_BY_KEY, type FeatureKey, featureForPath } from '@dealflow/types';
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

export const featureLabel = (f: FeatureKey) => FEATURE_BY_KEY[f].label;

/** True for an API error that says the plan does not include something, so a widget can show the upgrade hint. */
export function isPlanRefusal(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'FEATURE_NOT_IN_PLAN';
}
