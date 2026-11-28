'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  METRIC_RULE,
  TARGET_METRIC_LABEL,
  TASK_CADENCE_LABEL,
  TASK_CADENCES,
  TASK_MEASURES,
  TASK_PLAN_DURATION_LABEL,
  TASK_PLAN_DURATIONS,
  TASK_PLAN_STATUS_LABEL,
  TASK_STATUS_LABEL,
  WEEKDAY_SHORT,
  WEEKDAYS,
  type TaskCadence,
  type TaskInstanceRow,
  type TaskMeasure,
  type TaskPlanDetail,
  type TaskPlanDuration,
  type TaskPlanRow,
  type TaskPlansView,
  type TaskRequirement,
  type TaskStatus,
  planLastDay,
} from '@dealflow/types';
import { CalendarRange, CheckCircle2, Flame, History, Info, Pause, Pencil, Play, Plus, Repeat, Timer, Trash2, Users, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { type MessageKey, useT } from '@/lib/i18n';
import { useTaskPlan, useTaskPlanMutations, useTaskPlans } from '@/lib/task-plans';
import { Bar, MilestoneChip, MILESTONE_COLORS, milestoneOf, readable, Ring } from './progress-ring';

type T = ReturnType<typeof useT>;

/** Colour and tone of each task status chip. */
const STATUS_STYLE: Record<TaskStatus, string> = {
  NOT_STARTED: '#64748b',
  IN_PROGRESS: '#0284c7',
  HALF_COMPLETED: '#7c3aed',
  COMPLETED: '#059669',
  OVERDUE: '#dc2626',
  PARTIALLY_COMPLETED: '#d97706',
  NOT_COMPLETED: '#dc2626',
  CANCELLED: '#64748b',
};

export function StatusChip({ status }: { status: TaskStatus }) {
  const t = useT();
  const c = STATUS_STYLE[status];
  return (
    <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-semibold" style={{ color: readable(c), backgroundColor: `color-mix(in srgb, ${c} 13%, transparent)` }} data-status={status}>
      {t.maybe(TASK_STATUS_LABEL[status])}
    </span>
  );
}

const measure = (t: T, m: string) => t.maybe(TARGET_METRIC_LABEL[m as TaskMeasure] ?? m);
const fmtDay = (t: T, d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(t.formatLocale, { dateStyle: 'medium', timeZone: 'UTC' });

/** Time left until the instance's period ends, ticking every minute. */
function useTimeLeft(endsAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(h);
  }, []);
  return Math.max(0, new Date(endsAt).getTime() - now);
}

function TimeLeft({ endsAt }: { endsAt: string }) {
  const t = useT();
  const ms = useTimeLeft(endsAt);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const d = Math.floor(h / 24);
  const text = d >= 1 ? t('{d} d {h} h left', { d, h: h % 24 }) : t('{h} h {m} min left', { h, m });
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground" data-time-left>
      <Timer className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}

/** One running task: a ring per requirement, what is left, the time left and the streak. */
export function InstanceCard({ row, mine = true }: { row: TaskInstanceRow; mine?: boolean }) {
  const t = useT();
  const done = row.status === 'COMPLETED';
  const [c1, c2] = MILESTONE_COLORS[milestoneOf(row.percent)];
  return (
    <li
      className={`relative overflow-hidden rounded-2xl border border-border bg-[hsl(var(--surface))] p-4 shadow-sm ${done ? 'sf-task-done' : ''}`}
      data-instance={row.title}
      data-instance-status={row.status}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})` }} />
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="min-w-0 break-words">{row.title}</span>
            <StatusChip status={row.status} />
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {!mine && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden />
                {row.person.name}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <CalendarRange className="size-3.5" aria-hidden />
              {row.cadence === 'DAY' ? t('Today') : row.cadence === 'WEEK' ? t('This week') : t('This month')}
              {row.startsOn !== row.endsOn && ` · ${fmtDay(t, row.startsOn)} – ${fmtDay(t, row.endsOn)}`}
            </span>
            {!done && <TimeLeft endsAt={row.endsAt} />}
          </p>
        </div>
        {row.streak > 0 && (
          <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-orange-500/10 px-2.5 text-xs font-bold text-orange-700 dark:text-orange-300" data-streak={row.streak}>
            <Flame className="size-4 motion-safe:animate-pulse" aria-hidden />
            {t('{n} in a row', { n: row.streak })}
          </span>
        )}
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {row.requirements.map((r) => (
          <li key={r.metric} className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/40 p-2.5">
            <Ring id={`${row.id}-${r.metric}`} percent={r.percent} size={72} stroke={8} label={measure(t, r.metric)} caption={`${r.done}/${r.amount}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={t.maybe(METRIC_RULE[r.metric])}>{measure(t, r.metric)}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {r.remaining > 0 ? t('{done} done, {left} to go', { done: r.done, left: r.remaining }) : t('{done} done, target reached', { done: r.done })}
              </p>
              <div className="mt-1.5">
                <MilestoneChip percent={r.percent} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {done && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {t('Completed. It leaves your pending list and stays in the history.')}
        </p>
      )}
    </li>
  );
}

/** What the person has to do now: unfinished instances first, then what they completed today. */
export function TodayTasks({ view, compact = false }: { view: TaskPlansView; compact?: boolean }) {
  const t = useT();
  const pending = view.today.filter((r) => r.status !== 'COMPLETED');
  const done = view.today.filter((r) => r.status === 'COMPLETED');
  const total = view.today.length;
  const overall = total ? Math.round(view.today.reduce((a, r) => a + r.percent, 0) / total) : 0;
  return (
    <section className="space-y-3" data-today-tasks>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-gradient-to-br from-sky-500/10 via-violet-500/10 to-emerald-500/10 p-4">
        <Ring id="today-overall" percent={overall} size={compact ? 64 : 84} label={t('Today’s tasks')} caption={t('{done} of {total}', { done: done.length, total })} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{pending.length ? t('Tasks to finish: {n}', { n: pending.length }) : total ? t('Everything done. Great work!') : t('No tasks for now')}</p>
          <p className="text-sm text-muted-foreground">{t('Progress counts by itself from the companies, contacts, emails, calls and deals you add.')}</p>
        </div>
        {view.bestStreak > 1 && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-orange-500/15 px-3 text-sm font-bold text-orange-700 dark:text-orange-300">
            <Flame className="size-4" aria-hidden />
            {t('{n}-day streak', { n: view.bestStreak })}
          </span>
        )}
      </div>
      {pending.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2">
          {pending.map((r) => (
            <InstanceCard key={r.id} row={r} />
          ))}
        </ul>
      )}
      {done.length > 0 && !compact && (
        <details className="group" open={pending.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">{t('Completed ({n})', { n: done.length })}</summary>
          <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {done.map((r) => (
              <InstanceCard key={r.id} row={r} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The team's instances running now, one row per person and task. */
export function TeamToday({ rows }: { rows: TaskInstanceRow[] }) {
  const t = useT();
  if (!rows.length) return null;
  return (
    <Card data-team-today>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" aria-hidden />
          {t('Your team right now')}
        </CardTitle>
        <CardDescription>{t('Counted from each person’s own records.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-center" data-team-row={`${r.person.name} ${r.title}`} data-team-cadence={r.cadence}>
              <div className="min-w-0">
                <p className="truncate font-medium">{r.person.name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.title}</p>
              </div>
              <div className="min-w-0 space-y-1">
                {r.requirements.map((q) => (
                  <div key={q.metric} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0 truncate text-muted-foreground">{measure(t, q.metric)}</span>
                    <Bar percent={q.percent} label={`${r.person.name}: ${measure(t, q.metric)}`} />
                    <span className="w-14 shrink-0 text-end tabular-nums">
                      {q.done}/{q.amount}
                    </span>
                  </div>
                ))}
              </div>
              <StatusChip status={r.status} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function requirementsText(t: T, rs: TaskRequirement[]): string {
  return rs.map((r) => t('{amount} {measure} {per}', { amount: r.amount, measure: measure(t, r.metric).toLowerCase(), per: t.maybe(TASK_CADENCE_LABEL[r.per]).toLowerCase() })).join(' · ');
}

const PLAN_STATUS_COLOR = { ACTIVE: '#059669', PAUSED: '#d97706', CANCELLED: '#64748b', ENDED: '#64748b' } as const;

function PlanCard({ plan, onOpen }: { plan: TaskPlanRow; onOpen: (id: string) => void }) {
  const t = useT();
  const finished = plan.totals.completed + plan.totals.partial + plan.totals.missed;
  const rate = finished ? Math.round((plan.totals.completed / finished) * 100) : 0;
  const c = PLAN_STATUS_COLOR[plan.status];
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(plan.id)}
        className="w-full rounded-2xl border border-border bg-[hsl(var(--surface))] p-4 text-start shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-plan={plan.title}
      >
        <span className="flex flex-wrap items-center gap-2">
          <Repeat className="size-4 text-primary" aria-hidden />
          <span className="min-w-0 break-words font-semibold">{plan.title}</span>
          <span className="inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold" style={{ color: readable(c), backgroundColor: `color-mix(in srgb, ${c} 13%, transparent)` }}>
            {t.maybe(TASK_PLAN_STATUS_LABEL[plan.status])}
          </span>
        </span>
        <span className="mt-1 block text-sm">{requirementsText(t, plan.requirements)}</span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>
            {fmtDay(t, plan.startsOn)} – {fmtDay(t, plan.endsOn)}
          </span>
          <span>{plan.assignees.map((a) => a.name).join(', ')}</span>
          {finished > 0 && <span>{t('{rate}% of finished periods completed', { rate })}</span>}
        </span>
      </button>
    </li>
  );
}

/** The whole Tasks area for recurring tasks: today, the team, and the tasks you set or do. */
export function RecurringTasks({ openPlan, onOpenPlan, tab }: { openPlan: string | null; onOpenPlan: (id: string | null) => void; tab: 'today' | 'plans' }) {
  const t = useT();
  const view = useTaskPlans();
  const [creating, setCreating] = useState(false);
  if (view.isPending) return <Skeleton className="h-64" />;
  if (view.error) return <ErrorText error={view.error} />;
  const data = view.data;
  const canAssignOthers = data.assignable.some((a) => !a.self);
  return (
    <div className="space-y-4">
      {tab === 'today' ? (
        <>
          <TodayTasks view={data} />
          <TeamToday rows={data.teamToday} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{canAssignOthers ? t('Set a task once: SampForce makes each day’s, week’s or month’s task by itself and counts it from real work.') : t('Set yourself a recurring task: SampForce counts it from your real work.')}</p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              {t('New recurring task')}
            </Button>
          </div>
          {data.mine.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t('Tasks for you')}</h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {data.mine.map((p) => (
                  <PlanCard key={p.id} plan={p} onOpen={onOpenPlan} />
                ))}
              </ul>
            </section>
          )}
          {data.team.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{t('Tasks for your team')}</h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {data.team.map((p) => (
                  <PlanCard key={p.id} plan={p} onOpen={onOpenPlan} />
                ))}
              </ul>
            </section>
          )}
          {!data.mine.length && !data.team.length && (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">{t('No recurring tasks yet.')}</CardContent>
            </Card>
          )}
        </>
      )}
      {creating && <PlanDialog view={data} onClose={() => setCreating(false)} onSaved={(id) => onOpenPlan(id)} />}
      {openPlan && <PlanDetailDialog id={openPlan} view={data} onClose={() => onOpenPlan(null)} />}
    </div>
  );
}

// ───────────── Setting a task ─────────────

interface Draft {
  title: string;
  note: string;
  duration: TaskPlanDuration;
  startsOn: string;
  endsOn: string;
  workingDays: number[];
  skipDates: string[];
  assigneeIds: string[];
  requirements: { metric: TaskMeasure; amount: string; per: TaskCadence }[];
}

function PlanDialog({ view, plan, onClose, onSaved }: { view: TaskPlansView; plan?: TaskPlanDetail; onClose: () => void; onSaved?: (id: string) => void }) {
  const t = useT();
  const { create, update } = useTaskPlanMutations();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: view.timeZone }).format(new Date());
  const self = view.assignable.find((a) => a.self);
  const [f, setF] = useState<Draft>(() =>
    plan
      ? {
          title: plan.title, note: plan.note ?? '', duration: plan.duration, startsOn: plan.startsOn, endsOn: plan.endsOn, workingDays: plan.workingDays, skipDates: plan.skipDates,
          assigneeIds: plan.assignees.map((a) => a.id), requirements: plan.requirements.map((r) => ({ metric: r.metric, amount: String(r.amount), per: r.per })),
        }
      : {
          title: '', note: '', duration: 'ONE_MONTH', startsOn: today, endsOn: '', workingDays: [1, 2, 3, 4, 5], skipDates: [],
          assigneeIds: view.assignable.some((a) => !a.self) ? [] : self ? [self.id] : [], requirements: [{ metric: 'QUALIFIED_COMPANIES', amount: '20', per: 'DAY' }],
        },
  );
  const [holiday, setHoliday] = useState('');
  const mutation = plan ? update : create;
  const lastDay = f.duration === 'CUSTOM' ? f.endsOn : planLastDay(f.duration, f.startsOn);
  const assignable = view.assignable;
  const groups = useMemo(() => {
    const m = new Map<string, typeof assignable>();
    for (const a of assignable) {
      const k = a.self ? t('You') : (a.workspace?.name ?? '');
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [assignable, t]);
  const toggle = (id: string) => setF({ ...f, assigneeIds: f.assigneeIds.includes(id) ? f.assigneeIds.filter((x) => x !== id) : [...f.assigneeIds, id] });
  const team = view.assignable.filter((a) => !a.self).map((a) => a.id);
  const requirements = f.requirements.map((r) => ({ metric: r.metric, amount: Number(r.amount), per: r.per }));

  const submit = () => {
    if (plan) {
      const before = new Set(plan.assignees.map((a) => a.id));
      const now = new Set(f.assigneeIds);
      update.mutate(
        {
          id: plan.id,
          input: {
            title: f.title, note: f.note.trim() || null, requirements, workingDays: f.workingDays, skipDates: f.skipDates,
            ...(f.endsOn !== plan.endsOn ? { endsOn: f.endsOn } : {}),
            addAssigneeIds: [...now].filter((x) => !before.has(x)),
            removeAssigneeIds: [...before].filter((x) => !now.has(x)),
          },
        },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        {
          title: f.title, ...(f.note.trim() ? { note: f.note } : {}), requirements, duration: f.duration, startsOn: f.startsOn,
          ...(f.duration === 'CUSTOM' ? { endsOn: f.endsOn } : {}), workingDays: f.workingDays, skipDates: f.skipDates, assigneeIds: f.assigneeIds,
        },
        { onSuccess: (d) => { onClose(); onSaved?.(d.id); } },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{plan ? t('Change recurring task') : t('New recurring task')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {plan ? t('Changes apply from now on. Finished days keep the numbers they were measured against.') : t('Say what to reach and how often. SampForce makes each instance and counts it from real records.')}
        </DialogDescription>
        <form
          className="mt-4 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="tp-title" label={t('Task name')}>
            <Input id="tp-title" required minLength={2} maxLength={120} value={f.title} placeholder={t('For example: Daily prospecting')} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('What to reach')}</legend>
            {f.requirements.map((r, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,8rem)_auto] items-end gap-2" data-requirement={i}>
                <Field id={`tp-m-${i}`} label={t('Measure')}>
                  <Select id={`tp-m-${i}`} value={r.metric} onChange={(e) => setF({ ...f, requirements: f.requirements.map((x, j) => (j === i ? { ...x, metric: e.target.value as TaskMeasure } : x)) })}>
                    {TASK_MEASURES.map((m) => (
                      <option key={m} value={m}>
                        {measure(t, m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`tp-a-${i}`} label={t('Number')}>
                  <Input id={`tp-a-${i}`} type="number" required min={1} max={100000} step={1} value={r.amount} onChange={(e) => setF({ ...f, requirements: f.requirements.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                </Field>
                <Field id={`tp-p-${i}`} label={t('How often')}>
                  <Select id={`tp-p-${i}`} value={r.per} onChange={(e) => setF({ ...f, requirements: f.requirements.map((x, j) => (j === i ? { ...x, per: e.target.value as TaskCadence } : x)) })}>
                    {TASK_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {t.maybe(TASK_CADENCE_LABEL[c])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="button" size="icon" variant="ghost" aria-label={t('Remove this line')} disabled={f.requirements.length === 1} onClick={() => setF({ ...f, requirements: f.requirements.filter((_, j) => j !== i) })}>
                  <X aria-hidden />
                </Button>
                <p className="col-span-4 -mt-1 text-xs text-muted-foreground">{t.maybe(METRIC_RULE[r.metric])}</p>
              </div>
            ))}
            {f.requirements.length < 8 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setF({ ...f, requirements: [...f.requirements, { metric: TASK_MEASURES.find((m) => !f.requirements.some((x) => x.metric === m)) ?? 'CALLS', amount: '10', per: 'DAY' }] })}>
                <Plus className="size-4" aria-hidden />
                {t('Add another')}
              </Button>
            )}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('Who does it')}</legend>
            {team.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setF({ ...f, assigneeIds: [...new Set([...f.assigneeIds, ...team])] })}>
                  {t('Whole team')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setF({ ...f, assigneeIds: [] })}>
                  {t('Clear')}
                </Button>
              </div>
            )}
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {groups.map(([name, people]) => (
                <div key={name}>
                  <p className="px-1 text-xs font-semibold text-muted-foreground">{name}</p>
                  <div className="flex flex-wrap gap-1.5 p-1">
                    {people.map((p) => {
                      const on = f.assigneeIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(p.id)}
                          className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
                        >
                          {on && <CheckCircle2 className="size-3.5" aria-hidden />}
                          {p.self ? t('Myself') : p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>

          {!plan && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('For how long')}</legend>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('For how long')}>
                {TASK_PLAN_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={f.duration === d}
                    onClick={() => setF({ ...f, duration: d })}
                    className={`h-8 shrink-0 rounded-full border px-3 text-sm ${f.duration === d ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}
                  >
                    {t.maybe(TASK_PLAN_DURATION_LABEL[d])}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {!plan && (
              <Field id="tp-start" label={t('Starts on')}>
                <Input id="tp-start" type="date" required min={today} value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
              </Field>
            )}
            {(f.duration === 'CUSTOM' || plan) ? (
              <Field id="tp-end" label={t('Last day')}>
                <Input id="tp-end" type="date" required min={plan ? today : f.startsOn} value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
              </Field>
            ) : (
              <p className="self-end text-sm text-muted-foreground">{lastDay ? t('Runs until {date}', { date: fmtDay(t, lastDay) }) : null}</p>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('Working days')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = f.workingDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF({ ...f, workingDays: on ? f.workingDays.filter((x) => x !== d) : [...f.workingDays, d].sort() })}
                    className={`size-10 shrink-0 rounded-full border text-sm font-medium ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
                  >
                    {t.maybe(WEEKDAY_SHORT[d]!)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t('Daily tasks appear only on working days. Weekly and monthly ones count every day.')}</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('Holidays and days off')}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <Input aria-label={t('Day off')} type="date" className="w-44" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
              <Button type="button" variant="outline" size="sm" disabled={!holiday} onClick={() => { setF({ ...f, skipDates: [...new Set([...f.skipDates, holiday])].sort() }); setHoliday(''); }}>
                {t('Add day off')}
              </Button>
            </div>
            {f.skipDates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.skipDates.map((d) => (
                  <Badge key={d}>
                    {fmtDay(t, d)}
                    <button type="button" aria-label={t('Remove {date}', { date: fmtDay(t, d) })} onClick={() => setF({ ...f, skipDates: f.skipDates.filter((x) => x !== d) })}>
                      <X className="size-3" aria-hidden />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </fieldset>
          <Field id="tp-note" label={t('Note')}>
            <Textarea id="tp-note" maxLength={1000} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
          <ErrorText error={mutation.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !f.assigneeIds.length || !f.title.trim()}>
              {mutation.isPending ? t('Saving…') : plan ? t('Save changes') : t('Set task')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── One task: history and changes ─────────────

const CELL: Record<TaskStatus, string> = {
  COMPLETED: '#059669',
  PARTIALLY_COMPLETED: '#f59e0b',
  NOT_COMPLETED: '#ef4444',
  CANCELLED: '#cbd5e1',
  NOT_STARTED: '#94a3b8',
  IN_PROGRESS: '#38bdf8',
  HALF_COMPLETED: '#8b5cf6',
  OVERDUE: '#ef4444',
};

const KIND_LABEL: Record<string, MessageKey> = { created: 'Set the task', updated: 'Changed the task', paused: 'Paused the task', resumed: 'Resumed the task', cancelled: 'Cancelled the task' };
const FIELD_LABEL: Record<string, MessageKey> = { title: 'Task name', note: 'Note', requirements: 'What to reach', endsOn: 'Last day', workingDays: 'Working days', skipDates: 'Holidays and days off', assignees: 'Who does it', reason: 'Reason' };

function PlanDetailDialog({ id, view, onClose }: { id: string; view: TaskPlansView; onClose: () => void }) {
  const t = useT();
  const q = useTaskPlan(id);
  const m = useTaskPlanMutations();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const plan = q.data;
  const people = useMemo(() => {
    if (!plan) return [];
    const by = new Map<string, TaskInstanceRow[]>();
    for (const i of plan.instances.filter((x) => x.cadence === 'DAY')) by.set(i.person.name, [...(by.get(i.person.name) ?? []), i]);
    return [...by.entries()];
  }, [plan]);
  const err = m.pause.error ?? m.resume.error ?? m.cancel.error ?? m.remove.error;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-6" data-plan-detail>
        {!plan ? (
          <>
            <DialogTitle className="sr-only">{t('Recurring task')}</DialogTitle>
            {q.error ? <ErrorText error={q.error} /> : <Skeleton className="h-64" />}
          </>
        ) : (
          <>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              <Repeat className="size-5 text-primary" aria-hidden />
              {plan.title}
              <span className="text-sm font-medium text-muted-foreground">{t.maybe(TASK_PLAN_STATUS_LABEL[plan.status])}</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {requirementsText(t, plan.requirements)} · {fmtDay(t, plan.startsOn)} – {fmtDay(t, plan.endsOn)}
              {plan.createdBy ? ` · ${t('Set by {name}', { name: plan.createdBy.name })}` : ''}
            </DialogDescription>
            {plan.note && <p className="mt-2 text-sm">{plan.note}</p>}
            {plan.cancelReason && <p className="mt-2 text-sm text-muted-foreground">{t('Cancelled because: {reason}', { reason: plan.cancelReason })}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ['Completed', plan.totals.completed, '#059669'],
                ['Partially completed', plan.totals.partial, '#d97706'],
                ['Not completed', plan.totals.missed, '#dc2626'],
                ['Running now', plan.totals.running, '#0284c7'],
              ] as [MessageKey, number, string][]).map(([label, n, c]) => (
                <div key={label} className="rounded-xl border border-border p-3" style={{ backgroundColor: `color-mix(in srgb, ${c} 8%, transparent)` }}>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: readable(c) }}>{n}</p>
                  <p className="text-xs text-muted-foreground">{t(label)}</p>
                </div>
              ))}
            </div>

            {plan.canManage && plan.status !== 'CANCELLED' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" aria-hidden />
                  {t('Change')}
                </Button>
                {plan.status === 'ACTIVE' && (
                  <Button size="sm" variant="outline" onClick={() => m.pause.mutate(plan.id)} disabled={m.pause.isPending}>
                    <Pause className="size-4" aria-hidden />
                    {t('Pause')}
                  </Button>
                )}
                {plan.status === 'PAUSED' && (
                  <Button size="sm" variant="outline" onClick={() => m.resume.mutate(plan.id)} disabled={m.resume.isPending}>
                    <Play className="size-4" aria-hidden />
                    {t('Resume')}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
                  <XCircle className="size-4" aria-hidden />
                  {t('Cancel task')}
                </Button>
                {plan.totals.completed + plan.totals.partial + plan.totals.missed === 0 && (
                  <Button size="sm" variant="ghost" onClick={() => window.confirm(t('Delete this task? It has no finished days yet.')) && m.remove.mutate(plan.id, { onSuccess: onClose })}>
                    <Trash2 className="size-4" aria-hidden />
                    {t('Delete')}
                  </Button>
                )}
              </div>
            )}
            {cancelling && (
              <form
                className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  m.cancel.mutate({ id: plan.id, reason: reason.trim() || undefined }, { onSuccess: () => setCancelling(false) });
                }}
              >
                <Field id="tp-reason" label={t('Why cancel it? (optional)')} className="min-w-0 flex-1">
                  <Input id="tp-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button type="submit" variant="destructive" disabled={m.cancel.isPending}>
                  {t('Cancel task')}
                </Button>
              </form>
            )}
            <ErrorText error={err} />

            {people.length > 0 && (
              <section className="mt-5 space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarRange className="size-4" aria-hidden />
                  {t('Day by day')}
                </h3>
                {people.map(([name, days]) => (
                  <div key={name} className="space-y-1" data-heatmap={name}>
                    <p className="text-xs font-medium">{name}</p>
                    <div className="flex flex-wrap gap-1">
                      {[...days].reverse().map((d) => (
                        <span
                          key={d.id}
                          className="size-5 rounded-[5px]"
                          style={{ backgroundColor: CELL[d.status] }}
                          title={`${fmtDay(t, d.startsOn)}: ${t.maybe(TASK_STATUS_LABEL[d.status])} (${Math.round(d.percent)}%)`}
                          aria-label={`${fmtDay(t, d.startsOn)}: ${t.maybe(TASK_STATUS_LABEL[d.status])}`}
                          role="img"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="mt-5 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Info className="size-4" aria-hidden />
                {t('Every period so far')}
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {plan.instances.slice(0, 60).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-history-row={i.status}>
                    <span className="w-36 shrink-0 tabular-nums">{i.startsOn === i.endsOn ? fmtDay(t, i.startsOn) : `${fmtDay(t, i.startsOn)} – ${fmtDay(t, i.endsOn)}`}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {i.person.name} · {i.requirements.map((r) => `${r.done}/${r.amount} ${measure(t, r.metric).toLowerCase()}`).join(', ')}
                    </span>
                    <StatusChip status={i.status} />
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-5 space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4" aria-hidden />
                {t('Changes')}
              </h3>
              <ul className="space-y-2" data-plan-revisions>
                {plan.revisions.map((r, i) => (
                  <li key={i} className="rounded-lg bg-muted/40 p-2.5 text-sm">
                    <p>
                      <span className="font-medium">{r.by?.name ?? t('Someone')}</span> {KIND_LABEL[r.kind] ? t(KIND_LABEL[r.kind]!).toLowerCase() : r.kind}
                      <span className="text-xs text-muted-foreground"> · {new Date(r.at).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </p>
                    {r.changes.map((c) => (
                      <p key={c.field} className="break-words text-xs text-muted-foreground">
                        {FIELD_LABEL[c.field] ? t(FIELD_LABEL[c.field]!) : c.field}: {c.from ?? '—'} → {c.to ?? '—'}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        {editing && plan && <PlanDialog view={view} plan={plan} onClose={() => setEditing(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** The dashboard strip: today's tasks in brief, when the person has any. */
export function TodayTasksStrip() {
  const view = useTaskPlans();
  if (!view.data || !view.data.today.length) return null;
  return (
    <div data-dashboard-today-tasks>
      <TodayTasks view={view.data} compact />
    </div>
  );
}
