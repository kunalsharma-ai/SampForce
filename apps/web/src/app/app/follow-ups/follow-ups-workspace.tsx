'use client';

import { FOLLOW_UP_BUCKETS, type FollowUpBucket } from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { ListChecks, Send } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FirstEmailPending } from '@/components/crm/first-email-pending';
import { FollowUpItem } from '@/components/crm/follow-ups';
import { BUCKET_LABEL } from '@/components/crm/work-labels';
import { browserTimeZone, useFollowUpCounts, useFollowUps } from '@/lib/company-work';
import { useFirstEmails } from '@/lib/follow-up-cadence';
import { type MessageKey, useT } from '@/lib/i18n';
import { DeleteAllButton } from '@/components/delete-all-button';

const SCOPES: { value: 'mine' | 'team' | 'all'; label: MessageKey }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'team', label: 'My team' },
  { value: 'all', label: 'Everyone' },
];
const BUCKET_TONE: Record<FollowUpBucket, string> = {
  today: 'bg-warning/15 text-warning',
  upcoming: 'bg-primary/10 text-primary',
  overdue: 'bg-critical/15 text-critical',
  completed: 'bg-success/15 text-success',
  rescheduled: 'bg-accent/15 text-accent',
  cancelled: 'bg-muted text-muted-foreground',
};

/** The two parts of the page: new contacts waiting for their first email, and the follow-ups themselves. */
const VIEWS = [
  { value: 'first-email', label: 'First email pending', hint: 'New contacts not emailed yet', icon: Send, tone: 'from-amber-500 to-rose-600' },
  { value: 'follow-ups', label: 'Follow-ups', hint: 'Due today and overdue', icon: ListChecks, tone: 'from-sky-500 to-indigo-600' },
] as const satisfies readonly { value: 'first-email' | 'follow-ups'; label: MessageKey; hint: MessageKey; icon: typeof Send; tone: string }[];

/**
 * The Follow-ups section: First Email Pending (ADR 0096), new contacts whose first email has not gone out, and the
 * follow-ups by category, for me, my team (everyone reporting to me) or the whole workspace. ?view=first-email opens
 * the first list.
 */
export function FollowUpsWorkspace() {
  const t = useT();
  // The dashboard's cards open the exact list: ?bucket=overdue&scope=team (redesign R6).
  const params = useSearchParams();
  const askedScope = params.get('scope');
  const askedBucket = params.get('bucket');
  const [scope, setScope] = React.useState<'mine' | 'team' | 'all'>(SCOPES.some((x) => x.value === askedScope) ? (askedScope as 'mine' | 'team' | 'all') : 'mine');
  const [bucket, setBucket] = React.useState<FollowUpBucket>((FOLLOW_UP_BUCKETS as readonly string[]).includes(askedBucket ?? '') ? (askedBucket as FollowUpBucket) : 'today');
  const [view, setView] = React.useState<'first-email' | 'follow-ups'>(params.get('view') === 'first-email' ? 'first-email' : 'follow-ups');
  const counts = useFollowUpCounts({ scope });
  const list = useFollowUps({ scope, bucket });
  // The tab shows how many first emails are pending, for the same people.
  const firstEmail = useFirstEmails({ scope, limit: 1 });
  const pending = firstEmail.data ? firstEmail.data.counts.PENDING + firstEmail.data.counts.NO_EMAIL + firstEmail.data.counts.INVALID_EMAIL : null;
  const pick = (v: 'first-email' | 'follow-ups') => {
    setView(v);
    const url = new URL(window.location.href);
    if (v === 'first-email') url.searchParams.set('view', 'first-email');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2" role="tablist" aria-label={t('Follow-up sections')}>
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const active = view === v.value;
          const n = v.value === 'first-email' ? pending : counts.data ? counts.data.today + counts.data.overdue : null;
          return (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-view={v.value}
              onClick={() => pick(v.value)}
              className={cn('flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-start transition', active ? 'border-primary bg-surface shadow-md ring-2 ring-primary/30' : 'border-border bg-surface hover:border-primary/40')}
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow', v.tone)} aria-hidden>
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t(v.label)}</span>
                <span className="block truncate text-xs text-muted-foreground">{t(v.hint)}</span>
              </span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-sm font-bold tabular-nums">{n ?? '…'}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t('Whose follow-ups')}>
        {SCOPES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={scope === s.value}
            onClick={() => setScope(s.value)}
            className={cn('h-9 rounded-full border px-4 text-sm font-medium', scope === s.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted')}
          >
            {t(s.label)}
          </button>
        ))}
      </div>
      {view === 'first-email' ? (
        <FirstEmailPending scope={scope} />
      ) : (
        <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label={t('Follow-up categories')}>
        {FOLLOW_UP_BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={bucket === b}
            aria-controls="follow-up-list"
            onClick={() => setBucket(b)}
            className={cn('rounded-xl border p-3 text-start transition', bucket === b ? 'border-primary shadow-sm ring-2 ring-primary/30' : 'border-border bg-surface hover:border-primary/40')}
          >
            <span className={cn('inline-flex min-w-8 justify-center rounded-full px-2 py-0.5 text-lg font-bold tabular-nums', BUCKET_TONE[b])}>{counts.data ? counts.data[b] : '…'}</span>
            <span className="mt-1 block text-xs font-medium">{t(BUCKET_LABEL[b])}</span>
          </button>
        ))}
      </div>
      <section id="follow-up-list" role="tabpanel" aria-label={t(BUCKET_LABEL[bucket])}>
        {list.isPending ? (
          <Skeleton className="h-32" />
        ) : list.error ? (
          <p role="alert" className="text-sm text-critical">
            {list.error.message}
          </p>
        ) : !list.data?.length ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No follow-ups here.')}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-end">
              <DeleteAllButton path="/follow-ups" query={{ scope, bucket, tz: browserTimeZone() }} hasItems={list.data.length > 0} permission="activities:write" feature="follow_up_management" invalidate={['follow-ups']} />
            </div>
            <ul className="space-y-2">
              {list.data.map((f) => (
                <FollowUpItem key={f.id} f={f} />
              ))}
            </ul>
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
