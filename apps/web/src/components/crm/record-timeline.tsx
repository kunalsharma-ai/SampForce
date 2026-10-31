'use client';

import { Badge, Button, Skeleton } from '@dealflow/ui';
import { TIMELINE_KIND_LABELS, type TimelineEntity, type TimelineItem, type TimelineKind, type TimelinePage } from '@dealflow/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCircle2, FileSignature, FileText, FormInput, GitBranch, Mails, MousePointerClick, PlusCircle, ShieldAlert, StickyNote } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';

const ICONS: Record<TimelineKind, typeof StickyNote> = {
  created: PlusCircle,
  activity: StickyNote,
  email: Mails,
  meeting: CalendarDays,
  sequence_email: Mails,
  email_event: MousePointerClick,
  stage_change: GitBranch,
  task_done: CheckCircle2,
  quote: FileText,
  contract: FileSignature,
  form: FormInput,
  escalation: ShieldAlert,
};

/** Filters offered per record type: only sources that can have items there. */
const FILTERS: Record<TimelineEntity, TimelineKind[]> = {
  lead: ['activity', 'email', 'sequence_email', 'email_event', 'task_done', 'form'],
  contact: ['activity', 'email', 'meeting', 'sequence_email', 'email_event', 'task_done'],
  company: ['activity', 'email', 'meeting', 'stage_change', 'quote', 'contract', 'escalation'],
  deal: ['activity', 'email', 'meeting', 'stage_change', 'task_done', 'quote', 'contract'],
};

const ABOUT_HREF = { lead: '/app/leads/', contact: '/app/contacts/', deal: '/app/deals/' } as const;

/**
 * Customer 360 timeline: everything DealFlow knows about a record in one stream (activity, email, meetings,
 * sequences, stage moves, quotes, contracts, forms, escalations). Companies roll up their contacts and deals.
 */
export function RecordTimeline({ entity, id }: { entity: TimelineEntity; id: string }) {
  const [kind, setKind] = useState<TimelineKind | 'all'>('all');
  const q = useInfiniteQuery({
    queryKey: ['timeline', entity, id, kind],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '25' });
      if (pageParam) params.set('before', pageParam);
      if (kind !== 'all') params.set('kinds', kind);
      return api<TimelinePage>(`/timeline/${entity}/${id}?${params}`);
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const hidden = q.data?.pages[0]?.hidden ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
        <Button size="sm" variant={kind === 'all' ? 'default' : 'ghost'} className="h-7" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
          Everything
        </Button>
        {FILTERS[entity]
          .filter((k) => !hidden.includes(k))
          .map((k) => (
            <Button key={k} size="sm" variant={kind === k ? 'default' : 'ghost'} className="h-7" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {TIMELINE_KIND_LABELS[k]}
            </Button>
          ))}
      </div>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : q.error ? (
        <p role="alert" className="text-sm text-critical">
          {q.error.message}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ol className="space-y-3" aria-label="Timeline, newest first">
          {items.map((i) => (
            <TimelineRow key={i.id} item={i} />
          ))}
        </ol>
      )}
      {q.hasNextPage && (
        <Button size="sm" variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </Button>
      )}
    </div>
  );
}

function TimelineRow({ item: i }: { item: TimelineItem }) {
  const Icon = i.direction === 'in' ? ArrowDownLeft : i.direction === 'out' && i.kind === 'email' ? ArrowUpRight : ICONS[i.kind];
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {i.href ? (
            <Link href={i.href} className="font-medium hover:underline">
              {i.title}
            </Link>
          ) : (
            <span className="font-medium">{i.title}</span>
          )}
          {i.about && (
            <Badge className="ml-2" tone="neutral">
              <Link href={`${ABOUT_HREF[i.about.type]}${i.about.id}`} className="hover:underline">
                {i.about.name}
              </Link>
            </Badge>
          )}
        </p>
        {i.detail && <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{i.detail}</p>}
        <p className="text-xs text-muted-foreground">
          {i.actor ? `${i.actor.name} · ` : ''}
          <time dateTime={i.at} title={new Date(i.at).toLocaleString()}>
            {relativeTime(i.at)}
          </time>
        </p>
      </div>
    </li>
  );
}
