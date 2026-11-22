'use client';

import {
  type ExecutiveDay,
  type ManagerDashboardView,
  type SuperDashboard,
  TARGET_METRIC_LABEL,
  type TargetTotal,
  WORKSPACE_DASHBOARD_PERIOD_LABEL,
  WORKSPACE_DASHBOARD_PERIODS,
  type WorkCounts,
  type WorkspaceDashboardPeriod,
  type WorkspacePerformance,
} from '@dealflow/types';
import { Card, cn, Skeleton } from '@dealflow/ui';
import {
  AlarmClock,
  Award,
  BellRing,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  ListTodo,
  type LucideIcon,
  PhoneCall,
  Target,
  TrendingDown,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisTick, tooltipStyle } from '@/components/command-center/chart-card';
import { count, money, pct, Progress } from '@/components/command-center/tier-parts';
import { ErrorText } from '@/components/revenue/tabs';
import { useT } from '@/lib/i18n';
import { useWorkspaceDashboard } from '@/lib/workspace-dashboard';

/*
 * One dashboard per workspace level (ADR 0071, part 6). Each has its own colour, layout and focus: the Super Workspace
 * runs the organisation, a manager runs a team, an executive runs their own day. No recent-activity lists anywhere.
 */

const TONE = {
  SUPER: { band: 'from-[hsl(262_83%_58%/0.16)]', ring: 'hsl(262 83% 58%)', accent: 'text-[hsl(262_60%_45%)] dark:text-[hsl(262_83%_75%)]' },
  MANAGER: { band: 'from-[hsl(199_89%_48%/0.16)]', ring: 'hsl(199 89% 42%)', accent: 'text-[hsl(199_89%_30%)] dark:text-[hsl(199_89%_70%)]' },
  EXECUTIVE: { band: 'from-[hsl(152_69%_40%/0.16)]', ring: 'hsl(152 69% 36%)', accent: 'text-[hsl(152_69%_26%)] dark:text-[hsl(152_60%_65%)]' },
} as const;

/** The dashboard for the caller's level, with its own period choice. */
export function LevelDashboard({ level }: { level: 'SUPER' | 'MANAGER' | 'EXECUTIVE' }) {
  const [period, setPeriod] = useState<WorkspaceDashboardPeriod>(level === 'EXECUTIVE' ? 'TODAY' : 'MONTH');
  const q = useWorkspaceDashboard(period);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  // An executive's dashboard is always today; the others choose the period.
  const picker = level === 'EXECUTIVE' ? null : <PeriodTabs value={period} onChange={setPeriod} />;
  if (d.level === 'SUPER') return <SuperOverview d={d} picker={picker} />;
  if (d.level === 'MANAGER') return <TeamOverview d={d} picker={picker} />;
  return <MyDay d={d} picker={picker} />;
}

function PeriodTabs({ value, onChange }: { value: WorkspaceDashboardPeriod; onChange: (p: WorkspaceDashboardPeriod) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('Period')} className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {WORKSPACE_DASHBOARD_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn('h-8 rounded-md px-3 text-sm transition-colors', value === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
        >
          {t(WORKSPACE_DASHBOARD_PERIOD_LABEL[p])}
        </button>
      ))}
    </div>
  );
}

function Hero({ level, title, subtitle, picker }: { level: keyof typeof TONE; title: string; subtitle: string; picker: React.ReactNode }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-gradient-to-br to-transparent p-5', TONE[level].band)} data-level-dashboard={level}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {picker}
    </div>
  );
}

function Stat({ icon: Icon, label, value, detail, href, tone, data }: { icon: LucideIcon; label: string; value: string; detail?: string; href?: string; tone?: string; data?: string }) {
  const body = (
    <Card className="h-full p-4 transition-shadow hover:shadow-md" data-stat={data}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={cn('size-4', tone)} aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

function Targets({ rows, currency, title }: { rows: TargetTotal[]; currency: string; title: string }) {
  const t = useT();
  return (
    <Card className="p-4" data-dashboard-targets>
      <h3 className="flex items-center gap-2 font-medium">
        <Target className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      {rows.length ? (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => {
            const fmt = (n: number) => (r.metric === 'REVENUE' ? money(n, currency) : count(n));
            return (
              <li key={r.metric} data-target-total={r.metric}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{t.maybe(TARGET_METRIC_LABEL[r.metric])}</span>
                  <span className="tabular">
                    {t('{done} of {total}', { done: fmt(r.achieved), total: fmt(r.amount) })} · {pct(r.percent)}
                  </span>
                </div>
                <Progress value={r.percent} label={t.maybe(TARGET_METRIC_LABEL[r.metric])} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('No targets are running now.')}{' '}
          <Link href="/app/targets" className="text-primary underline-offset-2 hover:underline">
            {t('Open targets')}
          </Link>
        </p>
      )}
    </Card>
  );
}

function Work({ w }: { w: WorkCounts }) {
  const t = useT();
  return (
    <section aria-label={t('Work to do')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={ListTodo} label={t('Open tasks')} value={count(w.openTasks)} href="/app/tasks" data="openTasks" />
      <Stat icon={AlarmClock} label={t('Overdue tasks')} value={count(w.overdueTasks)} href="/app/tasks" tone={w.overdueTasks ? 'text-critical' : undefined} data="overdueTasks" />
      <Stat icon={CalendarCheck} label={t('Pending follow-ups')} value={count(w.pendingFollowUps)} href="/app/follow-ups" data="pendingFollowUps" />
      <Stat icon={BellRing} label={t('Overdue follow-ups')} value={count(w.overdueFollowUps)} href="/app/follow-ups" tone={w.overdueFollowUps ? 'text-critical' : undefined} data="overdueFollowUps" />
    </section>
  );
}

function Leader({ icon: Icon, label, p, currency, tone }: { icon: LucideIcon; label: string; p: WorkspacePerformance | null; currency: string; tone: string }) {
  const t = useT();
  return (
    <Card className="p-4" data-leader={label}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={cn('size-4', tone)} aria-hidden />
        {label}
      </p>
      {p ? (
        <>
          <p className="mt-2 text-lg font-semibold">{p.workspace.name}</p>
          <p className="text-xs text-muted-foreground">
            {[p.manager ? t('Team: {name}', { name: p.manager.name }) : null, t('Leads: {n}', { n: count(p.leads) }), money(p.revenue, currency), p.targetPercent !== null ? t('{p} of target', { p: pct(p.targetPercent) }) : null].filter(Boolean).join(' · ')}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('Nobody has results in this period yet.')}</p>
      )}
    </Card>
  );
}

function PerformanceTable({ rows, currency, caption, showManager }: { rows: WorkspacePerformance[]; currency: string; caption: string; showManager?: boolean }) {
  const t = useT();
  if (!rows.length) return <p className="mt-3 text-sm text-muted-foreground">{t('No workspaces yet.')}</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 text-start font-medium">{t('Workspace')}</th>
            {showManager && <th scope="col" className="py-1 text-start font-medium">{t('Team')}</th>}
            <th scope="col" className="py-1 text-end font-medium">{t('Leads')}</th>
            <th scope="col" className="py-1 text-end font-medium">{t('Calls')}</th>
            <th scope="col" className="py-1 text-end font-medium">{t('Deals won')}</th>
            <th scope="col" className="py-1 text-end font-medium">{t('Revenue')}</th>
            <th scope="col" className="w-36 py-1 ps-4 text-start font-medium">{t('Target')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.workspace.id} className="border-t border-border" data-performance={r.workspace.name}>
              <th scope="row" className="py-2 text-start font-medium">{r.workspace.name}</th>
              {showManager && <td className="py-2 text-muted-foreground">{r.manager?.name ?? '—'}</td>}
              <td className="py-2 text-end tabular">{count(r.leads)}</td>
              <td className="py-2 text-end tabular">{count(r.calls)}</td>
              <td className="py-2 text-end tabular">{count(r.dealsWon)}</td>
              <td className="py-2 text-end tabular">{money(r.revenue, currency)}</td>
              <td className="py-2 ps-4">
                {r.targetPercent === null ? (
                  <span className="text-xs text-muted-foreground">{t('No target')}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <Progress value={r.targetPercent} label={t('Target for {name}', { name: r.workspace.name })} />
                    <span className="w-12 text-end text-xs tabular">{pct(r.targetPercent)}</span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerformanceChart({ rows, currency, label }: { rows: WorkspacePerformance[]; currency: string; label: string }) {
  const t = useT();
  if (!rows.length) return null;
  const data = rows.map((r) => ({ name: r.workspace.name, leads: r.leads, revenue: r.revenue }));
  return (
    <div className="mt-3 h-56" role="img" aria-label={`${label}: ${rows.map((r) => `${r.workspace.name} ${count(r.leads)} / ${money(r.revenue, currency)}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8 }}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" tick={axisTick} interval={0} />
          <YAxis yAxisId="l" allowDecimals={false} tick={axisTick} width={32} />
          <YAxis yAxisId="r" orientation="right" tick={axisTick} width={56} tickFormatter={(v: number) => money(v, currency)} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="l" dataKey="leads" name={t('Leads')} fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar yAxisId="r" dataKey="revenue" name={t('Revenue')} fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Super Workspace: the organisation ────────────────────────────────────────────────────────────────────────────

function SuperOverview({ d, picker }: { d: SuperDashboard; picker: React.ReactNode }) {
  const t = useT();
  const left = (u: { used: number; max: number | null }) => (u.max === null ? t('No limit') : t('{n} left', { n: count(Math.max(0, u.max - u.used)) }));
  return (
    <div className="space-y-4">
      <Hero level="SUPER" title={t('Organisation overview')} subtitle={t('Every team’s results, your workspaces and targets, and the work waiting across the organisation.')} picker={picker} />
      <section aria-label={t('Organisation figures')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Building2} label={t('Manager Workspaces')} value={`${count(d.workspaces.managers.used)}${d.workspaces.managers.max !== null ? ` / ${count(d.workspaces.managers.max)}` : ''}`} detail={left(d.workspaces.managers)} href="/app/settings/workspaces" tone={TONE.SUPER.accent} data="managers" />
        <Stat icon={Users} label={t('Executive Workspaces')} value={`${count(d.workspaces.executives.used)}${d.workspaces.executives.max !== null ? ` / ${count(d.workspaces.executives.max)}` : ''}`} detail={left(d.workspaces.executives)} href="/app/settings/workspaces" tone={TONE.SUPER.accent} data="executives" />
        <Stat icon={UserPlus} label={t('Leads generated')} value={count(d.totals.leads)} detail={t('Calls: {n}', { n: count(d.totals.calls) })} href="/app/companies" tone={TONE.SUPER.accent} data="leads" />
        <Stat icon={CircleDollarSign} label={t('Sales achieved')} value={money(d.totals.revenue, d.currency)} detail={t('Deals won: {n}', { n: count(d.totals.dealsWon) })} href="/app/revenue" tone={TONE.SUPER.accent} data="revenue" />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Targets rows={d.targets} currency={d.currency} title={t('Organisation targets')} />
        <Leader icon={Trophy} label={t('Leading Manager Workspace')} p={d.topManager} currency={d.currency} tone="text-warning" />
        <Leader icon={Award} label={t('Leading Executive Workspace')} p={d.topExecutive} currency={d.currency} tone="text-warning" />
      </div>
      <Card className="p-4" data-performance-by="MANAGER">
        <h3 className="font-medium">{t('Performance by Manager Workspace')}</h3>
        <PerformanceChart rows={d.managers} currency={d.currency} label={t('Performance by Manager Workspace')} />
        <PerformanceTable rows={d.managers} currency={d.currency} caption={t('Performance by Manager Workspace')} />
      </Card>
      <Card className="p-4" data-performance-by="EXECUTIVE">
        <h3 className="font-medium">{t('Performance by Executive Workspace')}</h3>
        <PerformanceTable rows={d.executives} currency={d.currency} caption={t('Performance by Executive Workspace')} showManager />
      </Card>
      <Work w={d.work} />
    </div>
  );
}

// ── Manager Workspace: the team ──────────────────────────────────────────────────────────────────────────────────

function TeamOverview({ d, picker }: { d: ManagerDashboardView; picker: React.ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <Hero level="MANAGER" title={t('Team overview: {name}', { name: d.team.name })} subtitle={t('How each executive is doing against their targets, the team’s reports and trend, and the follow-ups and tasks to chase.')} picker={picker} />
      <section aria-label={t('Team figures')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label={t('Executives in your team')} value={count(d.executiveCount)} href="/app/settings/workspaces" tone={TONE.MANAGER.accent} data="executives" />
        <Stat icon={UserPlus} label={t('Team leads')} value={count(d.totals.leads)} detail={t('Calls: {n}', { n: count(d.totals.calls) })} tone={TONE.MANAGER.accent} data="leads" />
        <Stat icon={CircleDollarSign} label={t('Team sales')} value={money(d.totals.revenue, d.currency)} detail={t('Deals won: {n}', { n: count(d.totals.dealsWon) })} tone={TONE.MANAGER.accent} data="revenue" />
        <Stat icon={PhoneCall} label={t('Team calls')} value={count(d.totals.calls)} tone={TONE.MANAGER.accent} data="calls" />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Targets rows={d.targets} currency={d.currency} title={t('Team targets')} />
        <Leader icon={Trophy} label={t('Top executive')} p={d.best} currency={d.currency} tone="text-warning" />
        <Leader icon={TrendingDown} label={t('Needs support')} p={d.lowest} currency={d.currency} tone="text-critical" />
      </div>
      <Card className="p-4" data-performance-by="EXECUTIVE">
        <h3 className="font-medium">{t('Executive ranking')}</h3>
        <PerformanceTable rows={[...d.executives].sort((a, b) => (b.targetPercent ?? -1) - (a.targetPercent ?? -1) || b.revenue - a.revenue || b.leads - a.leads)} currency={d.currency} caption={t('Executive ranking')} />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4" data-team-reports>
          <h3 className="font-medium">{t('Daily, weekly and monthly report')}</h3>
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">{t('Daily, weekly and monthly report')}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 text-start font-medium">{t('Period')}</th>
                <th scope="col" className="py-1 text-end font-medium">{t('Leads')}</th>
                <th scope="col" className="py-1 text-end font-medium">{t('Calls')}</th>
                <th scope="col" className="py-1 text-end font-medium">{t('Deals won')}</th>
                <th scope="col" className="py-1 text-end font-medium">{t('Revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {d.reports.map((r) => (
                <tr key={r.period} className="border-t border-border" data-report={r.period}>
                  <th scope="row" className="py-2 text-start font-medium">{t(WORKSPACE_DASHBOARD_PERIOD_LABEL[r.period])}</th>
                  <td className="py-2 text-end tabular">{count(r.leads)}</td>
                  <td className="py-2 text-end tabular">{count(r.calls)}</td>
                  <td className="py-2 text-end tabular">{count(r.dealsWon)}</td>
                  <td className="py-2 text-end tabular">{money(r.revenue, d.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="p-4">
          <h3 className="font-medium">{t('Team trend, last 8 weeks')}</h3>
          <div className="mt-3 h-48" role="img" aria-label={`${t('Team trend, last 8 weeks')}: ${d.trend.map((p) => `${p.week} ${p.leads}`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tick={axisTick} tickFormatter={(w: string) => w.slice(5)} />
                <YAxis allowDecimals={false} tick={axisTick} width={32} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="leads" name={t('Leads')} stroke={TONE.MANAGER.ring} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Work w={d.work} />
      {d.otherManagers && (
        <Card className="p-4" data-other-managers>
          <h3 className="font-medium">{t('Other Manager Workspaces')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('Figures only, as the Super Workspace allows. Their records stay private.')}</p>
          <PerformanceTable rows={d.otherManagers} currency={d.currency} caption={t('Other Manager Workspaces')} />
        </Card>
      )}
    </div>
  );
}

// ── Executive Workspace: the day ─────────────────────────────────────────────────────────────────────────────────

function Ring({ value, max, label, children }: { value: number; max: number | null; label: string; children: React.ReactNode }) {
  const share = max ? Math.min(1, value / max) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-36 shrink-0 place-items-center" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="10" />
        {max !== null && <circle cx="60" cy="60" r={r} fill="none" stroke={TONE.EXECUTIVE.ring} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - share)} />}
      </svg>
      <div className="text-center">{children}</div>
    </div>
  );
}

function MyDay({ d, picker }: { d: ExecutiveDay; picker: React.ReactNode }) {
  const t = useT();
  const tday = d.today;
  return (
    <div className="space-y-4">
      <Hero level="EXECUTIVE" title={t('My day')} subtitle={t('Today’s target and what is left, your calls and sales, and the follow-ups waiting on you.')} picker={picker} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex flex-wrap items-center gap-6 p-5" data-my-day>
          <Ring value={tday.leads} max={tday.leadTarget} label={tday.leadTarget === null ? t('{n} leads today', { n: count(tday.leads) }) : t('{done} of {total} leads today', { done: count(tday.leads), total: count(tday.leadTarget) })}>
            <p className="text-3xl font-semibold tabular" data-today-leads>{count(tday.leads)}</p>
            <p className="text-xs text-muted-foreground">{tday.leadTarget === null ? t('leads today') : t('of {n} leads', { n: count(tday.leadTarget) })}</p>
          </Ring>
          <dl className="grid flex-1 grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('Daily lead target')}</dt>
              <dd className="text-xl font-semibold tabular" data-lead-target>{tday.leadTarget === null ? '—' : count(tday.leadTarget)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('Leads still needed')}</dt>
              <dd className={cn('text-xl font-semibold tabular', tday.remaining ? TONE.EXECUTIVE.accent : 'text-success')} data-remaining>
                {tday.remaining === null ? '—' : count(tday.remaining)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('Calls today')}</dt>
              <dd className="text-xl font-semibold tabular" data-calls-today>
                {count(tday.calls)}
                {tday.callTarget !== null && <span className="text-sm font-normal text-muted-foreground"> / {count(tday.callTarget)}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('Sales today')}</dt>
              <dd className="text-xl font-semibold tabular">{money(tday.revenue, d.currency)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5" data-monthly-target>
          <h3 className="flex items-center gap-2 font-medium">
            <Target className={cn('size-4', TONE.EXECUTIVE.accent)} aria-hidden />
            {t('Monthly sales target')}
          </h3>
          {d.monthly ? (
            <>
              <p className="mt-3 text-2xl font-semibold tabular">
                {money(d.monthly.achieved, d.currency)} <span className="text-base font-normal text-muted-foreground">/ {money(d.monthly.amount, d.currency)}</span>
              </p>
              <div className="mt-2">
                <Progress value={d.monthly.percent} label={t('Monthly sales target')} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('{p} reached', { p: pct(d.monthly.percent) })}</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t('No sales target is running for you now.')}</p>
          )}
        </Card>
      </div>
      <Work w={d.work} />
      <div>
        <Card className="p-4" data-upcoming-follow-ups>
          <h3 className="flex items-center gap-2 font-medium">
            <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
            {t('Coming up')}
          </h3>
          {d.upcoming.length ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {d.upcoming.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className={cn('font-medium', f.overdue && 'text-critical')}>{f.title}</span>
                    {f.company && (
                      <Link href={`/app/companies/${f.company.id}`} className="ms-2 text-xs text-primary underline-offset-2 hover:underline">
                        {f.company.name}
                      </Link>
                    )}
                  </span>
                  <span className={cn('text-xs tabular', f.overdue ? 'font-semibold text-critical' : 'text-muted-foreground')}>
                    {f.overdue ? t('Overdue') : new Date(f.dueAt).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t('No follow-ups are waiting on you.')}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
