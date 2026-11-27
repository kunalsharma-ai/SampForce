'use client';

import { PIP_STATUS_LABEL, type PipRow } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { CalendarClock, CheckCircle2, ClipboardCheck, MessageSquare, PartyPopper, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { Ring } from '@/components/task-plans/progress-ring';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { usePipCard, usePipMutations } from '@/lib/recognition';
import { GoalList } from './goal-list';
import './recognition.css';

/*
 * The improvement plan on the person's dashboard (ADR 0102): shown only while a plan is open, and once after it is
 * completed. It says plainly what must be done by when, counts the goals from the records, and lets the person
 * acknowledge the plan and reply. Nothing here fails a plan: only an authorised person decides it.
 */

export function PipDashboardCard() {
  const q = usePipCard();
  if (!q.data) return null;
  if (q.data.plan) return <OpenPlan p={q.data.plan} />;
  if (q.data.completed) return <Completed p={q.data.completed} />;
  return null;
}

function daysUntil(day: string): number {
  const d = new Date(`${day}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / 86_400_000);
}

function OpenPlan({ p }: { p: PipRow }) {
  const t = useT();
  const m = usePipMutations();
  const [reply, setReply] = useState<'ack' | 'comment' | null>(null);
  const reviewIn = p.nextReviewOn ? daysUntil(p.nextReviewOn) : null;
  const ready = p.status === 'READY_FOR_REVIEW' || p.status === 'UNDER_REVIEW';
  return (
    <section className="pip-card rounded-2xl p-5 shadow-sm sm:p-6" data-pip-card={p.status} aria-labelledby="pip-title">
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#4338ca] to-[#0f766e] text-white shadow-sm" aria-hidden>
              <ClipboardCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 id="pip-title" className="text-lg font-bold tracking-tight">
                {t('Performance Improvement Plan {number}', { number: p.number })}
              </h2>
              <p className="truncate text-sm text-muted-foreground">{p.title}</p>
            </div>
            <span className={cn('ml-auto inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold', ready ? 'bg-success/15 text-success' : 'bg-[#4338ca]/12 text-[#4338ca] dark:text-[#a5b4fc]')} data-pip-status={p.status}>
              {t.maybe(PIP_STATUS_LABEL[p.status])}
            </span>
          </div>
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium">
            {ready ? t('Every goal is met. Your manager will review the plan and confirm it.') : t('Complete these goals by {date} to clear this plan.', { date: formatDate(p.endsOn) })}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Fact label={t('Start date')} value={formatDate(p.startsOn)} />
            <Fact label={t('End date')} value={formatDate(p.endsOn)} />
            <Fact label={t('Days remaining')} value={String(Math.max(0, p.daysRemaining))} />
            <Fact label={t('Assigned by')} value={p.assignedBy.name} />
          </dl>
          {(p.currentLevel || p.requiredLevel) && (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {p.currentLevel && <Fact label={t('Current level')} value={p.currentLevel} />}
              {p.requiredLevel && <Fact label={t('Required level')} value={p.requiredLevel} />}
            </dl>
          )}
          {p.areas.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={t('Areas to improve')}>
              {p.areas.map((a) => (
                <span key={a} className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {a}
                </span>
              ))}
            </div>
          )}
          {p.managerFeedback && (
            <p className="flex gap-2 text-sm">
              <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="font-medium">{t('Manager feedback')}: </span>
                {p.managerFeedback}
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {p.can.acknowledge && (
              <Button size="sm" onClick={() => setReply('ack')} data-pip-acknowledge>
                <CheckCircle2 className="mr-1.5 size-4" aria-hidden />
                {t('Acknowledge plan')}
              </Button>
            )}
            {p.can.comment && (
              <Button size="sm" variant="outline" onClick={() => setReply('comment')} data-pip-comment>
                <MessageSquare className="mr-1.5 size-4" aria-hidden />
                {t('Add a comment')}
              </Button>
            )}
            <Link href={`/app/recognition?tab=plans&plan=${p.id}`} className="text-sm font-medium text-primary hover:underline">
              {t('Open the plan')}
            </Link>
          </div>
        </div>
        <div className="min-w-0 space-y-3 lg:w-[24rem]">
          <div className="flex items-center gap-3">
            <Ring percent={p.percent} id={`pip-${p.id}`} size={72} stroke={8} label={t('Improvement plan progress')} />
            <div className="text-sm">
              <p className="font-semibold">{t('{met} of {total} goals met', { met: p.goalsMet, total: p.goals.length })}</p>
              <p className="text-muted-foreground">{t('Goals count by themselves from your records.')}</p>
            </div>
          </div>
          <GoalList goals={p.goals} currency={p.currency} compact />
          {p.nextReviewOn && reviewIn !== null && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" data-pip-next-review>
              {reviewIn <= 3 ? <span className="pip-review-dot inline-block size-2 rounded-full bg-[#f59e0b]" aria-hidden /> : <CalendarClock className="size-3.5" aria-hidden />}
              {reviewIn <= 0 ? t('Review today') : reviewIn <= 3 ? t('Review soon: {date}', { date: formatDate(p.nextReviewOn) }) : t('Next review: {date}', { date: formatDate(p.nextReviewOn) })}
            </p>
          )}
        </div>
      </div>
      {reply && <ReplyDialog p={p} kind={reply} onClose={() => setReply(null)} m={m} />}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function ReplyDialog({ p, kind, onClose, m }: { p: PipRow; kind: 'ack' | 'comment'; onClose: () => void; m: ReturnType<typeof usePipMutations> }) {
  const t = useT();
  const [text, setText] = useState('');
  const mut = kind === 'ack' ? m.acknowledge : m.comment;
  const send = () => {
    if (kind === 'ack') m.acknowledge.mutate({ id: p.id, comment: text.trim() || undefined }, { onSuccess: onClose });
    else m.comment.mutate({ id: p.id, body: text.trim() }, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{kind === 'ack' ? t('Acknowledge plan') : t('Add a comment')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {kind === 'ack' ? t('Acknowledging says you have read the plan and its goals. You can add a comment for your manager.') : t('Your manager and the people who manage the plan see your comment in its history.')}
        </DialogDescription>
        <Textarea aria-label={t('Comment')} rows={4} value={text} onChange={(e) => setText(e.target.value)} className="mt-3" placeholder={kind === 'ack' ? t('Optional comment') : undefined} />
        <ErrorText error={mut.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={send} disabled={mut.isPending || (kind === 'comment' && !text.trim())} data-pip-send>
            {kind === 'ack' ? t('Acknowledge plan') : t('Send comment')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Completed({ p }: { p: PipRow }) {
  const t = useT();
  const m = usePipMutations();
  return (
    <section className="pip-done eom-reveal flex items-start gap-4 rounded-2xl border p-5 shadow-sm" data-pip-completed={p.id}>
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success" aria-hidden>
        <PartyPopper className="size-6" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-lg font-bold">{t('Well done! You completed improvement plan {number}.', { number: p.number })}</h2>
        <p className="text-sm text-muted-foreground">{p.closingComment ?? t('Your manager confirmed that every goal was met.')}</p>
      </div>
      <Button size="sm" variant="ghost" aria-label={t('Dismiss')} onClick={() => m.dismiss.mutate(p.id)} data-pip-dismiss>
        <X className="size-4" aria-hidden />
      </Button>
    </section>
  );
}
