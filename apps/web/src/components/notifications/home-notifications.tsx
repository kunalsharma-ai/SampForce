'use client';

import { NOTIFICATION_SECTIONS } from '@dealflow/types';
import { Button, Card, cn } from '@dealflow/ui';
import { BellRing, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { useNotificationActions, useNotificationList, useNotificationSummary } from '@/lib/notification-center';
import { NotificationItem } from './notification-item';

/**
 * The home dashboard's notifications (ADR 0075): what is unread, what needs action, a count per section that opens
 * the section, and the latest unread items. The same rows as the bell.
 */
export function HomeNotifications() {
  const t = useT();
  const summary = useNotificationSummary().data;
  const list = useNotificationList({ filter: 'unread', limit: 5 });
  const { read } = useNotificationActions();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = summary?.unread ?? 0;
  const sections = NOTIFICATION_SECTIONS.filter((s) => (summary?.bySection[s.key] ?? 0) > 0);

  return (
    <Card className="overflow-hidden p-0" data-home-notifications="">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-gradient-to-r from-[hsl(var(--sf-red)/0.10)] via-transparent to-transparent px-5 py-4">
        <span aria-hidden className={cn('relative grid size-9 place-items-center rounded-xl bg-[hsl(var(--sf-red))] text-white shadow-md', unread > 0 && 'sf-badge-pop')}>
          <BellRing className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{t('Notifications')}</h2>
          <p className="text-xs text-muted-foreground">
            {unread ? t('{n} unread · {a} need your action · {i} important', { n: unread, a: summary?.actionRequired ?? 0, i: summary?.important ?? 0 }) : t('You’re all caught up.')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => read.mutate('all')} disabled={read.isPending}>
              <CheckCheck className="size-4" aria-hidden /> {t('Mark all read')}
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/app/notifications">{t('View all')}</Link>
          </Button>
        </div>
      </div>
      {sections.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-b border-border px-5 py-3" aria-label={t('Unread by section')}>
          {sections.map((s) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium hover:border-[hsl(var(--sf-red)/0.5)] hover:bg-[hsl(var(--sf-red)/0.06)]"
                data-home-section={s.key}
              >
                {t.maybe(s.label)}
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1.5 text-[10px] font-bold text-white tabular">{summary!.bySection[s.key]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="p-2">
        {items.length ? (
          <ul className="space-y-1">
            {items.map((n) => (
              <li key={n.id}>
                <NotificationItem n={n} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {list.isPending ? t('Loading…') : t('New companies, tasks, approvals and reminders appear here as they happen.')}
          </p>
        )}
      </div>
    </Card>
  );
}
