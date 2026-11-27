'use client';

import {
  AVAILABILITY_LABEL,
  AVAILABILITY_STATUSES,
  type AvailabilityPerson,
  type AvailabilityStatus,
  type DashboardCompanyRef,
  type DashboardDealRef,
  type ExecutiveDay,
  type ManagerDashboardView,
  type SuperDashboard,
  TARGET_METRIC_LABEL,
  TARGET_METRICS,
  type TargetMetric,
  type TargetRow,
  WORKSPACE_DASHBOARD_PERIOD_LABEL,
  WORKSPACE_DASHBOARD_PERIODS,
  type WorkspaceDashboardPeriod,
  type WorkspacePerformance,
  type WorkspaceWorkload,
} from '@dealflow/types';
import { Card, cn, Skeleton } from '@dealflow/ui';
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  Briefcase,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Handshake,
  History,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Mail,
  PhoneCall,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { StatusDot } from '@/components/availability/status-control';
import { TeamStatusBoard } from '@/components/availability/team-status-board';
import { count, money } from '@/components/command-center/tier-parts';
import { STAGE_CHIP, stageStyle } from '@/components/crm/stage-chip';
import { InfoTip } from '@/components/info-tip';
import { ErrorText } from '@/components/revenue/tabs';
import { useAvailabilityTeam } from '@/lib/availability';
import { useFollowUps } from '@/lib/company-work';
import { formatDate } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useJourneyBoard } from '@/lib/journey';
import { dayPart, type DayPart, lineOfTheDay, WelcomeBanner } from '@/components/welcome/welcome-banner';
import { useCan, useSession } from '@/lib/session';
import { useTargets } from '@/lib/workspace-work';
import { useWorkspaceDashboard } from '@/lib/workspace-dashboard';
import { useQuickCreate } from '@/stores/quick-create';
import { BirthdayCelebration } from '@/components/welcome/birthday-celebration';
import { useHasFeature } from '@/lib/features';

/*
 * The three role dashboards (redesign R6, ADR 0086). Each answers one question: the executive's "What do I need to do
 * today?", the manager's "How is my team doing?" and the Super Workspace's "What is happening across the
 * organisation?". Every figure is counted from records, and every card opens the exact list it counts.
 */

type Level = 'SUPER' | 'MANAGER' | 'EXECUTIVE';

/** Role accents: Executive red and blue (action), Manager amber and teal (team), Super crimson and violet (control). */
const ROLE = {
  EXECUTIVE: { band: 'from-[#e11d48]/15 via-[#2563eb]/10', a: '#e11d48', b: '#2563eb' },
  MANAGER: { band: 'from-[#d97706]/15 via-[#0d9488]/10', a: '#d97706', b: '#0d9488' },
  SUPER: { band: 'from-[#be123c]/15 via-[#7c3aed]/10', a: '#be123c', b: '#7c3aed' },
} as const;

const QUESTION: Record<Level, MessageKey> = {
  EXECUTIVE: 'What do I need to do today?',
  MANAGER: 'How is my team doing?',
  SUPER: 'What is happening across the organisation?',
};

/** The dashboard for the caller's workspace level. */
export function RoleDashboard({ level }: { level: Level }) {
  const [period, setPeriod] = React.useState<WorkspaceDashboardPeriod>(level === 'EXECUTIVE' ? 'TODAY' : 'MONTH');
  const q = useWorkspaceDashboard(period);
  const chat = useHasFeature('team_chat');
  const picker = level === 'EXECUTIVE' ? null : <PeriodTabs value={period} onChange={setPeriod} />;
  return (
    <div className="space-y-5" data-role-dashboard={level}>
      <Greeting level={level} picker={picker} />
      <BirthdayCelebration wishes={chat} />
      {q.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorText error={q.error} />
      ) : q.data.level === 'EXECUTIVE' ? (
        <ExecutiveToday d={q.data} />
      ) : q.data.level === 'MANAGER' ? (
        <ManagerTeam d={q.data} />
      ) : (
        <SuperOrganisation d={q.data} />
      )}
    </div>
  );
}

function PeriodTabs({ value, onChange }: { value: WorkspaceDashboardPeriod; onChange: (p: WorkspaceDashboardPeriod) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('Period')} className="grid w-full grid-cols-2 gap-0.5 rounded-2xl border border-border bg-surface/80 p-0.5 shadow-sm backdrop-blur sm:inline-flex sm:w-auto sm:max-w-full sm:gap-0 sm:overflow-x-auto sm:rounded-full">
      {WORKSPACE_DASHBOARD_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn('h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors', value === p ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
        >
          {t(WORKSPACE_DASHBOARD_PERIOD_LABEL[p])}
        </button>
      ))}
    </div>
  );
}

/** The greeting, the role's question and the quick actions the person may use. */
/** A line for the day on the home dashboard, the same all day (Kunal, redesign: an attractive welcome). */
const LINES: MessageKey[] = [
  'Every conversation today is a step closer to a win.',
  'Small follow-ups build big relationships.',
  'Your next client is one good email away.',
  'Focus on the few things that move deals forward.',
  'Great teams celebrate progress, not just results.',
  'Make today count: one call, one follow-up, one win.',
  'Consistency beats intensity. Keep showing up.',
];
const HELLO: Record<DayPart, MessageKey> = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Working late' };
const LEVEL_BADGE: Record<Level, MessageKey> = { EXECUTIVE: 'Executive Workspace', MANAGER: 'Manager Workspace', SUPER: 'Super Workspace' };

function Greeting({ level, picker }: { level: Level; picker: React.ReactNode }) {
  const t = useT();
  const { data: session } = useSession();
  const name = session?.user.name ?? '';
  const first = name.split(' ')[0] ?? '';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '·';
  const part = dayPart();
  return (
    <WelcomeBanner
      headingId="role-question"
      part={part}
      hello={t(HELLO[part])}
      name={first}
      initials={initials}
      photoUrl={session?.user.photoUrl ?? null}
      colors={[ROLE[level].a, ROLE[level].b]}
      date={new Intl.DateTimeFormat(t.formatLocale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
      badge={
        <span className="rounded-full border border-border bg-surface/80 px-2 py-0.5 font-semibold text-foreground" data-welcome-level={level}>
          {t(LEVEL_BADGE[level])}
        </span>
      }
      line={t(lineOfTheDay(LINES))}
      heading={
        <div className="flex items-center gap-1.5">
          <h1 id="role-question" className="text-lg font-bold tracking-tight text-foreground/90 sm:text-xl">
            {t(QUESTION[level])}
          </h1>
          <InfoTip topic="page.commandCenter" />
        </div>
      }
      aside={picker}
      clockLabel={t('Current time')}
      locale={t.formatLocale}
      specialDaysPath="/special-days/today"
      specialLabels={{ HOLIDAY: t('Public holiday today'), OBSERVANCE: t('Celebrated today'), COMPANY: t('Company event today') }}
    >
      <QuickActions />
    </WelcomeBanner>
  );
}

/** The quick actions moved from the header (section 38), each shown only to people allowed to use it. */
function QuickActions() {
  const t = useT();
  const open = useQuickCreate((s) => s.open);
  const companies = useCan('companies:write');
  const contacts = useCan('contacts:write');
  const deals = useCan('deals:write');
  const activities = useCan('activities:write');
  const items: { key: string; label: MessageKey; icon: LucideIcon; color: string; href?: string; run?: () => void; show: boolean }[] = [
    { key: 'company', label: 'Add company', icon: Building2, color: '#4f46e5', href: '/app/companies/new', show: companies },
    { key: 'contact', label: 'Add contact', icon: UserPlus, color: '#0891b2', run: () => open('contacts'), show: contacts },
    { key: 'email', label: 'Send email', icon: Mail, color: '#e11d48', href: '/app/communication', show: activities },
    { key: 'task', label: 'Create task', icon: ListTodo, color: '#7c3aed', run: () => open('task'), show: activities },
    { key: 'follow-up', label: 'Schedule follow-up', icon: CalendarCheck, color: '#d97706', href: '/app/follow-ups', show: activities },
    { key: 'deal', label: 'Create deal', icon: Handshake, color: '#16a34a', run: () => open('deals'), show: deals },
  ];
  const shown = items.filter((i) => i.show);
  if (!shown.length) return null;
  const chip = cn('group inline-flex min-h-9 items-center gap-2 rounded-full py-1 pe-3.5 ps-1 text-sm font-semibold shadow-sm transition motion-safe:hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', STAGE_CHIP);
  const dot = 'flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--st-dot)] text-white dark:bg-[var(--st-dot-d)] dark:text-[#0b1120]';
  return (
    <div role="toolbar" aria-label={t('Quick actions')} className="flex flex-wrap gap-2" data-dashboard-actions>
      {shown.map((i) => {
        const body = (
          <>
            <span aria-hidden className={dot}>
              <i.icon className="size-3.5" />
            </span>
            {t(i.label)}
          </>
        );
        return i.href ? (
          <Link key={i.key} href={i.href} style={stageStyle(i.color)} className={chip} data-dashboard-action={i.key}>
            {body}
          </Link>
        ) : (
          <button key={i.key} type="button" onClick={i.run} style={stageStyle(i.color)} className={chip} data-dashboard-action={i.key}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** A number card in its own colour that opens the list it counts. */
function Tile({ icon: Icon, label, value, detail, href, color, data, alert }: { icon: LucideIcon; label: string; value: string; detail?: string | null; href: string; color: string; data: string; alert?: boolean }) {
  return (
    <Link
      href={href}
      style={stageStyle(alert ? '#dc2626' : color)}
      data-tile={data}
      aria-label={`${label}: ${value}${detail ? `. ${detail}` : ''}`}
      className="group relative block h-full overflow-hidden rounded-2xl border border-[var(--st-bd)] bg-gradient-to-br from-[var(--st-bg)] via-surface to-surface p-4 shadow-sm transition hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5 dark:border-[var(--st-bd-d)] dark:from-[var(--st-bg-d)]"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[var(--st-dot)] dark:bg-[var(--st-dot-d)]" />
      <Icon aria-hidden className="pointer-events-none absolute -bottom-4 -end-4 size-24 text-[var(--st-fg)] opacity-[0.07] dark:text-[var(--st-fg-d)]" />
      <span className="flex items-center justify-between gap-2">
        <span aria-hidden className="flex size-10 items-center justify-center rounded-xl bg-[var(--st-dot)] text-white shadow-md dark:bg-[var(--st-dot-d)] dark:text-[#0b1120]">
          <Icon className="size-5" />
        </span>
        <ArrowRight aria-hidden className="size-4 text-[var(--st-fg)] opacity-0 transition group-hover:opacity-100 rtl:-scale-x-100 dark:text-[var(--st-fg-d)]" />
      </span>
      <span className="relative mt-3 block text-sm font-semibold text-[var(--st-fg)] dark:text-[var(--st-fg-d)]">{label}</span>
      <span className="relative mt-0.5 block break-words text-3xl font-extrabold tabular-nums tracking-tight">{value}</span>
      {detail && <span className="relative mt-0.5 block text-xs font-medium text-muted-foreground">{detail}</span>}
    </Link>
  );
}

function Panel({ title, icon: Icon, color, action, children, className, data }: { title: string; icon: LucideIcon; color: string; action?: { href: string; label: string }; children: React.ReactNode; className?: string; data?: string }) {
  const id = React.useId();
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)} data-panel={data}>
      <section aria-labelledby={id} className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3" style={stageStyle(color)}>
          <span aria-hidden className="flex size-7 items-center justify-center rounded-lg bg-[var(--st-dot)] text-white dark:bg-[var(--st-dot-d)] dark:text-[#0b1120]">
            <Icon className="size-4" />
          </span>
          <h2 id={id} className="min-w-0 flex-1 truncate text-base font-semibold">
            {title}
          </h2>
          {action && (
            <Link href={action.href} className="inline-flex min-h-6 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
              {action.label} <ArrowRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
            </Link>
          )}
        </header>
        <div className="flex-1 p-4">{children}</div>
      </section>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Overdue follow-ups first, then today's: the queue to work through. */
function FollowUpQueue({ scope, team, className }: { scope: 'mine' | 'team' | 'all'; team?: boolean; className?: string }) {
  const t = useT();
  const overdue = useFollowUps({ scope, bucket: 'overdue' });
  const today = useFollowUps({ scope, bucket: 'today' });
  const rows = [...(overdue.data ?? []), ...(today.data ?? [])].slice(0, 6);
  const total = (overdue.data?.length ?? 0) + (today.data?.length ?? 0);
  return (
    <Panel
      title={team ? t('Team follow-up queue') : t('Follow-up queue')}
      icon={BellRing}
      color="#d97706"
      action={{ href: `/app/follow-ups?bucket=${overdue.data?.length ? 'overdue' : 'today'}&scope=${scope}`, label: t('See all ({n})', { n: String(total) }) }}
      data="follow-up-queue"
      className={className}
    >
      {overdue.isPending || today.isPending ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Empty>{t('Nothing due today. Well done!')}</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((f) => (
            <li key={f.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0" data-queue-item={f.title}>
              <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', f.due === 'OVERDUE' ? 'bg-critical' : 'bg-warning')} />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{f.title}</p>
                <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <span className={f.due === 'OVERDUE' ? 'font-semibold text-critical' : undefined}>{f.due === 'OVERDUE' ? t('Overdue since {date}', { date: formatDate(f.dueAt) }) : t('Due today')}</span>
                  {f.company && (
                    <Link href={`/app/companies/${f.company.id}`} className="text-primary hover:underline">
                      {f.company.name}
                    </Link>
                  )}
                  {team && f.assignee && <span>{f.assignee.name}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Companies per journey stage, each opening the Pipeline board; as a funnel for the organisation. */
function PipelineStrip({ mine, funnel }: { mine: boolean; funnel?: boolean }) {
  const t = useT();
  const board = useJourneyBoard({ mine, perStage: 1 });
  const cols = board.data?.columns ?? [];
  const max = Math.max(1, ...cols.map((c) => c.total));
  return (
    <Panel title={funnel ? t('Pipeline funnel') : t('My pipeline')} icon={Target} color="#2563eb" action={{ href: mine ? '/app/pipelines?mine=true' : '/app/pipelines', label: t('Open Pipeline') }} data="pipeline">
      {board.isPending ? (
        <Skeleton className="h-24" />
      ) : funnel ? (
        <ul className="space-y-1.5">
          {cols.map((c) => (
            <li key={c.stage.key} style={stageStyle(c.stage.color)} data-funnel-stage={c.stage.key}>
              <Link href="/app/pipelines" className="group flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="w-36 shrink-0 truncate text-sm" title={t.maybe(c.stage.name)}>
                  {t.maybe(c.stage.name)}
                </span>
                <span className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted">
                  <span aria-hidden className="absolute inset-y-0 start-0 rounded-md bg-[var(--st-dot)] transition-all dark:bg-[var(--st-dot-d)]" style={{ width: `${Math.max(c.total ? 4 : 0, (c.total / max) * 100)}%` }} />
                </span>
                <span className="w-10 shrink-0 text-end text-sm font-semibold tabular-nums">{c.total}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex snap-x gap-2 overflow-x-auto pb-1">
          {cols.map((c) => (
            <li key={c.stage.key} className="snap-start" style={stageStyle(c.stage.color)} data-strip-stage={c.stage.key}>
              <Link href={mine ? '/app/pipelines?mine=true' : '/app/pipelines'} className={cn('flex min-w-28 flex-col rounded-xl px-3 py-2 transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', STAGE_CHIP)}>
                <span className="text-2xl font-extrabold tabular-nums">{c.total}</span>
                <span className="text-xs font-medium">{t.maybe(c.stage.name)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Running targets of one workspace for a period, added up per metric. */
function targetsFor(rows: TargetRow[] | undefined, pick: (t: TargetRow) => boolean): { metric: TargetMetric; amount: number; achieved: number; percent: number; currency: string | null }[] {
  const now = Date.now();
  const running = (rows ?? []).filter((t) => pick(t) && new Date(`${t.startsOn}T00:00:00Z`).getTime() <= now && now < new Date(`${t.endsOn}T00:00:00Z`).getTime() + 86_400_000);
  const out: { metric: TargetMetric; amount: number; achieved: number; percent: number; currency: string | null }[] = [];
  // Revenue first, then the other metrics in their usual order.
  for (const metric of ['REVENUE', ...TARGET_METRICS.filter((m) => m !== 'REVENUE')] as TargetMetric[]) {
    const list = running.filter((t) => t.metric === metric);
    if (!list.length) continue;
    const amount = list.reduce((a, t) => a + t.amount, 0);
    const achieved = list.reduce((a, t) => a + t.achieved, 0);
    out.push({ metric, amount, achieved, percent: amount > 0 ? Math.round((achieved / amount) * 1000) / 10 : 0, currency: list[0]!.currency });
  }
  return out;
}

function Ring({ percent, color, size = 112, children, label }: { percent: number; color: string; size?: number; children: React.ReactNode; label: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" className="stroke-muted" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="10" strokeLinecap="round" stroke={color} strokeDasharray={`${(p / 100) * c} ${c}`} className="transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

/** Target rings, one per period, for the metric that matters most (revenue first). */
function TargetRings({ sets, currency }: { sets: { title: string; rows: ReturnType<typeof targetsFor>; data: string }[]; currency: string }) {
  const t = useT();
  return (
    <Panel title={t('Targets')} icon={Trophy} color="#16a34a" action={{ href: '/app/targets', label: t('Open targets') }} data="targets">
      <div className="flex flex-wrap justify-around gap-4">
        {sets.map((s) => {
          const main = s.rows[0];
          const value = main ? (main.metric === 'REVENUE' ? money(main.achieved, main.currency ?? currency) : count(main.achieved)) : '';
          const of = main ? (main.metric === 'REVENUE' ? money(main.amount, main.currency ?? currency) : count(main.amount)) : '';
          const tone = !main ? '#94a3b8' : main.percent >= 100 ? '#16a34a' : main.percent >= 50 ? '#2563eb' : '#d97706';
          return (
            <div key={s.title} className="flex flex-col items-center gap-2 text-center" data-target-ring={s.data}>
              <Ring percent={main?.percent ?? 0} color={tone} label={main ? t('{title}: {value} of {target}', { title: s.title, value, target: of }) : t('{title}: no target set', { title: s.title })}>
                <span className="text-2xl font-extrabold tabular-nums">{main ? `${Math.round(main.percent)}%` : '—'}</span>
              </Ring>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="text-xs text-muted-foreground">{main ? `${t.maybe(TARGET_METRIC_LABEL[main.metric])}: ${value} / ${of}` : t('No target set')}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function CompanyCards({ rows, empty }: { rows: DashboardCompanyRef[]; empty: string }) {
  const t = useT();
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((c) => (
        <li key={c.id}>
          <Link href={`/app/companies/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-2.5 transition hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-company-card={c.name}>
            {c.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.logoUrl} alt="" className="size-9 shrink-0 rounded-lg border border-border bg-white object-contain" />
            ) : (
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 text-xs font-bold">
                {c.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" title={c.name}>
                {c.name}
              </span>
              <span className="block text-xs text-muted-foreground">{formatDate(c.at)}</span>
            </span>
            <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
            <span className="sr-only">{t('Open company')}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DealRows({ rows }: { rows: DashboardDealRef[] }) {
  const t = useT();
  if (!rows.length) return <Empty>{t('No open deals yet.')}</Empty>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0" data-deal={d.name}>
          <span className="min-w-0 flex-1">
            <Link href={`/app/deals?deal=${d.id}`} className="block truncate text-sm font-medium text-primary hover:underline">
              {d.name}
            </Link>
            {d.company && <span className="block truncate text-xs text-muted-foreground">{d.company.name}</span>}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">{money(d.amount, d.currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Ranked by share of target where targets exist, then revenue, then leads (as the level dashboards rank). */
function rank(a: WorkspacePerformance, b: WorkspacePerformance): number {
  return (b.targetPercent ?? -1) - (a.targetPercent ?? -1) || b.revenue - a.revenue || b.leads - a.leads || b.calls - a.calls;
}

const MEDAL = ['#ca8a04', '#64748b', '#b45309'];

function Ranking({ rows, currency, title, data }: { rows: WorkspacePerformance[]; currency: string; title: string; data: string }) {
  const t = useT();
  const ranked = [...rows].sort(rank);
  const top = Math.max(1, ...ranked.map((r) => r.targetPercent ?? r.leads));
  return (
    <Panel title={title} icon={Trophy} color="#ca8a04" data={data}>
      {!ranked.length ? (
        <Empty>{t('Nobody here yet.')}</Empty>
      ) : (
        <ol className="space-y-2.5">
          {ranked.map((r, i) => {
            const score = r.targetPercent ?? r.leads;
            return (
              <li key={r.workspace.id} className="flex items-center gap-3" data-rank={r.workspace.name}>
                <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: MEDAL[i] ?? '#94a3b8' }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{r.workspace.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {r.targetPercent !== null ? `${Math.round(r.targetPercent)}% · ` : ''}
                      {t('{n} companies', { n: count(r.leads) })} · {money(r.revenue, currency)}
                    </span>
                  </span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[#d97706] to-[#16a34a]" style={{ width: `${Math.max(score ? 4 : 0, (score / top) * 100)}%` }} />
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

function Workload({ rows, title }: { rows: WorkspaceWorkload[]; title: string }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.work.openTasks + r.work.pendingFollowUps));
  return (
    <Panel title={title} icon={Briefcase} color="#7c3aed" action={{ href: '/app/follow-ups?bucket=overdue&scope=team', label: t('Overdue work') }} data="workload">
      {!rows.length ? (
        <Empty>{t('Nobody here yet.')}</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const open = r.work.openTasks + r.work.pendingFollowUps;
            const late = r.work.overdueTasks + r.work.overdueFollowUps;
            return (
              <li key={r.workspace.id} data-workload={r.workspace.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-semibold">{r.workspace.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t('{open} open · {late} overdue', { open: count(open), late: count(late) })}
                  </span>
                </div>
                <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="h-full bg-critical" style={{ width: `${(late / max) * 100}%` }} />
                  <span className="h-full bg-[#7c3aed]" style={{ width: `${((open - late) / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ───────────── Executive: What do I need to do today? ─────────────

function ExecutiveToday({ d }: { d: ExecutiveDay }) {
  const t = useT();
  const { data: session } = useSession();
  const targets = useTargets();
  const myId = session?.workspace?.id;
  const mine = (p: TargetRow['period']) => targetsFor(targets.data?.targets, (x) => x.workspace.id === myId && x.period === p);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('Today’s work')} role="group">
        <Tile icon={CalendarCheck} label={t('Follow-ups due')} value={count(d.work.pendingFollowUps)} detail={d.work.overdueFollowUps ? t('{count} overdue', { count: d.work.overdueFollowUps }) : null} href={`/app/follow-ups?bucket=${d.work.overdueFollowUps ? 'overdue' : 'today'}&scope=mine`} color="#d97706" alert={d.work.overdueFollowUps > 0} data="follow-ups" />
        <Tile icon={ListChecks} label={t('Tasks to do')} value={count(d.tasks.open)} detail={d.tasks.overdue ? t('{count} overdue', { count: d.tasks.overdue }) : null} href="/app/tasks" color="#7c3aed" alert={d.tasks.overdue > 0} data="tasks" />
        <Tile icon={UserPlus} label={t('Companies today')} value={d.today.leadTarget !== null ? `${count(d.today.leads)} / ${count(d.today.leadTarget)}` : count(d.today.leads)} detail={d.today.remaining !== null ? t('{n} still to go', { n: count(d.today.remaining) }) : null} href="/app/companies" color="#4f46e5" data="leads" />
        <Tile icon={PhoneCall} label={t('Calls today')} value={d.today.callTarget !== null ? `${count(d.today.calls)} / ${count(d.today.callTarget)}` : count(d.today.calls)} detail={money(d.today.revenue, d.currency)} href="/app/activities" color="#0891b2" data="calls" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <FollowUpQueue scope="mine" className="lg:col-span-3" />
        <div className="lg:col-span-2">
          <TargetRings
            currency={d.currency}
            sets={[
              { title: t('Today'), rows: mine('DAILY'), data: 'DAILY' },
              { title: t('This month'), rows: mine('MONTHLY'), data: 'MONTHLY' },
            ]}
          />
        </div>
      </div>
      <PipelineStrip mine />
      <Panel title={t('Continue where you left off')} icon={History} color="#e11d48" data="continue">
        <CompanyCards rows={d.recent} empty={t('The companies you work on will show here.')} />
      </Panel>
    </>
  );
}

// ───────────── Manager: How is my team doing? ─────────────

function ManagerTeam({ d }: { d: ManagerDashboardView }) {
  const t = useT();
  const targets = useTargets();
  const team = (p: TargetRow['period']) => targetsFor(targets.data?.targets, (x) => x.workspace.id === d.team.id && x.period === p);
  const e = d.extras;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label={t('Team results')}>
        <Tile icon={UserPlus} label={t('Companies created')} value={count(d.totals.leads)} detail={t('Calls: {n}', { n: count(d.totals.calls) })} href="/app/companies" color="#4f46e5" data="leads" />
        <Tile icon={CircleDollarSign} label={t('Sales achieved')} value={money(d.totals.revenue, d.currency)} detail={t('Deals won: {n}', { n: count(d.totals.dealsWon) })} href="/app/revenue" color="#16a34a" data="revenue" />
        <Tile icon={ListTodo} label={t('Tasks pending')} value={count(e.tasks.open)} detail={t('{n} done this period', { n: count(e.tasks.doneInPeriod) })} href="/app/tasks" color="#7c3aed" alert={e.tasks.overdue > 0} data="tasks" />
        <Tile icon={AlarmClock} label={t('Overdue follow-ups')} value={count(d.work.overdueFollowUps)} detail={t('{n} pending', { n: count(d.work.pendingFollowUps) })} href="/app/follow-ups?bucket=overdue&scope=team" color="#d97706" alert={d.work.overdueFollowUps > 0} data="overdue" />
      </div>
      <Panel title={t('Team status')} icon={Users} color="#0d9488" action={{ href: '/app/team-status', label: t('Open team status') }} data="team-status">
        <TeamStatusBoard compact />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-5">
        <FollowUpQueue scope="team" team className="lg:col-span-3" />
        <div className="lg:col-span-2">
          <TargetRings
            currency={d.currency}
            sets={[
              { title: t('This month'), rows: team('MONTHLY'), data: 'MONTHLY' },
              { title: t('This quarter'), rows: team('QUARTERLY'), data: 'QUARTERLY' },
            ]}
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Ranking rows={d.executives} currency={d.currency} title={t('Executive ranking')} data="ranking" />
        <Workload rows={e.workload} title={t('Work load by executive')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('New companies ({n})', { n: count(e.newCompanies.count) })} icon={Sparkles} color="#4f46e5" action={{ href: '/app/companies', label: t('Open companies') }} data="new-companies">
          <CompanyCards rows={e.newCompanies.latest} empty={t('No new companies in this period.')} />
        </Panel>
        <Panel title={t('Active deals ({n})', { n: count(e.activeDeals.count) })} icon={Handshake} color="#16a34a" action={{ href: '/app/deals?view=list', label: money(e.activeDeals.value, d.currency) }} data="active-deals">
          <DealRows rows={e.activeDeals.top} />
        </Panel>
      </div>
    </>
  );
}

// ───────────── Super: What is happening across the organisation? ─────────────

function SuperOrganisation({ d }: { d: SuperDashboard }) {
  const t = useT();
  const targets = useTargets();
  const org = (p: TargetRow['period']) => targetsFor(targets.data?.targets, (x) => x.source === 'SUPER' && !x.parentTargetId && x.period === p);
  const e = d.extras;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" role="group" aria-label={t('Organisation results')}>
        <Tile icon={UserPlus} label={t('Companies created')} value={count(d.totals.leads)} href="/app/companies" color="#4f46e5" data="leads" />
        <Tile icon={PhoneCall} label={t('Calls')} value={count(d.totals.calls)} href="/app/activities" color="#0891b2" data="calls" />
        <Tile icon={Trophy} label={t('Deals won')} value={count(d.totals.dealsWon)} href="/app/deals?view=list" color="#ca8a04" data="won" />
        <Tile icon={CircleDollarSign} label={t('Sales achieved')} value={money(d.totals.revenue, d.currency)} href="/app/revenue" color="#16a34a" data="revenue" />
        <Tile icon={Handshake} label={t('Active deals')} value={count(e.activeDeals.count)} detail={money(e.activeDeals.value, d.currency)} href="/app/deals?view=list" color="#7c3aed" data="deals" />
        <Tile icon={Sparkles} label={t('New companies')} value={count(e.newCompanies.count)} href="/app/companies" color="#be123c" data="new" />
      </div>
      <TeamStatusByManager d={d} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PipelineStrip mine={false} funnel />
        <TargetsByWorkspace d={d} rings={[{ title: t('This month'), rows: org('MONTHLY'), data: 'MONTHLY' }, { title: t('This quarter'), rows: org('QUARTERLY'), data: 'QUARTERLY' }]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Productivity d={d} />
        <Workload rows={e.workload} title={t('Work load by team')} />
      </div>
    </>
  );
}

/** Who is working, on break or away, team by team. */
function TeamStatusByManager({ d }: { d: SuperDashboard }) {
  const t = useT();
  const team = useAvailabilityTeam();
  const managerOf = new Map<string, { id: string; name: string }>();
  for (const m of d.managers) managerOf.set(m.workspace.id, m.workspace);
  for (const x of d.executives) if (x.manager) managerOf.set(x.workspace.id, x.manager);
  const groups = new Map<string, { name: string; people: AvailabilityPerson[] }>();
  for (const p of team.data?.people ?? []) {
    const m = p.workspace ? managerOf.get(p.workspace.id) : undefined;
    const key = m?.id ?? 'super';
    if (!groups.has(key)) groups.set(key, { name: m?.name ?? t('Super Workspace'), people: [] });
    groups.get(key)!.people.push(p);
  }
  const list = [...groups.entries()].sort(([a, x], [b, y]) => (a === 'super' ? -1 : b === 'super' ? 1 : x.name.localeCompare(y.name)));
  return (
    <Panel title={t('Team status by manager')} icon={Users} color="#0d9488" action={{ href: '/app/team-status', label: t('Open team status') }} data="status-by-manager">
      {team.isPending ? (
        <Skeleton className="h-24" />
      ) : !list.length ? (
        <Empty>{t('Nobody to show yet.')}</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map(([key, g]) => {
            const counts = new Map<AvailabilityStatus, number>();
            for (const p of g.people) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
            const on = g.people.filter((p) => p.status !== 'CHECKED_OUT').length;
            return (
              <li key={key} className="rounded-xl border border-border bg-background/60 p-3" data-status-team={g.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{g.name}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">{t('{on} of {all} checked in', { on: String(on), all: String(g.people.length) })}</p>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {AVAILABILITY_STATUSES.filter((s) => counts.get(s)).map((s) => (
                    <li key={s} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs">
                      <StatusDot status={s} />
                      {t(AVAILABILITY_LABEL[s] as MessageKey)} <span className="font-semibold tabular-nums">{counts.get(s)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function TargetsByWorkspace({ d, rings }: { d: SuperDashboard; rings: { title: string; rows: ReturnType<typeof targetsFor>; data: string }[] }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <TargetRings currency={d.currency} sets={rings} />
      <Panel title={t('Targets by workspace')} icon={Target} color="#be123c" action={{ href: '/app/targets', label: t('Open targets') }} data="targets-by-workspace">
        {!d.managers.length ? (
          <Empty>{t('Nobody here yet.')}</Empty>
        ) : (
          <ul className="space-y-2.5">
            {d.managers.map((m) => (
              <li key={m.workspace.id} data-workspace-target={m.workspace.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-semibold">{m.workspace.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{m.targetPercent !== null ? `${Math.round(m.targetPercent)}%` : t('No target set')}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-gradient-to-r from-[#be123c] to-[#7c3aed]" style={{ width: `${Math.min(100, m.targetPercent ?? 0)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Productivity({ d }: { d: SuperDashboard }) {
  const t = useT();
  return (
    <Panel title={t('Productivity by team')} icon={Briefcase} color="#2563eb" data="productivity">
      {!d.managers.length ? (
        <Empty>{t('Nobody here yet.')}</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[28rem] text-sm">
            <caption className="sr-only">{t('Productivity by team')}</caption>
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th scope="col" className="pb-2 text-start font-medium">{t('Team')}</th>
                <th scope="col" className="pb-2 text-end font-medium">{t('People')}</th>
                <th scope="col" className="pb-2 text-end font-medium">{t('Companies')}</th>
                <th scope="col" className="pb-2 text-end font-medium">{t('Calls')}</th>
                <th scope="col" className="pb-2 text-end font-medium">{t('Deals won')}</th>
                <th scope="col" className="pb-2 text-end font-medium">{t('Companies per person')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.managers.map((m) => (
                <tr key={m.workspace.id} data-productivity={m.workspace.name}>
                  <th scope="row" className="py-2 text-start font-semibold">{m.workspace.name}</th>
                  <td className="py-2 text-end tabular-nums">{count(m.people)}</td>
                  <td className="py-2 text-end tabular-nums">{count(m.leads)}</td>
                  <td className="py-2 text-end tabular-nums">{count(m.calls)}</td>
                  <td className="py-2 text-end tabular-nums">{count(m.dealsWon)}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{m.people ? (m.leads / m.people).toFixed(1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
