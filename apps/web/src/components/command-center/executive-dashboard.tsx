'use client';

import {
  type CommandCenterContext,
  type CommandCenterLayout,
  type ExecutiveDashboard as ExecutiveData,
  FOLLOW_UP_TYPES,
  type FunnelRow,
  TIER_DASHBOARD_WIDGETS,
  WORK_SECTIONS,
  type WorkBucket,
  type WorkCategory,
} from '@dealflow/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { CalendarClock, LayoutGrid, Plus, Target, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Select } from '@/components/crm/select';
import { FOLLOW_UP_TYPE_LABEL, PRIORITY_LABEL } from '@/components/crm/work-labels';
import { InfoTip } from '@/components/info-tip';
import {
  type DrillTarget,
  type PeriodChoice,
  useExecutiveDashboard,
  useSaveCommandCenterLayout,
  useSetTarget,
} from '@/lib/command-center';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { FUNNEL_LABEL, METRIC_LABEL, PERIOD_LABEL, SECTION_LABEL, WORK_LABEL } from './cc-labels';
import { RevenueAttribution } from './revenue-attribution';
import {
  ArrangeRow,
  count,
  DrillPanel,
  KpiCards,
  money,
  move,
  pct,
  PeriodPicker,
  Progress,
} from './tier-parts';
import { ReceivedInstructions } from './instructions';
import { TransferRequests } from './transfers';

type ExecSection = (typeof TIER_DASHBOARD_WIDGETS.EXECUTIVE)[number];
const EXEC_SECTIONS = TIER_DASHBOARD_WIDGETS.EXECUTIVE;

function orderedSections(
  layout: CommandCenterLayout | null,
): { id: ExecSection; hidden: boolean }[] {
  const saved = (layout?.sections ?? []).filter((s): s is { id: ExecSection; hidden: boolean } =>
    (EXEC_SECTIONS as readonly string[]).includes(s.id),
  );
  return [
    ...saved,
    ...EXEC_SECTIONS.filter((id) => !saved.some((s) => s.id === id)).map((id) => ({
      id,
      hidden: false,
    })),
  ];
}

/**
 * The executive dashboard (ADR 0063, master spec section 10): one person's numbers for the chosen period, their work
 * for today, their funnel, business performance, credited revenue and lead transfer requests. Every number opens the
 * records it counts. A manager can open the dashboard of anyone reporting to them.
 */
export function ExecutiveDashboard({ context }: { context: CommandCenterContext }) {
  const t = useT();
  const [period, setPeriod] = React.useState<PeriodChoice>({ period: 'this_month' });
  const params = useSearchParams();
  // A manager opening someone's dashboard from their team table arrives with ?person=.
  const [userId, setUserId] = React.useState<string>(() => {
    const p = params.get('person');
    return p && context.reports.some((r) => r.id === p) ? p : '';
  });
  const [drill, setDrill] = React.useState<DrillTarget | null>(null);
  const [customising, setCustomising] = React.useState(false);
  const [targetOpen, setTargetOpen] = React.useState(false);
  const q = useExecutiveDashboard(period, userId || undefined);
  const d = q.data;
  const sections = orderedSections(d?.layout ?? null).filter((s) => !s.hidden);
  const scopeFor = { scope: 'me' as const, userId: userId || undefined };
  const viewingOther = !!userId;

  const render = (id: ExecSection, data: ExecutiveData) => {
    switch (id) {
      case 'exec.kpis':
        return (
          <KpiCards
            label={t('Key metrics')}
            kpis={data.kpis}
            currency={data.currency}
            onOpen={(k) => setDrill({ metric: k.key, title: t(METRIC_LABEL[k.key]), ...scopeFor })}
          />
        );
      case 'exec.work':
        return <MyWork buckets={data.work} />;
      case 'exec.instructions':
        return data.features.instructions && !viewingOther ? <ReceivedInstructions /> : null;
      case 'exec.pipeline':
        return (
          <Funnel
            rows={data.funnel}
            currency={data.currency}
            onOpen={(stage) =>
              setDrill({ metric: `stage:${stage}`, title: t(FUNNEL_LABEL[stage]), ...scopeFor })
            }
          />
        );
      case 'exec.performance':
        return (
          <Performance
            data={data}
            onOpen={(metric) => setDrill({ metric, title: t(METRIC_LABEL[metric]), ...scopeFor })}
          />
        );
      case 'exec.revenue':
        return data.revenue ? (
          <RevenueAttribution
            revenue={data.revenue}
            currency={data.currency}
            periodLabel={t(PERIOD_LABEL[data.range.period])}
          />
        ) : null;
      case 'exec.transfers':
        return data.features.leadTransfers && !viewingOther ? <TransferRequests /> : null;
    }
  };

  return (
    <div className="space-y-5" data-testid="executive-dashboard">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {d ? (
              <>
                <h2 className="text-xl font-semibold tracking-tight">{d.person.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {[
                    d.person.designation && t.maybe(d.person.designation),
                    d.person.department && t.maybe(d.person.department),
                    d.person.reportingManager &&
                      t('Reports to {name}', { name: d.person.reportingManager.name }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </>
            ) : (
              <Skeleton className="h-10 w-64" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {context.reports.length > 0 && (
              <>
                <label className="sr-only" htmlFor="cc-person">
                  {t('Whose dashboard')}
                </label>
                <Select
                  id="cc-person"
                  className="w-auto"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                >
                  <option value="">{t('My dashboard')}</option>
                  {context.reports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <PeriodPicker value={period} onChange={setPeriod} />
            {!viewingOther && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCustomising(true)}
                disabled={!d}
              >
                <LayoutGrid aria-hidden /> {t('Customise')}
              </Button>
            )}
          </div>
        </div>
        {d && (
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">{t('This month’s target')}</span>
                <span className="tabular text-muted-foreground">
                  {d.month.target !== null
                    ? t('{achieved} of {target} ({percent})', {
                        achieved: money(d.month.achieved, d.currency),
                        target: money(d.month.target, d.currency),
                        percent: pct(d.month.percent),
                      })
                    : t('{achieved} credited. No target set.', {
                        achieved: money(d.month.achieved, d.currency),
                      })}
                </span>
              </div>
              <Progress value={d.month.percent} label={t('This month’s target')} />
            </div>
            {context.canSetTargets && viewingOther && (
              <Button size="sm" variant="outline" onClick={() => setTargetOpen(true)}>
                <Target aria-hidden /> {t('Set target')}
              </Button>
            )}
          </div>
        )}
      </Card>

      {q.error && !d ? (
        <Card role="alert" className="p-5 text-sm text-critical">
          {q.error.message}
        </Card>
      ) : !d ? (
        <div className="grid gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        sections.map((s) => {
          const body = render(s.id, d);
          if (!body) return null;
          return (
            <section key={s.id} data-section={s.id} aria-labelledby={`h-${s.id}`}>
              <div className="mb-2 flex items-center gap-2">
                <h2 id={`h-${s.id}`} className="text-base font-semibold">
                  {t(SECTION_LABEL[s.id])}
                </h2>
                <SectionTip id={s.id} />
              </div>
              {body}
            </section>
          );
        })
      )}

      <DrillPanel
        target={drill}
        period={period}
        currency={d?.currency ?? context.currency}
        onClose={() => setDrill(null)}
      />
      {d && customising && (
        <CustomiseDialog layout={d.layout} onClose={() => setCustomising(false)} />
      )}
      {d && targetOpen && userId && (
        <TargetDialog
          userId={userId}
          name={d.person.name}
          currency={d.currency}
          onClose={() => setTargetOpen(false)}
        />
      )}
    </div>
  );
}

/** Help for each section; written out so the help test can see every topic in use. */
function SectionTip({ id }: { id: ExecSection }) {
  switch (id) {
    case 'exec.kpis':
      return <InfoTip topic="cc.execKpis" />;
    case 'exec.work':
      return <InfoTip topic="cc.myWork" />;
    case 'exec.instructions':
      return <InfoTip topic="cc.instructionsReceived" />;
    case 'exec.pipeline':
      return <InfoTip topic="cc.funnel" />;
    case 'exec.performance':
      return <InfoTip topic="cc.performance" />;
    case 'exec.revenue':
      return <InfoTip topic="cc.revenue" />;
    case 'exec.transfers':
      return <InfoTip topic="cc.transfers" />;
  }
}

// ─── My work ───

function MyWork({ buckets }: { buckets: WorkBucket[] }) {
  const t = useT();
  if (!buckets.length)
    return (
      <Card className="p-5 text-sm text-muted-foreground">
        {t('Every work section is hidden. Choose Customise to show some again.')}
      </Card>
    );
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {buckets.map((b) => {
        const name =
          b.label ??
          ((WORK_SECTIONS as readonly string[]).includes(b.id)
            ? t(WORK_LABEL[b.id as keyof typeof WORK_LABEL])
            : b.id);
        return (
          <Card key={b.id} data-work={b.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">{name}</CardTitle>
              <Badge
                tone={b.total ? (b.id === 'overdue' ? 'critical' : 'primary') : 'neutral'}
                aria-label={t('{count} items', { count: count(b.total) })}
              >
                {count(b.total)}
              </Badge>
            </CardHeader>
            <CardContent>
              {!b.items.length ? (
                <p className="text-sm text-muted-foreground">{t('Nothing here.')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {b.items.map((i) => (
                    <li key={`${i.kind}-${i.id}`}>
                      <Link
                        href={i.href}
                        className="block rounded px-1 py-1 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="line-clamp-1 font-medium">{i.title}</span>
                        <span
                          className={cn(
                            'text-xs',
                            i.overdue ? 'text-critical' : 'text-muted-foreground',
                          )}
                        >
                          {[
                            i.subtitle && (i.subtitle in FOLLOW_UP_TYPE_LABEL ? t(FOLLOW_UP_TYPE_LABEL[i.subtitle as keyof typeof FOLLOW_UP_TYPE_LABEL]) : t.maybe(i.subtitle)),
                            i.at && relativeTime(i.at),
                            i.from && t('from {name}', { name: i.from.name }),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {b.total > b.items.length && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('and {count} more', { count: count(b.total - b.items.length) })}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Funnel ───

export function Funnel({
  rows,
  currency,
  onOpen,
  showPeople,
}: {
  rows: FunnelRow[];
  currency: string;
  onOpen: (stage: FunnelRow['stage']) => void;
  showPeople?: boolean;
}) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.companies));
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('Companies at each funnel stage')}</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {t('Stage')}
            </th>
            <th scope="col" className="px-4 py-2 text-start font-medium">
              {t('Companies')}
            </th>
            <th scope="col" className="px-4 py-2 text-end font-medium">
              {t('Opportunities')}
            </th>
            <th scope="col" className="px-4 py-2 text-end font-medium">
              {t('Potential value')}
            </th>
            <th scope="col" className="px-4 py-2 text-end font-medium">
              {t('Conversion')}
            </th>
            {showPeople && (
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('People')}
              </th>
            )}
            {showPeople && (
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Won revenue')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.stage} className="border-b border-border last:border-0" data-stage={r.stage}>
              <th scope="row" className="px-4 py-2 text-start font-medium">
                {t(FUNNEL_LABEL[r.stage])}
              </th>
              <td className="min-w-48 px-4 py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpen(r.stage)}
                  aria-label={t('{stage}: {count} companies. Show them', {
                    stage: t(FUNNEL_LABEL[r.stage]),
                    count: count(r.companies),
                  })}
                >
                  <span
                    className="h-2 rounded-full bg-primary/70"
                    style={{
                      width: `${(r.companies / max) * 100}%`,
                      minWidth: r.companies ? 6 : 0,
                    }}
                    aria-hidden
                  />
                  <span className="tabular">{count(r.companies)}</span>
                </button>
              </td>
              <td className="tabular px-4 py-2 text-end">{count(r.opportunities)}</td>
              <td className="tabular px-4 py-2 text-end">{money(r.potentialValue, currency)}</td>
              <td className="tabular px-4 py-2 text-end">{pct(r.conversion)}</td>
              {showPeople && <td className="tabular px-4 py-2 text-end">{count(r.people ?? 0)}</td>}
              {showPeople && (
                <td className="tabular px-4 py-2 text-end">{money(r.wonRevenue ?? 0, currency)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Business performance ───

function Performance({
  data,
  onOpen,
}: {
  data: ExecutiveData;
  onOpen: (m: 'leadsGenerated' | 'rfqsReceived' | 'rfqsSubmitted' | 'rfqsWon' | 'revenue') => void;
}) {
  const t = useT();
  const p = data.performance;
  const tiles: { label: string; value: string; open?: () => void }[] = [
    { label: t('Companies this month'), value: count(p.leads.month) },
    { label: t('Companies this quarter'), value: count(p.leads.quarter) },
    { label: t('Companies this half-year'), value: count(p.leads.half) },
    { label: t('Companies this year'), value: count(p.leads.year) },
    { label: t('RFQs received'), value: count(p.rfqsReceived), open: () => onOpen('rfqsReceived') },
    {
      label: t('RFQs submitted'),
      value: count(p.rfqsSubmitted),
      open: () => onOpen('rfqsSubmitted'),
    },
    { label: t('RFQs won'), value: count(p.rfqsWon), open: () => onOpen('rfqsWon') },
    { label: t('RFQ win rate'), value: pct(p.rfqWinRate) },
    {
      label: t('Revenue generated'),
      value: money(p.revenue, data.currency),
      open: data.features.revenueAttribution ? () => onOpen('revenue') : undefined,
    },
    { label: t('Target'), value: money(p.target, data.currency) },
    { label: t('Target achievement'), value: pct(p.achievement) },
    { label: t('Contact conversion rate'), value: pct(p.leadConversion) },
    { label: t('Average deal value'), value: money(p.averageDealValue, data.currency) },
  ];
  return (
    <Card className="p-4">
      <p className="mb-3 text-xs text-muted-foreground">
        {t('Companies by calendar period; everything else for {period}.', {
          period: t(PERIOD_LABEL[data.range.period]),
        })}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-md border border-border p-3">
            <dt className="text-xs text-muted-foreground">{x.label}</dt>
            <dd className="tabular mt-1 text-lg font-semibold">
              {x.open ? (
                <button
                  type="button"
                  className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={x.open}
                  aria-label={t('{kpi}: {value}. Show the records', {
                    kpi: x.label,
                    value: x.value,
                  })}
                >
                  {x.value}
                </button>
              ) : (
                x.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ─── Customise ───

function CustomiseDialog({
  layout,
  onClose,
}: {
  layout: CommandCenterLayout | null;
  onClose: () => void;
}) {
  const t = useT();
  const save = useSaveCommandCenterLayout('EXECUTIVE');
  const [sections, setSections] = React.useState(() => orderedSections(layout));
  const [categories, setCategories] = React.useState<WorkCategory[]>(
    () => layout?.categories ?? [],
  );
  const [work, setWork] = React.useState(() => {
    const saved = layout?.workSections ?? [];
    const ids = [
      ...saved.map((w) => w.id),
      ...WORK_SECTIONS.filter((id) => !saved.some((w) => w.id === id)),
      ...(layout?.categories ?? [])
        .map((c) => `cat:${c.id}`)
        .filter((id) => !saved.some((w) => w.id === id)),
    ];
    return ids.map((id) => ({ id, hidden: saved.find((w) => w.id === id)?.hidden ?? false }));
  });
  const [newCat, setNewCat] = React.useState({ label: '', followUpType: '', priority: '' });
  const [error, setError] = React.useState<string | null>(null);

  const workLabel = (id: string) =>
    id.startsWith('cat:')
      ? (categories.find((c) => `cat:${c.id}` === id)?.label ?? id)
      : t(WORK_LABEL[id as keyof typeof WORK_LABEL]);
  const addCategory = () => {
    const label = newCat.label.trim();
    if (!label) return setError(t('Enter a name for the category.'));
    const id = `${
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'category'
    }-${Date.now().toString(36).slice(-4)}`;
    setCategories([
      ...categories,
      {
        id,
        label,
        followUpType: newCat.followUpType || null,
        priority: (newCat.priority || null) as WorkCategory['priority'],
      },
    ]);
    setWork([...work, { id: `cat:${id}`, hidden: false }]);
    setNewCat({ label: '', followUpType: '', priority: '' });
    setError(null);
  };
  const removeCategory = (id: string) => {
    setCategories(categories.filter((c) => c.id !== id));
    setWork(work.filter((w) => w.id !== `cat:${id}`));
  };
  const submit = async (value: CommandCenterLayout | null) => {
    try {
      await save.mutateAsync(value);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Customise your dashboard')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('Only you see this arrangement. Your numbers stay the same.')}
        </DialogDescription>
        <h3 className="mb-2 text-sm font-semibold">{t('Sections')}</h3>
        <ul className="mb-5 space-y-1.5">
          {sections.map((s, i) => (
            <ArrangeRow
              key={s.id}
              label={t(SECTION_LABEL[s.id])}
              hidden={s.hidden}
              first={i === 0}
              last={i === sections.length - 1}
              onMove={(dir) => setSections(move(sections, i, dir))}
              onToggle={() =>
                setSections(sections.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x)))
              }
            />
          ))}
        </ul>
        <h3 className="mb-2 text-sm font-semibold">{t('My work')}</h3>
        <ul className="mb-5 space-y-1.5">
          {work.map((w, i) => (
            <ArrangeRow
              key={w.id}
              label={workLabel(w.id)}
              hidden={w.hidden}
              first={i === 0}
              last={i === work.length - 1}
              onMove={(dir) => setWork(move(work, i, dir))}
              onToggle={() =>
                setWork(work.map((x) => (x.id === w.id ? { ...x, hidden: !x.hidden } : x)))
              }
            />
          ))}
        </ul>
        <h3 className="mb-1 text-sm font-semibold">{t('Your own categories')}</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          {t('A category lists your open follow-ups of one type, priority, or both.')}
        </p>
        {categories.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {c.label}{' '}
                  <span className="text-xs text-muted-foreground">
                    {[
                      c.followUpType &&
                        t(
                          FOLLOW_UP_TYPE_LABEL[c.followUpType as keyof typeof FOLLOW_UP_TYPE_LABEL],
                        ),
                      c.priority && t(PRIORITY_LABEL[c.priority]),
                    ]
                      .filter(Boolean)
                      .join(' · ') || t('Every follow-up')}
                  </span>
                </span>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-muted"
                  onClick={() => removeCategory(c.id)}
                  aria-label={t('Remove {name}', { name: c.label })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Field id="cat-label" label={t('Name')}>
            <Input
              value={newCat.label}
              maxLength={60}
              onChange={(e) => setNewCat({ ...newCat, label: e.target.value })}
            />
          </Field>
          <Field id="cat-type" label={t('Follow-up type')}>
            <Select
              value={newCat.followUpType}
              onChange={(e) => setNewCat({ ...newCat, followUpType: e.target.value })}
            >
              <option value="">{t('Any')}</option>
              {FOLLOW_UP_TYPES.map((f) => (
                <option key={f} value={f}>
                  {t(FOLLOW_UP_TYPE_LABEL[f])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cat-priority" label={t('Priority')}>
            <Select
              value={newCat.priority}
              onChange={(e) => setNewCat({ ...newCat, priority: e.target.value })}
            >
              <option value="">{t('Any')}</option>
              {(['HIGH', 'NORMAL', 'LOW'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={addCategory}
          disabled={categories.length >= 10}
        >
          <Plus aria-hidden /> {t('Add category')}
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => submit(null)}
            disabled={save.isPending}
          >
            {t('Reset to default')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => submit({ sections, workSections: work, categories })}
              disabled={save.isPending}
            >
              {save.isPending ? t('Saving…') : t('Save layout')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Targets ───

function TargetDialog({
  userId,
  name,
  currency,
  onClose,
}: {
  userId: string;
  name: string;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const set = useSetTarget();
  const now = new Date();
  const [period, setPeriod] = React.useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n < 0)
      return setError(t('Enter an amount of 0 or more.'));
    try {
      await set.mutateAsync({ period, userId, amount: n });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">
          {t('Set a target for {name}', { name })}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('Revenue credited to them counts toward it, in {currency}.', { currency })}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="target-period" label={t('Month')}>
            <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
          <Field id="target-amount" label={t('Amount')} error={error ?? undefined}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={set.isPending}>
              <CalendarClock aria-hidden /> {set.isPending ? t('Saving…') : t('Save target')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
