'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  PERCENT_RANKING_METRICS,
  PERFORMANCE_PERIODS,
  RANKING_METRIC_LABEL,
  RANKING_METRICS,
  SUPER_TASK_NOTICES,
  SUPER_TASK_NOTICES_LABEL,
  type PerformancePeriod,
  type PerformanceSettings,
  type PerformanceView,
  type RankingMetric,
  type RankingRow,
  type SuperTaskNotices,
} from '@dealflow/types';
import { ArrowDown, ArrowUp, Calculator, ChevronLeft, ChevronRight, Crown, Medal, Minus, Settings2, Users } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { UserAvatar } from '@/components/people/user-avatar';
import { ErrorText, Field, Tabs } from '@/components/revenue/tabs';
import { type MessageKey, useT } from '@/lib/i18n';
import { usePerformance, usePerformanceSettings, useSavePerformanceSettings } from '@/lib/task-plans';
import { Bar, useCountTo, useReducedMotion } from './progress-ring';

type T = ReturnType<typeof useT>;

const PERIOD_TAB: Record<PerformancePeriod, MessageKey> = { WEEK: 'Week', MONTH: 'Month', QUARTER: 'Quarter' };

function day(t: T, d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(t.formatLocale, { dateStyle: 'medium', timeZone: 'UTC' });
}

/** A measure's own value: a percentage, money in the organisation's currency, or a count. */
function valueText(t: T, metric: RankingMetric, v: number | null | undefined, currency: string): string {
  if (v === null || v === undefined) return '—';
  if (PERCENT_RANKING_METRICS.has(metric)) return t('{percent}%', { percent: Math.round(v) });
  if (metric === 'REVENUE') return new Intl.NumberFormat(t.formatLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  return new Intl.NumberFormat(t.formatLocale).format(v);
}

function rowName(r: RankingRow): string {
  return r.kind === 'MANAGER' ? r.workspace.name : (r.people[0]?.name ?? r.workspace.name);
}

/** Up, down or level against the previous period of the same length. */
function RankChange({ row }: { row: RankingRow }) {
  const t = useT();
  if (row.previousRank === null) return <span className="text-xs text-muted-foreground">—</span>;
  const d = row.previousRank - row.rank;
  if (d === 0)
    return (
      <span className="inline-flex items-center text-xs text-muted-foreground" role="img" aria-label={t('Same place as before')}>
        <Minus className="size-3.5" aria-hidden />
      </span>
    );
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${d > 0 ? 'text-success' : 'text-critical'}`} role="img" aria-label={d > 0 ? t('Up {n} places', { n: d }) : t('Down {n} places', { n: -d })}>
      {d > 0 ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />}
      {Math.abs(d)}
    </span>
  );
}

const PODIUM = [
  { place: 2, height: 'h-20', color: '#94a3b8' },
  { place: 1, height: 'h-28', color: '#eab308' },
  { place: 3, height: 'h-14', color: '#b45309' },
] as const;

/** The top three, standing on a podium. */
function Podium({ rows }: { rows: RankingRow[] }) {
  const t = useT();
  const still = useReducedMotion();
  if (rows.length < 2) return null;
  return (
    <div className="flex items-end justify-center gap-3 pt-2" data-podium>
      {PODIUM.map(({ place, height, color }) => {
        const r = rows.find((x) => x.rank === place) ?? (place === 1 ? rows[0] : undefined);
        if (!r) return <div key={place} className="w-24" />;
        return (
          <div key={place} className="flex w-24 flex-col items-center gap-1 text-center sm:w-28" data-podium-place={place}>
            {place === 1 && <Crown className="size-5" style={{ color }} aria-hidden />}
            <UserAvatar userId={r.people[0]?.id} name={rowName(r)} className="size-11 text-sm" showMood={false} />
            <p className="w-full truncate text-sm font-medium" title={rowName(r)}>
              {rowName(r)}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">{t('{score} points', { score: r.score.toFixed(1) })}</p>
            <div
              className={`grid w-full place-items-center rounded-t-lg text-lg font-bold text-white ${height} ${still ? '' : 'motion-safe:animate-[sf-podium-rise_700ms_ease-out_both]'}`}
              style={{ background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 70%, black))` }}
            >
              {place}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Score({ value }: { value: number }) {
  const still = useReducedMotion();
  const shown = useCountTo(value, still, 700);
  return <span className="tabular-nums">{shown.toFixed(1)}</span>;
}

/** One ranking: place, who, score with its bar, the change since the last period, and each measure's figure. */
function RankingTable({ title, description, rows, view, kind }: { title: string; description: string; rows: RankingRow[]; view: PerformanceView; kind: 'managers' | 'executives' }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <Card data-ranking={kind}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {kind === 'executives' && rows.length > 2 && <Podium rows={rows} />}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th className="py-2 pe-2 text-start font-medium">{t('Place')}</th>
                <th className="py-2 pe-2 text-start font-medium">{kind === 'managers' ? t('Manager Workspace') : t('Person')}</th>
                <th className="w-48 py-2 pe-2 text-start font-medium">{t('Score')}</th>
                <th className="py-2 pe-2 text-start font-medium">{t('Change')}</th>
                <th className="py-2 text-end font-medium">
                  <span className="sr-only">{t('Details')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.kind}-${r.workspace.id}`;
                const expanded = open === key;
                return (
                  <FragmentRow key={key} r={r} view={view} expanded={expanded} onToggle={() => setOpen(expanded ? null : key)} />
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentRow({ r, view, expanded, onToggle }: { r: RankingRow; view: PerformanceView; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  const name = rowName(r);
  return (
    <>
      <tr className={`border-t border-border ${r.me ? 'bg-primary/5' : ''}`} data-rank-row={name} data-rank={r.rank}>
        <td className="py-2.5 pe-2">
          <span className={`inline-grid size-7 place-items-center rounded-full text-xs font-bold ${r.rank <= 3 ? 'text-white' : 'bg-muted text-muted-foreground'}`} style={r.rank <= 3 ? { backgroundColor: ['#eab308', '#94a3b8', '#b45309'][r.rank - 1] } : undefined}>
            {r.rank}
          </span>
        </td>
        <td className="py-2.5 pe-2">
          <div className="flex items-center gap-2">
            <UserAvatar userId={r.people[0]?.id} name={name} className="size-8 text-[10px]" showMood={false} />
            <div className="min-w-0">
              <p className="truncate font-medium">
                {name} {r.me && <Badge tone="primary">{t('You')}</Badge>}
              </p>
              {r.kind === 'MANAGER' && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3" aria-hidden />
                  {t('{n} people counted', { n: r.teamSize })}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className="py-2.5 pe-2">
          <div className="flex items-center gap-2">
            <span className="w-10 text-end font-semibold" data-score>
              <Score value={r.score} />
            </span>
            <div className="flex-1">
              <Bar percent={r.score} label={t('Score')} />
            </div>
          </div>
        </td>
        <td className="py-2.5 pe-2">
          <RankChange row={r} />
          {r.previousScore !== null && <span className="ms-1 text-xs tabular-nums text-muted-foreground">({r.previousScore.toFixed(1)})</span>}
        </td>
        <td className="py-2.5 text-end">
          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? t('Hide') : t('How it adds up')}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/30" data-score-breakdown={name}>
          <td colSpan={5} className="px-3 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 text-start font-medium">{t('Measure')}</th>
                  <th className="pb-1 text-end font-medium">{t('Figure')}</th>
                  <th className="pb-1 text-end font-medium">{t('Share')}</th>
                  <th className="pb-1 text-end font-medium">{t('Weight')}</th>
                  <th className="pb-1 text-end font-medium">{t('Points')}</th>
                </tr>
              </thead>
              <tbody>
                {view.method.map((m) => {
                  const share = r.shares[m.metric];
                  const counted = share !== null && share !== undefined;
                  return (
                    <tr key={m.metric} className={counted ? '' : 'text-muted-foreground'}>
                      <td className="py-0.5">{t.maybe(RANKING_METRIC_LABEL[m.metric])}</td>
                      <td className="py-0.5 text-end tabular-nums">{valueText(t, m.metric, r.values[m.metric], view.currency)}</td>
                      <td className="py-0.5 text-end tabular-nums">{counted ? t('{percent}%', { percent: Math.round(share * 100) }) : t('Not counted')}</td>
                      <td className="py-0.5 text-end tabular-nums">{m.weight}</td>
                      <td className="py-0.5 text-end tabular-nums">{counted ? (share * m.weight).toFixed(1) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">{t('Score = points ÷ the weights that counted × 100. A measure with no target or no finished task is left out, not counted as zero.')}</p>
          </td>
        </tr>
      )}
    </>
  );
}

/** The method, in plain words: what counts, how much, and how a share is worked out. */
function Method({ view }: { view: PerformanceView }) {
  const t = useT();
  const total = view.method.reduce((a, m) => a + m.weight, 0);
  return (
    <Card data-ranking-method>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="size-4" aria-hidden />
          {t('How the score is worked out')}
        </CardTitle>
        <CardDescription>{t('Plain arithmetic on your records. No AI is involved.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-1.5">
          {view.method.map((m) => (
            <li key={m.metric} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{t.maybe(RANKING_METRIC_LABEL[m.metric])}</span>
              <span className="w-24">
                <Bar percent={total ? (m.weight / total) * 100 : 0} label={t.maybe(RANKING_METRIC_LABEL[m.metric])} />
              </span>
              <span className="w-10 text-end tabular-nums text-muted-foreground">{m.weight}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t('Target achievement and task completion count as their own percentage (up to 100%). Every other measure is compared with the best in the same ranking: the best gets 100%, half of it gets 50%.')}
        </p>
      </CardContent>
    </Card>
  );
}

export function PerformanceBoard() {
  const t = useT();
  const [period, setPeriod] = useState<PerformancePeriod>('MONTH');
  const [offset, setOffset] = useState(0);
  const [configuring, setConfiguring] = useState(false);
  const view = usePerformance({ period, offset });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          label={t('Period')}
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setOffset(0);
          }}
          tabs={PERFORMANCE_PERIODS.map((p) => ({ key: p, label: t(PERIOD_TAB[p]) }))}
        />
        <div className="mb-4 flex items-center gap-1">
          <Button size="icon" variant="outline" aria-label={t('Earlier period')} disabled={offset <= -24} onClick={() => setOffset(offset - 1)}>
            <ChevronLeft className="rtl:rotate-180" aria-hidden />
          </Button>
          <span className="min-w-44 text-center text-sm font-medium" data-ranking-period>
            {view.data ? t('{start} to {end}', { start: day(t, view.data.period.startsOn), end: day(t, view.data.period.endsOn) }) : '…'}
          </span>
          <Button size="icon" variant="outline" aria-label={t('Later period')} disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>
            <ChevronRight className="rtl:rotate-180" aria-hidden />
          </Button>
          {view.data?.canConfigure && (
            <Button variant="outline" className="ms-2" onClick={() => setConfiguring(true)}>
              <Settings2 className="size-4" aria-hidden />
              {t('Ranking settings')}
            </Button>
          )}
        </div>
      </div>
      {view.isPending ? (
        <Skeleton className="h-72" />
      ) : view.error ? (
        <ErrorText error={view.error} />
      ) : (
        <PerformanceBody view={view.data} />
      )}
      {configuring && <SettingsDialog onClose={() => setConfiguring(false)} />}
    </div>
  );
}

function PerformanceBody({ view }: { view: PerformanceView }) {
  const t = useT();
  const mine = [...view.executives, ...view.managers].find((r) => r.me);
  const compared = t('Compared with {start} to {end}', { start: day(t, view.period.previousStartsOn), end: day(t, view.period.previousEndsOn) });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {mine && view.scope !== 'ORGANISATION' && (
          <Card className="border-primary/40" data-my-rank>
            <CardContent className="flex flex-wrap items-center gap-4 pt-6">
              <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
                <Medal className="size-7" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{t('Your score this period')}</p>
                <p className="text-2xl font-bold tabular-nums">
                  <Score value={mine.score} />
                </p>
              </div>
              {(view.scope === 'TEAM' || view.showTeamPosition) && (
                <div className="text-end">
                  <p className="text-sm text-muted-foreground">{t('Your place')}</p>
                  <p className="text-2xl font-bold tabular-nums">
                    {t('{rank} of {total}', { rank: mine.rank, total: mine.kind === 'MANAGER' ? view.rankedAmong.managers : view.rankedAmong.executives })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <RankingTable kind="managers" title={t('Managers')} description={`${t('Each manager’s whole team counts together.')} ${compared}`} rows={view.managers} view={view} />
        <RankingTable
          kind="executives"
          title={view.scope === 'SELF' && view.executives.length <= 1 ? t('Your figures') : t('Executives')}
          description={compared}
          rows={view.executives}
          view={view}
        />
        {!view.managers.length && !view.executives.length && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">{t('No one to rank yet. Rankings appear once managers or executives have workspaces.')}</CardContent>
          </Card>
        )}
      </div>
      <Method view={view} />
    </div>
  );
}

/** Super only: which measures count, how much each weighs, what executives see, and the task notifications Super gets. */
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const current = usePerformanceSettings();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Ranking settings')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('Choose what counts and how much. A weight of 0 leaves a measure out.')}</DialogDescription>
        {current.isPending ? <Skeleton className="mt-4 h-64" /> : current.error ? <ErrorText error={current.error} /> : <SettingsForm initial={current.data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({ initial, onClose }: { initial: PerformanceSettings; onClose: () => void }) {
  const t = useT();
  const save = useSavePerformanceSettings();
  const [weights, setWeights] = useState<Record<RankingMetric, number>>(initial.weights);
  const [showTeamPosition, setShow] = useState(initial.showTeamPosition);
  const [notices, setNotices] = useState<SuperTaskNotices>(initial.superTaskNotices);
  const total = Object.values(weights).reduce((a, w) => a + w, 0);
  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ weights, showTeamPosition, superTaskNotices: notices }, { onSuccess: onClose });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('Weights')}</legend>
        {RANKING_METRICS.map((m) => (
          <div key={m} className="grid grid-cols-[1fr_8rem_3.5rem] items-center gap-2">
            <label htmlFor={`pw-${m}`} className="text-sm">
              {t.maybe(RANKING_METRIC_LABEL[m])}
            </label>
            <input type="range" min={0} max={100} step={5} value={weights[m]} aria-hidden tabIndex={-1} onChange={(e) => setWeights({ ...weights, [m]: Number(e.target.value) })} className="accent-primary" />
            <Input id={`pw-${m}`} type="number" min={0} max={100} step={1} value={weights[m]} onChange={(e) => setWeights({ ...weights, [m]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} />
          </div>
        ))}
        <p className={`text-xs ${total === 0 ? 'text-critical' : 'text-muted-foreground'}`} role="status">
          {total === 0 ? t('Give at least one measure a weight above 0') : t('Weights add up to {total}. Each measure counts in proportion to its weight.', { total })}
        </p>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={showTeamPosition} onChange={(e) => setShow(e.target.checked)} />
        <span>{t('Show executives their place in their team')}</span>
      </label>
      <Field id="pw-notices" label={t('Recurring task notifications to the Super Workspace')}>
        <Select id="pw-notices" value={notices} onChange={(e) => setNotices(e.target.value as SuperTaskNotices)}>
          {SUPER_TASK_NOTICES.map((n) => (
            <option key={n} value={n}>
              {t.maybe(SUPER_TASK_NOTICES_LABEL[n])}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending || total === 0}>
          {save.isPending ? t('Saving…') : t('Save settings')}
        </Button>
      </div>
    </form>
  );
}
