'use client';

import { useCanDelete } from '@/lib/features';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
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
import { Pencil, Plus, Split, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { useT } from '@/lib/i18n';
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

/** Progress towards one target, from real records; the bar turns green when it is reached. */
export function TargetProgress({ row }: { row: TargetRow }) {
  const t = useT();
  const pct = Math.min(100, row.percent);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="tabular" data-target-progress>
          {t('{achieved} of {amount}', { achieved: formatTarget(t, row.achieved, row.currency), amount: formatTarget(t, row.amount, row.currency) })}
        </span>
        <span className="tabular text-muted-foreground">{t('{percent}%', { percent: row.percent })}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-muted" role="meter" aria-label={t.maybe(TARGET_METRIC_LABEL[row.metric])} aria-valuemin={0} aria-valuemax={row.amount} aria-valuenow={row.achieved}>
        <div className={`h-full rounded-full ${row.percent >= 100 ? 'bg-success' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
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

  if (view.isPending) return <Skeleton className="h-64" />;
  if (view.error) return <ErrorText error={view.error} />;
  const data = view.data;
  const groups = new Map<string, TargetRow[]>();
  for (const r of data.targets) groups.set(r.workspace.id, [...(groups.get(r.workspace.id) ?? []), r]);
  const ordered = [...groups.values()].sort((a, b) => LEVEL_ORDER[a[0]!.workspace.level] - LEVEL_ORDER[b[0]!.workspace.level] || a[0]!.workspace.name.localeCompare(b[0]!.workspace.name));

  return (
    <div className="space-y-4">
      {data.assignable.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setSetting(true)}>
            <Plus className="size-4" aria-hidden />
            {t('Set a target')}
          </Button>
        </div>
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
                <Badge tone={ws.level === 'MANAGER' ? 'primary' : 'neutral'}>{t.maybe(WORKSPACE_LEVEL_LABEL[ws.level])}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {rows.map((r) => (
                  <li key={r.id} className="space-y-2" data-target={`${ws.name} ${r.metric}`}>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {t('{period} {metric}', { period: t.maybe(TARGET_PERIOD_LABEL[r.period]), metric: t.maybe(TARGET_METRIC_LABEL[r.metric]).toLowerCase() })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dates(t, r)} · {r.source === 'SUPER' ? t('Set by the Super Workspace') : t('Handed down by the manager')}
                          {r.setBy?.name ? ` (${r.setBy.name})` : ''}
                        </p>
                        {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                      </div>
                      <div className="flex gap-1">
                        {r.canDistribute && (
                          <Button size="sm" variant="outline" onClick={() => setSplitting(r)}>
                            <Split className="size-4" aria-hidden />
                            {t('Split among team')}
                          </Button>
                        )}
                        {r.editable && (
                          <>
                            <Button size="icon" variant="ghost" aria-label={t('Change target')} onClick={() => setEditing(r)}>
                              <Pencil aria-hidden />
                            </Button>
                            {mayDelete && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t('Remove target')}
                                onClick={() => window.confirm(t('Remove this target? Parts handed down from it are removed too.')) && remove.mutate(r.id)}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <TargetProgress row={r} />
                    {r.distributed > 0 && (
                      <p className="text-xs text-muted-foreground">{t('Handed down: {done} of {amount}', { done: formatTarget(t, r.distributed, r.currency), amount: formatTarget(t, r.amount, r.currency) })}</p>
                    )}
                  </li>
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
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
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
            <Field id="st-metric" label={t('Measure')}>
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
            <Field id="st-amount" label={f.metric === 'REVENUE' ? t('Amount ({currency})', { currency: view.currency }) : t('Number')}>
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
            update.mutate({ id: row.id, input: { amount: Number(amount), note: note.trim() || null } }, { onSuccess: onClose });
          }}
        >
          <Field id="et-amount" label={row.currency ? t('Amount ({currency})', { currency: row.currency }) : t('Number')}>
            <Input id="et-amount" type="number" required min={1} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
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
          <div key={r.id} className="space-y-1">
            <p className="text-sm font-medium">{t('{period} {metric}', { period: t.maybe(TARGET_PERIOD_LABEL[r.period]), metric: t.maybe(TARGET_METRIC_LABEL[r.metric]).toLowerCase() })}</p>
            <TargetProgress row={r} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
