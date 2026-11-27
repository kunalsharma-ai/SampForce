'use client';

import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_CATEGORY_LABEL,
  type AchievementBadgeKey,
  type AchievementCategory,
  type AchievementRow,
  type AchievementSettingsInput,
  type AchievementSettingsView,
  type AchievementSummary,
  type LeadProgress,
} from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { Award, CalendarCheck2, CheckCheck, Crown, Gem, Handshake, Leaf, ListChecks, Lock, Medal, Send, Target, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Segmented } from '@/components/forms/segmented';
import { useAchievementHistory, useAchievementSettings, useAchievementSummary, useSaveAchievementSettings } from '@/lib/achievements';
import { useT } from '@/lib/i18n';
import { CelebrationCard, useLevelLabel } from './celebration-card';
import { achievementCopy, formatAchievedAt } from './copy';
import { ProgressRing, sceneFor, useCountUp } from './scenes';
import './celebrations.css';

const BADGE_LOOK: Record<AchievementBadgeKey, { icon: typeof Award; tone: string }> = {
  'first-conversion': { icon: Handshake, tone: 'deal' },
  'deal-maker': { icon: Crown, tone: 'deal' },
  'rfq-launch': { icon: Send, tone: 'rfq' },
  'rfq-pilot': { icon: Send, tone: 'rfq' },
  'quota-reached': { icon: Target, tone: 'quota' },
  'quota-regular': { icon: Target, tone: 'quota' },
  'clean-sweep': { icon: ListChecks, tone: 'sweep' },
  'target-hit': { icon: Trophy, tone: 'target' },
  'big-win': { icon: Gem, tone: 'diamond' },
  'steady-week': { icon: Leaf, tone: 'rhythm' },
};

function Stat({ icon: Icon, tone, label, value }: { icon: typeof Award; tone: string; label: string; value: number }) {
  const t = useT();
  const n = useCountUp(value, false, 900, 0);
  return (
    <div className="sfc sfc-chip flex items-center gap-3 rounded-2xl p-3" data-tone={tone} data-stat={label}>
      <span className="sfc-band grid size-10 shrink-0 place-items-center rounded-xl"><Icon className="size-5" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold tabular-nums leading-none">{new Intl.NumberFormat(t.formatLocale).format(n)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function LeadCard({ p, title }: { p: LeadProgress; title: string }) {
  const t = useT();
  const num = (n: number) => new Intl.NumberFormat(t.formatLocale).format(n);
  return (
    <div className="sfc flex items-center gap-4 rounded-2xl border p-4" data-tone={p.percent >= 100 ? 'quota' : 'milestone'} data-lead-progress={p.period}>
      <ProgressRing percent={p.target ? Math.min(100, p.percent) : 0} size={88} still={false} light={false} label={p.target ? `${num(p.actual)}/${num(p.target)}` : num(p.actual)} />
      <div className="min-w-0 space-y-0.5 text-sm">
        <p className="font-semibold">{title}</p>
        {p.target ? (
          <>
            <p>{t('{actual} of {target} valid leads', { actual: num(p.actual), target: num(p.target) })}</p>
            <p className="text-muted-foreground">{p.remaining > 0 ? t('{n} still to go', { n: num(p.remaining) }) : t('Target reached')}</p>
            <p className="text-xs text-muted-foreground">{p.targetSource === 'ASSIGNED' ? t('Set by your manager') : t('Your personal target')}</p>
          </>
        ) : (
          <p className="text-muted-foreground">{t('{n} valid leads. No target set.', { n: num(p.actual) })}</p>
        )}
        {p.notCounted > 0 && <p className="text-xs text-muted-foreground">{t('{n} not counted (no website, email, phone or LinkedIn, or already in SampForce)', { n: num(p.notCounted) })}</p>}
      </div>
    </div>
  );
}

function Summary({ s }: { s: AchievementSummary }) {
  const t = useT();
  const money = (n: number, c: string | null) => (c ? new Intl.NumberFormat(t.formatLocale, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n) : new Intl.NumberFormat(t.formatLocale).format(n));
  return (
    <div className="space-y-6">
      <section aria-labelledby="ach-today" className="space-y-3">
        <h2 id="ach-today" className="text-lg font-semibold">{t('Lead targets')}</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <LeadCard p={s.leads.today} title={t('Today')} />
          <LeadCard p={s.leads.week} title={t('This week')} />
          <LeadCard p={s.leads.month} title={t('This month')} />
        </div>
        {s.sales.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2" data-sales-progress>
            {s.sales.map((p) => (
              <div key={`${p.targetSource}-${p.period}-${p.periodLabel}-${p.metric}`} className="sfc rounded-2xl border p-4" data-tone="target">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">{p.period === 'QUARTER' ? t('Quarterly sales target') : t('Monthly sales target')}</span>
                  <span className="tabular-nums sfc-accent font-bold">{Math.floor(p.percent)}%</span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.floor(p.percent))} aria-label={t('Sales target progress')}>
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--c3)] to-[var(--c1)]" style={{ width: `${Math.min(100, p.percent)}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.metric === 'REVENUE' ? t('{actual} of {target}', { actual: money(p.actual, p.currency), target: money(p.target, p.currency) }) : t('{actual} of {target} deals won', { actual: p.actual, target: p.target })}
                  {' · '}
                  {p.targetSource === 'PERSONAL' ? t('Your personal target') : p.targetSource === 'FORECAST' ? t('Forecast target') : t('Set by your manager')}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="ach-totals" className="space-y-3">
        <h2 id="ach-totals" className="text-lg font-semibold">{t('Your totals')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat icon={Handshake} tone="deal" label={t('Deals converted')} value={s.totals.dealsConverted} />
          <Stat icon={Send} tone="rfq" label={t('RFQs submitted')} value={s.totals.rfqsSubmitted} />
          <Stat icon={Target} tone="quota" label={t('Daily lead targets reached')} value={s.totals.dailyLeadTargets} />
          <Stat icon={CalendarCheck2} tone="milestone" label={t('Weekly and monthly lead targets')} value={s.totals.weeklyLeadTargets + s.totals.monthlyLeadTargets} />
          <Stat icon={CheckCheck} tone="task" label={t('Tasks completed')} value={s.totals.tasksCompleted} />
          <Stat icon={ListChecks} tone="sweep" label={t('Days with every task done')} value={s.totals.allTasksDays} />
          <Stat icon={Trophy} tone="target" label={t('Sales targets reached')} value={s.totals.salesTargets} />
          <Stat icon={Medal} tone="medal" label={t('Major milestones')} value={s.totals.milestones} />
        </div>
      </section>

      <section aria-labelledby="ach-badges" className="space-y-3">
        <h2 id="ach-badges" className="text-lg font-semibold">{t('Badges')}</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {s.badges.map((b) => {
            const look = BADGE_LOOK[b.key];
            const Icon = b.earnedAt ? look.icon : Lock;
            const name = t.maybe(BADGE_TITLES[b.key]);
            return (
              <li key={b.key} className={cn('sfc flex flex-col items-center gap-2 rounded-2xl border p-3 text-center', !b.earnedAt && 'bg-muted/40')} data-tone={look.tone} data-badge={b.key} data-earned={b.earnedAt ? 'yes' : 'no'}>
                <span className={cn('grid size-14 place-items-center rounded-full', b.earnedAt ? 'sfc-band sfc-badge-float shadow-lg' : 'border-2 border-dashed text-muted-foreground')}>
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="text-sm font-semibold">{name}</span>
                {b.earnedAt ? (
                  <span className="text-xs text-muted-foreground">{t('Earned {date}', { date: new Intl.DateTimeFormat(t.formatLocale, { dateStyle: 'medium' }).format(new Date(b.earnedAt)) })}</span>
                ) : (
                  <span className="w-full">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full bg-[var(--c1)]" style={{ width: `${(b.progress / b.goal) * 100}%` }} /></span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t('{n} of {goal}', { n: b.progress, goal: b.goal })}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

const BADGE_TITLES: Record<AchievementBadgeKey, string> = {
  'first-conversion': 'First conversion',
  'deal-maker': 'Deal maker',
  'rfq-launch': 'RFQ launch',
  'rfq-pilot': 'RFQ pilot',
  'quota-reached': 'Quota reached',
  'quota-regular': 'Quota regular',
  'clean-sweep': 'Clean sweep',
  'target-hit': 'Target hit',
  'big-win': 'Big win',
  'steady-week': 'Steady rhythm',
};

function Timeline() {
  const t = useT();
  const levelLabel = useLevelLabel();
  const [category, setCategory] = useState<AchievementCategory | null>(null);
  const [open, setOpen] = useState<AchievementRow | null>(null);
  const q = useAchievementHistory(category);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="ach-timeline" className="space-y-3">
      <h2 id="ach-timeline" className="text-lg font-semibold">{t('Achievement timeline')}</h2>
      <div className="flex max-w-full flex-wrap gap-1.5" role="group" aria-label={t('Show')}>
        {[null, ...ACHIEVEMENT_CATEGORIES].map((c) => (
          <button
            key={c ?? 'all'}
            type="button"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={cn('shrink-0 rounded-full border px-3 py-1 text-sm', category === c ? 'border-foreground bg-foreground font-semibold text-background' : 'hover:bg-muted')}
          >
            {c ? t.maybe(ACHIEVEMENT_CATEGORY_LABEL[c]) : t('All')}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('Your achievements will appear here as you reach them.')}</p>
      ) : (
        <ol className="relative space-y-3 border-s-2 border-border ps-5" data-achievement-timeline>
          {items.map((a) => {
            const scene = sceneFor(a);
            const copy = achievementCopy(a, t);
            const Icon = scene.icon;
            return (
              <li key={a.id} className="sfc relative" data-tone={scene.tone} data-kind={a.kind}>
                <span className="sfc-band absolute -start-[1.95rem] top-3 grid size-7 place-items-center rounded-full ring-4 ring-background"><Icon className="size-3.5" aria-hidden /></span>
                <button type="button" onClick={() => setOpen(a)} className="w-full rounded-2xl border bg-[hsl(var(--surface))] p-3 text-start transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{copy.title}</span>
                    <time className="text-xs text-muted-foreground" dateTime={a.achievedAt}>{formatAchievedAt(a.achievedAt, t.formatLocale)}</time>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">{copy.facts.slice(0, 2).map((f) => f.value).join(' · ') || copy.message}</span>
                  <span className="mt-1 inline-block text-xs font-medium sfc-accent">{levelLabel(a.level)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {q.hasNextPage && (
        <Button variant="outline" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {t('Show older')}
        </Button>
      )}
      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-[30rem] border-0 bg-transparent p-0 shadow-none" hideClose>
          <DialogTitle className="sr-only">{open ? achievementCopy(open, t).title : ''}</DialogTitle>
          {/* The history shows the achievement still: it never replays the celebration. */}
          {open && <CelebrationCard a={open} scene={{ ...sceneFor(open), layout: sceneFor(open).layout === 'toast' || sceneFor(open).layout === 'compact' ? 'card' : sceneFor(open).layout }} still onClose={() => setOpen(null)} className="w-full" />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-3">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function SettingsCard({ s }: { s: AchievementSettingsView }) {
  const t = useT();
  const save = useSaveAchievementSettings();
  const [draft, setDraft] = useState(s);
  useEffect(() => setDraft(s), [s]);
  const set = (patch: Partial<AchievementSettingsView>) => setDraft((d) => ({ ...d, ...patch }));
  const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
  const input: AchievementSettingsInput = {
    enabled: draft.enabled,
    style: draft.style,
    sound: draft.sound,
    reduceMotion: draft.reduceMotion,
    mutedCategories: draft.mutedCategories,
    dailyLeadTarget: draft.dailyLeadTarget,
    weeklyLeadTarget: draft.weeklyLeadTarget,
    monthlyLeadTarget: draft.monthlyLeadTarget,
    monthlyRevenueTarget: draft.monthlyRevenueTarget,
    majorDealAmount: draft.majorDealAmount,
  };
  const targetField = (key: 'dailyLeadTarget' | 'weeklyLeadTarget' | 'monthlyLeadTarget' | 'monthlyRevenueTarget' | 'majorDealAmount', label: string, assigned: number | null, money = false) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ach-${key}`}>{money ? `${label} (${s.currency})` : label}</Label>
      <Input id={`ach-${key}`} type="number" inputMode="numeric" min={1} step={money ? 'any' : 1} value={draft[key] ?? ''} onChange={(e) => set({ [key]: toNum(e.target.value) } as Partial<AchievementSettingsView>)} aria-describedby={assigned !== null ? `ach-${key}-hint` : undefined} />
      {assigned !== null && <p id={`ach-${key}-hint`} className="text-xs text-muted-foreground">{t('Your manager set {n} for now; it is used instead.', { n: new Intl.NumberFormat(t.formatLocale).format(assigned) })}</p>}
    </div>
  );
  return (
    <Card id="celebration-settings">
      <CardHeader>
        <CardTitle>{t('Celebration settings')}</CardTitle>
        <CardDescription>{t('Choose how SampForce celebrates your achievements. Achievements are always kept in your history.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(input);
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Toggle id="ach-enabled" label={t('Show celebrations')} hint={t('Animations and pop-ups for real achievements.')} checked={draft.enabled} onChange={(v) => set({ enabled: v })} />
            <Toggle id="ach-sound" label={t('Celebration sounds')} hint={t('A soft chime. Off unless you switch it on.')} checked={draft.sound} onChange={(v) => set({ sound: v })} />
            <Toggle id="ach-motion" label={t('Reduce motion')} hint={t('Show each celebration still, without movement or confetti.')} checked={draft.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
          </div>
          <Segmented
            legend={t('Animation style')}
            name="ach-style"
            value={draft.style}
            onChange={(v) => set({ style: v })}
            options={[
              { value: 'SUBTLE', label: t('Subtle'), hint: t('Smaller pop-ups, no confetti') },
              { value: 'EXPRESSIVE', label: t('Expressive'), hint: t('Confetti and full-screen moments for exceptional milestones') },
            ]}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('Celebrate')}</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ACHIEVEMENT_CATEGORIES.map((c) => (
                <Toggle
                  key={c}
                  id={`ach-cat-${c}`}
                  label={t.maybe(ACHIEVEMENT_CATEGORY_LABEL[c])}
                  checked={!draft.mutedCategories.includes(c)}
                  onChange={(on) => set({ mutedCategories: on ? draft.mutedCategories.filter((x) => x !== c) : [...draft.mutedCategories, c] })}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('Consistency uses only the check-ins and breaks you record yourself. Breaks never count against you, and days longer than 10 hours are never rewarded.')}</p>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('Personal targets')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {targetField('dailyLeadTarget', t('Leads per day'), s.assigned.dailyLeads)}
              {targetField('weeklyLeadTarget', t('Leads per week'), s.assigned.weeklyLeads)}
              {targetField('monthlyLeadTarget', t('Leads per month'), s.assigned.monthlyLeads)}
              {targetField('monthlyRevenueTarget', t('Revenue per month'), s.assigned.monthlyRevenue, true)}
              {targetField('majorDealAmount', t('Major deal from'), null, true)}
            </div>
          </fieldset>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={save.isPending}>{t('Save settings')}</Button>
            {save.isSuccess && !save.isPending && <span role="status" className="text-sm text-success">{t('Saved')}</span>}
            {save.isError && <span role="alert" className="text-sm text-critical">{t.maybe(save.error.message)}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** My Achievements (ADR 0090): progress, totals, badges, the timeline and the celebration settings. */
export function MyAchievements() {
  const summary = useAchievementSummary();
  const settings = useAchievementSettings();
  return (
    <div className="space-y-8" data-my-achievements>
      {summary.data ? <Summary s={summary.data} /> : <Skeleton className="h-64 w-full" />}
      <Timeline />
      {settings.data ? <SettingsCard s={settings.data} /> : <Skeleton className="h-48 w-full" />}
    </div>
  );
}
