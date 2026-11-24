'use client';

import { type CenterNotification, notificationSection, sectionOfPath } from '@dealflow/types';
import { Button } from '@dealflow/ui';
import { BellRing, CheckCheck, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useNotificationActions, useNotificationList, useNotificationSummary } from '@/lib/notification-center';
import { NotificationItem } from './notification-item';

/**
 * The third way to a notification (ADR 0075): at the top of the section it comes from. On Leads, the unread lead
 * notifications; on one record's page, the unread ones about that record. Opening the section is reading them: they
 * are marked read as soon as the page is in view (so the bell, the menu count and the home card clear at once), and
 * the strip keeps showing what was new for this visit. Something arriving while the page is open is read the same way.
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
  const [dismissed, setDismissed] = useState(false);
  // What was new on this visit: kept after it is marked read, reset when the page changes.
  const [seen, setSeen] = useState<{ path: string; items: CenterNotification[]; total: number }>({ path: pathname, items: [], total: 0 });
  const visible = usePageVisible();
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  useEffect(() => {
    setSeen({ path: pathname, items: [], total: 0 });
    setDismissed(false);
    setCollapsed(false);
  }, [pathname]);

  useEffect(() => {
    if (!key || !visible || seen.path !== pathname) return;
    const known = new Set(seen.items.map((n) => n.id));
    const fresh = items.filter((n) => !n.readAt && !known.has(n.id));
    if (!fresh.length) return;
    // The first look at a section reads all of it (more than the five shown); after that, what newly arrived.
    if (!isRecord && seen.items.length === 0) readSection.mutate(key);
    else read.mutate(fresh.map((n) => n.id));
    const at = new Date().toISOString();
    setSeen((prev) => ({ path: prev.path, items: [...fresh.map((n) => ({ ...n, readAt: at })), ...prev.items].slice(0, 5), total: prev.total + (prev.items.length === 0 && !isRecord ? Math.max(count, fresh.length) : fresh.length) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the list or visibility changes
  }, [items, visible, key, pathname]);

  if (!section || !key || dismissed || seen.path !== pathname || seen.items.length === 0) return null;
  const shown = collapsed ? [] : seen.items.slice(0, 3);
  const total = Math.max(seen.total, seen.items.length);

  return (
    <section
      aria-label={t('New in {section}', { section: t.maybe(section.label) })}
      className="sf-item-in mb-5 overflow-hidden rounded-xl border border-[hsl(var(--sf-red)/0.35)] bg-surface shadow-sm"
      data-section-notices={key}
      data-section-read="yes"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--sf-red)/0.2)] bg-[hsl(var(--sf-red)/0.06)] px-4 py-2.5">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[hsl(var(--sf-red))] text-white">
          <BellRing className="size-3.5" />
        </span>
        <h2 className="flex-1 text-sm font-semibold">
          {isRecord ? t('New about this record: {n}', { n: total }) : t('New in {section}: {n}', { section: t.maybe(section.label), n: total })}
          <span className="ms-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <CheckCheck className="size-3.5" aria-hidden /> {t('Marked as read')}
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          {t('Got it')}
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
      {!collapsed && !isRecord && total > shown.length && (
        <p className="border-t border-border px-4 py-2 text-xs">
          <Link href={`/app/notifications?section=${key}`} className="font-medium text-primary hover:underline">
            {t('See all {n} in {section}', { n: total, section: t.maybe(section.label) })}
          </Link>
        </p>
      )}
    </section>
  );
}

/** Whether the page is in front of the person (not a background tab): only then is a section "opened". */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
