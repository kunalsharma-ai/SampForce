'use client';

import { notificationSection, sectionOfPath } from '@dealflow/types';
import { Button } from '@dealflow/ui';
import { BellRing, CheckCheck, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useNotificationActions, useNotificationList, useNotificationSummary } from '@/lib/notification-center';
import { NotificationItem } from './notification-item';

/**
 * The third way to a notification (ADR 0075): at the top of the section it comes from. On Leads, the unread lead
 * notifications; on one record's page, the unread ones about that record. Same rows as the bell, so reading one here
 * clears it there.
 */
export function SectionNotices() {
  const t = useT();
  const pathname = usePathname();
  const enabled = useHasFeature('notifications');
  const key = sectionOfPath(pathname);
  const section = notificationSection(key);
  const summary = useNotificationSummary(enabled && !!key).data;
  const count = key ? (summary?.bySection[key] ?? 0) : 0;
  const isRecord = !!section && pathname !== section.href;
  const list = useNotificationList({ filter: 'unread', ...(isRecord ? { link: pathname } : { section: key ?? undefined }), limit: 5 }, enabled && count > 0);
  const { readSection, read } = useNotificationActions();
  const [collapsed, setCollapsed] = useState(false);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (!section || !key || count === 0 || items.length === 0) return null;
  const shown = collapsed ? [] : items.slice(0, 3);

  return (
    <section
      aria-label={t('New in {section}', { section: t.maybe(section.label) })}
      className="sf-item-in mb-5 overflow-hidden rounded-xl border border-[hsl(var(--sf-red)/0.35)] bg-surface shadow-sm"
      data-section-notices={key}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--sf-red)/0.2)] bg-[hsl(var(--sf-red)/0.06)] px-4 py-2.5">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[hsl(var(--sf-red))] text-white">
          <BellRing className="size-3.5" />
        </span>
        <h2 className="flex-1 text-sm font-semibold">
          {isRecord ? t('New about this record: {n}', { n: items.length }) : t('New in {section}: {n}', { section: t.maybe(section.label), n: count })}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (isRecord ? read.mutate(items.map((n) => n.id)) : readSection.mutate(key))}
          disabled={read.isPending || readSection.isPending}
        >
          <CheckCheck className="size-4" aria-hidden /> {t('Mark these read')}
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-expanded={!collapsed} aria-label={collapsed ? t('Show') : t('Hide')} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronDown className="size-4" aria-hidden /> : <ChevronUp className="size-4" aria-hidden />}
        </Button>
      </div>
      {shown.length > 0 && (
        <ul className="space-y-1 p-2">
          {shown.map((n) => (
            <li key={n.id}>
              <NotificationItem n={n} showSection={false} dense animate />
            </li>
          ))}
        </ul>
      )}
      {!collapsed && !isRecord && count > shown.length && (
        <p className="border-t border-border px-4 py-2 text-xs">
          <Link href={`/app/notifications?section=${key}`} className="font-medium text-primary hover:underline">
            {t('See all {n} in {section}', { n: count, section: t.maybe(section.label) })}
          </Link>
        </p>
      )}
    </section>
  );
}
