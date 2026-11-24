'use client';

import { type NotificationFilter } from '@dealflow/types';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NotificationItem } from '@/components/notifications/notification-item';
import { useT } from '@/lib/i18n';
import { useArrivals, useNotificationActions, useNotificationList, useNotificationLive, useNotificationSummary } from '@/lib/notification-center';

const TABS: { key: NotificationFilter; label: 'All' | 'Unread' | 'Action required' }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'action', label: 'Action required' },
];

/**
 * The bell in every workspace's header (ADR 0075): the unread count, a single swing and a pop of the badge when
 * something new arrives, and a panel with All, Unread and Action required, "mark all read" and the full history.
 * It also keeps the notifications live for the whole app.
 */
export function NotificationsMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotificationFilter>('all');
  useNotificationLive(true);
  const summary = useNotificationSummary().data;
  const unread = summary?.unread ?? 0;
  const list = useNotificationList({ filter: tab, limit: 8 }, open);
  const { read } = useNotificationActions();
  const arrivals = useArrivals((s) => s.count);
  const [swing, setSwing] = useState(0);
  const firstArrival = useRef(arrivals);
  useEffect(() => {
    if (arrivals !== firstArrival.current) setSwing((n) => n + 1);
  }, [arrivals]);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const counts: Record<NotificationFilter, number | null> = { all: null, unread, action: summary?.actionRequired ?? 0 };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')}
          data-notification-bell=""
          data-unread={unread}
        >
          <Bell key={`bell-${swing}`} aria-hidden className={cn(swing > 0 && 'sf-bell-swing')} />
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
      <PopoverContent align="end" className="w-[24rem] p-0" aria-label={t('Notifications')}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{t('Notifications')}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => read.mutate('all')} disabled={!unread || read.isPending}>
              <CheckCheck className="size-4" aria-hidden /> {t('Mark all read')}
            </Button>
            <Button asChild variant="ghost" size="icon" className="size-8">
              <Link href="/app/notifications#preferences" aria-label={t('Notification settings')} title={t('Notification settings')} onClick={() => setOpen(false)}>
                <Settings2 className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <div role="tablist" aria-label={t('Show')} className="flex gap-1 border-b border-border px-3 py-2">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                tab === x.key ? 'bg-[hsl(var(--sf-red))] text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(x.label)}
              {counts[x.key] ? <span className={cn('rounded-full px-1.5 text-[10px] tabular', tab === x.key ? 'bg-white/25' : 'bg-muted')}>{counts[x.key]}</span> : null}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="max-h-[26rem] overflow-y-auto p-2">
          {items.length ? (
            <ul className="space-y-1">
              {items.map((n, i) => (
                <li key={n.id} style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }} className="sf-item-in">
                  <NotificationItem n={n} dense onOpened={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {list.isPending ? t('Loading…') : tab === 'unread' ? t('No unread notifications.') : tab === 'action' ? t('Nothing needs your action right now.') : t('You’re all caught up. Assignments, approvals and automation alerts appear here.')}
            </p>
          )}
        </div>
        <div className="border-t border-border p-2">
          <Link href="/app/notifications" onClick={() => setOpen(false)} className="block rounded-lg p-2 text-center text-sm font-medium text-[hsl(var(--sf-red))] hover:bg-muted dark:text-[hsl(0_90%_72%)]">
            {t('View all notifications')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
