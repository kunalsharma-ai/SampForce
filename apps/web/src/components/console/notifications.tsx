'use client';

import { Button, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import { OPERATOR_NOTIFICATION_DEFS, type OperatorNotificationPage, type OperatorNotificationRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { playConsoleSound } from '@/lib/console-sound';
import { relativeTime } from '@/lib/format';
import { fmtLocale } from '@/lib/i18n/locale';

/** Console notifications in the browser (ADR 0074, C3b): the unread count, the bell's list and the read marks. */

export const UNREAD_KEY = ['operator', 'notifications', 'unread'] as const;
const LIST_KEY = ['operator', 'notifications', 'latest'] as const;

/** Unread Console notifications, checked every 30 seconds (and shared by the bell and the menu badge). */
export function useUnreadNotifications(enabled = true) {
  return useQuery({ enabled, queryKey: UNREAD_KEY, queryFn: () => api<{ unread: number }>('/operator/me/notifications/unread'), refetchInterval: 30_000 });
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['operator', 'notifications'] });
  const read = useMutation({ mutationKey: ['operator', 'preferences', 'read'], mutationFn: (id: string) => api<{ unread: number }>(`/operator/me/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh });
  const readAll = useMutation({ mutationKey: ['operator', 'preferences', 'read-all'], mutationFn: () => api<{ unread: number }>('/operator/me/notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  return { read, readAll };
}

/** One notification: title, what it is about and when, with an unread dot. */
export function NotificationItem({ n, onOpen }: { n: OperatorNotificationRow; onOpen: (n: OperatorNotificationRow) => void }) {
  const urgent = OPERATOR_NOTIFICATION_DEFS[n.type]?.urgent;
  const body = (
    <>
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : urgent ? 'bg-critical' : 'bg-[hsl(var(--sf-red))]'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${n.readAt ? '' : 'font-medium'}`}>
          {n.readAt ? null : <span className="sr-only">Unread: </span>}
          {n.title}
        </span>
        {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
        <span className="block text-xs text-muted-foreground">
          {OPERATOR_NOTIFICATION_DEFS[n.type]?.label ?? n.type} ·{' '}
          <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString(fmtLocale())}>
            {relativeTime(n.createdAt)}
          </time>
        </span>
      </span>
    </>
  );
  // Unread rows carry a red edge (amber-red when urgent), the same look as the workspace bell (ADR 0075).
  const tone = n.readAt ? 'border-transparent' : urgent ? 'border-critical bg-critical/5' : 'border-[hsl(var(--sf-red))] bg-[hsl(var(--sf-red)/0.05)]';
  const cls = `flex w-full items-start gap-3 rounded-lg border-s-2 p-2 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`;
  return n.link ? (
    <Link href={n.link} className={cls} onClick={() => onOpen(n)} data-notification={n.type} data-read={n.readAt ? 'yes' : 'no'}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={() => onOpen(n)} data-notification={n.type} data-read={n.readAt ? 'yes' : 'no'}>
      {body}
    </button>
  );
}

/**
 * The bell in the Console's top bar: the unread count, the latest notifications and "mark all read". With sounds on,
 * a new urgent notification (a failed payment, a ticket past its response time) plays the alert chime.
 */
export function NotificationBell({ sound }: { sound: boolean }) {
  const [open, setOpen] = useState(false);
  const unread = useUnreadNotifications().data?.unread ?? 0;
  const latest = useQuery({ queryKey: LIST_KEY, queryFn: () => api<OperatorNotificationPage>('/operator/me/notifications?limit=8'), enabled: open || unread > 0, refetchInterval: open ? 30_000 : false });
  const { read, readAll } = useNotificationActions();
  const seen = useRef<number | null>(null);
  const [swing, setSwing] = useState(0);
  const [desktop, setDesktop] = useState<NotificationPermission | 'unsupported'>('unsupported');
  useEffect(() => setDesktop(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission), []);

  useEffect(() => {
    // Only a rise in the count after the first load is "new": opening the Console never chimes or rings.
    if (seen.current !== null && unread > seen.current) {
      const newest = latest.data?.items.find((n) => !n.readAt);
      const urgent = !!(newest && OPERATOR_NOTIFICATION_DEFS[newest.type]?.urgent);
      setSwing((x) => x + 1);
      if (sound) playConsoleSound(urgent ? 'alert' : 'success');
      // A browser notification only while the Console is in the background and the browser allows it.
      if (newest && document.visibilityState === 'hidden' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const shown = new Notification(newest.title, { body: newest.body ?? undefined, tag: `console-${newest.id}`, icon: '/brand/sampforce-icon-512.png' });
          shown.onclick = () => {
            window.focus();
            if (newest.link) window.location.assign(newest.link);
          };
        } catch {
          // Some browsers only allow notifications from a service worker; the bell still shows it.
        }
      }
    }
    seen.current = unread;
  }, [unread, sound, latest.data]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} data-notification-bell data-unread={unread}>
          <Bell key={`bell-${swing}`} aria-hidden className={swing > 0 ? 'sf-bell-swing' : undefined} />
          {swing > 0 && <span key={`halo-${swing}`} aria-hidden className="sf-ring-halo pointer-events-none absolute inset-1.5 rounded-full" />}
          {unread > 0 && (
            <span
              key={`badge-${unread}`}
              aria-hidden
              className="sf-badge-pop absolute -end-0.5 -top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_hsl(var(--background))]"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0" aria-label="Notifications">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="ghost" size="sm" onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending}>
            <CheckCheck className="size-4" aria-hidden /> Mark all read
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {latest.data?.items.length ? (
            <ul className="space-y-0.5">
              {latest.data.items.map((n) => (
                <li key={n.id} className="sf-item-in">
                  <NotificationItem
                    n={n}
                    onOpen={(x) => {
                      if (!x.readAt) read.mutate(x.id);
                      setOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">{latest.isPending && open ? 'Loading…' : 'You are all caught up.'}</p>
          )}
        </div>
        <div className="border-t border-border p-2">
          {desktop === 'default' && (
            <button
              type="button"
              className="mb-1 flex w-full items-center justify-center gap-2 rounded-lg p-2 text-sm hover:bg-muted"
              onClick={() => void Notification.requestPermission().then(setDesktop)}
              data-console-desktop-ask=""
            >
              <BellRing className="size-4" aria-hidden /> Show browser notifications while the Console is in the background
            </button>
          )}
          <Link href="/operator/notifications" onClick={() => setOpen(false)} className="block rounded-lg p-2 text-center text-sm font-medium text-primary hover:bg-muted">
            All notifications and preferences
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
