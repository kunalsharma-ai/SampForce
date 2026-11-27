'use client';

import {
  GOAL_MEASURES,
  PIP_DECISIONS,
  PIP_REVIEW_FREQUENCIES,
  PIP_REVIEW_FREQUENCY_LABEL,
  PIP_STATUS_LABEL,
  type PipDecision,
  type PipDetail,
  type PipEvent,
  type PipReviewFrequency,
  type PipRow,
  type PipsView,
} from '@dealflow/types';
import { Button, Card, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { CalendarClock, ClipboardCheck, Pencil, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { UserAvatar } from '@/components/people/user-avatar';
import { Bar } from '@/components/task-plans/progress-ring';
import { formatDate } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { usePip, usePipMutations, usePips } from '@/lib/recognition';
import { GoalList } from './goal-list';
import { type GoalDraft, draftsOf, GoalsEditor, goalsOf, PersonSelect } from './goals-editor';

/*
 * Performance improvement plans for managers and the Super Workspace (ADR 0102): assign, follow, evaluate, review and
 * decide. The person on a plan sees their own plans here too. Nothing closes a plan by itself when its end date passes.
 */

const DECISION_LABEL: Record<PipDecision, MessageKey> = {
  COMPLETE: 'Successfully completed',
  EXTEND: 'Extend the plan',
  UNSUCCESSFUL: 'Close as unsuccessful',
  CANCEL: 'Cancel the plan',
};

const EVENT_LABEL: Record<PipEvent['kind'], MessageKey> = {
  CREATED: 'Plan created',
  ACTIVATED: 'Plan started',
  ACKNOWLEDGED: 'Acknowledged',
  UPDATED: 'Plan changed',
  COMMENT: 'Comment',
  EVALUATION: 'Evaluation',
  REVIEW: 'Review',
  GOAL_MET: 'Goal met',
  READY_FOR_REVIEW: 'Ready for review',
  EXTENDED: 'Extended',
  COMPLETED: 'Successfully completed',
  UNSUCCESSFUL: 'Unsuccessful',
  CANCELLED: 'Cancelled',
};

export function PlansBoard({ openPlan, onOpenPlan }: { openPlan: string | null; onOpenPlan: (id: string | null) => void }) {
  const t = useT();
  const q = usePips();
  const [editing, setEditing] = useState<PipRow | 'new' | null>(null);
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorText error={q.error} />;
  const v = q.data;
  return (
    <div className="space-y-5" data-plans-board>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t('Plans show on the person’s dashboard while they are open. Goals count by themselves; only an authorised person decides a plan.')}</p>
        {v.canAssign && (
          <Button className="ml-auto" onClick={() => setEditing('new')} data-new-plan>
            <Plus className="mr-1.5 size-4" aria-hidden />
            {t('Assign a plan')}
          </Button>
        )}
      </div>
      {v.mine.length > 0 && <PlanList title={t('Your plans')} rows={v.mine} onOpen={onOpenPlan} />}
      <PlanList title={t('Open plans')} rows={v.open.filter((r) => !v.mine.some((m) => m.id === r.id))} onOpen={onOpenPlan} empty={t('No open plans.')} />
      {v.drafts.length > 0 && <PlanList title={t('Drafts')} rows={v.drafts} onOpen={onOpenPlan} />}
      {v.closed.length > 0 && <PlanList title={t('Closed plans')} rows={v.closed} onOpen={onOpenPlan} />}
      {editing && <PlanDialog v={v} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => onOpenPlan(id)} />}
      {openPlan && <PlanDetailDialog id={openPlan} onClose={() => onOpenPlan(null)} onEdit={(r) => { onOpenPlan(null); setEditing(r); }} />}
    </div>
  );
}

function PlanStatus({ status }: { status: PipRow['status'] }) {
  const t = useT();
  const tone =
    status === 'COMPLETED' ? 'bg-success/15 text-success' : status === 'UNSUCCESSFUL' ? 'bg-critical/10 text-critical' : status === 'READY_FOR_REVIEW' || status === 'UNDER_REVIEW' ? 'bg-warning/15 text-warning' : status === 'DRAFT' || status === 'CANCELLED' ? 'bg-muted text-muted-foreground' : 'bg-[#4338ca]/12 text-[#4338ca] dark:text-[#a5b4fc]';
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold', tone)} data-plan-status={status}>
      {t.maybe(PIP_STATUS_LABEL[status])}
    </span>
  );
}

function PlanList({ title, rows, onOpen, empty }: { title: string; rows: PipRow[]; onOpen: (id: string) => void; empty?: string }) {
  const t = useT();
  return (
    <Card className="p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="flex w-full flex-wrap items-center gap-3 py-2.5 text-left" onClick={() => onOpen(r.id)} data-plan-row={r.person.name}>
                <UserAvatar userId={r.person.id} name={r.person.name} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.number} · {r.person.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.title} · {formatDate(r.startsOn)} – {formatDate(r.endsOn)}
                  </span>
                </span>
                <span className="w-28">
                  <Bar percent={r.percent} label={t('Improvement plan progress')} />
                  <span className="text-xs tabular-nums text-muted-foreground">{t('{met} of {total} goals met', { met: r.goalsMet, total: r.goals.length })}</span>
                </span>
                <PlanStatus status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function PlanDialog({ v, row, onClose, onSaved }: { v: PipsView; row: PipRow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const m = usePipMutations();
  const start = todayIso();
  const [f, setF] = useState({
    title: row?.title ?? '',
    userId: row?.person.id ?? '',
    employeeCode: row?.person.employeeCode ?? '',
    reason: row?.reason ?? '',
    areas: row?.areas.join(', ') ?? '',
    currentLevel: row?.currentLevel ?? '',
    requiredLevel: row?.requiredLevel ?? '',
    goals: row ? draftsOf(row.goals) : ([{ measure: 'CALLS', amount: '15', per: 'DAY', label: '' }, { measure: 'MANUAL', amount: '70', per: 'PERIOD', label: '' }] as GoalDraft[]),
    startsOn: row?.startsOn ?? start,
    endsOn: row?.endsOn ?? plusDays(start, 29),
    reviewFrequency: (row?.reviewFrequency ?? 'WEEKLY') as PipReviewFrequency,
    reviewDates: row?.reviewFrequency === 'CUSTOM' ? row.reviewDates.join(', ') : '',
    requiredPercent: String(row?.requiredPercent ?? 100),
    managerComments: '',
    comment: '',
  });
  const mut = row ? m.update : m.create;
  const dates = f.reviewDates.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean);
  const save = (activate: boolean) => {
    const common = {
      title: f.title.trim(),
      employeeCode: f.employeeCode.trim() || undefined,
      reason: f.reason.trim(),
      areas: f.areas.split(',').map((a) => a.trim()).filter(Boolean),
      currentLevel: f.currentLevel.trim() || undefined,
      requiredLevel: f.requiredLevel.trim() || undefined,
      goals: goalsOf(f.goals),
      reviewFrequency: f.reviewFrequency,
      ...(f.reviewFrequency === 'CUSTOM' ? { reviewDates: dates } : {}),
      requiredPercent: Number(f.requiredPercent),
    };
    if (row) m.update.mutate({ id: row.id, input: { ...common, comment: f.comment.trim() || undefined } }, { onSuccess: onClose });
    else m.create.mutate({ ...common, userId: f.userId, startsOn: f.startsOn, endsOn: f.endsOn, managerComments: f.managerComments.trim() || undefined, activate }, { onSuccess: (d) => { onClose(); onSaved(d.id); } });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-6" data-plan-dialog>
        <DialogTitle className="text-lg font-semibold">{row ? t('Change improvement plan {number}', { number: row.number }) : t('Assign an improvement plan')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('The person sees the plan on their dashboard once it starts, with each goal and what is left to do. Manager evaluation goals are scored by you.')}</DialogDescription>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="p-person" label={t('Person')}>
              <PersonSelect id="p-person" people={row ? [row.person] : v.people} value={f.userId} disabled={!!row} onChange={(userId) => setF({ ...f, userId, employeeCode: v.people.find((p) => p.id === userId)?.employeeCode ?? f.employeeCode })} />
            </Field>
            <Field id="p-code" label={t('Employee ID (optional)')}>
              <Input id="p-code" value={f.employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} />
            </Field>
          </div>
          <Field id="p-title" label={t('Plan title')}>
            <Input id="p-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field id="p-reason" label={t('Why the plan is needed')}>
            <Textarea id="p-reason" rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <Field id="p-areas" label={t('Areas to improve (separate with commas)')}>
            <Input id="p-areas" value={f.areas} onChange={(e) => setF({ ...f, areas: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="p-current" label={t('Current level (optional)')}>
              <Input id="p-current" value={f.currentLevel} onChange={(e) => setF({ ...f, currentLevel: e.target.value })} />
            </Field>
            <Field id="p-required" label={t('Required level (optional)')}>
              <Input id="p-required" value={f.requiredLevel} onChange={(e) => setF({ ...f, requiredLevel: e.target.value })} />
            </Field>
          </div>
          <GoalsEditor value={f.goals} onChange={(goals) => setF({ ...f, goals })} measures={GOAL_MEASURES} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="p-start" label={t('Start date')}>
              <Input id="p-start" type="date" value={f.startsOn} disabled={!!row} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            </Field>
            <Field id="p-end" label={t('End date')}>
              <Input id="p-end" type="date" value={f.endsOn} disabled={!!row} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
            </Field>
            <Field id="p-percent" label={t('Goals needed (%)')}>
              <Input id="p-percent" inputMode="numeric" value={f.requiredPercent} onChange={(e) => setF({ ...f, requiredPercent: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="p-freq" label={t('Reviews')}>
              <Select id="p-freq" value={f.reviewFrequency} onChange={(e) => setF({ ...f, reviewFrequency: e.target.value as PipReviewFrequency })}>
                {PIP_REVIEW_FREQUENCIES.map((x) => (
                  <option key={x} value={x}>
                    {t.maybe(PIP_REVIEW_FREQUENCY_LABEL[x])}
                  </option>
                ))}
              </Select>
            </Field>
            {f.reviewFrequency === 'CUSTOM' && (
              <Field id="p-dates" label={t('Review dates (YYYY-MM-DD, separate with commas)')}>
                <Input id="p-dates" value={f.reviewDates} onChange={(e) => setF({ ...f, reviewDates: e.target.value })} />
              </Field>
            )}
          </div>
          {row ? (
            <Field id="p-why" label={t('Why it changed (shown to the person)')}>
              <Textarea id="p-why" rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
            </Field>
          ) : (
            <Field id="p-comments" label={t('Manager comments (optional)')}>
              <Textarea id="p-comments" rows={2} value={f.managerComments} onChange={(e) => setF({ ...f, managerComments: e.target.value })} />
            </Field>
          )}
          <ErrorText error={mut.error} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Close')}
            </Button>
            {row ? (
              <Button onClick={() => save(false)} disabled={mut.isPending} data-save-plan>
                {t('Save changes')}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => save(false)} disabled={mut.isPending || !f.userId} data-save-draft>
                  {t('Save as draft')}
                </Button>
                <Button onClick={() => save(true)} disabled={mut.isPending || !f.userId} data-start-plan>
                  {t('Start the plan')}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlanDetailDialog({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (r: PipRow) => void }) {
  const t = useT();
  const q = usePip(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-6" data-plan-detail>
        {!q.data ? (
          <>
            <DialogTitle className="sr-only">{t('Improvement plan')}</DialogTitle>
            {q.error ? <ErrorText error={q.error} /> : <Skeleton className="h-64" />}
          </>
        ) : (
          <PlanDetailBody p={q.data} onEdit={onEdit} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanDetailBody({ p, onEdit }: { p: PipDetail; onEdit: (r: PipRow) => void }) {
  const t = useT();
  const m = usePipMutations();
  const [comment, setComment] = useState('');
  const [review, setReview] = useState({ notes: '', next: '' });
  const [decision, setDecision] = useState<{ decision: PipDecision; comment: string; endsOn: string }>({ decision: 'COMPLETE', comment: '', endsOn: '' });
  const [evals, setEvals] = useState<Record<string, { score: string; comments: string }>>({});
  const manual = p.goals.filter((g) => g.measure === 'MANUAL');
  return (
    <>
      <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        <ClipboardCheck className="size-5 text-[#4338ca]" aria-hidden />
        {p.number} · {p.person.name}
        <PlanStatus status={p.status} />
      </DialogTitle>
      <DialogDescription className="text-sm text-muted-foreground">
        {p.title} · {formatDate(p.startsOn)} – {formatDate(p.endsOn)}
        {p.endsOn !== p.originalEndsOn ? ` (${t('first end date {date}', { date: formatDate(p.originalEndsOn) })})` : ''} · {t('Assigned by {name}', { name: p.assignedBy.name })}
      </DialogDescription>
      <div className="mt-4 space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="font-medium">{t('Why the plan is needed')}: </span>
            {p.reason}
          </p>
          <p>
            <span className="font-medium">{t('Areas to improve')}: </span>
            {p.areas.join(', ')}
          </p>
          {p.currentLevel && (
            <p>
              <span className="font-medium">{t('Current level')}: </span>
              {p.currentLevel}
            </p>
          )}
          {p.requiredLevel && (
            <p>
              <span className="font-medium">{t('Required level')}: </span>
              {p.requiredLevel}
            </p>
          )}
          <p>{t('{met} of {total} goals met', { met: p.goalsMet, total: p.goals.length })} · {Math.round(p.percent)}%</p>
          {p.nextReviewOn && (
            <p className="flex items-center gap-1.5">
              <CalendarClock className="size-4" aria-hidden />
              {t('Next review: {date}', { date: formatDate(p.nextReviewOn) })}
            </p>
          )}
        </div>
        <GoalList goals={p.goals} currency={p.currency} />

        {p.can.evaluate && manual.length > 0 && (
          <section className="space-y-2" data-evaluations>
            <h4 className="text-sm font-semibold">{t('Score the manager evaluation goals')}</h4>
            {manual.map((g) => {
              const e = evals[g.id] ?? { score: '', comments: '' };
              return (
                <div key={g.id} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,2fr)_auto]" data-evaluate={g.id}>
                  <span className="self-center text-sm">{t.maybe(g.label)}</span>
                  <Input aria-label={t('Score (0 to 100)')} inputMode="numeric" value={e.score} onChange={(x) => setEvals({ ...evals, [g.id]: { ...e, score: x.target.value } })} />
                  <Input aria-label={t('Comments')} placeholder={t('Comments')} value={e.comments} onChange={(x) => setEvals({ ...evals, [g.id]: { ...e, comments: x.target.value } })} />
                  <Button size="sm" disabled={!e.score || !e.comments.trim() || m.evaluate.isPending} onClick={() => m.evaluate.mutate({ id: p.id, goalId: g.id, score: Number(e.score), comments: e.comments.trim() }, { onSuccess: () => setEvals({ ...evals, [g.id]: { score: '', comments: '' } }) })}>
                    {t('Save score')}
                  </Button>
                </div>
              );
            })}
            <ErrorText error={m.evaluate.error} />
          </section>
        )}

        {p.can.review && (
          <section className="space-y-2" data-review-form>
            <h4 className="text-sm font-semibold">{t('Record a review')}</h4>
            <Textarea aria-label={t('Review notes')} placeholder={t('Review notes')} rows={2} value={review.notes} onChange={(e) => setReview({ ...review, notes: e.target.value })} />
            <div className="flex flex-wrap items-end gap-2">
              <Field id="r-next" label={t('Next review (optional)')}>
                <Input id="r-next" type="date" value={review.next} onChange={(e) => setReview({ ...review, next: e.target.value })} />
              </Field>
              <Button size="sm" disabled={!review.notes.trim() || m.review.isPending} onClick={() => m.review.mutate({ id: p.id, notes: review.notes.trim(), nextReviewOn: review.next || undefined }, { onSuccess: () => setReview({ notes: '', next: '' }) })} data-save-review>
                {t('Save review')}
              </Button>
            </div>
            <ErrorText error={m.review.error} />
          </section>
        )}

        {p.can.decide && (
          <section className="space-y-2 rounded-xl border border-border p-3" data-decision-form>
            <h4 className="text-sm font-semibold">{t('Decide the plan')}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select aria-label={t('Decision')} value={decision.decision} onChange={(e) => setDecision({ ...decision, decision: e.target.value as PipDecision })} data-decision>
                {PIP_DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(DECISION_LABEL[d])}
                  </option>
                ))}
              </Select>
              {decision.decision === 'EXTEND' && <Input aria-label={t('New end date')} type="date" value={decision.endsOn} onChange={(e) => setDecision({ ...decision, endsOn: e.target.value })} data-extend-to />}
            </div>
            <Textarea aria-label={t('Comment for the record')} placeholder={t('Comment for the record')} rows={2} value={decision.comment} onChange={(e) => setDecision({ ...decision, comment: e.target.value })} />
            <ErrorText error={m.decide.error} />
            <div className="flex justify-end">
              <Button size="sm" disabled={!decision.comment.trim() || m.decide.isPending} onClick={() => m.decide.mutate({ id: p.id, input: { decision: decision.decision, comment: decision.comment.trim(), ...(decision.decision === 'EXTEND' ? { endsOn: decision.endsOn } : {}) } }, { onSuccess: () => setDecision({ decision: 'COMPLETE', comment: '', endsOn: '' }) })} data-save-decision>
                {t('Record decision')}
              </Button>
            </div>
          </section>
        )}

        {p.can.comment && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{t('Add a comment')}</h4>
            <Textarea aria-label={t('Comment')} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            <ErrorText error={m.comment.error} />
            <div className="flex justify-end gap-2">
              {p.can.acknowledge && (
                <Button size="sm" variant="outline" onClick={() => m.acknowledge.mutate({ id: p.id, comment: comment.trim() || undefined }, { onSuccess: () => setComment('') })} disabled={m.acknowledge.isPending}>
                  {t('Acknowledge plan')}
                </Button>
              )}
              <Button size="sm" disabled={!comment.trim() || m.comment.isPending} onClick={() => m.comment.mutate({ id: p.id, body: comment.trim() }, { onSuccess: () => setComment('') })}>
                {t('Send comment')}
              </Button>
            </div>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-sm font-semibold">{t('History')}</h4>
          <ol className="space-y-2 border-l border-border pl-4" data-plan-history>
            {p.events.map((e) => (
              <li key={e.id} className="relative text-sm" data-event={e.kind}>
                <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-[#4338ca]" aria-hidden />
                <p>
                  <span className="font-medium">{t(EVENT_LABEL[e.kind])}</span>
                  <span className="text-muted-foreground"> · {e.by?.name ?? t('SampForce')} · {formatDate(e.at)}</span>
                </p>
                {e.body && <p className="text-muted-foreground">{e.body}</p>}
                {e.changes.length > 0 && <p className="text-xs text-muted-foreground">{e.changes.join('; ')}</p>}
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-wrap justify-end gap-2">
          {p.can.activate && (
            <Button onClick={() => m.activate.mutate(p.id)} disabled={m.activate.isPending} data-activate>
              <Play className="mr-1.5 size-4" aria-hidden />
              {t('Start the plan')}
            </Button>
          )}
          {p.can.edit && (
            <Button variant="outline" onClick={() => onEdit(p)}>
              <Pencil className="mr-1.5 size-4" aria-hidden />
              {t('Change plan')}
            </Button>
          )}
        </div>
        <ErrorText error={m.activate.error} />
      </div>
    </>
  );
}
