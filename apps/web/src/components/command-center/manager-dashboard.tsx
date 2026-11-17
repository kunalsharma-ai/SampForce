'use client';

import {
  type CommandCenterContext,
  type CommandCenterLayout,
  FOLLOW_UP_PRIORITIES,
  type ManagerDashboard as ManagerData,
  MONITOR_SECTIONS,
  type MonitorSection,
  type PersonRef,
  TIER_DASHBOARD_WIDGETS,
  type TeamMemberRow,
  type WorkBucket,
  type WorkItem,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Skeleton,
} from '@dealflow/ui';
import { LayoutGrid, MoreHorizontal, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FollowUpDialog, type FollowUpPreset } from '@/components/crm/follow-ups';
import { PersonSelect } from '@/components/crm/lead-fields';
import { Select } from '@/components/crm/select';
import { FOLLOW_UP_TYPE_LABEL, PRIORITY_LABEL } from '@/components/crm/work-labels';
import { InfoTip } from '@/components/info-tip';
import { type DrillTarget, type PeriodChoice, useManagerDashboard, useSaveCommandCenterLayout } from '@/lib/command-center';
import { useChangeOwner } from '@/lib/company-leads';
import { useFollowUpMutations } from '@/lib/company-work';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { usePreferences } from '@/stores/preferences';
import {
  FUNNEL_LABEL,
  METRIC_LABEL,
  MONITOR_LABEL,
  PERFORMANCE_STATUS_LABEL,
  PERFORMANCE_STATUS_TONE,
  PERIOD_LABEL,
  SECTION_LABEL,
} from './cc-labels';
import { axisTick, ChartCard, tooltipStyle } from './chart-card';
import { ConcernsCard, EscalateDialog } from './concerns';
import { Funnel } from './executive-dashboard';
import { InstructionDialog, SentInstructions } from './instructions';
import { ArrangeRow, count, DrillPanel, KpiCards, money, move, pct, PeriodPicker, Progress } from './tier-parts';
import { TransferRequests } from './transfers';

type TeamSection = (typeof TIER_DASHBOARD_WIDGETS.MANAGER)[number];
const TEAM_SECTIONS = TIER_DASHBOARD_WIDGETS.MANAGER;

function orderedSections(layout: CommandCenterLayout | null): { id: TeamSection; hidden: boolean }[] {
  const saved = (layout?.sections ?? []).filter((s): s is { id: TeamSection; hidden: boolean } => (TEAM_SECTIONS as readonly string[]).includes(s.id));
  return [...saved, ...TEAM_SECTIONS.filter((id) => !saved.some((s) => s.id === id)).map((id) => ({ id, hidden: false }))];
}

/**
 * The manager dashboard (ADR 0063, master spec section 12): the manager's team for the period, its numbers, each
 * person's performance and how they compare, the team funnel, the work that needs a manager's eye with the actions to
 * take on it, instructions, client concerns and the revenue each person and manager brought in.
 */
export function ManagerDashboard({ context }: { context: CommandCenterContext }) {
  const t = useT();
  const router = useRouter();
  const [period, setPeriod] = React.useState<PeriodChoice>({ period: 'this_month' });
  const params = useSearchParams();
  // Opened from the senior dashboard (?person=): that manager's team, when the caller can see it.
  const [userId, setUserId] = React.useState(() => {
    const p = params.get('person');
    return p && context.reports.some((r) => r.id === p) ? p : '';
  });
  const [drill, setDrill] = React.useState<DrillTarget | null>(null);
  const [customising, setCustomising] = React.useState(false);
  const [instructing, setInstructing] = React.useState<{ toUserId?: string; company?: { id: string; name: string } | null } | null>(null);
  const q = useManagerDashboard(period, userId || undefined);
  const d = q.data;
  const sections = orderedSections(d?.layout ?? null).filter((s) => !s.hidden);
  const scope = { scope: 'team' as const, userId: userId || undefined };
  const viewingOther = !!userId;
  // People an instruction can go to: everyone in the team the caller manages (never the caller).
  const recipients: PersonRef[] = (d?.team ?? []).map((r) => r.person).filter((p) => context.reports.some((x) => x.id === p.id));
  const openPerson = (id: string) => router.push(`/app?view=executive&person=${id}`);

  const render = (id: TeamSection, data: ManagerData) => {
    switch (id) {
      case 'team.kpis':
        return <KpiCards label={t('Team metrics')} kpis={data.kpis} currency={data.currency} onOpen={(k) => setDrill({ metric: k.key, title: t(METRIC_LABEL[k.key]), ...scope })} />;
      case 'team.table':
        return <EmployeeTable data={data} onOpen={openPerson} onInstruct={data.features.instructions ? (p) => setInstructing({ toUserId: p }) : null} canInstruct={(p) => recipients.some((r) => r.id === p)} />;
      case 'team.compare':
        return <Comparison data={data} />;
      case 'team.pipeline':
        return <Funnel rows={data.funnel} currency={data.currency} showPeople onOpen={(stage) => setDrill({ metric: `stage:${stage}`, title: t(FUNNEL_LABEL[stage]), ...scope })} />;
      case 'team.monitor':
        return (
          <div className="space-y-3">
            <Monitor buckets={data.monitor} features={data.features} recipients={recipients} onInstruct={(toUserId, company) => setInstructing({ toUserId, company })} />
            {data.features.leadTransfers && !viewingOther && <TransferRequests />}
          </div>
        );
      case 'team.instructions':
        return data.features.instructions && !viewingOther ? <SentInstructions onSend={recipients.length ? () => setInstructing({}) : null} /> : null;
      case 'team.concerns':
        return data.features.clientConcerns ? <ConcernsCard box="team" /> : null;
      case 'team.revenue':
        return data.revenue ? <TeamRevenue data={data} onOpen={openPerson} /> : null;
    }
  };

  return (
    <div className="space-y-5" data-testid="manager-dashboard">
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
                    t('{count} reporting employees', { count: count(d.teamSize) }),
                    d.person.reportingManager && t('Reports to {name}', { name: d.person.reportingManager.name }),
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
                <label className="sr-only" htmlFor="cc-team">
                  {t('Whose team')}
                </label>
                <Select id="cc-team" className="w-auto" value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">{t('My team')}</option>
                  {context.reports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <PeriodPicker value={period} onChange={setPeriod} />
            {d?.features.instructions && recipients.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setInstructing({})}>
                <Send aria-hidden /> {t('Send an instruction')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setCustomising(true)} disabled={!d}>
              <LayoutGrid aria-hidden /> {t('Customise')}
            </Button>
          </div>
        </div>
        {d && (
          <div className="mt-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t('This month’s team target')}</span>
              <span className="tabular text-muted-foreground" data-testid="team-target">
                {d.month.target !== null
                  ? t('{achieved} of {target} ({percent})', { achieved: money(d.month.achieved, d.currency), target: money(d.month.target, d.currency), percent: pct(d.month.percent) })
                  : t('{achieved} credited. No target set.', { achieved: money(d.month.achieved, d.currency) })}
              </span>
            </div>
            <Progress value={d.month.percent} label={t('This month’s team target')} />
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
      {instructing && <InstructionDialog people={recipients} toUserId={instructing.toUserId} company={instructing.company} onClose={() => setInstructing(null)} />}
    </div>
  );
}

/** Help for each section; written out so the help test can see every topic in use. */
function SectionTip({ id }: { id: TeamSection }) {
  switch (id) {
    case 'team.kpis':
      return <InfoTip topic="cc.teamKpis" />;
    case 'team.table':
      return <InfoTip topic="cc.teamTable" />;
    case 'team.compare':
      return <InfoTip topic="cc.teamCompare" />;
    case 'team.pipeline':
      return <InfoTip topic="cc.teamPipeline" />;
    case 'team.monitor':
      return <InfoTip topic="cc.teamMonitor" />;
    case 'team.instructions':
      return <InfoTip topic="cc.instructions" />;
    case 'team.concerns':
      return <InfoTip topic="cc.concerns" />;
    case 'team.revenue':
      return <InfoTip topic="cc.teamRevenue" />;
  }
}

// ─── Employee performance table (12.3) ───

function EmployeeTable({
  data,
  onOpen,
  onInstruct,
  canInstruct,
}: {
  data: ManagerData;
  onOpen: (userId: string) => void;
  onInstruct: ((userId: string) => void) | null;
  canInstruct: (userId: string) => boolean;
}) {
  const t = useT();
  const cols: { key: keyof TeamMemberRow; label: MessageKey; money?: boolean }[] = [
    { key: 'leads', label: 'Leads' },
    { key: 'activeCompanies', label: 'Active companies' },
    { key: 'emailsSent', label: 'Emails sent' },
    { key: 'responses', label: 'Responses' },
    { key: 'positiveResponses', label: 'Positive' },
    { key: 'followUpsPending', label: 'Follow-ups pending' },
    { key: 'followUpsOverdue', label: 'Overdue' },
    { key: 'rfqsReceived', label: 'RFQs received' },
    { key: 'rfqsSubmitted', label: 'RFQs submitted' },
    { key: 'rfqsWon', label: 'RFQs won' },
    { key: 'rfqsLost', label: 'RFQs lost' },
    { key: 'clientsConverted', label: 'Clients converted' },
    { key: 'business', label: 'Business generated', money: true },
  ];
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[1100px] text-sm" data-testid="team-table">
        <caption className="sr-only">{t('Performance of each person in the team for {period}', { period: t(PERIOD_LABEL[data.range.period]) })}</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">
              {t('Employee')}
            </th>
            {cols.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-2 text-end font-medium">
                {t(c.label)}
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-end font-medium">
              {t('Target achievement')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('Status')}
            </th>
            {onInstruct && (
              <th scope="col" className="px-2 py-2">
                <span className="sr-only">{t('Actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="tabular">
          {data.team.map((r) => (
            <tr key={r.person.id} className="border-b border-border last:border-0" data-person={r.person.id}>
              <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">
                <button type="button" className="rounded text-start hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(r.person.id)} aria-label={t('Open the dashboard of {name}', { name: r.person.name })}>
                  {r.person.name}
                </button>
                {r.person.designation && <span className="block text-xs font-normal text-muted-foreground">{t.maybe(r.person.designation)}</span>}
              </th>
              {cols.map((c) => (
                <td key={c.key} className={cn('px-2 py-2 text-end', c.key === 'followUpsOverdue' && (r[c.key] as number) > 0 && 'font-semibold text-critical')}>
                  {c.money ? money(r[c.key] as number, data.currency) : count(r[c.key] as number)}
                </td>
              ))}
              <td className="px-2 py-2 text-end">{r.target !== null ? pct(r.achievement) : '—'}</td>
              <td className="px-3 py-2">
                <Badge tone={PERFORMANCE_STATUS_TONE[r.status]}>{t(PERFORMANCE_STATUS_LABEL[r.status])}</Badge>
              </td>
              {onInstruct && (
                <td className="px-2 py-2 text-end">
                  {canInstruct(r.person.id) && (
                    <Button size="sm" variant="ghost" onClick={() => onInstruct(r.person.id)} aria-label={t('Send an instruction to {name}', { name: r.person.name })}>
                      <Send aria-hidden />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Comparison charts (12.4) ───

const COMPARE: { key: 'leads' | 'responseRate' | 'rfqsReceived' | 'rfqConversion' | 'followUpCompletion' | 'wonDeals' | 'business' | 'achievement'; label: MessageKey; kind: 'count' | 'pct' | 'money' }[] = [
  { key: 'leads', label: 'Leads generated', kind: 'count' },
  { key: 'responseRate', label: 'Response rate', kind: 'pct' },
  { key: 'rfqsReceived', label: 'RFQs received', kind: 'count' },
  { key: 'rfqConversion', label: 'RFQ conversion rate', kind: 'pct' },
  { key: 'followUpCompletion', label: 'Follow-up completion', kind: 'pct' },
  { key: 'wonDeals', label: 'Won deals', kind: 'count' },
  { key: 'business', label: 'Revenue contribution', kind: 'money' },
  { key: 'achievement', label: 'Target achievement', kind: 'pct' },
];

function Comparison({ data }: { data: ManagerData }) {
  const t = useT();
  const animate = usePreferences((s) => s.appearance.motion !== 'off' && s.appearance.motion !== 'minimal');
  const [metric, setMetric] = React.useState<(typeof COMPARE)[number]['key']>('leads');
  const spec = COMPARE.find((c) => c.key === metric)!;
  const fmt = (v: number | null) => (spec.kind === 'money' ? money(v, data.currency) : spec.kind === 'pct' ? pct(v) : count(v));
  const rows = data.team.map((r) => ({ name: r.person.name, value: (r[metric] as number | null) ?? 0, raw: r[metric] as number | null }));
  const best = [...rows].sort((a, b) => b.value - a.value)[0];
  const label = t(spec.label);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="cc-compare" className="text-sm text-muted-foreground">
          {t('Compare by')}
        </label>
        <Select id="cc-compare" className="w-auto" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          {COMPARE.map((c) => (
            <option key={c.key} value={c.key}>
              {t(c.label)}
            </option>
          ))}
        </Select>
      </div>
      <ChartCard
        title={label}
        description={t('Each person in the team, for {period}.', { period: t(PERIOD_LABEL[data.range.period]) })}
        summary={best ? t('Bar chart for {people} people; {name} leads with {value}.', { people: rows.length, name: best.name, value: fmt(best.raw) }) : label}
        filename={`team-${metric}.csv`}
        empty={rows.length === 0 ? t('No one in the team yet.') : null}
        table={{
          caption: label,
          header: [t('Employee'), label],
          rows: rows.map((r) => [r.name, r.raw]),
          display: rows.map((r) => [r.name, fmt(r.raw)]),
          numeric: [1],
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={false} interval={0} />
            <YAxis tickFormatter={(v: number) => fmt(v)} tick={axisTick} tickLine={false} axisLine={false} width={72} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [fmt(v), label]} />
            <Bar dataKey="value" name={label} fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ─── Follow-up monitoring (12.6) ───

function Monitor({
  buckets,
  features,
  recipients,
  onInstruct,
}: {
  buckets: WorkBucket[];
  features: ManagerData['features'];
  recipients: PersonRef[];
  onInstruct: (toUserId: string, company: { id: string; name: string } | null) => void;
}) {
  const t = useT();
  const [reassigning, setReassigning] = React.useState<WorkItem | null>(null);
  const [assigning, setAssigning] = React.useState<WorkItem | null>(null);
  const [escalating, setEscalating] = React.useState<WorkItem | null>(null);
  const [followUp, setFollowUp] = React.useState<FollowUpPreset | null>(null);
  if (!buckets.length) return <Card className="p-5 text-sm text-muted-foreground">{t('Every monitoring section is hidden. Choose Customise to show some again.')}</Card>;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {buckets.map((b) => (
          <Card key={b.id} data-monitor={b.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">{t(MONITOR_LABEL[b.id as MonitorSection] ?? 'Unassigned leads')}</CardTitle>
              <Badge tone={b.total ? (b.id === 'teamOverdue' || b.id === 'intervention' ? 'critical' : 'primary') : 'neutral'} aria-label={t('{count} items', { count: count(b.total) })}>
                {count(b.total)}
              </Badge>
            </CardHeader>
            <CardContent>
              {!b.items.length ? (
                <p className="text-sm text-muted-foreground">{t('Nothing here.')}</p>
              ) : (
                <ul className="space-y-1">
                  {b.items.map((i) => {
                    const company = i.companyId ? { id: i.companyId, name: i.kind === 'company' ? i.title : '' } : null;
                    const actions: { label: string; run: () => void }[] = [];
                    if (i.kind === 'followUp') actions.push({ label: t('Reassign or change priority'), run: () => setReassigning(i) });
                    if (i.kind === 'company') actions.push({ label: t('Assign the lead'), run: () => setAssigning(i) });
                    if (i.kind === 'concern' && features.clientConcerns) actions.push({ label: t('Escalate'), run: () => setEscalating(i) });
                    if (i.companyId && i.kind !== 'followUp') actions.push({ label: t('Add follow-up'), run: () => setFollowUp({ companyId: i.companyId!, companyName: i.title, ownerId: i.assignee?.id ?? null }) });
                    if (features.instructions && i.assignee && recipients.some((r) => r.id === i.assignee!.id)) actions.push({ label: t('Send an instruction'), run: () => onInstruct(i.assignee!.id, company) });
                    return (
                      <li key={`${i.kind}-${i.id}`} className="flex items-start gap-1">
                        <Link href={i.href} className="min-w-0 flex-1 rounded px-1 py-1 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="line-clamp-1 font-medium">{i.title}</span>
                          <span className={cn('text-xs', i.overdue ? 'text-critical' : 'text-muted-foreground')}>
                            {[
                              i.assignee?.name ?? (i.kind === 'company' ? t('No owner') : null),
                              i.subtitle && (i.subtitle in FOLLOW_UP_TYPE_LABEL ? t(FOLLOW_UP_TYPE_LABEL[i.subtitle as keyof typeof FOLLOW_UP_TYPE_LABEL]) : t.maybe(i.subtitle)),
                              i.at && relativeTime(i.at),
                              i.kind === 'transfer' && i.from && t('from {name}', { name: i.from.name }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </Link>
                        {actions.length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="mt-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('Actions for {name}', { name: i.title })}>
                                <MoreHorizontal className="size-4" aria-hidden />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {actions.map((a) => (
                                <DropdownMenuItem key={a.label} onSelect={a.run}>
                                  {a.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {b.total > b.items.length && <p className="mt-2 text-xs text-muted-foreground">{t('and {count} more', { count: count(b.total - b.items.length) })}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      {reassigning && <ReassignDialog item={reassigning} onClose={() => setReassigning(null)} />}
      {assigning && <AssignLeadDialog item={assigning} onClose={() => setAssigning(null)} />}
      {escalating && <EscalateDialog row={{ id: escalating.id, title: escalating.title }} onClose={() => setEscalating(null)} />}
      {followUp && <FollowUpDialog preset={followUp} open onOpenChange={(o) => !o && setFollowUp(null)} />}
    </>
  );
}

function ReassignDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const t = useT();
  const { update } = useFollowUpMutations();
  const [assigneeId, setAssigneeId] = React.useState(item.assignee?.id ?? '');
  const [priority, setPriority] = React.useState<(typeof FOLLOW_UP_PRIORITIES)[number]>((item.priority as (typeof FOLLOW_UP_PRIORITIES)[number]) ?? 'NORMAL');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: item.id, input: { priority, ...(assigneeId && assigneeId !== item.assignee?.id ? { assigneeId } : {}) } });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Reassign or change priority')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{item.title}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="ra-assignee" label={t('Assigned to')}>
            <PersonSelect value={assigneeId} onChange={setAssigneeId} />
          </Field>
          <Field id="ra-priority" label={t('Priority')} error={error ?? undefined}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              {FOLLOW_UP_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('Saving…') : t('Save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignLeadDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const t = useT();
  const change = useChangeOwner(item.id);
  const [ownerId, setOwnerId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerId) return setError(t('Choose the new owner.'));
    try {
      await change.mutateAsync({ ownerId, reason: 'REASSIGNED', note: null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Assign the lead')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{item.title}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="al-owner" label={t('Lead owner')} error={error ?? undefined}>
            <PersonSelect value={ownerId} onChange={setOwnerId} assignableOnly />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? t('Saving…') : t('Assign')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Business generation and revenue (12.7) ───

function TeamRevenue({ data, onOpen }: { data: ManagerData; onOpen: (userId: string) => void }) {
  const t = useT();
  const r = data.revenue!;
  const head = (
    <tr className="border-b border-border">
      <th scope="col" className="px-4 py-2 text-start font-medium">
        {t('Employee')}
      </th>
      <th scope="col" className="px-4 py-2 text-end font-medium">
        {t('This month')}
      </th>
      <th scope="col" className="px-4 py-2 text-end font-medium">
        {t('This quarter')}
      </th>
      <th scope="col" className="px-4 py-2 text-end font-medium">
        {t('This year')}
      </th>
    </tr>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="team-revenue">
          <caption className="px-4 pt-3 text-start text-sm font-semibold">{t('Employee-wise revenue')}</caption>
          <thead className="text-xs text-muted-foreground">{head}</thead>
          <tbody className="tabular">
            {r.people.map((p) => (
              <tr key={p.person.id} className="border-b border-border">
                <th scope="row" className="px-4 py-2 text-start font-medium">
                  <button type="button" className="rounded hover:underline" onClick={() => onOpen(p.person.id)}>
                    {p.person.name}
                  </button>
                </th>
                <td className="px-4 py-2 text-end">{money(p.month, data.currency)}</td>
                <td className="px-4 py-2 text-end">{money(p.quarter, data.currency)}</td>
                <td className="px-4 py-2 text-end">{money(p.year, data.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular font-semibold">
            <tr>
              <th scope="row" className="px-4 py-2 text-start">
                {t('Team total')}
              </th>
              <td className="px-4 py-2 text-end">{money(r.team.month, data.currency)}</td>
              <td className="px-4 py-2 text-end">{money(r.team.quarter, data.currency)}</td>
              <td className="px-4 py-2 text-end">{money(r.team.year, data.currency)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="px-4 pb-3 text-xs text-muted-foreground">{t('Each person’s credited share. The team total counts every deal once.')}</p>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="manager-revenue">
          <caption className="px-4 pt-3 text-start text-sm font-semibold">{t('Manager-wise revenue')}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {t('Manager')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Team size')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('This month')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('This quarter')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('This year')}
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {r.managers.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-muted-foreground">
                  {t('No managers in this team.')}
                </td>
              </tr>
            ) : (
              r.managers.map((m) => (
                <tr key={m.person.id} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2 text-start font-medium">
                    {m.person.name}
                  </th>
                  <td className="px-4 py-2 text-end">{count(m.teamSize)}</td>
                  <td className="px-4 py-2 text-end">{money(m.month, data.currency)}</td>
                  <td className="px-4 py-2 text-end">{money(m.quarter, data.currency)}</td>
                  <td className="px-4 py-2 text-end">{money(m.year, data.currency)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {r.unconverted.length > 0 && (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            {t('Left out for want of an exchange rate: {list}', { list: r.unconverted.map((u) => money(u.amount, u.currency)).join(', ') })}
          </p>
        )}
      </Card>
    </div>
  );
}

// ─── Customise ───

function CustomiseDialog({ layout, onClose }: { layout: CommandCenterLayout | null; onClose: () => void }) {
  const t = useT();
  const save = useSaveCommandCenterLayout('MANAGER');
  const [sections, setSections] = React.useState(() => orderedSections(layout));
  const [monitor, setMonitor] = React.useState(() => {
    const saved = (layout?.workSections ?? []).filter((w) => (MONITOR_SECTIONS as readonly string[]).includes(w.id));
    return [...saved, ...MONITOR_SECTIONS.filter((id) => !saved.some((w) => w.id === id)).map((id) => ({ id, hidden: false }))];
  });
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
        <h3 className="mb-2 text-sm font-semibold">{t('Follow-up monitoring')}</h3>
        <ul className="mb-5 space-y-1.5">
          {monitor.map((w, i) => (
            <ArrangeRow key={w.id} label={t(MONITOR_LABEL[w.id as MonitorSection])} hidden={w.hidden} first={i === 0} last={i === monitor.length - 1} onMove={(dir) => setMonitor(move(monitor, i, dir))} onToggle={() => setMonitor(monitor.map((x) => (x.id === w.id ? { ...x, hidden: !x.hidden } : x)))} />
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
            <Button type="button" onClick={() => submit({ sections, workSections: monitor, categories: [] })} disabled={save.isPending}>
              {save.isPending ? t('Saving…') : t('Save layout')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
