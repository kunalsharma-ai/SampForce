'use client';

import { FOLLOW_UP_BUCKETS, type FollowUpBucket } from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FollowUpItem } from '@/components/crm/follow-ups';
import { BUCKET_LABEL } from '@/components/crm/work-labels';
import { useFollowUpCounts, useFollowUps } from '@/lib/company-work';
import { type MessageKey, useT } from '@/lib/i18n';

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

/** Follow-ups by category, for me, my team (everyone reporting to me) or the whole workspace. */
export function FollowUpsWorkspace() {
  const t = useT();
  // The dashboard's cards open the exact list: ?bucket=overdue&scope=team (redesign R6).
  const params = useSearchParams();
  const askedScope = params.get('scope');
  const askedBucket = params.get('bucket');
  const [scope, setScope] = React.useState<'mine' | 'team' | 'all'>(SCOPES.some((x) => x.value === askedScope) ? (askedScope as 'mine' | 'team' | 'all') : 'mine');
  const [bucket, setBucket] = React.useState<FollowUpBucket>((FOLLOW_UP_BUCKETS as readonly string[]).includes(askedBucket ?? '') ? (askedBucket as FollowUpBucket) : 'today');
  const counts = useFollowUpCounts({ scope });
  const list = useFollowUps({ scope, bucket });
  return (
    <div className="space-y-4">
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
          <ul className="space-y-2">
            {list.data.map((f) => (
              <FollowUpItem key={f.id} f={f} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
