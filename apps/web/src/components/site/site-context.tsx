'use client';

import { createContext, useContext } from 'react';
import type { SiteMode } from './site-theme';

export type PortalFace = 'sign-in' | 'start';

/** What the website's pieces share: the light or dark mode (for dialogs, which render outside the page) and the portal. */
export interface SiteContextValue {
  mode: SiteMode;
  openPortal: (face: PortalFace) => void;
  openHelp: () => void;
}

export const SiteContext = createContext<SiteContextValue>({ mode: 'dark', openPortal: () => undefined, openHelp: () => undefined });

export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}

/** Hash links that open the portal, so "Sign in" and "Start free" can be shared and bookmarked. */
export const PORTAL_HASH: Record<PortalFace, string> = { 'sign-in': '#sign-in', start: '#start' };

export function faceFromHash(hash: string): PortalFace | null {
  if (hash === PORTAL_HASH['sign-in']) return 'sign-in';
  if (hash === PORTAL_HASH.start) return 'start';
  return null;
}
