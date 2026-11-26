'use client';

import type { CommunicationEvent, CommunicationEventKind, InteractionKind, StageChangeSource } from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { ArrowRight, BadgeCheck, CalendarClock, CircleCheck, Inbox, MessageSquare, Send, TriangleAlert, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { personLabel } from '@/lib/company-leads';
import { type MessageKey, useT } from '@/lib/i18n';
import { formatDateTime } from './follow-ups';
import { StageChip, stageStyle, STAGE_DOT } from './stage-chip';
import { INTERACTION_LABEL } from './work-labels';

const SOURCE_LABEL: Record<StageChangeSource, MessageKey> = {
  MANUAL: 'Changed by hand',
  RFQ: 'An RFQ arrived',
  FOLLOW_UP: 'Follow-up completed',
  INTERACTION: 'Interaction logged',
  SAMPBIDX: 'SampBidx confirmed the transfer',
  RFQ_OUTCOME: 'RFQ outcome recorded',
  CALL_SCHEDULED: 'Call scheduled',
};

const KIND_ICON: Record<CommunicationEventKind, LucideIcon> = {
  STAGE: ArrowRight,
  INTERACTION: MessageSquare,
  RFQ: Inbox,
  FOLLOW_UP: CalendarClock,
  SAMPBIDX: Send,
  CONTRIBUTOR: BadgeCheck,
};

/** Follow-up and SampBidx states with their own label and tone. */
function subLabel(e: CommunicationEvent): { label: MessageKey; tone: string } | null {
  if (e.kind === 'FOLLOW_UP') {
    if (e.subKind === 'DONE') return { label: 'Follow-up done', tone: 'text-success' };
    if (e.subKind === 'OVERDUE') return { label: 'Overdue', tone: 'text-critical' };
    if (e.subKind === 'OPEN') return { label: 'Follow-up scheduled', tone: 'text-primary' };
    if (e.subKind === 'CANCELED') return { label: 'Cancelled', tone: 'text-muted-foreground' };
    return { label: 'Follow-up scheduled', tone: 'text-muted-foreground' };
  }
  if (e.kind === 'SAMPBIDX') {
    const client = e.subKind?.startsWith('CLIENT_');
    const state = client ? e.subKind!.slice(7) : e.subKind;
    if (state === 'SENT') return { label: client ? 'Client created or updated in SampBidx' : 'Accepted by SampBidx', tone: 'text-success' };
    if (state === 'FAILED') return { label: client ? 'Client not sent to SampBidx' : 'Not sent to SampBidx', tone: 'text-critical' };
    return { label: 'Sending to SampBidx…', tone: 'text-muted-foreground' };
  }
  return null;
}

/** An employee's communication history, newest first: every stage change, interaction, follow-up and transfer. */
export function CommunicationTimeline({ events, pending, error }: { events: CommunicationEvent[] | undefined; pending?: boolean; error?: Error | null }) {
  const t = useT();
  if (pending) return <Skeleton className="h-40" />;
  if (error) return <p role="alert" className="text-sm text-critical">{error.message}</p>;
  if (!events?.length) return <p className="text-sm text-muted-foreground">{t('Nothing has happened with this employee yet.')}</p>;
  return (
    <ol className="relative space-y-3 before:absolute before:inset-y-1 before:start-[13px] before:w-px before:bg-border" aria-label={t('Communication history')}>
      {events.map((e) => {
        const Icon = KIND_ICON[e.kind];
        const sub = subLabel(e);
        const failed = e.kind === 'SAMPBIDX' && e.subKind?.endsWith('FAILED');
        const stage = e.kind === 'STAGE' ? e.to : null;
        return (
          <li key={e.id} className="relative flex gap-3 ps-0">
            <span
              style={stage ? stageStyle(stage.color) : undefined}
              className={cn(
                'relative z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-background',
                stage ? cn(STAGE_DOT, 'text-white dark:text-[#0b1120]') : failed ? 'bg-critical text-white' : sub?.tone === 'text-success' ? 'bg-success text-white' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden
            >
              {failed ? <TriangleAlert className="size-3.5" /> : sub?.tone === 'text-success' ? <CircleCheck className="size-3.5" /> : <Icon className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {e.kind === 'STAGE' ? (
                    <>
                      {e.from && <StageChip stage={e.from} className="opacity-70" />}
                      {e.from && <ArrowRight aria-label={t('to')} className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" />}
                      <StageChip stage={e.to} />
                    </>
                  ) : (
                    <span className="min-w-0 break-words text-sm font-medium">{e.kind === 'CONTRIBUTOR' ? t('Marked as RFQ contributor') : e.title}</span>
                  )}
                </div>
                <time dateTime={e.at} className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(e.at)}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {e.kind === 'STAGE' && e.source && <span>{t(SOURCE_LABEL[e.source])}</span>}
                {e.kind === 'INTERACTION' && e.subKind && e.subKind in INTERACTION_LABEL && <span>{t(INTERACTION_LABEL[e.subKind as InteractionKind])}</span>}
                {sub && <span className={cn('font-medium', sub.tone)}>{t(sub.label)}</span>}
                {e.remoteId && <span className="font-mono">{t('SampBidx ref. {id}', { id: e.remoteId })}</span>}
                {e.rfq && (
                  <Link className="inline-flex min-h-6 items-center font-mono text-primary hover:underline" href={`/app/rfqs?open=${e.rfq.id}`}>
                    {e.rfq.number}
                  </Link>
                )}
                {e.by && <span>· {personLabel(e.by)}</span>}
              </div>
              {e.detail && e.kind !== 'FOLLOW_UP' && <p className={cn('mt-1 line-clamp-3 whitespace-pre-line break-words text-sm', failed ? 'text-critical' : 'text-foreground/80')}>{e.detail}</p>}
              {e.detail && e.kind === 'FOLLOW_UP' && e.subKind === 'DONE' && <p className="mt-1 line-clamp-2 break-words text-sm text-foreground/80">{e.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
