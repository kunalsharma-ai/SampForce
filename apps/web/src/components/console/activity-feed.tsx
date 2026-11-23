'use client';

import { Button } from '@dealflow/ui';
import type { ConsoleActivityCategory, ConsoleActivityItem, ConsoleActivityPage } from '@dealflow/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Building2, CreditCard, LayoutGrid, LifeBuoy, type LucideIcon, ShieldAlert, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { fmtLocale } from '@/lib/i18n/locale';
import { activitySentence, CATEGORY_LABEL } from './audit-labels';
import { ConsoleEmpty, ConsoleError } from './console-states';

const ICON: Record<ConsoleActivityCategory, LucideIcon> = {
  clients: Building2,
  workspaces: LayoutGrid,
  billing: CreditCard,
  support: LifeBuoy,
  security: ShieldAlert,
  console: UserCog,
};

const TONE: Record<ConsoleActivityCategory, string> = {
  clients: 'bg-primary/10 text-primary',
  workspaces: 'bg-accent/15 text-accent-foreground',
  billing: 'bg-success/15 text-success',
  support: 'bg-warning/15 text-foreground',
  security: 'bg-critical/10 text-critical',
  console: 'bg-muted text-foreground',
};

/** A failed payment or an unusual sign-in stands out from the rest of the feed. */
const urgent = (i: ConsoleActivityItem) => i.kind === 'subscription.past_due' || i.kind === 'signin.unusual';

/**
 * The Console activity feed (ADR 0074, C3): what happened across SampForce, newest first, refreshed every 30 seconds.
 * The server leaves out the kinds the operator's role may not act on; the chips narrow it further.
 */
export function ActivityFeed({ categories, tenantId, pageSize = 30 }: { categories: ConsoleActivityCategory[]; tenantId?: string; pageSize?: number }) {
  const [picked, setPicked] = useState<ConsoleActivityCategory[]>([]);
  const feed = useInfiniteQuery({
    queryKey: ['operator', 'activity', tenantId ?? null, picked.join(','), pageSize],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(pageSize) });
      if (picked.length) p.set('categories', picked.join(','));
      if (tenantId) p.set('tenantId', tenantId);
      if (pageParam) p.set('before', pageParam);
      return api<ConsoleActivityPage>(`/operator/activity?${p}`);
    },
    getNextPageParam: (last) => last.next,
    refetchInterval: 30_000,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const toggle = (c: ConsoleActivityCategory) => setPicked((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  return (
    <div data-activity-feed>
      {categories.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Show activity about">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={picked.includes(c)}
              onClick={() => toggle(c)}
              className="rounded-full border border-border px-3 py-1 text-sm text-foreground hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      )}
      {feed.isError ? (
        <ConsoleError error={feed.error} onRetry={() => void feed.refetch()} />
      ) : feed.isPending ? (
        <div role="status" aria-label="Loading activity" className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <ConsoleEmpty title="No activity yet" description="New clients, workspaces, invoices, tickets and operator changes appear here as they happen." />
      ) : (
        <ol className="relative space-y-1 before:absolute before:inset-y-2 before:start-5 before:w-px before:bg-border" aria-label="Activity, newest first">
          {items.map((i) => {
            const Icon = ICON[i.category];
            const body = (
              <>
                <span className={`relative z-10 grid size-10 shrink-0 place-items-center rounded-full ring-4 ring-background ${TONE[i.category]}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">
                    {i.client && <span className="font-medium">{i.client.name} · </span>}
                    <span className={urgent(i) ? 'font-medium text-critical' : undefined}>{activitySentence(i)}</span>
                  </span>
                  <time dateTime={i.at} title={new Date(i.at).toLocaleString(fmtLocale())} className="block text-xs text-muted-foreground">
                    {relativeTime(i.at)}
                  </time>
                </span>
              </>
            );
            return (
              <li key={i.id} data-activity={i.kind} data-category={i.category}>
                {i.link ? (
                  <Link href={i.link} className="flex items-start gap-3 rounded-xl p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {feed.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? 'Loading…' : 'Show older activity'}
        </Button>
      )}
    </div>
  );
}
