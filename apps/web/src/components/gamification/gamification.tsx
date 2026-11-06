'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import {
  BADGE_ICONS,
  BADGE_METRIC_LABELS,
  BADGE_METRICS,
  BADGE_WINDOWS,
  type BadgeInput,
  type BadgeRow,
  COMPETITION_METRIC_LABELS,
  COMPETITION_METRICS,
  type CompetitionInput,
  type CompetitionRow,
  type GamificationMe,
  type GamificationSettings,
  type ScoringRules,
  SCORING_RULE_KEYS,
  SCORING_RULE_LABELS,
} from '@dealflow/types';
import { Crown, Flame, Medal, Phone, Rocket, Star, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { formatDate, formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { gamificationApi, periodOptions, useAwards, useBadges, useCompetitions, useGamificationMe, useGamificationMutation, useGamificationSettings, useLeaderboard, useTeams } from '@/lib/gamification';
import { fmtLocale } from '@/lib/i18n/locale';
import { rich, type Translator, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

const ICONS = { trophy: Trophy, medal: Medal, star: Star, flame: Flame, target: Target, rocket: Rocket, crown: Crown, phone: Phone } as const;
const WINDOW_LABELS = { month: 'in a month', quarter: 'in a quarter', year: 'in a year', all_time: 'all time' } as const satisfies Record<(typeof BADGE_WINDOWS)[number], string>;
const STATUS_TONE = { running: 'success', upcoming: 'primary', finished: 'neutral', cancelled: 'critical' } as const;
const STATUS_LABEL = { running: 'Running', upcoming: 'Upcoming', finished: 'Finished', cancelled: 'Cancelled' } as const;
const num = (n: number) => n.toLocaleString(fmtLocale(), { maximumFractionDigits: 1 });

type Tab = 'me' | 'leaderboards' | 'competitions' | 'badges' | 'settings';

export function GamificationWorkspace() {
  const t = useT();
  const me = useGamificationMe();
  const [tab, setTab] = useState<Tab | null>(null);
  if (me.isPending) return <Skeleton className="h-64" />;
  if (me.error || !me.data) return <p role="alert" className="text-sm text-critical">{me.error?.message ?? t('Could not load gamification.')}</p>;
  const m = me.data;
  const tabs: { key: Tab; label: string }[] = m.enabled
    ? [
        { key: 'me', label: t('My performance') },
        { key: 'leaderboards', label: t('Leaderboards') },
        { key: 'competitions', label: t('Competitions') },
        { key: 'badges', label: t('Badges') },
        ...(m.canManage ? [{ key: 'settings' as const, label: t('Rules and settings') }] : []),
      ]
    : m.canManage
      ? [{ key: 'settings', label: t('Rules and settings') }, { key: 'badges', label: t('Badges') }]
      : [];
  const current = tab && tabs.some((item) => item.key === tab) ? tab : (tabs[0]?.key ?? null);

  return (
    <div className="space-y-4">
      {!m.enabled && (
        <Card>
          <CardContent className="p-5 text-sm">
            <p className="font-medium">{t('Gamification is turned off for this workspace.')}</p>
            <p className="mt-1 text-muted-foreground">
              {m.canManage ? t('Choose which activities earn points and set up badges, then turn it on in Rules and settings. Nobody sees points until you do.') : t('An admin or sales manager can turn it on and choose which activities earn points.')}
            </p>
          </CardContent>
        </Card>
      )}
      {tabs.length > 0 && (
        <div role="tablist" aria-label={t('Gamification')} className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map((item) => (
            <button
              key={item.key}
              role="tab"
              id={`gm-tab-${item.key}`}
              aria-selected={current === item.key}
              aria-controls={`gm-panel-${item.key}`}
              onClick={() => setTab(item.key)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', current === item.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {current && (
        <div role="tabpanel" id={`gm-panel-${current}`} aria-labelledby={`gm-tab-${current}`}>
          {current === 'me' && <MyPerformance me={m} />}
          {current === 'leaderboards' && <Leaderboards />}
          {current === 'competitions' && <Competitions canManage={m.canManage} currency={m.currency} />}
          {current === 'badges' && <Badges canManage={m.canManage} enabled={m.enabled} />}
          {current === 'settings' && <RulesSettings />}
        </div>
      )}
    </div>
  );
}

// ───────────── my performance ─────────────

function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', value >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${pct}%` }} />
    </div>
  );
}

function MyPerformance({ me }: { me: GamificationMe }) {
  const t = useT();
  const s = me.score;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('Points this month')}</p>
            <p className="mt-1 text-3xl font-semibold" data-testid="my-points">{num(s?.points ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('Leaderboard position')}</p>
            <p className="mt-1 text-3xl font-semibold">{s ? `#${s.rank}` : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">{t('Badges earned')}</p>
            <p className="mt-1 text-3xl font-semibold">{me.badges.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('How you earned your points')}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('Points by activity this month')}</caption>
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">{t('Activity')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('Done')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('Counted')}</th>
                  <th scope="col" className="py-2 text-end font-medium">{t('Points')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(s?.breakdown ?? []).filter((b) => b.count > 0 || b.points > 0).map((b) => (
                  <tr key={b.key}>
                    <th scope="row" className="py-2 text-start font-normal">{b.key === 'revenue_won' ? t('Revenue won (per 1,000)') : t.maybe(SCORING_RULE_LABELS[b.key].label)}</th>
                    <td className="py-2 text-end">{num(b.count)}</td>
                    <td className="py-2 text-end">{b.scored < b.count ? <span title={t('Above the daily limit or not counted under the current rules')}>{num(b.scored)}</span> : num(b.scored)}</td>
                    <td className="py-2 text-end font-medium">{num(b.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!s?.breakdown.some((b) => b.count > 0) && <p className="py-3 text-sm text-muted-foreground">{t('Nothing yet this month. Log calls and meetings, complete tasks and win deals to earn points.')}</p>}
            <p className="mt-3 text-xs text-muted-foreground">{t('Points come straight from your CRM records under your workspace\'s rules. "Counted" is lower when a daily limit applies.')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Sales target progress')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {me.targets.map((item) => (
              <div key={item.period} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{t.maybe(item.period)}</span>
                  <span className="text-muted-foreground">{item.target === null ? t('{won} won, no target set', { won: formatMoney(item.won, me.currency) }) : t('{won} of {target} ({pct}%)', { won: formatMoney(item.won, me.currency), target: formatMoney(item.target, me.currency), pct: num(item.attainment ?? 0) })}</span>
                </div>
                {item.target !== null && <Meter value={item.attainment ?? 0} label={t('{period} target progress', { period: t.maybe(item.period) })} />}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t('Targets are set in Revenue Intelligence. Won revenue is in {currency}, using your exchange rates.', { currency: me.currency })}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Your badges')}</CardTitle>
          </CardHeader>
          <CardContent>
            {me.badges.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('No badges yet.')}</p>
            ) : (
              <ul className="space-y-2" aria-label={t('Your badges')}>
                {me.badges.map((a) => {
                  const Icon = ICONS[a.badge.icon as keyof typeof ICONS] ?? Medal;
                  return (
                    <li key={a.id} className="flex items-center gap-3 text-sm">
                      <Icon className="size-5 text-accent" aria-hidden />
                      <span className="flex-1">
                        <span className="font-medium">{a.badge.name}</span>
                        {a.period !== 'all' && <span className="text-muted-foreground"> · {a.period}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{relativeTime(a.awardedAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-base">{t('Your competitions')}</CardTitle>
              <InfoTip topic="gamification.competitions" />
            </div>
          </CardHeader>
          <CardContent>
            {me.competitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('You are not in a running competition.')}</p>
            ) : (
              <ul className="space-y-3" aria-label={t('Your competitions')}>
                {me.competitions.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{t(STATUS_LABEL[c.status])}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {c.mine ? `${c.kind === 'team' ? `${c.mine.name}: ` : ''}${t('#{rank} with {value}', { rank: c.mine.rank, value: metricValue(t, c, c.mine.value, me.currency) })}` : t('Starts {date}', { date: formatDate(c.start) })}
                      {c.goal && c.mine ? ` · ${t('{pct}% of the goal', { pct: num(c.mine.progress ?? 0) })}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function metricValue(t: Translator, c: Pick<CompetitionRow, 'metric'>, v: number, currency: string) {
  if (c.metric === 'revenue_won') return formatMoney(v, currency);
  if (c.metric === 'points') return t.plural('count.points', v, { value: num(v) });
  if (c.metric === 'deals_won') return t.plural('count.wonDeals', v, { value: num(v) });
  return t.plural('count.activities', v, { value: num(v) });
}

// ───────────── leaderboards ─────────────

function Leaderboards() {
  const t = useT();
  const options = periodOptions(t);
  const [period, setPeriod] = useState(options[0]!.value);
  const [view, setView] = useState<'people' | 'teams'>('people');
  const q = useLeaderboard(period);
  const b = q.data;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{t('Leaderboard')}</CardTitle>
          <InfoTip topic="gamification.leaderboard" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label={t('Rank')} className="inline-flex rounded-md border border-border p-0.5 text-sm">
            {(['people', 'teams'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded px-3 py-1', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {v === 'people' ? t('People') : t('Teams')}
              </button>
            ))}
          </div>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">{t('Period')}</span>
            <Select aria-label={t('Period')} value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-56">
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : q.error ? (
          <p role="alert" className="text-sm text-critical">{q.error.message}</p>
        ) : b ? (
          <>
            {!b.full && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">{t('Your workspace shows leaderboards to managers only, so you see your own score.')}</p>}
            {b.missingRates > 0 && <p className="mb-3 text-sm text-warning">{t.plural('count.missingRates', b.missingRates)}</p>}
            {view === 'people' ? (
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">{t('People ranked by points, {period}', { period: t.maybe(b.period.label) })}</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 font-medium">{t('Rank')}</th>
                    <th scope="col" className="py-2 font-medium">{t('Name')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Points')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Deals won')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Revenue won')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Activities')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Target')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Badges')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.people.map((p) => (
                    <tr key={p.user.id}>
                      <td className="py-2">{p.rank <= 3 && p.points > 0 ? <span className="inline-flex items-center gap-1"><Trophy className={cn('size-4', p.rank === 1 ? 'text-warning' : 'text-muted-foreground')} aria-hidden />{p.rank}</span> : p.rank}</td>
                      <th scope="row" className="py-2 text-start font-medium">{p.user.name}</th>
                      <td className="py-2 text-end font-semibold">{num(p.points)}</td>
                      <td className="py-2 text-end">{p.dealsWon}</td>
                      <td className="py-2 text-end">{formatMoney(p.revenueWon, b.currency)}</td>
                      <td className="py-2 text-end">{p.activities}</td>
                      <td className="py-2 text-end">{p.attainment === null ? '—' : `${num(p.attainment)}%`}</td>
                      <td className="py-2 text-end">{p.badges}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : b.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">{b.full ? t('No sales teams yet. An admin can create them in Team Management.') : t('Team rankings are shown to managers only.')}</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">{t('Teams ranked by points, {period}', { period: t.maybe(b.period.label) })}</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 font-medium">{t('Rank')}</th>
                    <th scope="col" className="py-2 font-medium">{t('Team')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Points')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Per member')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Members')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Deals won')}</th>
                    <th scope="col" className="py-2 text-end font-medium">{t('Revenue won')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.teams.map((item) => (
                    <tr key={item.team.id}>
                      <td className="py-2">{item.rank}</td>
                      <th scope="row" className="py-2 text-start font-medium">{item.team.name}</th>
                      <td className="py-2 text-end font-semibold">{num(item.points)}</td>
                      <td className="py-2 text-end">{num(item.perMember)}</td>
                      <td className="py-2 text-end">{item.members}</td>
                      <td className="py-2 text-end">{item.dealsWon}</td>
                      <td className="py-2 text-end">{formatMoney(item.revenueWon, b.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {t('{start} to {end}. Daily limits use UTC days. Revenue is in {currency}.', { start: b.period.start, end: formatDate(new Date(Date.parse(`${b.period.end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)), currency: b.currency })}
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────── competitions and team challenges ─────────────

function Competitions({ canManage, currency }: { canManage: boolean; currency: string }) {
  const t = useT();
  const q = useCompetitions();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const cancel = useGamificationMutation((id: string) => gamificationApi.cancelCompetition(id), () => setConfirm(null));
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>{t('New competition')}</Button>
        </div>
      )}
      {cancel.error && <p role="alert" className="text-sm text-critical">{cancel.error.message}</p>}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <p role="alert" className="text-sm text-critical">{q.error.message}</p>
      ) : !q.data?.length ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">{t('No competitions yet.')}{canManage ? ` ${t('Start one for a month or quarter, for people or for teams.')}` : ''}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((c) => (
            <Card key={c.id}>
              <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <Badge tone={STATUS_TONE[c.status]}>{t(STATUS_LABEL[c.status])}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {c.kind === 'team' ? t('Team challenge') : t('Individual')} · {t.maybe(COMPETITION_METRIC_LABELS[c.metric])} · {t('{start} to {end}', { start: formatDate(c.start), end: formatDate(c.end) })}
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {c.description && <p>{c.description}</p>}
                {(c.goal || c.reward) && (
                  <p className="text-muted-foreground">
                    {c.goal ? (c.kind === 'team' ? t('Goal: {value} per team', { value: metricValue(t, c, c.goal, currency) }) : t('Goal: {value}', { value: metricValue(t, c, c.goal, currency) })) : ''}
                    {c.goal && c.reward ? ' · ' : ''}
                    {c.reward ? t('Reward: {reward}', { reward: c.reward }) : ''}
                  </p>
                )}
                {c.status === 'upcoming' ? (
                  <p className="text-muted-foreground">{t('Standings appear when it starts.')}</p>
                ) : c.standings.length === 0 ? (
                  <p className="text-muted-foreground">{t('No standings to show.')}</p>
                ) : (
                  <ol className="space-y-2" aria-label={t('Standings for {name}', { name: c.name })}>
                    {c.standings.map((s) => (
                      <li key={s.id} className={cn('space-y-1', c.mine?.id === s.id && 'font-medium')}>
                        <div className="flex justify-between gap-2">
                          <span>
                            {s.rank}. {s.name}
                            {c.mine?.id === s.id && <span className="sr-only"> {t('(you)')}</span>}
                          </span>
                          <span>{metricValue(t, c, s.value, currency)}{s.progress !== null ? ` · ${num(s.progress)}%` : ''}</span>
                        </div>
                        {s.progress !== null && <Meter value={s.progress} label={t('{name} progress towards the goal', { name: s.name })} />}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">{c.createdBy ? t('Scored with the rules in place when it was created, by {name}.', { name: c.createdBy.name }) : t('Scored with the rules in place when it was created.')}</p>
                {canManage && (c.status === 'running' || c.status === 'upcoming') && (
                  <div className="flex gap-2">
                    {confirm === c.id ? (
                      <>
                        <Button size="sm" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>{t('Confirm cancel')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>{t('Keep it')}</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirm(c.id)}>{t('Cancel competition')}</Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {open && <CompetitionDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function CompetitionDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const teams = useTeams();
  const options = periodOptions(t).filter((o) => !o.last);
  const [form, setForm] = useState<CompetitionInput>({ name: '', description: null, kind: 'individual', metric: 'points', period: options[0]!.value, startDate: null, endDate: null, goal: null, reward: null, teamIds: [] });
  const [custom, setCustom] = useState(false);
  const create = useGamificationMutation((b: CompetitionInput) => gamificationApi.createCompetition(b), onClose);
  const set = (p: Partial<CompetitionInput>) => setForm((f) => ({ ...f, ...p }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ ...form, period: custom ? null : form.period, startDate: custom ? form.startDate : null, endDate: custom ? form.endDate : null });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{t('New competition')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t("Participants are notified in SampForce. It uses a copy of today's scoring rules, so later rule changes do not move its standings.")}</DialogDescription>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Name')}</span>
            <Input required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Who competes')}</span>
              <Select value={form.kind} onChange={(e) => set({ kind: e.target.value as CompetitionInput['kind'] })}>
                <option value="individual">{t('People')}</option>
                <option value="team">{t('Teams (team challenge)')}</option>
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Measure')}</span>
              <Select value={form.metric} onChange={(e) => set({ metric: e.target.value as CompetitionInput['metric'] })}>
                {COMPETITION_METRICS.map((k) => (
                  <option key={k} value={k}>{t.maybe(COMPETITION_METRIC_LABELS[k])}</option>
                ))}
              </Select>
            </label>
          </div>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">{t('When')}</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> {t('Custom dates')}
            </label>
            {custom ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span>{t('First day')}</span>
                  <Input type="date" required value={form.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span>{t('Last day')}</span>
                  <Input type="date" required value={form.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value })} />
                </label>
              </div>
            ) : (
              <Select aria-label={t('Competition period')} value={form.period ?? ''} onChange={(e) => set({ period: e.target.value })}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            )}
          </fieldset>
          {form.kind === 'team' || form.teamIds.length > 0 || (teams.data?.length ?? 0) > 0 ? (
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">{t('Teams')}</legend>
              <p className="text-xs text-muted-foreground">{form.kind === 'team' ? t('Leave all unticked to include every team.') : t('Optional: only members of the ticked teams take part.')}</p>
              {teams.data?.length ? (
                teams.data.map((item) => (
                  <label key={item.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={form.teamIds.includes(item.id)} onChange={(e) => set({ teamIds: e.target.checked ? [...form.teamIds, item.id] : form.teamIds.filter((x) => x !== item.id) })} />
                    {item.name} <span className="text-muted-foreground">({item.members.length})</span>
                  </label>
                ))
              ) : (
                <p className="text-muted-foreground">{t('No sales teams yet. An admin can create them in Team Management.')}</p>
              )}
            </fieldset>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Goal (optional)')}</span>
              <Input type="number" min={1} step="any" value={form.goal ?? ''} onChange={(e) => set({ goal: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Reward (optional)')}</span>
              <Input maxLength={200} value={form.reward ?? ''} onChange={(e) => set({ reward: e.target.value || null })} placeholder={t('Team lunch')} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Description (optional)')}</span>
            <Textarea maxLength={500} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} />
          </label>
          {create.error && <p role="alert" className="text-sm text-critical">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t('Close')}</Button>
            <Button type="submit" disabled={create.isPending}>{t('Start competition')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── badges ─────────────

const EMPTY_BADGE: BadgeInput = { name: '', description: null, icon: 'medal', metric: 'deals_won', threshold: 1, window: 'month', active: true };

function badgeRule(t: Translator, b: Pick<BadgeRow, 'metric' | 'threshold' | 'window'>) {
  const v = b.metric === 'target_attainment' ? `${num(b.threshold)}%` : num(b.threshold);
  return t('{metric} at least {value}, {window}', { metric: t.maybe(BADGE_METRIC_LABELS[b.metric]), value: v, window: t(WINDOW_LABELS[b.window]) });
}

function Badges({ canManage, enabled }: { canManage: boolean; enabled: boolean }) {
  const t = useT();
  const badges = useBadges();
  const awards = useAwards(enabled);
  const [editing, setEditing] = useState<BadgeRow | 'new' | null>(null);
  const defaults = useGamificationMutation(() => gamificationApi.addDefaultBadges());
  const [checked, setChecked] = useState<number | null>(null);
  const evaluate = useGamificationMutation(() => gamificationApi.evaluate(), (r) => setChecked(r.awarded));
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          {enabled && <Button variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate(undefined)}>{t('Check for new badges now')}</Button>}
          <Button variant="outline" disabled={defaults.isPending} onClick={() => defaults.mutate(undefined)}>{t('Add suggested badges')}</Button>
          <Button onClick={() => setEditing('new')}>{t('New badge')}</Button>
        </div>
      )}
      {checked !== null && <p role="status" className="text-sm">{checked === 0 ? t('No new badges to award.') : t.plural('count.badgesAwarded', checked)}</p>}
      {(defaults.error || evaluate.error) && <p role="alert" className="text-sm text-critical">{(defaults.error ?? evaluate.error)!.message}</p>}
      {badges.isPending ? (
        <Skeleton className="h-40" />
      ) : !badges.data?.length ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">{t('No badges yet.')}{canManage ? ` ${t('Add the suggested ones or make your own.')}` : ''}</CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('Badges')}>
          {badges.data.map((b) => {
            const Icon = ICONS[b.icon as keyof typeof ICONS] ?? Medal;
            return (
              <li key={b.id}>
                <Card className={cn('h-full', !b.active && 'opacity-70')}>
                  <CardContent className="flex h-full gap-3 p-4">
                    <Icon className="size-8 shrink-0 text-accent" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <p className="font-medium">
                        {b.name} {!b.active && <Badge>{t('off')}</Badge>}
                      </p>
                      {b.description && <p className="text-muted-foreground">{b.description}</p>}
                      <p className="text-xs text-muted-foreground">{badgeRule(t, b)}</p>
                      <p className="text-xs text-muted-foreground">{t.plural('count.awardedTimes', b.awardedCount)}</p>
                      {canManage && (
                        <div className="mt-auto pt-1">
                          <Button size="sm" variant="outline" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>{t('Edit')}</Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Recent awards')}</CardTitle>
          </CardHeader>
          <CardContent>
            {awards.isPending ? (
              <Skeleton className="h-16" />
            ) : !awards.data?.length ? (
              <p className="text-sm text-muted-foreground">{t('No badges awarded yet. The worker checks every hour.')}</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label={t('Recent awards')}>
                {awards.data.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 py-2">
                    <span>
                      {rich(a.period !== 'all' ? t('{name} earned {badge} for {period}') : t('{name} earned {badge}'), { name: <span className="font-medium">{a.user.name}</span>, badge: a.badge.name, period: a.period })}
                    </span>
                    <span className="text-muted-foreground">{relativeTime(a.awardedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {editing && <BadgeDialog badge={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function BadgeDialog({ badge, onClose }: { badge: BadgeRow | null; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState<BadgeInput>(badge ? { name: badge.name, description: badge.description, icon: badge.icon, metric: badge.metric, threshold: badge.threshold, window: badge.window, active: badge.active } : EMPTY_BADGE);
  const save = useGamificationMutation((b: BadgeInput) => (badge ? gamificationApi.updateBadge(badge.id, b) : gamificationApi.createBadge(b)), onClose);
  const remove = useGamificationMutation(() => gamificationApi.removeBadge(badge!.id), onClose);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = (p: Partial<BadgeInput>) => setForm((f) => ({ ...f, ...p }));
  const badWindow = form.metric === 'target_attainment' && form.window === 'all_time';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-lg">
        <div>
          <DialogTitle className="text-lg font-semibold">{badge ? t('Edit badge') : t('New badge')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('A badge is awarded once per person per period when they reach the threshold. Awards already given are kept if you change it.')}</DialogDescription>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Name')}</span>
            <Input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Description')}</span>
            <Input maxLength={200} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Measure')}</span>
              <Select value={form.metric} onChange={(e) => set({ metric: e.target.value as BadgeInput['metric'] })}>
                {BADGE_METRICS.map((k) => (
                  <option key={k} value={k}>{t.maybe(BADGE_METRIC_LABELS[k])}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('At least')}</span>
              <Input type="number" required min={0.01} step="any" value={form.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Within')}</span>
              <Select value={form.window} aria-invalid={badWindow} onChange={(e) => set({ window: e.target.value as BadgeInput['window'] })}>
                {BADGE_WINDOWS.map((w) => (
                  <option key={w} value={w}>{w === 'all_time' ? t('All time') : w === 'month' ? t('One month') : w === 'quarter' ? t('One quarter') : t('One year')}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">{t('Icon')}</span>
              <Select value={form.icon} onChange={(e) => set({ icon: e.target.value as BadgeInput['icon'] })}>
                {BADGE_ICONS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </Select>
            </label>
          </div>
          {badWindow && <p role="alert" className="text-sm text-critical">{t('Target attainment needs a month, quarter or year.')}</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> {t('Award this badge')}
          </label>
          {(save.error || remove.error) && <p role="alert" className="text-sm text-critical">{(save.error ?? remove.error)!.message}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            {badge ? (
              confirmRemove ? (
                <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>
                  Delete badge and its {badge.awardedCount} {badge.awardedCount === 1 ? 'award' : 'awards'}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)}>{t('Delete')}</Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>{t('Close')}</Button>
              <Button type="submit" disabled={save.isPending || badWindow}>{t('Save badge')}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── rules and settings ─────────────

function RulesSettings() {
  const q = useGamificationSettings();
  if (q.isPending) return <Skeleton className="h-64" />;
  if (!q.data) return <p role="alert" className="text-sm text-critical">{q.error?.message}</p>;
  return <RulesForm key={q.data.updatedAt ?? 'new'} settings={q.data} />;
}

function RulesForm({ settings }: { settings: GamificationSettings }) {
  const t = useT();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [visibility, setVisibility] = useState(settings.visibility);
  const [rules, setRules] = useState<ScoringRules>(settings.rules);
  const [saved, setSaved] = useState(false);
  const save = useGamificationMutation(() => gamificationApi.saveSettings({ enabled, visibility, rules }), () => setSaved(true));
  const setRule = (k: keyof ScoringRules, p: Partial<ScoringRules[keyof ScoringRules]>) => {
    setSaved(false);
    setRules((r) => ({ ...r, [k]: { ...r[k], ...p } }));
  };
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Gamification')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => (setSaved(false), setEnabled(e.target.checked))} />
            <span className="font-medium">{t('Turn on points, leaderboards, badges and competitions')}</span>
          </label>
          <label className="block max-w-sm space-y-1">
            <span className="font-medium">{t('Who sees leaderboards')}</span>
            <Select value={visibility} onChange={(e) => (setSaved(false), setVisibility(e.target.value as typeof visibility))}>
              <option value="everyone">{t('Everyone in the workspace')}</option>
              <option value="managers">{t('Managers only (others see their own score)')}</option>
            </Select>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('What earns points')}</CardTitle>
            <InfoTip topic="gamification.rules" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{t('Scoring rules')}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">{t('Activity')}</th>
                <th scope="col" className="py-2 font-medium">{t('Counts')}</th>
                <th scope="col" className="py-2 font-medium">{t('Points')}</th>
                <th scope="col" className="py-2 font-medium">{t('Daily limit')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SCORING_RULE_KEYS.map((k) => {
                const r = rules[k];
                const label = t.maybe(SCORING_RULE_LABELS[k].label);
                return (
                  <tr key={k}>
                    <th scope="row" className="py-2 pe-3 text-start font-normal">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{t.maybe(SCORING_RULE_LABELS[k].unit)}</span>
                    </th>
                    <td className="py-2 pe-3">
                      <input type="checkbox" aria-label={t('{name} counts', { name: label })} checked={r.enabled} onChange={(e) => setRule(k, { enabled: e.target.checked })} />
                    </td>
                    <td className="py-2 pe-3">
                      <Input aria-label={t('{name} points', { name: label })} type="number" min={0} max={1000} step={1} className="h-9 w-24" value={r.points} onChange={(e) => setRule(k, { points: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="py-2">
                      {k === 'revenue_won' ? (
                        <span className="text-xs text-muted-foreground">{t('No limit')}</span>
                      ) : (
                        <Input aria-label={t('{name} daily limit', { name: label })} type="number" min={1} max={500} step={1} placeholder={t('No limit')} className="h-9 w-28" value={r.dailyCap ?? ''} onChange={(e) => setRule(k, { dailyCap: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">{t('Points are worked out from CRM records whenever someone looks, so a change here applies to every leaderboard at once. Running competitions keep the rules they started with. A daily limit stops points from bulk-logged records.')}</p>
        </CardContent>
      </Card>
      {save.error && <p role="alert" className="text-sm text-critical">{save.error.message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved ? <p role="status" className="text-sm text-success">{t('Saved.')}</p> : settings.updatedBy && <p className="text-xs text-muted-foreground">{t('Last changed by {name} {time}', { name: settings.updatedBy.name, time: settings.updatedAt ? relativeTime(settings.updatedAt) : '' })}</p>}
        <Button type="submit" disabled={save.isPending}>{t('Save rules')}</Button>
      </div>
    </form>
  );
}
