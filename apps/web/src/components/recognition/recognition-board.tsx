'use client';

import {
  ELIGIBILITY_RULE_LABEL,
  ELIGIBILITY_RULES,
  type EligibilityRule,
  RANKING_CRITERIA,
  RANKING_CRITERION_LABEL,
  type RankingCriterion,
  RECOGNITION_MEASURES,
  RECOGNITION_SELECTION,
  RECOGNITION_SELECTION_LABEL,
  RECOGNITION_STATUS_LABEL,
  type RecognitionAwardRow,
  type RecognitionPolicy,
  type RecognitionScopeView,
  type RecognitionTargetRow,
  type RecognitionView,
  TIE_BREAK_LABEL,
  TIE_BREAKS,
} from '@dealflow/types';
import { Button, Card, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Crown, Download, History, Pencil, Plus, Sparkles, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { UserAvatar } from '@/components/people/user-avatar';
import { Bar } from '@/components/task-plans/progress-ring';
import { downloadFile } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { monthLabel, shiftMonth, useRecognitionMutations, useRecognitionView } from '@/lib/recognition';
import { GoalList } from './goal-list';
import { type GoalDraft, draftsOf, GoalsEditor, goalsOf, PersonSelect } from './goals-editor';

/*
 * Employee of the Month for managers and the Super Workspace (ADR 0102): the month's targets, the ranking of the
 * people in reach, choosing the winner (or the automatic run), withdrawing an award, and the winners so far.
 */

export function RecognitionBoard() {
  const t = useT();
  const [month, setMonth] = useState<string | null>(null);
  const q = useRecognitionView(month);
  const [editing, setEditing] = useState<RecognitionTargetRow | 'new' | null>(null);
  const [open, setOpen] = useState<RecognitionTargetRow | null>(null);
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorText error={q.error} />;
  const v = q.data;
  const shown = v.month;
  return (
    <div className="space-y-5" data-recognition-board>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('Previous month')} onClick={() => setMonth(shiftMonth(shown, -1))}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <h2 className="min-w-40 text-center text-lg font-semibold" data-month={shown}>
          {monthLabel(shown, t.formatLocale)}
        </h2>
        <Button variant="outline" size="icon" aria-label={t('Next month')} onClick={() => setMonth(shiftMonth(shown, 1))}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        {shown !== v.currentMonth && (
          <Button variant="ghost" size="sm" onClick={() => setMonth(null)}>
            {t('This month')}
          </Button>
        )}
        {v.canSetTargets && shown >= v.currentMonth && (
          <Button className="ml-auto" onClick={() => setEditing('new')} data-new-target>
            <Plus className="mr-1.5 size-4" aria-hidden />
            {t('Set a target')}
          </Button>
        )}
      </div>

      {v.scopes.map((s) => (
        <ScopePanel key={s.team?.id ?? 'org'} s={s} v={v} />
      ))}

      <Card className="p-4" data-targets>
        <h3 className="mb-3 font-semibold">{t('Targets this month')}</h3>
        {v.targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{v.canSetTargets ? t('No targets for this month yet. Set one for each person who can become Employee of the Month.') : t('No targets for this month.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {v.targets.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5" data-target-row={r.person.name}>
                <UserAvatar userId={r.person.id} name={r.person.name} className="size-9" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(r)}>
                  <span className="block truncate font-medium">{r.person.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[r.name, r.person.designation, r.person.workspace.name].filter(Boolean).join(' · ')}</span>
                </button>
                <div className="w-32">
                  <Bar percent={r.achievementPercent} label={t('Achievement')} />
                  <span className="text-xs tabular-nums text-muted-foreground">{Math.round(r.achievementPercent)}%</span>
                </div>
                <StatusChip status={r.status} />
                {r.editable && (
                  <Button size="icon" variant="ghost" aria-label={t('Change target')} onClick={() => setEditing(r)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <HistoryList awards={v.history} />
      {editing && <TargetDialog v={v} row={editing === 'new' ? null : editing} month={shown} onClose={() => setEditing(null)} />}
      {open && <TargetDetail r={open} currency={v.currency} onClose={() => setOpen(null)} onEdit={open.editable ? () => { setEditing(open); setOpen(null); } : undefined} />}
    </div>
  );
}

function StatusChip({ status }: { status: RecognitionTargetRow['status'] }) {
  const t = useT();
  return (
    <span
      className={cn('inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold', status === 'AWARDED' ? 'bg-[#f5c542]/30 text-[#7c4a03] dark:text-[#fde68a]' : status === 'ELIGIBLE' || status === 'NOT_SELECTED' ? 'bg-success/15 text-success' : status === 'CANCELLED' ? 'bg-critical/10 text-critical' : 'bg-muted text-muted-foreground')}
      data-status={status}
    >
      {t.maybe(RECOGNITION_STATUS_LABEL[status])}
    </span>
  );
}

function ScopePanel({ s, v }: { s: RecognitionScopeView; v: RecognitionView }) {
  const t = useT();
  const m = useRecognitionMutations();
  const [revoking, setRevoking] = useState<RecognitionAwardRow | null>(null);
  const [choosing, setChoosing] = useState<RecognitionTargetRow | null>(null);
  const title = s.scope === 'TEAM' && s.team ? t('Team winner: {team}', { team: s.team.name }) : t('Organisation winner');
  const running = v.month <= v.currentMonth;
  return (
    <Card className="p-4" data-scope={s.scope} data-scope-team={s.team?.name}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {s.scope === 'ORGANISATION' && v.canEditPolicy && !s.award && running && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => m.select.mutate(v.month)} disabled={m.select.isPending} data-run-selection>
            <Sparkles className="mr-1.5 size-4" aria-hidden />
            {t('Run automatic selection')}
          </Button>
        )}
      </div>
      <ErrorText error={m.select.error} />
      {s.notice && <p className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" data-scope-notice>{t.maybe(s.notice)}</p>}
      {s.award ? (
        <div className="eom-spotlight mb-3 flex flex-wrap items-center gap-3 rounded-xl p-3" data-award={s.award.person.name}>
          <span className="relative">
            <UserAvatar userId={s.award.person.id} name={s.award.person.name} className="size-11" />
            <Crown className="absolute -right-1 -top-2 size-5 rotate-12 fill-[#f5c542] text-[#b7791f]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{s.award.person.name}</p>
            <p className="text-xs text-muted-foreground">
              {s.award.method === 'AUTOMATIC' ? t('Selected automatically by ranking') : t('Selected by {name}', { name: s.award.selectedBy?.name ?? '' })} · {t('{percent}% of goals', { percent: Math.round(s.award.achievementPercent) })} · {t('Score {score}', { score: Math.round(s.award.score) })}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void downloadFile(`/recognition/awards/${s.award!.id}/certificate`, `employee-of-the-month-${s.award!.month}.pdf`)}>
            <Download className="mr-1.5 size-4" aria-hidden />
            {t('Certificate')}
          </Button>
          {s.award.canRevoke && (
            <Button size="sm" variant="ghost" onClick={() => setRevoking(s.award)} data-revoke>
              <Undo2 className="mr-1.5 size-4" aria-hidden />
              {t('Withdraw')}
            </Button>
          )}
        </div>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">{s.canSelect ? t('Not chosen yet. Choose from the eligible people below.') : t('Not chosen yet.')}</p>
      )}
      {s.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Nobody has a target here this month.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm" data-ranking>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">{t('Person')}</th>
                <th className="py-1 pr-2">{t('Achievement')}</th>
                <th className="py-1 pr-2">{t('Performance score')}</th>
                <th className="py-1 pr-2">{t('Status')}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {s.candidates.map((c) => (
                <tr key={c.target.id} className="border-t border-border" data-candidate={c.target.person.name}>
                  <td className="py-2 pr-2 tabular-nums">{c.rank}</td>
                  <td className="py-2 pr-2">
                    <span className="font-medium">{c.target.person.name}</span>
                    {c.tiedWithNext && <span className="ml-2 rounded bg-warning/15 px-1.5 text-xs text-warning">{t('Tied')}</span>}
                  </td>
                  <td className="py-2 pr-2 tabular-nums">{Math.round(c.target.achievementPercent)}%</td>
                  <td className="py-2 pr-2 tabular-nums">{Math.round(c.target.performance.score)}</td>
                  <td className="py-2 pr-2">
                    <StatusChip status={c.target.status} />
                  </td>
                  <td className="py-2 text-right">
                    {s.canSelect && !s.award && c.target.eligible && running && (
                      <Button size="sm" onClick={() => setChoosing(c.target)} data-choose={c.target.person.name}>
                        {t('Choose as winner')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoking && <RevokeDialog a={revoking} onClose={() => setRevoking(null)} />}
      {choosing && <ChooseDialog r={choosing} month={v.month} onClose={() => setChoosing(null)} />}
    </Card>
  );
}

function ChooseDialog({ r, month, onClose }: { r: RecognitionTargetRow; month: string; onClose: () => void }) {
  const t = useT();
  const m = useRecognitionMutations();
  const [note, setNote] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Choose {name} as Employee of the Month?', { name: r.person.name })}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('They and their managers are told, the award shows on the dashboards and a certificate is ready to download.')}</DialogDescription>
        <Textarea aria-label={t('Note (optional)')} placeholder={t('Note (optional)')} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-3" />
        <ErrorText error={m.award.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button onClick={() => m.award.mutate({ month, userId: r.person.id, note: note.trim() || undefined }, { onSuccess: onClose })} disabled={m.award.isPending} data-confirm-award>
            {t('Choose as winner')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ a, onClose }: { a: RecognitionAwardRow; onClose: () => void }) {
  const t = useT();
  const m = useRecognitionMutations();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Withdraw this award?')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('The award stays in the history as withdrawn, with your reason. You can then choose again.')}</DialogDescription>
        <Textarea aria-label={t('Reason')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3" />
        <ErrorText error={m.revoke.error} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Close')}
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || m.revoke.isPending} onClick={() => m.revoke.mutate({ id: a.id, reason: reason.trim() }, { onSuccess: onClose })} data-confirm-revoke>
            {t('Withdraw')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryList({ awards }: { awards: RecognitionAwardRow[] }) {
  const t = useT();
  return (
    <Card className="p-4" data-history>
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <History className="size-4" aria-hidden />
        {t('Winners so far')}
      </h3>
      {awards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No winners yet.')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {awards.map((a) => (
            <li key={a.id} className={cn('flex flex-wrap items-center gap-3 py-2', a.revoked && 'opacity-60')} data-history-row={a.person.name}>
              <UserAvatar userId={a.person.id} name={a.person.name} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.person.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[monthLabel(a.month, t.formatLocale), a.scope === 'TEAM' && a.team ? a.team.name : t('Organisation winner'), a.revoked ? t('Withdrawn: {reason}', { reason: a.revoked.reason }) : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {!a.revoked && (
                <Button size="icon" variant="ghost" aria-label={t('Download certificate')} onClick={() => void downloadFile(`/recognition/awards/${a.id}/certificate`, `employee-of-the-month-${a.month}.pdf`)}>
                  <Download className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TargetDetail({ r, currency, onClose, onEdit }: { r: RecognitionTargetRow; currency: string; onClose: () => void; onEdit?: () => void }) {
  const t = useT();
  const m = useRecognitionMutations();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-6" data-target-detail>
        <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {r.person.name} <StatusChip status={r.status} />
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {[r.name, `${formatDate(r.startsOn)} – ${formatDate(r.endsOn)}`, r.setBy ? t('Set by {name}', { name: r.setBy.name }) : null].filter(Boolean).join(' · ')}
        </DialogDescription>
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p>{t('Achievement: {percent}%', { percent: Math.round(r.achievementPercent) })}</p>
            <p>{t('Performance score: {score}', { score: Math.round(r.performance.score) })}</p>
            <p>{t.maybe(ELIGIBILITY_RULE_LABEL[r.eligibility])} ({r.minAchievementPercent}%)</p>
          </div>
          <GoalList goals={r.goals} currency={currency} />
          <div className="text-xs text-muted-foreground">
            {r.performance.parts.map((p) => (
              <span key={p.key} className="mr-3">
                {t.maybe(p.label)}: {p.value === null ? t('no data') : Math.round(p.value)}
              </span>
            ))}
          </div>
          {r.reward && <p className="text-sm">{t('Reward: {reward}', { reward: r.reward })}</p>}
          {r.conditions && <p className="text-sm">{r.conditions}</p>}
          {r.revisions.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">{t('Changes')}</h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {r.revisions.map((x, i) => (
                  <li key={i}>
                    {formatDate(x.at)} · {x.by}: {x.changes.join('; ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ErrorText error={m.cancel.error} />
          <div className="flex justify-end gap-2">
            {onEdit && (
              <>
                <Button variant="ghost" onClick={() => m.cancel.mutate(r.id, { onSuccess: onClose })} disabled={m.cancel.isPending} data-cancel-target>
                  <XCircle className="mr-1.5 size-4" aria-hidden />
                  {t('Cancel target')}
                </Button>
                <Button variant="outline" onClick={onEdit}>
                  <Pencil className="mr-1.5 size-4" aria-hidden />
                  {t('Change target')}
                </Button>
              </>
            )}
            <Button onClick={onClose}>{t('Close')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TargetDialog({ v, row, month, onClose }: { v: RecognitionView; row: RecognitionTargetRow | null; month: string; onClose: () => void }) {
  const t = useT();
  const m = useRecognitionMutations();
  const [f, setF] = useState({
    name: row?.name ?? t('Employee of the Month – {month}', { month: monthLabel(month, t.formatLocale) }),
    userId: row?.person.id ?? '',
    goals: row ? draftsOf(row.goals) : ([{ measure: 'REVENUE', amount: '10000', per: 'PERIOD', label: '' }, { measure: 'CALLS', amount: '20', per: 'DAY', label: '' }] as GoalDraft[]),
    eligibility: (row?.eligibility ?? 'EVERY_GOAL') as EligibilityRule,
    min: String(row?.minAchievementPercent ?? 100),
    minScore: row?.minScore === null || row?.minScore === undefined ? '' : String(row.minScore),
    reward: row?.reward ?? '',
    conditions: row?.conditions ?? '',
    description: row?.description ?? '',
  });
  const mut = row ? m.update : m.create;
  const save = () => {
    const common = {
      name: f.name.trim(),
      goals: goalsOf(f.goals),
      eligibility: f.eligibility,
      minAchievementPercent: Number(f.min),
      minScore: f.minScore.trim() ? Number(f.minScore) : null,
      reward: f.reward.trim() || undefined,
      conditions: f.conditions.trim() || undefined,
      description: f.description.trim() || undefined,
    };
    if (row) m.update.mutate({ id: row.id, input: common }, { onSuccess: onClose });
    else m.create.mutate({ ...common, month, userId: f.userId }, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-6" data-target-dialog>
        <DialogTitle className="text-lg font-semibold">{row ? t('Change target') : t('Set an Employee of the Month target')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('Progress counts by itself from the person’s records. Reaching the target makes them eligible; the winner is chosen from the eligible people.')}</DialogDescription>
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="t-person" label={t('Person')}>
              <PersonSelect id="t-person" people={row ? [row.person] : v.people} value={f.userId} onChange={(userId) => setF({ ...f, userId })} disabled={!!row} />
            </Field>
            <Field id="t-name" label={t('Name')}>
              <Input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
          </div>
          <GoalsEditor value={f.goals} onChange={(goals) => setF({ ...f, goals })} measures={RECOGNITION_MEASURES} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="t-rule" label={t('Eligible when')}>
              <Select id="t-rule" value={f.eligibility} onChange={(e) => setF({ ...f, eligibility: e.target.value as EligibilityRule })}>
                {ELIGIBILITY_RULES.map((r) => (
                  <option key={r} value={r}>
                    {t.maybe(ELIGIBILITY_RULE_LABEL[r])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="t-min" label={t('Minimum achievement (%)')}>
              <Input id="t-min" inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
            </Field>
            <Field id="t-score" label={t('Minimum performance score (optional)')}>
              <Input id="t-score" inputMode="numeric" value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} />
            </Field>
          </div>
          <Field id="t-reward" label={t('Reward (optional)')}>
            <Input id="t-reward" value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} />
          </Field>
          <Field id="t-conditions" label={t('Other conditions (optional)')}>
            <Textarea id="t-conditions" rows={2} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />
          </Field>
          <Field id="t-description" label={t('Description (optional)')}>
            <Textarea id="t-description" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <ErrorText error={mut.error} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Close')}
            </Button>
            <Button onClick={save} disabled={mut.isPending || (!row && !f.userId)} data-save-target>
              {row ? t('Save changes') : t('Set target')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The Super Workspace's rules for Employee of the Month and plans. */
export function RecognitionSettings({ policy }: { policy: RecognitionPolicy }) {
  const t = useT();
  const m = useRecognitionMutations();
  const [p, setP] = useState<RecognitionPolicy>(policy);
  const move = (i: number, by: number) => {
    const r = [...p.ranking];
    const [x] = r.splice(i, 1);
    r.splice(i + by, 0, x!);
    setP({ ...p, ranking: r });
  };
  const flag = (k: keyof RecognitionPolicy, label: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5" checked={p[k] as boolean} onChange={(e) => setP({ ...p, [k]: e.target.checked })} data-flag={k} />
      {label}
    </label>
  );
  return (
    <Card className="max-w-3xl space-y-4 p-5" data-recognition-settings>
      <Field id="p-selection" label={t('How the winner is chosen')}>
        <Select id="p-selection" value={p.selection} onChange={(e) => setP({ ...p, selection: e.target.value as RecognitionPolicy['selection'] })}>
          {RECOGNITION_SELECTION.map((s) => (
            <option key={s} value={s}>
              {t.maybe(RECOGNITION_SELECTION_LABEL[s])}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium">{t('Ranking, in order')}</p>
        <ol className="space-y-1">
          {p.ranking.map((c, i) => (
            <li key={c} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm" data-criterion={c}>
              <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="flex-1">{t.maybe(RANKING_CRITERION_LABEL[c])}</span>
              <Button size="icon" variant="ghost" aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t('Move down')} disabled={i === p.ranking.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t('Remove')} disabled={p.ranking.length === 1} onClick={() => setP({ ...p, ranking: p.ranking.filter((x) => x !== c) })}>
                <XCircle className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        {p.ranking.length < RANKING_CRITERIA.length && (
          <Select aria-label={t('Add a criterion')} className="mt-2" value="" onChange={(e) => e.target.value && setP({ ...p, ranking: [...p.ranking, e.target.value as RankingCriterion] })}>
            <option value="">{t('Add a criterion')}</option>
            {RANKING_CRITERIA.filter((c) => !p.ranking.includes(c)).map((c) => (
              <option key={c} value={c}>
                {t.maybe(RANKING_CRITERION_LABEL[c])}
              </option>
            ))}
          </Select>
        )}
      </div>
      <Field id="p-tie" label={t('When people are tied')}>
        <Select id="p-tie" value={p.tieBreak} onChange={(e) => setP({ ...p, tieBreak: e.target.value as RecognitionPolicy['tieBreak'] })}>
          {TIE_BREAKS.map((s) => (
            <option key={s} value={s}>
              {t.maybe(TIE_BREAK_LABEL[s])}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('What managers may do for their executives')}</p>
        {flag('managersSetTargets', t('Set Employee of the Month targets'))}
        {flag('managersSelectTeamWinner', t('Choose their team’s Employee of the Month'))}
        {flag('managersAssignPlans', t('Assign improvement plans'))}
        {flag('managersDecidePlans', t('Decide improvement plans (complete, extend, unsuccessful, cancel)'))}
        {flag('superFollowsAllPlans', t('Tell the Super Workspace about every plan’s progress and reviews'))}
      </div>
      <Field id="p-remind" label={t('Remind reviewers this many days before a review')}>
        <Input id="p-remind" inputMode="numeric" value={String(p.reviewReminderDays)} onChange={(e) => setP({ ...p, reviewReminderDays: Math.max(0, Math.min(14, Number(e.target.value) || 0)) })} />
      </Field>
      <ErrorText error={m.policy.error} />
      <div className="flex items-center justify-end gap-3">
        {m.policy.isSuccess && <span className="text-sm text-success">{t('Saved')}</span>}
        <Button onClick={() => m.policy.mutate(p)} disabled={m.policy.isPending} data-save-policy>
          {t('Save rules')}
        </Button>
      </div>
    </Card>
  );
}
