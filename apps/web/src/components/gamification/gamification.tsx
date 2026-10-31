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

const ICONS = { trophy: Trophy, medal: Medal, star: Star, flame: Flame, target: Target, rocket: Rocket, crown: Crown, phone: Phone } as const;
const WINDOW_LABELS: Record<(typeof BADGE_WINDOWS)[number], string> = { month: 'in a month', quarter: 'in a quarter', year: 'in a year', all_time: 'all time' };
const STATUS_TONE = { running: 'success', upcoming: 'primary', finished: 'neutral', cancelled: 'critical' } as const;
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

type Tab = 'me' | 'leaderboards' | 'competitions' | 'badges' | 'settings';

export function GamificationWorkspace() {
  const me = useGamificationMe();
  const [tab, setTab] = useState<Tab | null>(null);
  if (me.isPending) return <Skeleton className="h-64" />;
  if (me.error || !me.data) return <p role="alert" className="text-sm text-critical">{me.error?.message ?? 'Could not load gamification.'}</p>;
  const m = me.data;
  const tabs: { key: Tab; label: string }[] = m.enabled
    ? [
        { key: 'me', label: 'My performance' },
        { key: 'leaderboards', label: 'Leaderboards' },
        { key: 'competitions', label: 'Competitions' },
        { key: 'badges', label: 'Badges' },
        ...(m.canManage ? [{ key: 'settings' as const, label: 'Rules and settings' }] : []),
      ]
    : m.canManage
      ? [{ key: 'settings', label: 'Rules and settings' }, { key: 'badges', label: 'Badges' }]
      : [];
  const current = tab && tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? null);

  return (
    <div className="space-y-4">
      {!m.enabled && (
        <Card>
          <CardContent className="p-5 text-sm">
            <p className="font-medium">Gamification is turned off for this workspace.</p>
            <p className="mt-1 text-muted-foreground">
              {m.canManage ? 'Choose which activities earn points and set up badges, then turn it on in Rules and settings. Nobody sees points until you do.' : 'An admin or sales manager can turn it on and choose which activities earn points.'}
            </p>
          </CardContent>
        </Card>
      )}
      {tabs.length > 0 && (
        <div role="tablist" aria-label="Gamification" className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              id={`gm-tab-${t.key}`}
              aria-selected={current === t.key}
              aria-controls={`gm-panel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', current === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {t.label}
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
  const s = me.score;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Points this month</p>
            <p className="mt-1 text-3xl font-semibold" data-testid="my-points">{num(s?.points ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Leaderboard position</p>
            <p className="mt-1 text-3xl font-semibold">{s ? `#${s.rank}` : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Badges earned</p>
            <p className="mt-1 text-3xl font-semibold">{me.badges.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How you earned your points</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Points by activity this month</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 font-medium">Activity</th>
                  <th scope="col" className="py-2 text-right font-medium">Done</th>
                  <th scope="col" className="py-2 text-right font-medium">Counted</th>
                  <th scope="col" className="py-2 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(s?.breakdown ?? []).filter((b) => b.count > 0 || b.points > 0).map((b) => (
                  <tr key={b.key}>
                    <th scope="row" className="py-2 text-left font-normal">{b.key === 'revenue_won' ? 'Revenue won (per 1,000)' : SCORING_RULE_LABELS[b.key].label}</th>
                    <td className="py-2 text-right">{num(b.count)}</td>
                    <td className="py-2 text-right">{b.scored < b.count ? <span title="Above the daily limit or not counted under the current rules">{num(b.scored)}</span> : num(b.scored)}</td>
                    <td className="py-2 text-right font-medium">{num(b.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!s?.breakdown.some((b) => b.count > 0) && <p className="py-3 text-sm text-muted-foreground">Nothing yet this month. Log calls and meetings, complete tasks and win deals to earn points.</p>}
            <p className="mt-3 text-xs text-muted-foreground">Points come straight from your CRM records under your workspace&apos;s rules. &quot;Counted&quot; is lower when a daily limit applies.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales target progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {me.targets.map((t) => (
              <div key={t.period} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{t.period}</span>
                  <span className="text-muted-foreground">{t.target === null ? `${formatMoney(t.won, me.currency)} won, no target set` : `${formatMoney(t.won, me.currency)} of ${formatMoney(t.target, me.currency)} (${num(t.attainment ?? 0)}%)`}</span>
                </div>
                {t.target !== null && <Meter value={t.attainment ?? 0} label={`${t.period} target progress`} />}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Targets are set in Revenue Intelligence. Won revenue is in {me.currency}, using your exchange rates.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your badges</CardTitle>
          </CardHeader>
          <CardContent>
            {me.badges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No badges yet.</p>
            ) : (
              <ul className="space-y-2" aria-label="Your badges">
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
            <CardTitle className="text-base">Your competitions</CardTitle>
          </CardHeader>
          <CardContent>
            {me.competitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">You are not in a running competition.</p>
            ) : (
              <ul className="space-y-3" aria-label="Your competitions">
                {me.competitions.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {c.mine ? `${c.kind === 'team' ? `${c.mine.name}: ` : ''}#${c.mine.rank} with ${metricValue(c, c.mine.value, me.currency)}` : `Starts ${formatDate(c.start)}`}
                      {c.goal && c.mine ? ` · ${num(c.mine.progress ?? 0)}% of the goal` : ''}
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

function metricValue(c: Pick<CompetitionRow, 'metric'>, v: number, currency: string) {
  if (c.metric === 'revenue_won') return formatMoney(v, currency);
  if (c.metric === 'points') return `${num(v)} points`;
  if (c.metric === 'deals_won') return `${num(v)} won deals`;
  return `${num(v)} activities`;
}

// ───────────── leaderboards ─────────────

function Leaderboards() {
  const options = periodOptions();
  const [period, setPeriod] = useState(options[0]!.value);
  const [view, setView] = useState<'people' | 'teams'>('people');
  const q = useLeaderboard(period);
  const b = q.data;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Leaderboard</CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Rank" className="inline-flex rounded-md border border-border p-0.5 text-sm">
            {(['people', 'teams'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded px-3 py-1', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {v === 'people' ? 'People' : 'Teams'}
              </button>
            ))}
          </div>
          <label className="space-y-1 text-sm">
            <span className="block text-xs text-muted-foreground">Period</span>
            <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-56">
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
            {!b.full && <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">Your workspace shows leaderboards to managers only, so you see your own score.</p>}
            {b.missingRates > 0 && <p className="mb-3 text-sm text-warning">{b.missingRates} won {b.missingRates === 1 ? 'deal is' : 'deals are'} left out of revenue because {b.missingRates === 1 ? 'its currency has' : 'their currencies have'} no exchange rate yet.</p>}
            {view === 'people' ? (
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">People ranked by points, {b.period.label}</caption>
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 font-medium">Rank</th>
                    <th scope="col" className="py-2 font-medium">Name</th>
                    <th scope="col" className="py-2 text-right font-medium">Points</th>
                    <th scope="col" className="py-2 text-right font-medium">Deals won</th>
                    <th scope="col" className="py-2 text-right font-medium">Revenue won</th>
                    <th scope="col" className="py-2 text-right font-medium">Activities</th>
                    <th scope="col" className="py-2 text-right font-medium">Target</th>
                    <th scope="col" className="py-2 text-right font-medium">Badges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.people.map((p) => (
                    <tr key={p.user.id}>
                      <td className="py-2">{p.rank <= 3 && p.points > 0 ? <span className="inline-flex items-center gap-1"><Trophy className={cn('size-4', p.rank === 1 ? 'text-warning' : 'text-muted-foreground')} aria-hidden />{p.rank}</span> : p.rank}</td>
                      <th scope="row" className="py-2 text-left font-medium">{p.user.name}</th>
                      <td className="py-2 text-right font-semibold">{num(p.points)}</td>
                      <td className="py-2 text-right">{p.dealsWon}</td>
                      <td className="py-2 text-right">{formatMoney(p.revenueWon, b.currency)}</td>
                      <td className="py-2 text-right">{p.activities}</td>
                      <td className="py-2 text-right">{p.attainment === null ? '—' : `${num(p.attainment)}%`}</td>
                      <td className="py-2 text-right">{p.badges}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : b.teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">{b.full ? 'No sales teams yet. An admin can create them in Team Management.' : 'Team rankings are shown to managers only.'}</p>
            ) : (
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Teams ranked by points, {b.period.label}</caption>
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 font-medium">Rank</th>
                    <th scope="col" className="py-2 font-medium">Team</th>
                    <th scope="col" className="py-2 text-right font-medium">Points</th>
                    <th scope="col" className="py-2 text-right font-medium">Per member</th>
                    <th scope="col" className="py-2 text-right font-medium">Members</th>
                    <th scope="col" className="py-2 text-right font-medium">Deals won</th>
                    <th scope="col" className="py-2 text-right font-medium">Revenue won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.teams.map((t) => (
                    <tr key={t.team.id}>
                      <td className="py-2">{t.rank}</td>
                      <th scope="row" className="py-2 text-left font-medium">{t.team.name}</th>
                      <td className="py-2 text-right font-semibold">{num(t.points)}</td>
                      <td className="py-2 text-right">{num(t.perMember)}</td>
                      <td className="py-2 text-right">{t.members}</td>
                      <td className="py-2 text-right">{t.dealsWon}</td>
                      <td className="py-2 text-right">{formatMoney(t.revenueWon, b.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {b.period.start} to {formatDate(new Date(Date.parse(`${b.period.end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}. Daily limits use UTC days. Revenue is in {b.currency}.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ───────────── competitions and team challenges ─────────────

function Competitions({ canManage, currency }: { canManage: boolean; currency: string }) {
  const q = useCompetitions();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const cancel = useGamificationMutation((id: string) => gamificationApi.cancelCompetition(id), () => setConfirm(null));
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>New competition</Button>
        </div>
      )}
      {cancel.error && <p role="alert" className="text-sm text-critical">{cancel.error.message}</p>}
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <p role="alert" className="text-sm text-critical">{q.error.message}</p>
      ) : !q.data?.length ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">No competitions yet.{canManage ? ' Start one for a month or quarter, for people or for teams.' : ''}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((c) => (
            <Card key={c.id}>
              <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {c.kind === 'team' ? 'Team challenge' : 'Individual'} · {COMPETITION_METRIC_LABELS[c.metric]} · {formatDate(c.start)} to {formatDate(c.end)}
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {c.description && <p>{c.description}</p>}
                {(c.goal || c.reward) && (
                  <p className="text-muted-foreground">
                    {c.goal ? `Goal: ${metricValue(c, c.goal, currency)}${c.kind === 'team' ? ' per team' : ''}` : ''}
                    {c.goal && c.reward ? ' · ' : ''}
                    {c.reward ? `Reward: ${c.reward}` : ''}
                  </p>
                )}
                {c.status === 'upcoming' ? (
                  <p className="text-muted-foreground">Standings appear when it starts.</p>
                ) : c.standings.length === 0 ? (
                  <p className="text-muted-foreground">No standings to show.</p>
                ) : (
                  <ol className="space-y-2" aria-label={`Standings for ${c.name}`}>
                    {c.standings.map((s) => (
                      <li key={s.id} className={cn('space-y-1', c.mine?.id === s.id && 'font-medium')}>
                        <div className="flex justify-between gap-2">
                          <span>
                            {s.rank}. {s.name}
                            {c.mine?.id === s.id && <span className="sr-only"> (you)</span>}
                          </span>
                          <span>{metricValue(c, s.value, currency)}{s.progress !== null ? ` · ${num(s.progress)}%` : ''}</span>
                        </div>
                        {s.progress !== null && <Meter value={s.progress} label={`${s.name} progress towards the goal`} />}
                      </li>
                    ))}
                  </ol>
                )}
                <p className="text-xs text-muted-foreground">Scored with the rules in place when it was created{c.createdBy ? `, by ${c.createdBy.name}` : ''}.</p>
                {canManage && (c.status === 'running' || c.status === 'upcoming') && (
                  <div className="flex gap-2">
                    {confirm === c.id ? (
                      <>
                        <Button size="sm" variant="destructive" disabled={cancel.isPending} onClick={() => cancel.mutate(c.id)}>Confirm cancel</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirm(c.id)}>Cancel competition</Button>
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
  const teams = useTeams();
  const options = periodOptions().filter((o) => !/^Last/.test(o.label));
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
          <DialogTitle className="text-lg font-semibold">New competition</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Participants are notified in DealFlow. It uses a copy of today&apos;s scoring rules, so later rule changes do not move its standings.</DialogDescription>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Name</span>
            <Input required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Who competes</span>
              <Select value={form.kind} onChange={(e) => set({ kind: e.target.value as CompetitionInput['kind'] })}>
                <option value="individual">People</option>
                <option value="team">Teams (team challenge)</option>
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Measure</span>
              <Select value={form.metric} onChange={(e) => set({ metric: e.target.value as CompetitionInput['metric'] })}>
                {COMPETITION_METRICS.map((k) => (
                  <option key={k} value={k}>{COMPETITION_METRIC_LABELS[k]}</option>
                ))}
              </Select>
            </label>
          </div>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium">When</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Custom dates
            </label>
            {custom ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span>First day</span>
                  <Input type="date" required value={form.startDate ?? ''} onChange={(e) => set({ startDate: e.target.value })} />
                </label>
                <label className="block space-y-1">
                  <span>Last day</span>
                  <Input type="date" required value={form.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value })} />
                </label>
              </div>
            ) : (
              <Select aria-label="Competition period" value={form.period ?? ''} onChange={(e) => set({ period: e.target.value })}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            )}
          </fieldset>
          {form.kind === 'team' || form.teamIds.length > 0 || (teams.data?.length ?? 0) > 0 ? (
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium">Teams</legend>
              <p className="text-xs text-muted-foreground">{form.kind === 'team' ? 'Leave all unticked to include every team.' : 'Optional: only members of the ticked teams take part.'}</p>
              {teams.data?.length ? (
                teams.data.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input type="checkbox" checked={form.teamIds.includes(t.id)} onChange={(e) => set({ teamIds: e.target.checked ? [...form.teamIds, t.id] : form.teamIds.filter((x) => x !== t.id) })} />
                    {t.name} <span className="text-muted-foreground">({t.members.length})</span>
                  </label>
                ))
              ) : (
                <p className="text-muted-foreground">No sales teams yet. An admin can create them in Team Management.</p>
              )}
            </fieldset>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Goal (optional)</span>
              <Input type="number" min={1} step="any" value={form.goal ?? ''} onChange={(e) => set({ goal: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Reward (optional)</span>
              <Input maxLength={200} value={form.reward ?? ''} onChange={(e) => set({ reward: e.target.value || null })} placeholder="Team lunch" />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Description (optional)</span>
            <Textarea maxLength={500} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} />
          </label>
          {create.error && <p role="alert" className="text-sm text-critical">{create.error.message}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button type="submit" disabled={create.isPending}>Start competition</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── badges ─────────────

const EMPTY_BADGE: BadgeInput = { name: '', description: null, icon: 'medal', metric: 'deals_won', threshold: 1, window: 'month', active: true };

function badgeRule(b: Pick<BadgeRow, 'metric' | 'threshold' | 'window'>) {
  const v = b.metric === 'target_attainment' ? `${num(b.threshold)}%` : num(b.threshold);
  return `${BADGE_METRIC_LABELS[b.metric]} at least ${v}, ${WINDOW_LABELS[b.window]}`;
}

function Badges({ canManage, enabled }: { canManage: boolean; enabled: boolean }) {
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
          {enabled && <Button variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate(undefined)}>Check for new badges now</Button>}
          <Button variant="outline" disabled={defaults.isPending} onClick={() => defaults.mutate(undefined)}>Add suggested badges</Button>
          <Button onClick={() => setEditing('new')}>New badge</Button>
        </div>
      )}
      {checked !== null && <p role="status" className="text-sm">{checked === 0 ? 'No new badges to award.' : `${checked} new ${checked === 1 ? 'badge' : 'badges'} awarded.`}</p>}
      {(defaults.error || evaluate.error) && <p role="alert" className="text-sm text-critical">{(defaults.error ?? evaluate.error)!.message}</p>}
      {badges.isPending ? (
        <Skeleton className="h-40" />
      ) : !badges.data?.length ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">No badges yet.{canManage ? ' Add the suggested ones or make your own.' : ''}</CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Badges">
          {badges.data.map((b) => {
            const Icon = ICONS[b.icon as keyof typeof ICONS] ?? Medal;
            return (
              <li key={b.id}>
                <Card className={cn('h-full', !b.active && 'opacity-70')}>
                  <CardContent className="flex h-full gap-3 p-4">
                    <Icon className="size-8 shrink-0 text-accent" aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      <p className="font-medium">
                        {b.name} {!b.active && <Badge>off</Badge>}
                      </p>
                      {b.description && <p className="text-muted-foreground">{b.description}</p>}
                      <p className="text-xs text-muted-foreground">{badgeRule(b)}</p>
                      <p className="text-xs text-muted-foreground">Awarded {b.awardedCount} {b.awardedCount === 1 ? 'time' : 'times'}</p>
                      {canManage && (
                        <div className="mt-auto pt-1">
                          <Button size="sm" variant="outline" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}>Edit</Button>
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
            <CardTitle className="text-base">Recent awards</CardTitle>
          </CardHeader>
          <CardContent>
            {awards.isPending ? (
              <Skeleton className="h-16" />
            ) : !awards.data?.length ? (
              <p className="text-sm text-muted-foreground">No badges awarded yet. The worker checks every hour.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Recent awards">
                {awards.data.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{a.user.name}</span> earned {a.badge.name}
                      {a.period !== 'all' ? ` for ${a.period}` : ''}
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
          <DialogTitle className="text-lg font-semibold">{badge ? 'Edit badge' : 'New badge'}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">A badge is awarded once per person per period when they reach the threshold. Awards already given are kept if you change it.</DialogDescription>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Name</span>
            <Input required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Description</span>
            <Input maxLength={200} value={form.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Measure</span>
              <Select value={form.metric} onChange={(e) => set({ metric: e.target.value as BadgeInput['metric'] })}>
                {BADGE_METRICS.map((k) => (
                  <option key={k} value={k}>{BADGE_METRIC_LABELS[k]}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">At least</span>
              <Input type="number" required min={0.01} step="any" value={form.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Within</span>
              <Select value={form.window} aria-invalid={badWindow} onChange={(e) => set({ window: e.target.value as BadgeInput['window'] })}>
                {BADGE_WINDOWS.map((w) => (
                  <option key={w} value={w}>{w === 'all_time' ? 'All time' : `One ${w}`}</option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Icon</span>
              <Select value={form.icon} onChange={(e) => set({ icon: e.target.value as BadgeInput['icon'] })}>
                {BADGE_ICONS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </Select>
            </label>
          </div>
          {badWindow && <p role="alert" className="text-sm text-critical">Target attainment needs a month, quarter or year.</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> Award this badge
          </label>
          {(save.error || remove.error) && <p role="alert" className="text-sm text-critical">{(save.error ?? remove.error)!.message}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            {badge ? (
              confirmRemove ? (
                <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>
                  Delete badge and its {badge.awardedCount} {badge.awardedCount === 1 ? 'award' : 'awards'}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => setConfirmRemove(true)}>Delete</Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
              <Button type="submit" disabled={save.isPending || badWindow}>Save badge</Button>
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
          <CardTitle className="text-base">Gamification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => (setSaved(false), setEnabled(e.target.checked))} />
            <span className="font-medium">Turn on points, leaderboards, badges and competitions</span>
          </label>
          <label className="block max-w-sm space-y-1">
            <span className="font-medium">Who sees leaderboards</span>
            <Select value={visibility} onChange={(e) => (setSaved(false), setVisibility(e.target.value as typeof visibility))}>
              <option value="everyone">Everyone in the workspace</option>
              <option value="managers">Managers only (others see their own score)</option>
            </Select>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What earns points</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Scoring rules</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">Activity</th>
                <th scope="col" className="py-2 font-medium">Counts</th>
                <th scope="col" className="py-2 font-medium">Points</th>
                <th scope="col" className="py-2 font-medium">Daily limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SCORING_RULE_KEYS.map((k) => {
                const r = rules[k];
                const label = SCORING_RULE_LABELS[k].label;
                return (
                  <tr key={k}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-xs text-muted-foreground">{SCORING_RULE_LABELS[k].unit}</span>
                    </th>
                    <td className="py-2 pr-3">
                      <input type="checkbox" aria-label={`${label} counts`} checked={r.enabled} onChange={(e) => setRule(k, { enabled: e.target.checked })} />
                    </td>
                    <td className="py-2 pr-3">
                      <Input aria-label={`${label} points`} type="number" min={0} max={1000} step={1} className="h-9 w-24" value={r.points} onChange={(e) => setRule(k, { points: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="py-2">
                      {k === 'revenue_won' ? (
                        <span className="text-xs text-muted-foreground">No limit</span>
                      ) : (
                        <Input aria-label={`${label} daily limit`} type="number" min={1} max={500} step={1} placeholder="No limit" className="h-9 w-28" value={r.dailyCap ?? ''} onChange={(e) => setRule(k, { dailyCap: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">Points are worked out from CRM records whenever someone looks, so a change here applies to every leaderboard at once. Running competitions keep the rules they started with. A daily limit stops points from bulk-logged records.</p>
        </CardContent>
      </Card>
      {save.error && <p role="alert" className="text-sm text-critical">{save.error.message}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved ? <p role="status" className="text-sm text-success">Saved.</p> : settings.updatedBy && <p className="text-xs text-muted-foreground">Last changed by {settings.updatedBy.name} {settings.updatedAt ? relativeTime(settings.updatedAt) : ''}</p>}
        <Button type="submit" disabled={save.isPending}>Save rules</Button>
      </div>
    </form>
  );
}
