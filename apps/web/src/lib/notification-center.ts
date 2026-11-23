'use client';

import {
  type CenterNotification,
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationCategoryOf,
  notificationChimes,
  type NotificationFilter,
  type NotificationPage,
  type NotificationPreferences,
  type NotificationSectionKey,
  type NotificationSummary,
  notificationTone,
} from '@dealflow/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { api } from './api';
import { playChime } from './notification-sound';

/*
 * The Notification Center in the browser (ADR 0075). One summary query feeds the bell, the home card and every
 * section's badge; one tab at a time holds the live connection and tells the others, so a new notification chimes
 * once, however many tabs are open, and never for what was already there when SampForce opened.
 */

export const SUMMARY_KEY = ['notifications', 'summary'] as const;
const PREFS_KEY = ['notifications', 'preferences'] as const;
const CHANNEL = 'sampforce-notifications';
const LOCK = 'sampforce-notifications-live';
/** The newest notification this browser has already announced, shared by its tabs. */
const HEARD_KEY = 'sampforce:notifications:heard';

/** Counts each arrival so the bell can swing once per new notification. */
export const useArrivals = create<{ count: number; bump: () => void }>((set) => ({ count: 0, bump: () => set((s) => ({ count: s.count + 1 })) }));

export function useNotificationSummary(enabled = true) {
  return useQuery({ enabled, queryKey: SUMMARY_KEY, queryFn: () => api<NotificationSummary>('/notifications/summary'), refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export interface ListParams {
  filter?: NotificationFilter;
  section?: NotificationSectionKey;
  link?: string;
  limit?: number;
}

function listPath(p: ListParams, before?: string | null): string {
  const q = new URLSearchParams();
  if (p.filter && p.filter !== 'all') q.set('filter', p.filter);
  if (p.section) q.set('section', p.section);
  if (p.link) q.set('link', p.link);
  q.set('limit', String(p.limit ?? 20));
  if (before) q.set('before', before);
  return `/notifications?${q.toString()}`;
}

/** One list of notifications (the bell's tab, the history page, a section's strip), with "load more". */
export function useNotificationList(p: ListParams, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: ['notifications', 'list', p.filter ?? 'all', p.section ?? null, p.link ?? null, p.limit ?? 20],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<NotificationPage>(listPath(p, pageParam)),
    getNextPageParam: (last) => last.next,
  });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  // Mutation keys under ['notifications', ...] tell the workspace's mutation sounds to stay quiet for these.
  const read = useMutation({ mutationKey: ['notifications', 'read'], mutationFn: (ids: string[] | 'all') => api<{ updated: number }>('/notifications/read', { method: 'POST', json: { ids } }), onSuccess: refresh });
  const readSection = useMutation({ mutationKey: ['notifications', 'read-section'], mutationFn: (section: NotificationSectionKey) => api<{ updated: number }>('/notifications/read', { method: 'POST', json: { section } }), onSuccess: refresh });
  const unread = useMutation({ mutationKey: ['notifications', 'unread'], mutationFn: (id: string) => api<{ updated: number }>(`/notifications/${id}/unread`, { method: 'POST' }), onSuccess: refresh });
  return { read, readSection, unread };
}

export function useNotificationPreferences(enabled = true) {
  return useQuery({ enabled, queryKey: PREFS_KEY, queryFn: () => api<NotificationPreferences>('/notifications/preferences'), staleTime: 5 * 60_000 });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['notifications', 'preferences'],
    mutationFn: (prefs: NotificationPreferences) => api<NotificationPreferences>('/notifications/preferences', { method: 'PUT', json: prefs }),
    onSuccess: (saved) => qc.setQueryData(PREFS_KEY, saved),
  });
}

/** Opens a notification: marks it read and goes to its page. */
export function useOpenNotification() {
  const router = useRouter();
  const { read } = useNotificationActions();
  return (n: CenterNotification) => {
    if (!n.readAt) read.mutate([n.id]);
    if (n.link) router.push(n.link);
  };
}

function readHeard(): number {
  try {
    return Number(localStorage.getItem(HEARD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeHeard(ms: number) {
  try {
    if (ms > readHeard()) localStorage.setItem(HEARD_KEY, String(ms));
  } catch {
    // Private windows may refuse storage; the tab still remembers for itself.
  }
}

type Message = { kind: 'summary'; summary: NotificationSummary } | { kind: 'arrived' };

/**
 * Keeps the summary live. Mounted once, in the header. The tab holding the lock waits on the server; when something
 * new arrives it refreshes every tab, rings the chime (once, by the person's preferences) and, with SampForce in the
 * background, shows the browser's own notification.
 */
export function useNotificationLive(enabled: boolean) {
  const qc = useQueryClient();
  const router = useRouter();
  const bump = useArrivals((s) => s.bump);
  const prefs = useNotificationPreferences(enabled).data;
  const prefsRef = useRef<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  prefsRef.current = prefs ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
    // Everything there when this tab took over counts as already heard: no chime on opening SampForce. Server times
    // only, so a wrong clock on the computer changes nothing.
    let heard = readHeard();
    let latest: string | null = null;

    const apply = (s: NotificationSummary) => {
      const prev = qc.getQueryData<NotificationSummary>(SUMMARY_KEY);
      qc.setQueryData(SUMMARY_KEY, s);
      if (s.latestAt && s.latestAt !== prev?.latestAt) void qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      latest = s.latestAt ?? latest;
    };

    const announce = async () => {
      const page = await api<NotificationPage>('/notifications?filter=unread&limit=10', { signal: stop.signal });
      const fresh = page.items.filter((n) => new Date(n.createdAt).getTime() > heard).reverse();
      if (!fresh.length) return;
      heard = Math.max(heard, ...fresh.map((n) => new Date(n.createdAt).getTime()));
      writeHeard(heard);
      bump();
      channel?.postMessage({ kind: 'arrived' } satisfies Message);
      const p = prefsRef.current;
      const ringing = fresh.filter((n) => notificationChimes(p, n.type, notificationCategoryOf));
      if (ringing.length) playChime(ringing.some((n) => notificationTone(n) !== 'normal') ? 'bright' : 'soft', p.volume);
      if (p.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        for (const n of fresh.slice(-3)) {
          try {
            const shown = new Notification(n.title, { body: n.body ?? undefined, tag: n.id, icon: '/brand/sampforce-icon-512.png', silent: true });
            shown.onclick = () => {
              window.focus();
              if (n.link) routerRef.current.push(n.link);
              shown.close();
            };
          } catch {
            // Some browsers only allow notifications from a service worker; the bell still shows it.
          }
        }
      }
    };

    if (channel) {
      channel.onmessage = (e: MessageEvent<Message>) => {
        if (e.data.kind === 'summary') apply(e.data.summary);
        if (e.data.kind === 'arrived') {
          heard = Math.max(heard, readHeard());
          bump();
        }
      };
    }

    const loop = async () => {
      let backoff = 2_000;
      latest = (await api<NotificationSummary>('/notifications/summary', { signal: stop.signal }).catch(() => null))?.latestAt ?? null;
      heard = Math.max(readHeard(), latest ? Date.parse(latest) : 0);
      while (!stop.signal.aborted) {
        try {
          const after = latest ?? '1970-01-01T00:00:00.000Z';
          const s = await api<NotificationSummary>(`/notifications/wait?after=${encodeURIComponent(after)}&wait=25`, { signal: stop.signal });
          const isNew = !!s.latestAt && s.latestAt !== latest;
          apply(s);
          channel?.postMessage({ kind: 'summary', summary: s } satisfies Message);
          if (isNew) await announce().catch(() => undefined);
          backoff = 2_000;
        } catch {
          if (stop.signal.aborted) return;
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
    };

    // One tab holds the live connection (Web Locks); without them, every tab keeps its own.
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      void navigator.locks.request(LOCK, { signal: stop.signal }, () => loop()).catch(() => undefined);
    } else {
      void loop();
    }
    return () => {
      stop.abort();
      channel?.close();
    };
  }, [enabled, qc, bump]);
}

/** Asks the browser for permission to show notifications; resolves to whether it was granted. */
export async function askDesktopPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}
