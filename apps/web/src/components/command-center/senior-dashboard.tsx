'use client';

import {
  type CommandCenterContext,
  type CommandCenterLayout,
  type OrgDepartmentRow,
  type OrgInsight,
  type OrgInsightItem,
  type OrgManagerRow,
  type OrgPersonRow,
  type RankingCategory,
  type RankingLeader,
  type RevenueSlice,
  type SeniorDashboard as SeniorData,
  TIER_DASHBOARD_WIDGETS,
} from '@dealflow/types';
import { Badge, Button, Card, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { LayoutGrid, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Select } from '@/components/crm/select';
import { InfoTip } from '@/components/info-tip';
import { type DrillTarget, type PeriodChoice, useSaveCommandCenterLayout, useSeniorDashboard } from '@/lib/command-center';
import { type MessageKey, useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { usePreferences } from '@/stores/preferences';
import {
  INSIGHT_LABEL,
  METRIC_LABEL,
  PERFORMANCE_STATUS_LABEL,
  PERFORMANCE_STATUS_TONE,
  PERIOD_LABEL,
  RANKING_LABEL,
  SECTION_LABEL,
} from './cc-labels';
import { axisTick, ChartCard, tooltipStyle } from './chart-card';
import { ArrangeRow, count, DrillPanel, KpiCards, money, move, pct, PeriodPicker, Progress } from './tier-parts';

type OrgSection = (typeof TIER_DASHBOARD_WIDGETS.SENIOR)[number];
const ORG_SECTIONS = TIER_DASHBOARD_WIDGETS.SENIOR;

function orderedSections(layout: CommandCenterLayout | null): { id: OrgSection; hidden: boolean }[] {
  const saved = (layout?.sections ?? []).filter((s): s is { id: OrgSection; hidden: boolean } => (ORG_SECTIONS as readonly string[]).includes(s.id));
  return [...saved, ...ORG_SECTIONS.filter((id) => !saved.some((s) => s.id === id)).map((id) => ({ id, hidden: false }))];
}

/**
 * The senior management dashboard (ADR 0063, master spec section 13): the organisation, or one department, for the
 * period. Its numbers, how each department and manager's team is doing, who leads on revenue and on quality, where
 * revenue comes from down to the deal, and the patterns in the records that need attention.
 */
export function SeniorDashboard({ context }: { context: CommandCenterContext }) {
  const t = useT();
  const router = useRouter();
  const [period, setPeriod] = React.useState<PeriodChoice>({ period: 'this_month' });
  const [departmentId, setDepartmentId] = React.useState('');
  const [drill, setDrill] = React.useState<DrillTarget | null>(null);
  const [customising, setCustomising] = React.useState(false);
  const q = useSeniorDashboard(period, departmentId || undefined);
  const d = q.data;
  const sections = orderedSections(d?.layout ?? null).filter((s) => !s.hidden);
  const org = { scope: 'org' as const, departmentId: departmentId || undefined };
  const openPerson = (id: string) => router.push(`/app?view=executive&person=${id}`);
  const openTeam = (id: string) => router.push(`/app?view=manager&person=${id}`);

  const render = (id: OrgSection, data: SeniorData) => {
    switch (id) {
      case 'org.kpis':
        return <KpiCards label={t('Organisation metrics')} kpis={data.kpis} currency={data.currency} onOpen={(k) => setDrill({ metric: k.key, title: t(METRIC_LABEL[k.key]), ...org })} />;
      case 'org.departments':
        return (
          <Departments
            data={data}
            onDepartment={(row) => setDrill({ metric: 'revenue', title: t('Revenue: {name}', { name: row.department?.name ?? t('No department') }), scope: 'org', departmentId: row.department?.id })}
            onManager={openTeam}
          />
        );
      case 'org.rankings':
        return <Rankings data={data} onOpen={openPerson} />;
      case 'org.revenue':
        return data.revenue ? <OrgRevenue data={data} onDrill={setDrill} /> : null;
      case 'org.insights':
        return <Insights data={data} />;
    }
  };

  return (
    <div className="space-y-5" data-testid="senior-dashboard">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {d ? (
              <>
                <h2 className="text-xl font-semibold tracking-tight">{d.departmentId ? (d.departments.find((x) => x.id === d.departmentId)?.name ?? '') : t('The whole organisation')}</h2>
                <p className="text-sm text-muted-foreground">
                  {[
                    t('{count} people', { count: count(d.people) }),
                    d.coverage === 'VISIBLE' && !d.departmentId ? t('Only the people your role lets you see') : null,
                    t(PERIOD_LABEL[d.range.period]),
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
            {(d?.departments.length ?? 0) > 0 && (
              <>
                <label className="sr-only" htmlFor="cc-dept">
                  {t('Department')}
                </label>
                <Select id="cc-dept" className="w-auto" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">{t('All departments')}</option>
                  {d!.departments.map((x) => (
                    <option key={x.id} value={x.id}>
                      {t.maybe(x.name)}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button variant="outline" size="sm" onClick={() => setCustomising(true)} disabled={!d}>
              <LayoutGrid aria-hidden /> {t('Customise')}
            </Button>
          </div>
        </div>
        {d?.features.revenueAttribution && (
          <div className="mt-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t('Organisation target for the period')}</span>
              <span className="tabular text-muted-foreground" data-testid="org-target">
                {d.target.target !== null
                  ? t('{achieved} of {target} ({percent})', { achieved: money(d.target.achieved, d.currency), target: money(d.target.target, d.currency), percent: pct(d.target.percent) })
                  : t('{achieved} credited. No target set.', { achieved: money(d.target.achieved, d.currency) })}
              </span>
            </div>
            <Progress value={d.target.percent} label={t('Organisation target for the period')} />
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

      <DrillPanel target={drill} period={period} currency={d?.currency ?? context.currency} onClose={() => setDrill(null)} />
      {d && customising && <CustomiseDialog layout={d.layout} onClose={() => setCustomising(false)} />}
    </div>
  );
}

/** Help for each section; written out so the help test can see every topic in use. */
function SectionTip({ id }: { id: OrgSection }) {
  switch (id) {
    case 'org.kpis':
      return <InfoTip topic="cc.orgKpis" />;
    case 'org.departments':
      return <InfoTip topic="cc.orgDepartments" />;
    case 'org.rankings':
      return <InfoTip topic="cc.orgRankings" />;
    case 'org.revenue':
      return <InfoTip topic="cc.orgRevenue" />;
    case 'org.insights':
      return <InfoTip topic="cc.orgInsights" />;
  }
}

const TH = 'px-2 py-2 text-end font-medium';
const TD = 'px-2 py-2 text-end';

// ─── Departments and teams (13.2) ───

function Departments({ data, onDepartment, onManager }: { data: SeniorData; onDepartment: (row: OrgDepartmentRow) => void; onManager: (userId: string) => void }) {
  const t = useT();
  const cells = (r: OrgDepartmentRow | OrgManagerRow) => (
    <>
      <td className={TD}>{count(r.leads)}</td>
      <td className={TD}>{count(r.rfqsReceived)}</td>
      <td className={TD}>{count(r.rfqsWon)}</td>
      <td className={TD}>{count(r.clientsConverted)}</td>
      {data.features.revenueAttribution && <td className={TD}>{money(r.business, data.currency)}</td>}
      {data.features.revenueAttribution && <td className={TD}>{r.target !== null ? pct(r.achievement) : '—'}</td>}
      <td className={TD}>{count(r.productivity)}</td>
      <td className="px-3 py-2">
        <Badge tone={PERFORMANCE_STATUS_TONE[r.status]}>{t(PERFORMANCE_STATUS_LABEL[r.status])}</Badge>
      </td>
    </>
  );
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[960px] text-sm" data-testid="org-departments">
        <caption className="sr-only">{t('Each department and the teams of its managers, for {period}', { period: t(PERIOD_LABEL[data.range.period]) })}</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('Department or manager')}
            </th>
            <th scope="col" className={TH}>
              {t('Reporting employees')}
            </th>
            <th scope="col" className={TH}>
              {t('Companies')}
            </th>
            <th scope="col" className={TH}>
              {t('RFQs received')}
            </th>
            <th scope="col" className={TH}>
              {t('RFQs won')}
            </th>
            <th scope="col" className={TH}>
              {t('Clients converted')}
            </th>
            {data.features.revenueAttribution && (
              <th scope="col" className={TH}>
                {t('Business generated')}
              </th>
            )}
            {data.features.revenueAttribution && (
              <th scope="col" className={TH}>
                {t('Target achievement')}
              </th>
            )}
            <th scope="col" className={TH}>
              {t('Client touches per person')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('Status')}
            </th>
          </tr>
        </thead>
        {data.departmentRows.map((row) => (
          <tbody key={row.department?.id ?? 'none'} className="tabular" data-department={row.department?.id ?? 'none'}>
            <tr className="border-b border-border bg-muted/40">
              <th scope="row" className="px-3 py-2 text-start font-semibold">
                <button type="button" className="rounded text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onDepartment(row)}>
                  {row.department ? t.maybe(row.department.name) : t('No department')}
                </button>
                <span className="block text-xs font-normal text-muted-foreground">{t('{count} people', { count: count(row.people) })}</span>
              </th>
              <td className={TD}>—</td>
              {cells(row)}
            </tr>
            {row.managers.map((m) => (
              <tr key={m.person.id} className="border-b border-border" data-manager={m.person.id}>
                <th scope="row" className="py-2 pe-3 ps-7 text-start font-medium">
                  <button type="button" className="rounded text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onManager(m.person.id)} aria-label={t('Open the team dashboard of {name}', { name: m.person.name })}>
                    {m.person.name}
                  </button>
                  {m.person.designation && <span className="block text-xs font-normal text-muted-foreground">{t.maybe(m.person.designation)}</span>}
                </th>
                <td className={TD}>{count(m.reports)}</td>
                {cells(m)}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <p className="px-4 py-3 text-xs text-muted-foreground">{t('A team is a manager and everyone reporting to them. Each company and each revenue share counts once in a total.')}</p>
    </Card>
  );
}

// ─── Rankings (13.3) ───

type RankBy = 'score' | RankingCategory;
const RANK_VALUE: Record<RankBy, (r: OrgPersonRow) => number | null> = {
  score: (r) => r.score,
  revenue: (r) => r.business,
  leads: (r) => r.leads,
  rfqs: (r) => r.rfqsReceived,
  conversions: (r) => r.clientsConverted,
  responseRate: (r) => r.responseRate,
  followUpCompletion: (r) => r.followUpCompletion,
  targetAchievement: (r) => r.achievement,
};
const RANK_BY_LABEL: Record<RankBy, MessageKey> = {
  score: 'Balanced score',
  revenue: 'Revenue',
  leads: 'Companies created',
  rfqs: 'RFQs received',
  conversions: 'Clients converted',
  responseRate: 'Response rate',
  followUpCompletion: 'Follow-up completion',
  targetAchievement: 'Target achievement',
};

function leaderValue(l: RankingLeader, currency: string): string {
  if (l.value === null) return '—';
  return l.category === 'revenue' ? money(l.value, currency) : ['responseRate', 'followUpCompletion', 'targetAchievement'].includes(l.category) ? pct(l.value) : count(l.value);
}

function Rankings({ data, onOpen }: { data: SeniorData; onOpen: (userId: string) => void }) {
  const t = useT();
  const [by, setBy] = React.useState<RankBy>('score');
  const leaders = data.ranking.leaders.filter((l) => data.features.revenueAttribution || (l.category !== 'revenue' && l.category !== 'targetAchievement'));
  const rows = [...data.ranking.people].sort((a, b) => (RANK_VALUE[by](b) ?? -1) - (RANK_VALUE[by](a) ?? -1) || (b.score ?? -1) - (a.score ?? -1) || a.person.name.localeCompare(b.person.name));
  const detail = (l: RankingLeader) => {
    if (!l.detail) return null;
    const v = l.detail.value;
    if (v === null && l.detail.label !== 'target') return null;
    switch (l.detail.label) {
      case 'leadConversion':
        return t('{percent} converted', { percent: pct(v) });
      case 'rfqWinRate':
        return t('{percent} RFQ win rate', { percent: pct(v) });
      case 'emailsSent':
        return t('from {count} emails sent', { count: count(v) });
      case 'followUpsDue':
        return t('of {count} follow-ups due', { count: count(v) });
      case 'target':
        return v === null ? t('No target set') : t('{percent} of target', { percent: pct(v) });
      case 'business':
        return data.features.revenueAttribution ? t('{amount} business', { amount: money(v, data.currency) }) : null;
      default:
        return null;
    }
  };
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('Leaders for the period')} data-testid="org-leaders">
        {leaders.map((l) => (
          <li key={l.category} data-leader={l.category}>
            <Card className="h-full p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Trophy className="size-3.5" aria-hidden /> {t(RANKING_LABEL[l.category])}
              </p>
              {l.person ? (
                <>
                  <button type="button" className="mt-1 block rounded text-start font-semibold hover:underline" onClick={() => onOpen(l.person!.id)}>
                    {l.person.name}
                  </button>
                  <p className="tabular text-sm">
                    {leaderValue(l, data.currency)}
                    {detail(l) && <span className="text-muted-foreground"> · {detail(l)}</span>}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t('No one qualifies yet')}</p>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cc-rank" className="text-sm text-muted-foreground">
          {t('Rank by')}
        </label>
        <Select id="cc-rank" className="w-auto" value={by} onChange={(e) => setBy(e.target.value as RankBy)}>
          {(Object.keys(RANK_BY_LABEL) as RankBy[])
            .filter((k) => data.features.revenueAttribution || (k !== 'revenue' && k !== 'targetAchievement'))
            .map((k) => (
              <option key={k} value={k}>
                {t(RANK_BY_LABEL[k])}
              </option>
            ))}
        </Select>
        {by === 'score' && <p className="text-xs text-muted-foreground">{t('The balanced score weighs quality (conversion, win rate, response rate, follow-up completion, target) as well as volume, so the number of companies alone never decides the order.')}</p>}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-sm" data-testid="org-ranking">
          <caption className="sr-only">{t('Everyone ranked by {measure}, for {period}', { measure: t(RANK_BY_LABEL[by]), period: t(PERIOD_LABEL[data.range.period]) })}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('Rank')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('Employee')}
              </th>
              <th scope="col" className={TH}>
                {t('Balanced score')}
              </th>
              {data.features.revenueAttribution && (
                <th scope="col" className={TH}>
                  {t('Business generated')}
                </th>
              )}
              <th scope="col" className={TH}>
                {t('Companies')}
              </th>
              <th scope="col" className={TH}>
                {t('Company conversion')}
              </th>
              <th scope="col" className={TH}>
                {t('RFQs received')}
              </th>
              <th scope="col" className={TH}>
                {t('RFQ win rate')}
              </th>
              <th scope="col" className={TH}>
                {t('Clients converted')}
              </th>
              <th scope="col" className={TH}>
                {t('Response rate')}
              </th>
              <th scope="col" className={TH}>
                {t('Follow-up completion')}
              </th>
              {data.features.revenueAttribution && (
                <th scope="col" className={TH}>
                  {t('Target achievement')}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r, i) => (
              <tr key={r.person.id} className="border-b border-border last:border-0" data-person={r.person.id}>
                <td className="px-3 py-2 text-end text-muted-foreground">{RANK_VALUE[by](r) === null ? '—' : i + 1}</td>
                <th scope="row" className="px-3 py-2 text-start font-medium">
                  <button type="button" className="rounded text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(r.person.id)} aria-label={t('Open the dashboard of {name}', { name: r.person.name })}>
                    {r.person.name}
                  </button>
                  <span className="block text-xs font-normal text-muted-foreground">{[r.person.designation && t.maybe(r.person.designation), r.department && t.maybe(r.department.name)].filter(Boolean).join(' · ')}</span>
                </th>
                <td className={cn(TD, 'font-semibold')}>{r.score === null ? '—' : count(r.score)}</td>
                {data.features.revenueAttribution && <td className={TD}>{money(r.business, data.currency)}</td>}
                <td className={TD}>{count(r.leads)}</td>
                <td className={TD}>{pct(r.leadConversion)}</td>
                <td className={TD}>{count(r.rfqsReceived)}</td>
                <td className={TD}>{pct(r.rfqWinRate)}</td>
                <td className={TD}>{count(r.clientsConverted)}</td>
                <td className={TD}>{pct(r.responseRate)}</td>
                <td className={TD}>{pct(r.followUpCompletion)}</td>
                {data.features.revenueAttribution && <td className={TD}>{r.target !== null ? pct(r.achievement) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Revenue (13.4) ───

type Breakdown = 'byEmployee' | 'byManager' | 'byDepartment' | 'byClient' | 'byCountry' | 'byIndustry' | 'byService';
const BREAKDOWN_LABEL: Record<Breakdown, MessageKey> = {
  byEmployee: 'Employee',
  byManager: 'Manager',
  byDepartment: 'Department',
  byClient: 'Client',
  byCountry: 'Country',
  byIndustry: 'Industry',
  byService: 'Service category',
};
const PERIOD_KEY_LABEL: Record<'month' | 'quarter' | 'half' | 'year', MessageKey> = {
  month: 'This month',
  quarter: 'This quarter',
  half: 'This half-year',
  year: 'This year',
};

function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames([fmtLocale()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function OrgRevenue({ data, onDrill }: { data: SeniorData; onDrill: (t: DrillTarget) => void }) {
  const t = useT();
  const animate = usePreferences((s) => s.appearance.motion !== 'off' && s.appearance.motion !== 'minimal');
  const r = data.revenue!;
  const [by, setBy] = React.useState<Breakdown>('byDepartment');
  const monthLabel = (ym: string) => new Intl.DateTimeFormat(fmtLocale(), { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-15T00:00:00Z`));
  const trend = r.trend.map((p) => ({ name: monthLabel(p.month), revenue: p.revenue, target: p.target }));
  const best = [...r.trend].sort((a, b) => b.revenue - a.revenue)[0];
  const label = (s: RevenueSlice) => {
    if (s.key === 'other') return t('Shares held by people outside this view');
    if (s.key === 'none') return by === 'byService' ? t('Service not recorded') : by === 'byCountry' ? t('Country not recorded') : by === 'byIndustry' ? t('Industry not recorded') : by === 'byClient' ? t('No company') : t('No department');
    return by === 'byCountry' ? countryName(s.label) : by === 'byDepartment' ? t.maybe(s.label) : s.label;
  };
  const open = (s: RevenueSlice) => {
    if (!s.link) return;
    const title = t('Revenue: {name}', { name: label(s) });
    if (s.link.kind === 'person') onDrill({ metric: 'revenue', scope: 'me', userId: s.link.id, title });
    else if (s.link.kind === 'team') onDrill({ metric: 'revenue', scope: 'team', userId: s.link.id, title });
    else if (s.link.kind === 'department') onDrill({ metric: 'revenue', scope: 'org', departmentId: s.link.id, title });
  };
  const slices = r[by];
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('Revenue by period')} data-testid="org-revenue-periods">
        {r.periods.map((p) => (
          <li key={p.key}>
            <Card className="h-full p-4">
              <p className="text-xs font-medium text-muted-foreground">{t(PERIOD_KEY_LABEL[p.key])}</p>
              <p className="tabular mt-1 text-xl font-semibold">{money(p.amount, data.currency)}</p>
              <p className="tabular mb-2 text-xs text-muted-foreground">{p.target !== null ? t('{percent} of {target}', { percent: pct(p.target ? (Math.round((p.amount / p.target) * 1000) / 10) : null), target: money(p.target, data.currency) }) : t('No target set')}</p>
              {p.target !== null && <Progress value={p.target ? Math.round((p.amount / p.target) * 1000) / 10 : null} label={t('{period} against target', { period: t(PERIOD_KEY_LABEL[p.key]) })} />}
            </Card>
          </li>
        ))}
      </ul>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title={t('Target against achievement')}
          description={t('Revenue each month this year, with the target for the month.')}
          summary={best && best.revenue > 0 ? t('Chart for {count} months; the best month brought {amount}.', { count: r.trend.length, amount: money(best.revenue, data.currency) }) : t('No revenue this year yet.')}
          filename="revenue-target.csv"
          table={{
            caption: t('Target against achievement'),
            header: [t('Month'), t('Revenue'), t('Target')],
            rows: r.trend.map((p) => [p.month, p.revenue, p.target]),
            display: r.trend.map((p) => [monthLabel(p.month), money(p.revenue, data.currency), money(p.target, data.currency)]),
            numeric: [1, 2],
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
              <YAxis tickFormatter={(v: number) => money(v, data.currency)} tick={axisTick} tickLine={false} axisLine={false} width={80} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number, name: string) => [money(v, data.currency), name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name={t('Revenue')} fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
              <Line dataKey="target" name={t('Target')} stroke="hsl(var(--chart-3))" strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={animate} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div>
              <h3 className="text-sm font-semibold">{t('Where the revenue comes from')}</h3>
              <p className="text-xs text-muted-foreground">{t('{amount} in {period}, each deal counted once.', { amount: money(r.total, data.currency), period: t(PERIOD_LABEL[data.range.period]) })}</p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="cc-breakdown" className="text-sm text-muted-foreground">
                {t('Break down by')}
              </label>
              <Select id="cc-breakdown" className="w-auto" value={by} onChange={(e) => setBy(e.target.value as Breakdown)}>
                {(Object.keys(BREAKDOWN_LABEL) as Breakdown[]).map((k) => (
                  <option key={k} value={k}>
                    {t(BREAKDOWN_LABEL[k])}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="mt-2 w-full text-sm" data-testid="org-revenue-breakdown">
              <caption className="sr-only">{t('Revenue by {what}', { what: t(BREAKDOWN_LABEL[by]) })}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-2 text-start font-medium">
                    {t(BREAKDOWN_LABEL[by])}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">
                    {t('Revenue')}
                  </th>
                  <th scope="col" className="w-1/3 px-4 py-2 text-start font-medium">
                    {t('Share')}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {slices.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-muted-foreground">
                      {t('No revenue in this period.')}
                    </td>
                  </tr>
                ) : (
                  slices.map((s) => (
                    <tr key={s.key} className="border-b border-border last:border-0" data-slice={s.key}>
                      <th scope="row" className="px-4 py-2 text-start font-medium">
                        {s.link?.kind === 'company' ? (
                          <Link href={`/app/companies/${s.link.id}`} className="rounded hover:underline">
                            {label(s)}
                          </Link>
                        ) : s.link ? (
                          <button type="button" className="rounded text-start hover:underline" onClick={() => open(s)}>
                            {label(s)}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">{label(s)}</span>
                        )}
                      </th>
                      <td className="px-4 py-2 text-end">{money(s.amount, data.currency)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-muted" aria-hidden>
                            <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, s.share)}%` }} />
                          </div>
                          <span className="w-12 text-end text-xs text-muted-foreground">{pct(s.share)}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {by === 'byManager' ? t('A manager’s figure covers their whole team, so managers above others include their teams. Select a row to see its deals.') : t('Select a row to see its deals.')}
            {r.unconverted.length > 0 && ` ${t('Left out for want of an exchange rate: {list}', { list: r.unconverted.map((u) => money(u.amount, u.currency)).join(', ') })}`}
          </p>
        </Card>
      </div>
    </div>
  );
}

// ─── Insights (13.5) ───

function Insights({ data }: { data: SeniorData }) {
  const t = useT();
  const figure = (kind: OrgInsight['kind'], i: OrgInsightItem): string | null => {
    switch (kind) {
      case 'overdueFollowUps':
        return t('{count} overdue', { count: count(i.value) });
      case 'lowConversion':
        return t('{count} companies, {percent} converted', { count: count(i.value), percent: pct(i.extra) });
      case 'repeatRfqs':
        return t('{count} RFQs in six months', { count: count(i.value) });
      case 'decliningEngagement':
        return t('{now} interactions in the last 30 days, {before} in the 30 before', { now: count(i.value), before: count(i.extra) });
      case 'stuckNegotiation':
        return t('{count} days in negotiation', { count: count(i.value) });
      case 'rfqDeadlines':
        return i.value === null ? null : i.value < 0 ? t('Deadline passed {count} days ago', { count: count(-i.value) }) : i.value === 0 ? t('Due today') : t('Due in {count} days', { count: count(i.value) });
      case 'unresolvedConcerns':
        return t('{count} open concerns', { count: count(i.value) });
      case 'teamsBehind':
        return t('{percent} of target · {count} people', { percent: pct(i.value), count: count(i.extra) });
      case 'revenueConcentration':
        return t('{percent} of revenue', { percent: pct(i.value) });
      default:
        return null;
    }
  };
  const shown = data.insights.filter((x) => data.features.revenueAttribution || (x.kind !== 'teamsBehind' && x.kind !== 'revenueConcentration'));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {shown.map((x) => (
        <Card key={x.kind} className="p-4" data-insight={x.kind}>
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold">{t(INSIGHT_LABEL[x.kind])}</h3>
            <Badge tone={x.count === 0 ? 'success' : x.kind === 'rfqDeadlines' || x.kind === 'overdueFollowUps' || x.kind === 'teamsBehind' ? 'critical' : 'warning'}>{count(x.count)}</Badge>
          </div>
          {x.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('All clear.')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {x.items.map((i) => (
                <li key={i.id} className="min-w-0">
                  {i.href ? (
                    <Link href={i.href} className="block truncate rounded font-medium hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{i.title}</span>
                  )}
                  <span className="tabular block text-xs text-muted-foreground">{[figure(x.kind, i), i.person && i.person.name !== i.title ? i.person.name : null].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
              {x.count > x.items.length && <li className="text-xs text-muted-foreground">{t('and {count} more', { count: count(x.count - x.items.length) })}</li>}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─── Customise ───

function CustomiseDialog({ layout, onClose }: { layout: CommandCenterLayout | null; onClose: () => void }) {
  const t = useT();
  const save = useSaveCommandCenterLayout('SENIOR');
  const [sections, setSections] = React.useState(() => orderedSections(layout));
  const [error, setError] = React.useState<string | null>(null);
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
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Only you see this arrangement. Your numbers stay the same.')}</DialogDescription>
        <h3 className="mb-2 text-sm font-semibold">{t('Sections')}</h3>
        <ul className="mb-5 space-y-1.5">
          {sections.map((s, i) => (
            <ArrangeRow key={s.id} label={t(SECTION_LABEL[s.id])} hidden={s.hidden} first={i === 0} last={i === sections.length - 1} onMove={(dir) => setSections(move(sections, i, dir))} onToggle={() => setSections(sections.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x)))} />
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-3 text-sm text-critical">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => submit(null)} disabled={save.isPending}>
            {t('Reset to default')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="button" onClick={() => submit({ sections, workSections: [], categories: [] })} disabled={save.isPending}>
              {save.isPending ? t('Saving…') : t('Save layout')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
