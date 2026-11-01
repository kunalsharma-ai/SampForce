'use client';

import { type NavigationState, type NavItem, navKindForPath, type UpdateNavigationInput } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { api } from './api';
import { type ModuleDef, MODULES } from './navigation';
import { useSession } from './session';

/** Pins, recent pages and sidebar layout are per person and per workspace, so the key carries the workspace. */
export const navigationKey = (tenantId: string | undefined) => ['navigation', tenantId ?? 'none'] as const;

const EMPTY: NavigationState = { pinned: [], recent: [], moduleOrder: [], hiddenModules: [] };

export function useNavigation() {
  const { data: me } = useSession();
  const q = useQuery({
    queryKey: navigationKey(me?.tenant.id),
    queryFn: () => api<NavigationState>('/me/navigation'),
    enabled: !!me && !me.restriction,
    staleTime: 60_000,
  });
  return { ...q, nav: q.data ?? EMPTY };
}

export function useUpdateNavigation() {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const key = navigationKey(me?.tenant.id);
  return useMutation({
    mutationFn: (patch: UpdateNavigationInput) => api<NavigationState>('/me/navigation', { method: 'PATCH', json: patch }),
    // Optimistic, so a star or a reorder shows at once; the server answer replaces it.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NavigationState>(key);
      if (prev) qc.setQueryData<NavigationState>(key, { ...prev, ...patch } as NavigationState);
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSuccess: (data) => qc.setQueryData(key, data),
  });
}

/** Adds or removes a pin. Returns a function so callers can bind it to a button. */
export function useTogglePin() {
  const { nav } = useNavigation();
  const update = useUpdateNavigation();
  return {
    isPinned: (href: string) => nav.pinned.some((p) => p.href === href),
    toggle: (item: NavItem) => {
      const exists = nav.pinned.some((p) => p.href === item.href);
      update.mutate({ pinned: exists ? nav.pinned.filter((p) => p.href !== item.href) : [...nav.pinned, item] });
    },
    pending: update.isPending,
  };
}

export function useClearRecent() {
  const qc = useQueryClient();
  const { data: me } = useSession();
  return useMutation({
    mutationFn: () => api<NavigationState>('/me/navigation/visits', { method: 'DELETE' }),
    onSuccess: (data) => qc.setQueryData(navigationKey(me?.tenant.id), data),
  });
}

/** A readable label for the page: its first heading once it has rendered, else the document title. */
function pageLabel(): string | null {
  const h1 = document.querySelector('main h1')?.textContent?.trim();
  const title = document.title.replace(/\s*[·|–-]\s*DealFlow.*$/i, '').trim();
  const label = h1 || title;
  return label ? label.slice(0, 120) : null;
}

/** Records each page the person opens, after it has rendered, so "Recent" shows record names rather than ids. */
export function useRecordVisits(enabled: boolean) {
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: me } = useSession();
  useEffect(() => {
    if (!enabled || !pathname.startsWith('/app')) return;
    const t = setTimeout(() => {
      const label = pageLabel();
      if (!label) return;
      const item: NavItem = { href: pathname, label, kind: navKindForPath(pathname) };
      void api<NavigationState>('/me/navigation/visits', { method: 'POST', json: item })
        .then((data) => qc.setQueryData(navigationKey(me?.tenant.id), data))
        .catch(() => undefined); // History is a convenience; a failed write must never disturb the page.
    }, 1500);
    return () => clearTimeout(t);
  }, [enabled, pathname, qc, me?.tenant.id]);
}

/** Modules in the person's order, with hidden ones removed. Modules they never placed keep the default order after. */
export function orderedModules(nav: Pick<NavigationState, 'moduleOrder' | 'hiddenModules'>, includeHidden = false): ModuleDef[] {
  const rank = new Map(nav.moduleOrder.map((s, i) => [s, i]));
  const hidden = new Set(nav.hiddenModules);
  return MODULES.map((m, i) => ({ m, i }))
    .filter(({ m }) => includeHidden || m.slug === 'settings' || !hidden.has(m.slug || 'home'))
    .sort((a, b) => (rank.get(a.m.slug || 'home') ?? 1000 + a.i) - (rank.get(b.m.slug || 'home') ?? 1000 + b.i))
    .map(({ m }) => m);
}
