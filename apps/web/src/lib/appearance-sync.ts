'use client';

import type { Appearance, PreferencesResponse, SavedTheme, SavedThemeInput } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { usePreferences } from '@/stores/preferences';

export const PREFERENCES_KEY = ['me', 'preferences'] as const;
export const THEMES_KEY = ['me', 'themes'] as const;
const SAVE_DELAY_MS = 500;

export type SyncState = 'idle' | 'saving' | 'saved' | 'error';
let syncListeners: ((s: SyncState) => void)[] = [];
let syncState: SyncState = 'idle';
function setSync(s: SyncState) {
  syncState = s;
  syncListeners.forEach((l) => l(s));
}

/** Whether the latest appearance change reached the person's account. */
export function useSyncState(): SyncState {
  const [s, set] = useState(syncState);
  useEffect(() => {
    syncListeners.push(set);
    return () => {
      syncListeners = syncListeners.filter((l) => l !== set);
    };
  }, []);
  return s;
}

/**
 * Keeps the applied appearance and the person's account in step. On load the server's settings win, unless this
 * device has a change that has not been saved yet (for example made offline), which is then uploaded. Every later
 * change is saved shortly after it is made.
 */
export function useAppearanceSync(enabled: boolean, brandColor: string | null) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => api<PreferencesResponse>('/me/preferences'), enabled, staleTime: Infinity });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    usePreferences.getState().setBrandColor(brandColor);
  }, [brandColor]);

  useEffect(() => {
    if (!query.data || ready) return;
    const s = usePreferences.getState();
    if (!s.dirty) s.adopt(query.data.appearance);
    setReady(true);
  }, [query.data, ready]);

  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = async (appearance: Appearance) => {
      setSync('saving');
      try {
        const res = await api<PreferencesResponse>('/me/preferences/appearance', { method: 'PUT', json: appearance });
        qc.setQueryData(PREFERENCES_KEY, res);
        // Only clear the flag if nothing changed while the request was in flight.
        if (usePreferences.getState().appearance === appearance) usePreferences.getState().markSynced();
        setSync('saved');
      } catch {
        setSync('error');
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void save(usePreferences.getState().appearance), SAVE_DELAY_MS);
    };
    if (usePreferences.getState().dirty) schedule();
    const unsub = usePreferences.subscribe((s, prev) => {
      if (s.dirty && s.appearance !== prev.appearance) schedule();
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [ready, qc]);
}

export function usePreferencesQuery() {
  return useQuery({ queryKey: PREFERENCES_KEY, queryFn: () => api<PreferencesResponse>('/me/preferences'), staleTime: Infinity });
}

/** Forgets the person's own settings on the server and applies whatever now applies to them. */
export function useResetAppearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<PreferencesResponse>('/me/preferences/appearance', { method: 'DELETE' }),
    onSuccess: (res) => {
      qc.setQueryData(PREFERENCES_KEY, res);
      usePreferences.getState().adopt(res.appearance);
    },
  });
}

export function useWorkspaceDefault() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Appearance | null) =>
      a ? api<PreferencesResponse>('/tenants/current/appearance', { method: 'PUT', json: a }) : api<PreferencesResponse>('/tenants/current/appearance', { method: 'DELETE' }),
    onSuccess: (res) => qc.setQueryData(PREFERENCES_KEY, res),
  });
}

export function useSavedThemes() {
  return useQuery({ queryKey: THEMES_KEY, queryFn: () => api<SavedTheme[]>('/me/themes') });
}

export function useSaveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavedThemeInput) => api<SavedTheme>('/me/themes', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: THEMES_KEY }),
  });
}

export function useDeleteTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/me/themes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: THEMES_KEY }),
  });
}
