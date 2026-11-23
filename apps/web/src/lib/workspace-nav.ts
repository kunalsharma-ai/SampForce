'use client';

import { type NavigationState, type NavItem, type UpdateNavigationInput } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { type ModuleDef, MODULES } from './navigation';
import { useSession } from './session';

/** Pins and sidebar layout are per person and per workspace, so the key carries the workspace. */
export const navigationKey = (tenantId: string | undefined) => ['navigation', tenantId ?? 'none'] as const;

const EMPTY: NavigationState = { pinned: [], moduleOrder: [], hiddenModules: [] };

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

/** Modules in the person's order, with hidden ones removed. Modules they never placed keep the default order after. */
export function orderedModules(nav: Pick<NavigationState, 'moduleOrder' | 'hiddenModules'>, includeHidden = false): ModuleDef[] {
  const rank = new Map(nav.moduleOrder.map((s, i) => [s, i]));
  const hidden = new Set(nav.hiddenModules);
  return MODULES.map((m, i) => ({ m, i }))
    .filter(({ m }) => includeHidden || m.slug === 'settings' || !hidden.has(m.slug || 'home'))
    .sort((a, b) => (rank.get(a.m.slug || 'home') ?? 1000 + a.i) - (rank.get(b.m.slug || 'home') ?? 1000 + b.i))
    .map(({ m }) => m);
}
