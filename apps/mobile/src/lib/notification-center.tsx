import { type CenterNotification, type MobilePushStatus, type NotificationPage, type NotificationPreferences, type NotificationSummary, notificationCategoryOf, notificationChimes } from '@dealflow/types';
import * as Notifications from 'expo-notifications';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { pushSupported } from './push';
import { useController, useSession } from './session';

/*
 * The Notification Center on the phone (ADR 0075, part 4): the same store as the web's bell. One summary feeds the
 * header bell, the tab badges and the home card; it is refreshed every 20 seconds while the app is open and at once
 * when the app comes back. Something new slides down as a banner, with the phone's notification sound when the
 * person has the chime on (and the phone is not already getting it as a push).
 */

export { arrived, badgeFor, badgeText, MODULE_SECTION, SUMMARY_EVERY_MS } from './notification-badges';
import { arrived, SUMMARY_EVERY_MS } from './notification-badges';

interface Center {
  summary: NotificationSummary | null;
  banner: CenterNotification | null;
  dismissBanner: () => void;
  refresh: () => void;
}

const Ctx = createContext<Center>({ summary: null, banner: null, dismissBanner: () => undefined, refresh: () => undefined });

export function useNotificationCenter(): Center {
  return useContext(Ctx);
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const s = useSession();
  const c = useController();
  const on = s.status === 'signedIn' && s.config.modules.some((m) => m.key === 'notifications');
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [banner, setBanner] = useState<CenterNotification | null>(null);
  const last = useRef<NotificationSummary | null>(null);
  const prefs = useRef<NotificationPreferences | null>(null);
  const pushOn = useRef(false);

  const announce = useCallback(async () => {
    const page = await c.api.get<NotificationPage>('/notifications?filter=unread&limit=1');
    const n = page.items[0];
    if (!n) return;
    setBanner(n);
    // The chime: the phone's own notification sound, unless muted, or the push already brought it.
    if (!pushSupported() || pushOn.current || !prefs.current || !notificationChimes(prefs.current, n.type, notificationCategoryOf)) return;
    await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body ?? undefined, sound: 'default', data: { route: '/notifications' } }, trigger: null });
  }, [c]);

  const refresh = useCallback(() => {
    if (!on) return;
    c.api
      .get<NotificationSummary>('/notifications/summary')
      .then((next) => {
        const isNew = arrived(last.current, next);
        last.current = next;
        setSummary(next);
        if (isNew) void announce().catch(() => undefined);
      })
      .catch((e: unknown) => c.report(e));
  }, [c, on, announce]);

  useEffect(() => {
    if (!on) {
      last.current = null;
      setSummary(null);
      return;
    }
    void c.api.get<NotificationPreferences>('/notifications/preferences').then((p) => (prefs.current = p)).catch(() => undefined);
    if (pushSupported()) void c.api.get<MobilePushStatus>('/mobile/push').then((p) => (pushOn.current = p.enabled && p.registered)).catch(() => undefined);
    refresh();
    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, SUMMARY_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        timer ??= setInterval(refresh, SUMMARY_EVERY_MS);
      } else if (timer && Platform.OS !== 'web') {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [c, on, refresh]);

  const value = useMemo(() => ({ summary, banner, dismissBanner: () => setBanner(null), refresh }), [summary, banner, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
