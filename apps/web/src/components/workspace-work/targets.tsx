'use client';

import { useCanDelete } from '@/lib/features';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  MONEY_METRICS,
  METRIC_RULE,
  TARGET_METRIC_LABEL,
  TARGET_METRICS,
  TARGET_PERIOD_LABEL,
  TARGET_PERIODS,
  type TargetMetric,
  type TargetPeriod,
  type TargetRow,
  type TargetsView,
  WORKSPACE_LEVEL_LABEL,
} from '@dealflow/types';
import { History, Info, LineChart, Minus, Pencil, Plus, Split, Timer, TrendingDown, TrendingUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { Bar, MILESTONE_COLORS, MilestoneChip, milestoneOf, Ring } from '@/components/task-plans/progress-ring';
import { useT } from '@/lib/i18n';
import { useTargetTrend } from '@/lib/task-plans';
import { useTargetMutations, useTargets } from '@/lib/workspace-work';

type T = ReturnType<typeof useT>;
const LEVEL_ORDER = { SUPER: 0, MANAGER: 1, EXECUTIVE: 2 } as const;

export function formatTarget(t: T, value: number, currency: string | null): string {
  return currency
    ? new Intl.NumberFormat(t.formatLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
    : new Intl.NumberFormat(t.formatLocale, { maximumFractionDigits: 1 }).format(value);
}

function dates(t: T, r: TargetRow): string {
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(t.formatLocale, { dateStyle: 'medium', timeZone: 'UTC' });
  return r.startsOn === r.endsOn ? f(r.startsOn) : t('{start} to {end}', { start: f(r.startsOn), end: f(r.endsOn) });
}

/** Progress towards one target, from real records, as a bar in the milestone colours (ADR 0096). */
export function TargetProgress({ row }: { row: TargetRow }) {
  const t = useT();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular" data-target-progress>
          {t('{achieved} of {amount}', { achieved: formatTarget(t, row.achieved, row.currency), amount: formatTarget(t, row.amount, row.currency) })}
        </span>
        <span className="tabular text-muted-foreground">{t('{percent}%', { percent: row.percent })}</span>
      </div>
      <div className="mt-1">
        <Bar percent={row.percent} label={t.maybe(TARGET_METRIC_LABEL[row.metric])} />
      </div>
    </div>
  );
}

type Level = 'ALL' | 'SUPER' | 'MANAGER' | 'EXECUTIVE' | 'MINE';

/** Days left, or that it has not started or has ended. */
function timeLeft(t: T, r: TargetRow): string {
  if (r.state === 'UPCOMING') return t('Starts {date}', { date: new Date(`${r.startsOn}T00:00:00Z`).toLocaleDateString(t.formatLocale, { dateStyle: 'medium', timeZone: 'UTC' }) });
  if (r.state === 'ENDED') return t('Ended');
  return r.daysLeft === 1 ? t('Last day') : t('{n} days left', { n: r.daysLeft ?? 0 });
}

/** How this period compares with the one of the same length just before. */
function Comparison({ row }: { row: TargetRow }) {
  const t = useT();
  if (!row.previous) return null;
  const diff = row.achieved - row.previous.achieved;
  const tone = diff > 0 ? 'text-success' : diff < 0 ? 'text-critical' : 'text-muted-foreground';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`} data-target-previous>
      <Icon className="size-3.5" aria-hidden />
      {t('Previous period: {achieved} ({percent}%)', { achieved: formatTarget(t, row.previous.achieved, row.currency), percent: row.previous.percent })}
    </span>
  );
}

/** One target: the ring, what is left, the time left, the previous period, and the trend on demand. */
function TargetItem({ r, onSplit, onEdit, onRemove, mayDelete }: { r: TargetRow; onSplit: () => void; onEdit: () => void; onRemove: () => void; mayDelete: boolean }) {
  const t = useT();
  const [trend, setTrend] = useState(false);
  const metric = t.maybe(TARGET_METRIC_LABEL[r.metric]);
  return (
    <li className="space-y-3 rounded-xl border border-border p-3" data-target={`${r.workspace.name} ${r.metric}`} data-milestone-of={milestoneOf(r.percent)}>
      <div className="flex flex-wrap items-start gap-3">
        <Ring id={r.id} percent={r.percent} size={84} label={metric} caption={t.maybe(TARGET_PERIOD_LABEL[r.period])} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{t('{period} {metric}', { period: t.maybe(TARGET_PERIOD_LABEL[r.period]), metric: metric.toLowerCase() })}</p>
            <MilestoneChip percent={r.percent} />
            <span className="text-muted-foreground" title={t.maybe(r.rule)} aria-label={t.maybe(r.rule)} role="img">
              <Info className="size-3.5" aria-hidden />
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {dates(t, r)} · {r.source === 'SUPER' ? t('Set by the Super Workspace') : t('Handed down by the manager')}
            {r.setBy?.name ? ` (${r.setBy.name})` : ''}
          </p>
          {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
          <TargetProgress row={r} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="font-medium" data-target-remaining>
              {r.remaining > 0 ? t('{amount} to go', { amount: formatTarget(t, r.remaining, r.currency) }) : r.percent > 100 ? t('Exceeded by {amount}', { amount: formatTarget(t, r.achieved - r.amount, r.currency) }) : t('Target reached')}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground" data-target-time>
              <Timer className="size-3.5" aria-hidden />
              {timeLeft(t, r)}
            </span>
            <Comparison row={r} />
          </div>
        </div>
        <div className="flex gap-1">
          {r.canDistribute && (
            <Button size="sm" variant="outline" onClick={onSplit}>
              <Split className="size-4" aria-hidden />
              {t('Split among team')}
            </Button>
          )}
          <Button size="icon" variant="ghost" aria-label={t('Progress and history')} aria-expanded={trend} onClick={() => setTrend(!trend)}>
            <LineChart aria-hidden />
          </Button>
          {r.editable && (
            <>
              <Button size="icon" variant="ghost" aria-label={t('Change target')} onClick={onEdit}>
                <Pencil aria-hidden />
              </Button>
              {mayDelete && (
                <Button size="icon" variant="ghost" aria-label={t('Remove target')} onClick={onRemove}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {r.distributed > 0 && (
        <p className="text-xs text-muted-foreground">{t('Handed down: {done} of {amount}', { done: formatTarget(t, r.distributed, r.currency), amount: formatTarget(t, r.amount, r.currency) })}</p>
      )}
      {trend && <TargetTrendView row={r} />}
    </li>
  );
}

/** Cumulative progress day by day against the even pace that reaches the target on time, then earlier periods. */
function TargetTrendView({ row }: { row: TargetRow }) {
  const t = useT();
  const trend = useTargetTrend(row.id);
  if (trend.isPending) return <Skeleton className="h-40" />;
  if (trend.error) return <ErrorText error={trend.error} />;
  const { points, history } = trend.data;
  const W = 320;
  const H = 110;
  const top = Math.max(row.amount, ...points.map((p) => p.achieved), 1);
  const x = (i: number) => (points.length < 2 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - (v / top) * (H - 6) - 3;
  const line = (k: 'achieved' | 'pace') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  const [c1] = MILESTONE_COLORS[milestoneOf(row.percent)];
  return (
    <div className="grid gap-4 border-t border-border pt-3 md:grid-cols-[3fr_2fr]" data-target-trend>
      <figure>
        <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: c1 }} aria-hidden />
            {t('Achieved so far')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 border-t border-dashed border-muted-foreground" aria-hidden />
            {t('Pace to reach it on time')}
          </span>
        </figcaption>
        {points.length ? (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full overflow-visible" role="img" aria-label={t('{achieved} of {amount}', { achieved: formatTarget(t, row.achieved, row.currency), amount: formatTarget(t, row.amount, row.currency) })}>
            <line x1="0" x2={W} y1={y(row.amount)} y2={y(row.amount)} stroke="hsl(var(--border))" strokeDasharray="2 3" />
            <path d={line('pace')} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeDasharray="4 4" />
            <path d={line('achieved')} fill="none" stroke={c1} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        ) : (
          <p className="text-sm text-muted-foreground">{t('It has not started yet.')}</p>
        )}
      </figure>
      <div>
        <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <History className="size-3.5" aria-hidden />
          {t('Earlier periods')}
        </p>
        {history.length ? (
          <ul className="space-y-2" data-target-history>
            {history.map((h) => (
              <li key={h.startsOn} className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <span>{dates(t, { ...row, startsOn: h.startsOn, endsOn: h.endsOn })}</span>
                  <span className="tabular text-muted-foreground">
                    {formatTarget(t, h.achieved, row.currency)} · {t('{percent}%', { percent: h.percent })}
                  </span>
                </div>
                <Bar percent={h.percent} label={dates(t, { ...row, startsOn: h.startsOn, endsOn: h.endsOn })} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t('No earlier periods yet.')}</p>
        )}
      </div>
    </div>
  );
}

/** Targets by workspace: who set each one, how far it got, and what was handed down from it. */
export function TargetsBoard() {
  const t = useT();
  const view = useTargets();
  const mayDelete = useCanDelete('sales_target_management');
  const { remove } = useTargetMutations();
  const [setting, setSetting] = useState(false);
  const [editing, setEditing] = useState<TargetRow | null>(null);
  const [splitting, setSplitting] = useState<TargetRow | null>(null);
  const [level, setLevel] = useState<Level>('ALL');

  if (view.isPending) return <Skeleton className="h-64" />;
  if (view.error) return <ErrorText error={view.error} />;
  const data = view.data;
  const levels = new Set(data.targets.map((r) => r.workspace.level));
  const shown = data.targets.filter((r) => (level === 'ALL' ? true : level === 'MINE' ? r.workspace.id === data.myWorkspaceId : r.workspace.level === level));
  const groups = new Map<string, TargetRow[]>();
  for (const r of shown) groups.set(r.workspace.id, [...(groups.get(r.workspace.id) ?? []), r]);
  const ordered = [...groups.values()].sort((a, b) => LEVEL_ORDER[a[0]!.workspace.level] - LEVEL_ORDER[b[0]!.workspace.level] || a[0]!.workspace.name.localeCompare(b[0]!.workspace.name));
  const running = data.targets.filter((r) => r.state === 'RUNNING');
  const reached = running.filter((r) => r.percent >= 100).length;
  const tabs: { key: Level; label: string }[] = [
    { key: 'ALL', label: t('All') },
    ...(levels.has('SUPER') ? [{ key: 'SUPER' as const, label: t('Organisation') }] : []),
    ...(levels.has('MANAGER') && data.scope !== 'SELF' ? [{ key: 'MANAGER' as const, label: t('Managers') }] : []),
    ...(levels.has('EXECUTIVE') && data.scope !== 'SELF' ? [{ key: 'EXECUTIVE' as const, label: t('Executives') }] : []),
    ...(data.scope !== 'SELF' && data.targets.some((r) => r.workspace.id === data.myWorkspaceId) ? [{ key: 'MINE' as const, label: t('Yours') }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tabs.length > 2 ? <Tabs label={t('Targets')} tabs={tabs} value={level} onChange={setLevel} /> : <span />}
        {data.assignable.length > 0 && (
          <Button onClick={() => setSetting(true)}>
            <Plus className="size-4" aria-hidden />
            {t('Set a target')}
          </Button>
        )}
      </div>
      {running.length > 0 && (
        <p className="text-sm text-muted-foreground" data-targets-summary>
          {t('{reached} of {total} running targets reached', { reached, total: running.length })}
        </p>
      )}
      {ordered.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">{t('No targets yet.')}</CardContent>
        </Card>
      )}
      {ordered.map((rows) => {
        const ws = rows[0]!.workspace;
        return (
          <Card key={ws.id} data-targets-of={ws.name}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {ws.name}
                <Badge tone={ws.level === 'SUPER' ? 'success' : ws.level === 'MANAGER' ? 'primary' : 'neutral'}>{t.maybe(WORKSPACE_LEVEL_LABEL[ws.level])}</Badge>
                {ws.id === data.myWorkspaceId && <Badge tone="neutral">{t('Yours')}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {rows.map((r) => (
                  <TargetItem
                    key={r.id}
                    r={r}
                    mayDelete={mayDelete}
                    onSplit={() => setSplitting(r)}
                    onEdit={() => setEditing(r)}
                    onRemove={() => window.confirm(t('Remove this target? Parts handed down from it are removed too.')) && remove.mutate(r.id)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
      <ErrorText error={remove.error} />
      {setting && <SetTargetDialog view={data} onClose={() => setSetting(false)} />}
      {editing && <EditTargetDialog row={editing} onClose={() => setEditing(null)} />}
      {splitting && <SplitDialog row={splitting} view={data} onClose={() => setSplitting(null)} />}
    </div>
  );
}

function SetTargetDialog({ view, onClose }: { view: TargetsView; onClose: () => void }) {
  const t = useT();
  const { create } = useTargetMutations();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ workspaceId: view.assignable[0]?.id ?? '', metric: 'REVENUE' as TargetMetric, period: 'MONTHLY' as TargetPeriod, startsOn: `${today.slice(0, 7)}-01`, endsOn: '', amount: '', note: '' });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5%] max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Set a target')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('Progress counts the records of everyone in the workspace and the workspaces below it.')}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { workspaceId: f.workspaceId, metric: f.metric, period: f.period, startsOn: f.startsOn, ...(f.period === 'CUSTOM' ? { endsOn: f.endsOn } : {}), amount: Number(f.amount), ...(f.note.trim() ? { note: f.note } : {}) },
              { onSuccess: onClose },
            );
          }}
        >
          <Field id="st-workspace" label={t('Workspace')}>
            <Select id="st-workspace" value={f.workspaceId} onChange={(e) => setF({ ...f, workspaceId: e.target.value })}>
              {view.assignable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {t.maybe(WORKSPACE_LEVEL_LABEL[w.level])}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="st-metric" label={t('Measure')} hint={t.maybe(METRIC_RULE[f.metric])}>
              <Select id="st-metric" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as TargetMetric })}>
                {TARGET_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {t.maybe(TARGET_METRIC_LABEL[m])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="st-period" label={t('Period')}>
              <Select id="st-period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as TargetPeriod })}>
                {TARGET_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t.maybe(TARGET_PERIOD_LABEL[p])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="st-start" label={t('Starts on')}>
              <Input id="st-start" type="date" required value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            </Field>
            {f.period === 'CUSTOM' && (
              <Field id="st-end" label={t('Ends on')}>
                <Input id="st-end" type="date" required value={f.endsOn} min={f.startsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
              </Field>
            )}
            <Field id="st-amount" label={MONEY_METRICS.has(f.metric) ? t('Amount ({currency})', { currency: view.currency }) : t('Number')}>
              <Input id="st-amount" type="number" required min={1} step="any" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Field>
          </div>
          <Field id="st-note" label={t('Note')}>
            <Input id="st-note" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !f.workspaceId}>
              {create.isPending ? t('Saving…') : t('Set target')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTargetDialog({ row, onClose }: { row: TargetRow; onClose: () => void }) {
  const t = useT();
  const { update } = useTargetMutations();
  const [amount, setAmount] = useState(String(row.amount));
  const [note, setNote] = useState(row.note ?? '');
  const [endsOn, setEndsOn] = useState(row.endsOn);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Change target')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {row.workspace.name} · {t.maybe(TARGET_METRIC_LABEL[row.metric])}
        </DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: row.id, input: { amount: Number(amount), note: note.trim() || null, ...(endsOn !== row.endsOn ? { endsOn } : {}) } }, { onSuccess: onClose });
          }}
        >
          <Field id="et-amount" label={row.currency ? t('Amount ({currency})', { currency: row.currency }) : t('Number')}>
            <Input id="et-amount" type="number" required min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field id="et-end" label={t('Ends on')} hint={endsOn !== row.endsOn ? t('A new end date makes it a custom period, and the parts handed down from it end on the same day.') : undefined}>
            <Input id="et-end" type="date" required value={endsOn} min={row.startsOn > today ? row.startsOn : today} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field id="et-note" label={t('Note')}>
            <Input id="et-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorText error={update.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('Saving…') : t('Save changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SplitDialog({ row, view, onClose }: { row: TargetRow; view: TargetsView; onClose: () => void }) {
  const t = useT();
  const { distribute } = useTargetMutations();
  const team = view.assignable.filter((w) => w.level === 'EXECUTIVE' && w.parentId === row.workspace.id);
  const prior = new Map(view.targets.filter((x) => x.parentTargetId === row.id).map((x) => [x.workspace.id, String(x.amount)]));
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(team.map((w) => [w.id, prior.get(w.id) ?? ''])));
  const total = Object.values(amounts).reduce((a, v) => a + (Number(v) || 0), 0);
  const over = total > row.amount;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5%] max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Split among team')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('Give each Executive Workspace its part of {amount}. Each part becomes its own target, marked as handed down by the manager.', { amount: formatTarget(t, row.amount, row.currency) })}
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const parts = team.filter((w) => Number(amounts[w.id]) > 0).map((w) => ({ workspaceId: w.id, amount: Number(amounts[w.id]) }));
            if (parts.length) distribute.mutate({ id: row.id, input: { parts } }, { onSuccess: onClose });
          }}
        >
          {team.length === 0 && <p className="text-sm text-muted-foreground">{t('No Executive Workspaces report to this workspace yet.')}</p>}
          {team.map((w) => (
            <Field key={w.id} id={`sp-${w.id}`} label={w.name}>
              <Input id={`sp-${w.id}`} type="number" min={0} step="any" value={amounts[w.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [w.id]: e.target.value })} />
            </Field>
          ))}
          <p className={`text-sm ${over ? 'font-medium text-critical' : 'text-muted-foreground'}`} role="status">
            {t('Handed down: {done} of {amount}', { done: formatTarget(t, total, row.currency), amount: formatTarget(t, row.amount, row.currency) })}
          </p>
          <ErrorText error={distribute.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={distribute.isPending || over || team.length === 0}>
              {distribute.isPending ? t('Saving…') : t('Save split')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dashboard card: the caller's own workspace targets for the current period, with progress. */
export function YourTargets() {
  const t = useT();
  const view = useTargets();
  const rows = view.data?.targets.filter((r) => !r.editable && new Date(`${r.endsOn}T23:59:59Z`) >= new Date()) ?? [];
  if (!rows.length) return null;
  return (
    <Card data-your-targets>
      <CardHeader>
        <CardTitle>{t('Your targets')}</CardTitle>
        <CardDescription>{t('Set by the workspace above yours, counted from your records.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {rows.slice(0, 4).map((r) => (
          <div key={r.id} className="flex items-center gap-3">
            <Ring id={`yt-${r.id}`} percent={r.percent} size={64} stroke={8} label={t.maybe(TARGET_METRIC_LABEL[r.metric])} />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">{t('{period} {metric}', { period: t.maybe(TARGET_PERIOD_LABEL[r.period]), metric: t.maybe(TARGET_METRIC_LABEL[r.metric]).toLowerCase() })}</p>
              <TargetProgress row={r} />
              <p className="text-xs text-muted-foreground">
                {r.remaining > 0 ? t('{amount} to go', { amount: formatTarget(t, r.remaining, r.currency) }) : t('Target reached')} · {timeLeft(t, r)}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
