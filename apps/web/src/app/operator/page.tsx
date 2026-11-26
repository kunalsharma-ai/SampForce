'use client';

import { Badge, Card, cn, Skeleton } from '@dealflow/ui';
import {
  CONSOLE_ACTIVITY_CATEGORIES,
  CONSOLE_ACTIVITY_PERMISSION,
  type ConsoleActionKey,
  type ConsoleDashboard,
  type ConsoleKpi,
  type ConsoleKpiKey,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  Layers,
  Plus,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ActivityFeed } from '@/components/console/activity-feed';
import { ConsoleDenied, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { AnimatedNumber } from '@/components/command-center/animated-number';
import { api } from '@/lib/api';
import { formatDate, formatMinor } from '@/lib/billing';
import { usePreferences } from '@/stores/preferences';
import { can, useOperator } from './operator-shell';
import { dayPart, lineOfTheDay, WelcomeBanner } from '@/components/welcome/welcome-banner';

const KPI: Record<ConsoleKpiKey, { label: string; href: string; upIsBad?: boolean }> = {
  'clients.total': { label: 'Clients', href: '/operator/clients' },
  'clients.active': { label: 'Active clients', href: '/operator/clients?state=ACTIVE' },
  'clients.suspended': {
    label: 'Suspended clients',
    href: '/operator/clients?state=SUSPENDED',
    upIsBad: true,
  },
  'clients.trial': { label: 'Clients on trial', href: '/operator/clients?sort=renews&dir=asc' },
  'workspaces.super': { label: 'Super Workspaces', href: '/operator/clients' },
  'workspaces.manager': { label: 'Manager Workspaces', href: '/operator/clients?sort=managers' },
  'workspaces.executive': {
    label: 'Executive Workspaces',
    href: '/operator/clients?sort=executives',
  },
  'people.users': { label: 'People', href: '/operator/clients?sort=people' },
  'people.active': { label: 'Active people', href: '/operator/clients?sort=people' },
  'people.mobile': { label: 'People on mobile', href: '/operator/mobile' },
  'revenue.subscriptions': { label: 'Active subscriptions', href: '/operator/plans' },
  'revenue.expiring': {
    label: 'Renewing in 14 days',
    href: '/operator/clients?sort=renews&dir=asc',
    upIsBad: true,
  },
  'revenue.mrr': { label: 'Monthly recurring revenue', href: '/operator/plans' },
  'revenue.arr': { label: 'Annual recurring revenue', href: '/operator/plans' },
  'revenue.total': { label: 'Revenue collected', href: '/operator/plans' },
  'revenue.outstanding': {
    label: 'Outstanding payments',
    href: '/operator/clients?payment=OVERDUE',
    upIsBad: true,
  },
  'revenue.failed': {
    label: 'Failed payments',
    href: '/operator/clients?sort=payment',
    upIsBad: true,
  },
  'support.open': { label: 'Support queries waiting', href: '/operator/support', upIsBad: true },
};

const ACTION: Record<ConsoleActionKey, { label: (n: number) => string; href: string }> = {
  overdue: {
    label: (n) => `${n} overdue payment${n === 1 ? '' : 's'}`,
    href: '/operator/clients?payment=OVERDUE',
  },
  expiring: {
    label: (n) => `${n} subscription${n === 1 ? '' : 's'} renewing in 14 days`,
    href: '/operator/clients?sort=renews&dir=asc',
  },
  failed: {
    label: (n) => `${n} failed payment${n === 1 ? '' : 's'}`,
    href: '/operator/clients?sort=payment',
  },
  tickets: {
    label: (n) => `${n} support quer${n === 1 ? 'y' : 'ies'} open over 48 hours`,
    href: '/operator/support',
  },
  suspended: {
    label: (n) => `${n} suspended client${n === 1 ? '' : 's'}`,
    href: '/operator/clients?state=SUSPENDED',
  },
  seats: {
    label: (n) => `${n} unused workspace seat${n === 1 ? '' : 's'}`,
    href: '/operator/clients?sort=managers',
  },
  mobile: { label: (n) => `${n} mobile request${n === 1 ? '' : 's'}`, href: '/operator/mobile' },
  providers: {
    label: (n) => `${n} provider${n === 1 ? '' : 's'} failing a check`,
    href: '/operator/providers',
  },
};

const AXIS = { fontSize: 12, fill: 'hsl(var(--muted-foreground))' };
const TIP = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
};
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });

/**
 * The Console Overview (ADR 0074, C5b): what needs the operator now, 18 platform figures against 30 days ago, and
 * the charts. Figures come from one cached endpoint; the change against 30 days ago from the daily snapshots.
 */
export default function ConsoleOverviewPage() {
  const me = useOperator();
  const animate = useChartMotion();
  const allowed = !!me.data && can(me.data, 'clients.view');
  const q = useQuery({
    enabled: allowed,
    queryKey: ['operator', 'overview', 'dashboard'],
    queryFn: () => api<ConsoleDashboard>('/operator/overview/dashboard'),
    refetchInterval: 60_000,
  });
  if (!me.data) return <ConsoleLoading />;
  if (!allowed) return <ConsoleDenied />;
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ConsoleError error={q.error} />;
  const d = q.data;
  const money = (cents: number) => formatMinor(cents, d.currency);
  const others = d.otherCurrencies.filter((c) => c.mrrCents > 0);
  const plans = topPlans(d.plans);
  const categories = CONSOLE_ACTIVITY_CATEGORIES.filter((c) =>
    can(me.data, CONSOLE_ACTIVITY_PERMISSION[c] as never),
  );

  return (
    <div className="space-y-6" data-console-overview>
      <Hero
        name={me.data.name || me.data.email}
        providers={d.actions.find((a) => a.key === 'providers')?.count ?? 0}
        canCreate={can(me.data, 'clients.edit')}
        canPlans={can(me.data, 'plans.manage')}
        canBill={can(me.data, 'billing.manage')}
      />
      <ActionRequired actions={d.actions} />
      <section aria-labelledby="kpi-title">
        <h2 id="kpi-title" className="sr-only">
          Platform figures
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {d.kpis.map((k) => (
            <li key={k.key}>
              <KpiCard kpi={k} />
            </li>
          ))}
        </ul>
        {others.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Money figures are in {d.currency}. Also billed:{' '}
            {others
              .map((c) => `${formatMinor(c.mrrCents, c.currency)} a month in ${c.currency}`)
              .join(', ')}
            .
          </p>
        )}
      </section>
      <div className="grid gap-6 xl:grid-cols-3">
        <ChartCard
          title="Client growth"
          description="New and deactivated clients each month, and clients active at the end of it."
          className="xl:col-span-2"
        >
          <div
            className="h-64"
            role="img"
            data-chart="growth"
            aria-label={`Clients over the last 12 months. This month: ${d.growth.at(-1)?.new ?? 0} new, ${d.growth.at(-1)?.churned ?? 0} deactivated, ${d.growth.at(-1)?.active ?? 0} active.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={d.growth.map((g) => ({ ...g, label: monthLabel(g.month) }))}
                margin={{ left: 0, right: 8, top: 8 }}
              >
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis allowDecimals={false} tick={AXIS} width={36} />
                <Tooltip contentStyle={TIP} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area
                  isAnimationActive={animate}
                  type="monotone"
                  dataKey="active"
                  name="Active"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.15)"
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={animate}
                  type="monotone"
                  dataKey="new"
                  name="New"
                  stroke="hsl(var(--success))"
                  fill="hsl(var(--success) / 0.15)"
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={animate}
                  type="monotone"
                  dataKey="churned"
                  name="Deactivated"
                  stroke="hsl(var(--critical))"
                  fill="hsl(var(--critical) / 0.1)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <WorkspaceDonut w={d.workspaces} />
        <ChartCard
          title="Revenue"
          description={`Invoices each month in ${d.currency}: paid, still open and written off, with monthly recurring revenue.`}
          className="xl:col-span-2"
        >
          <div
            className="h-64"
            role="img"
            data-chart="revenue"
            aria-label={`Revenue over the last 12 months in ${d.currency}. This month: ${money(d.revenue.at(-1)?.paidCents ?? 0)} paid, ${money(d.revenue.at(-1)?.outstandingCents ?? 0)} open.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={d.revenue.map((r) => ({
                  label: monthLabel(r.month),
                  paid: r.paidCents / 100,
                  open: r.outstandingCents / 100,
                  failed: r.failedCents / 100,
                  mrr: r.mrrCents === null ? null : r.mrrCents / 100,
                }))}
                margin={{ left: 0, right: 8, top: 8 }}
              >
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={AXIS} />
                <YAxis
                  tick={AXIS}
                  width={56}
                  tickFormatter={(v: number) => compact(v, d.currency)}
                />
                <Tooltip
                  contentStyle={TIP}
                  formatter={(v: number) => formatMinor(Math.round(v * 100), d.currency)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  isAnimationActive={animate}
                  dataKey="paid"
                  name="Paid"
                  stackId="r"
                  fill="hsl(var(--success))"
                />
                <Bar
                  isAnimationActive={animate}
                  dataKey="open"
                  name="Open"
                  stackId="r"
                  fill="hsl(var(--warning))"
                />
                <Bar
                  isAnimationActive={animate}
                  dataKey="failed"
                  name="Written off"
                  stackId="r"
                  fill="hsl(var(--critical))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  isAnimationActive={animate}
                  type="monotone"
                  dataKey="mrr"
                  name="Monthly recurring"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard
          title="Plans sold"
          description="Active subscriptions on each plan, paid monthly or yearly."
        >
          {plans.length ? (
            <div
              className="h-64"
              role="img"
              data-chart="plans"
              aria-label={`Subscriptions per plan: ${plans.map((p) => `${p.name} ${p.month} monthly and ${p.year} yearly`).join(', ')}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={plans.map((p) => ({
                    name: p.name.replace('SampForce ', ''),
                    month: p.month,
                    year: p.year,
                  }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} />
                  <YAxis type="category" dataKey="name" width={96} tick={AXIS} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={TIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    isAnimationActive={animate}
                    dataKey="month"
                    name="Monthly"
                    stackId="p"
                    fill="hsl(var(--primary))"
                  />
                  <Bar
                    isAnimationActive={animate}
                    dataKey="year"
                    name="Yearly"
                    stackId="p"
                    fill="hsl(var(--accent))"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active subscriptions yet.</p>
          )}
        </ChartCard>
        <Utilisation u={d.utilisation} />
        <Mobile m={d.mobile} />
        <RecentWorkspaces rows={d.recentWorkspaces} />
      </div>
      {categories.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Recent activity</h2>
          <ActivityFeed categories={categories} pageSize={10} />
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Figures from{' '}
        {new Date(d.generatedAt).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
        . They refresh every minute.
      </p>
    </div>
  );
}

function Hero({
  name,
  providers,
  canCreate,
  canPlans,
  canBill,
}: {
  name: string;
  providers: number;
  canCreate: boolean;
  canPlans: boolean;
  canBill: boolean;
}) {
  const now = new Date();
  const part = dayPart(now);
  const first = name.includes('@') ? name : name.split(' ')[0]!;
  const initials = (
    name.includes('@')
      ? name.slice(0, 2)
      : name
          .split(/\s+/)
          .map((p) => p[0])
          .slice(0, 2)
          .join('')
  ).toUpperCase();
  const quick = [
    ...(canCreate
      ? [{ label: 'New client', href: '/operator/clients?new=1', icon: UserPlus }]
      : []),
    ...(canPlans ? [{ label: 'New plan', href: '/operator/plans', icon: Plus }] : []),
    ...(canBill
      ? [{ label: 'Record payment', href: '/operator/clients?payment=PENDING', icon: CreditCard }]
      : []),
  ];
  const status = (
    <span
      data-overview-status
      className={cn(
        'inline-flex items-center gap-1 font-semibold',
        providers ? 'text-critical' : 'text-success',
      )}
    >
      {providers ? (
        <AlertTriangle className="size-4" aria-hidden />
      ) : (
        <CheckCircle2 className="size-4" aria-hidden />
      )}
      {providers
        ? `${providers} provider${providers === 1 ? '' : 's'} need${providers === 1 ? 's' : ''} attention`
        : 'All systems normal'}
    </span>
  );
  return (
    <WelcomeBanner
      part={part}
      hello={CONSOLE_HELLO[part]}
      name={first}
      initials={initials}
      colors={['#e11d48', '#f97316']}
      headingId="overview-title"
      badge={
        <span
          className="rounded-full border border-border bg-surface/80 px-2 py-0.5 font-semibold text-foreground"
          data-welcome-level="platform"
        >
          Platform Console
        </span>
      }
      date={now.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}
      heading={
        <h1 id="overview-title" className="text-lg font-semibold text-muted-foreground">
          Overview
        </h1>
      }
      line={lineOfTheDay(CONSOLE_LINES, now)}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {status}
        {quick.length > 0 && (
          <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
            {quick.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 text-sm font-medium shadow-sm backdrop-blur hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <a.icon className="size-4" aria-hidden />
                {a.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </WelcomeBanner>
  );
}

const CONSOLE_HELLO = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Working late',
} as const;
const CONSOLE_LINES = [
  'Every client you onboard today is a team that sells better tomorrow.',
  'Healthy clients, quiet alerts: that is a good day on the platform.',
  'Small fixes today keep every workspace running smoothly.',
  'The platform is only as strong as the care behind it.',
  'Check the alerts, thank a client, ship something good.',
];

function ActionRequired({ actions }: { actions: ConsoleDashboard['actions'] }) {
  const open = actions.filter((a) => a.count > 0);
  return (
    <section aria-labelledby="actions-title">
      <h2 id="actions-title" className="mb-2 text-sm font-medium">
        Action required
      </h2>
      {open.length ? (
        <ul className="flex flex-wrap gap-2" data-overview-actions>
          {open.map((a) => (
            <li key={a.key}>
              <Link
                href={ACTION[a.key].href}
                data-action={a.key}
                className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm font-medium hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <AlertTriangle className="size-4 text-warning" aria-hidden />
                {ACTION[a.key].label(a.count)}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
          data-overview-actions
        >
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          Nothing needs you right now.
        </p>
      )}
    </section>
  );
}

function KpiCard({ kpi }: { kpi: ConsoleKpi }) {
  const meta = KPI[kpi.key];
  // Whole units on the cards so large sums fit; the exact figure is in the lists behind them.
  const fmt = (n: number) =>
    kpi.currency ? whole(n, kpi.currency) : Math.round(n).toLocaleString();
  const delta = kpi.previous === null ? null : kpi.value - kpi.previous;
  const pct = delta !== null && kpi.previous ? Math.round((delta / kpi.previous) * 100) : null;
  const bad = delta !== null && delta !== 0 && delta > 0 === !!meta.upIsBad;
  return (
    <Link
      href={meta.href}
      data-kpi={kpi.key}
      className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="flex h-full flex-col p-4 transition-colors hover:border-primary/40">
        <span className="text-sm text-muted-foreground">{meta.label}</span>
        <span className="mt-1 truncate text-xl font-semibold tabular" data-kpi-value>
          <AnimatedNumber value={kpi.value} format={fmt} />
        </span>
        <span className="mt-1 text-xs" data-kpi-delta>
          {delta === null ? (
            <span className="text-muted-foreground">No figure from 30 days ago yet</span>
          ) : delta === 0 ? (
            <span className="text-muted-foreground">No change in 30 days</span>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                bad ? 'text-critical' : 'text-success',
              )}
            >
              {delta > 0 ? (
                <ArrowUpRight className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3.5" aria-hidden />
              )}
              {delta > 0 ? '+' : '−'}
              {kpi.currency
                ? formatMinor(Math.abs(delta), kpi.currency)
                : Math.abs(delta).toLocaleString()}
              {pct !== null && ` (${Math.abs(pct)}%)`}
              <span className="font-normal text-muted-foreground">&nbsp;in 30 days</span>
            </span>
          )}
        </span>
        <Sparkline series={kpi.series} />
      </Card>
    </Link>
  );
}

/** A 30-day line drawn from the daily snapshots. Days without one are skipped. */
function Sparkline({ series }: { series: (number | null)[] }) {
  const pts = series
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (pts.length < 2) return <div className="mt-auto h-8" aria-hidden />;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const path = pts
    .map(
      (p, n) =>
        `${n ? 'L' : 'M'}${((p.i / (series.length - 1)) * 100).toFixed(1)},${(28 - ((p.v - min) / span) * 24).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="mt-auto h-8 w-full pt-2 text-primary"
      aria-hidden
      data-sparkline
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function ChartCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <h2 className="font-medium">{title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {children}
    </Card>
  );
}

function WorkspaceDonut({ w }: { w: ConsoleDashboard['workspaces'] }) {
  const animate = useChartMotion();
  const rows = [
    { name: 'Super', value: w.super, color: 'hsl(var(--primary))' },
    { name: 'Manager', value: w.manager, color: 'hsl(var(--accent))' },
    { name: 'Executive', value: w.executive, color: 'hsl(var(--success))' },
  ];
  const total = w.super + w.manager + w.executive;
  return (
    <ChartCard title="Workspaces" description="Every workspace across your clients, by level.">
      <div
        className="relative h-56"
        role="img"
        data-chart="workspaces"
        aria-label={`${total} workspaces: ${w.super} Super, ${w.manager} Manager, ${w.executive} Executive.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              isAnimationActive={animate}
              data={rows}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="85%"
              paddingAngle={2}
              stroke="none"
            >
              {rows.map((r) => (
                <Cell key={r.name} fill={r.color} aria-label={`${r.name} ${r.value}`} />
              ))}
            </Pie>
            <Tooltip contentStyle={TIP} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular">{total.toLocaleString()}</span>
          <span className="text-xs text-muted-foreground">workspaces</span>
        </div>
      </div>
      <ul className="mt-2 flex justify-center gap-4 text-xs">
        {rows.map((r) => (
          <li key={r.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: r.color }} aria-hidden />
            {r.name}{' '}
            <span className="tabular text-muted-foreground">{r.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

function Bullet({ label, used, allocated }: { label: string; used: number; allocated: number }) {
  const pct = allocated ? Math.min(100, Math.round((used / allocated) * 100)) : 0;
  const tone = pct >= 90 ? 'bg-critical' : pct >= 70 ? 'bg-warning' : 'bg-primary';
  return (
    <div data-utilisation={label}>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular text-muted-foreground">
          {used.toLocaleString()} of {allocated ? allocated.toLocaleString() : 'no limit'}
          {allocated ? ` · ${pct}%` : ''}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={`${label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Utilisation({ u }: { u: ConsoleDashboard['utilisation'] }) {
  return (
    <ChartCard
      title="Workspace use"
      description="Workspaces created against what clients may create, and the clients closest to their limit."
    >
      <div className="space-y-3">
        <Bullet label="Manager Workspaces" used={u.manager.used} allocated={u.manager.allocated} />
        <Bullet
          label="Executive Workspaces"
          used={u.executive.used}
          allocated={u.executive.allocated}
        />
      </div>
      <h3 className="mb-1 mt-4 text-sm font-medium">Top clients by use</h3>
      {u.top.length ? (
        <ol className="space-y-1 text-sm" data-overview-top>
          {u.top.map((t) => (
            <li key={t.id} className="flex justify-between gap-2">
              <Link
                href={`/operator/clients/${t.id}`}
                className="truncate text-primary underline-offset-2 hover:underline"
              >
                {t.name}
              </Link>
              <span className="shrink-0 tabular text-muted-foreground">
                {t.used} / {t.allocated}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No client has workspace limits yet.</p>
      )}
    </ChartCard>
  );
}

function Mobile({ m }: { m: ConsoleDashboard['mobile'] }) {
  const stats = [
    { label: 'Clients with the app', value: m.enabledClients.toLocaleString() },
    { label: 'Waiting for approval', value: m.requested.toLocaleString() },
    {
      label: 'Seats in use',
      value: `${m.seatsUsed.toLocaleString()}${m.seatsAllocated === null ? '' : ` / ${m.seatsAllocated.toLocaleString()}`}`,
    },
    { label: 'People signed in on mobile', value: m.people.toLocaleString() },
  ];
  return (
    <ChartCard
      title="Mobile app"
      description="Clients that may use the iOS and Android app, and the people using it."
    >
      <dl className="grid grid-cols-2 gap-3" data-overview-mobile>
        {stats.map((s) => (
          <div key={s.label} className="rounded-md bg-muted/50 p-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular">{s.value}</dd>
          </div>
        ))}
      </dl>
      <Link
        href="/operator/mobile"
        className="mt-3 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline"
      >
        <Smartphone className="size-4" aria-hidden />
        Open Mobile app
      </Link>
    </ChartCard>
  );
}

function RecentWorkspaces({ rows }: { rows: ConsoleDashboard['recentWorkspaces'] }) {
  return (
    <ChartCard
      title="Recently created workspaces"
      description="The newest Manager and Executive Workspaces across your clients."
    >
      {rows.length ? (
        <ul className="divide-y divide-border text-sm" data-overview-recent>
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{r.name}</span>
                </span>
                <Link
                  href={`/operator/clients/${r.clientId}`}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  {r.clientName}
                </Link>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <Badge tone={r.level === 'MANAGER' ? 'accent' : 'neutral'}>
                  {r.level === 'MANAGER' ? 'Manager' : 'Executive'}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No workspaces created yet.</p>
      )}
    </ChartCard>
  );
}

/** Charts draw in only when the operator's motion setting allows it, as on the Command Center. */
function useChartMotion(): boolean {
  const pref = usePreferences((s) => s.appearance.motion);
  const reduced = useReducedMotion();
  return !(pref === 'off' || pref === 'minimal' || (pref === 'balanced' && !!reduced));
}

/** The six plans with the most subscriptions; the rest share one bar so the names stay readable. */
function topPlans(plans: ConsoleDashboard['plans']): ConsoleDashboard['plans'] {
  if (plans.length <= 6) return plans;
  const rest = plans.slice(5);
  return [
    ...plans.slice(0, 5),
    {
      code: 'other',
      name: `${rest.length} other plans`,
      month: rest.reduce((a, p) => a + p.month, 0),
      year: rest.reduce((a, p) => a + p.year, 0),
    },
  ];
}

function whole(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function compact(v: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v);
}
