'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FieldEntity, hiddenKeysByEntity, type MeResponse, type Permission } from '@dealflow/types';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { api, ApiError } from './api';

export function useSession() {
  const router = useRouter();
  const query = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/auth/me') });
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) router.replace('/login');
  }, [query.error, router]);
  return query;
}

export function useCan(permission: Permission): boolean {
  const { data } = useSession();
  return !!data?.permissions.includes(permission);
}

/**
 * The properties of a record type the Console hides from this workspace's level (R8, ADR 0092). The server already
 * sends them empty and ignores changes; screens use this to leave the inputs out instead of showing blank ones.
 */
export function useHiddenKeys(entity: FieldEntity | null): Set<string> {
  const { data } = useSession();
  const hidden = data?.workspace?.hiddenFields;
  return useMemo(() => new Set(entity ? (hiddenKeysByEntity(hidden ?? [])[entity] ?? []) : []), [hidden, entity]);
}

export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
}

export function useSwitchTenant() {
  const qc = useQueryClient();
  return async (tenantId: string) => {
    await api('/auth/switch-tenant', { method: 'POST', json: { tenantId } });
    await qc.invalidateQueries();
  };
}

/** Converts #RRGGBB to the "H S% L%" triplet the design tokens use. */
export function hexToHslTriplet(hex: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => parseInt(v!, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
