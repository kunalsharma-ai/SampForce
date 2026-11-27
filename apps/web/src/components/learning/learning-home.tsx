'use client';

import type { LearningCard, MyLearningView } from '@dealflow/types';
import { Button, cn, Skeleton } from '@dealflow/ui';
import {
  Award,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  Compass,
  Flame,
  GraduationCap,
  Hourglass,
  ListChecks,
  Medal,
  PlayCircle,
  RotateCcw,
  Settings2,
  Star,
  Target,
  Trophy,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { minutesText, useCategories, useMyLearning } from '@/lib/learning';
import { Bar, CategoryChip, dateText, dueText, EmptyState, ErrorLine, LevelBadge, MATERIAL_ICON, MaterialChip, pct, Ring, StatTile, StatusBadge } from './bits';

type Tab = 'mine' | 'explore' | 'achievements';
type Filter = 'all' | 'todo' | 'progress' | 'done' | 'overdue';

/** The learner's home: what is assigned, what to explore, and the Learning Achievement Dashboard. */
export function LearningHome() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('mine');
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryId, setCategoryId] = useState('');
  const q = useMyLearning(categoryId ? { categoryId } : {});
  const categories = useCategories();
  const v = q.data;

  const cards = useMemo(() => {
    const list = v?.cards ?? [];
    return list.filter((c) => {
      if (filter === 'todo') return c.status === 'NOT_STARTED';
      if (filter === 'progress') return c.status === 'IN_PROGRESS' || c.status === 'AWAITING_MARKING' || c.status === 'FAILED';
      if (filter === 'done') return c.status === 'COMPLETED';
      if (filter === 'overdue') return c.overdue;
      return true;
    });
  }, [v, filter]);

  if (q.isLoading) return <HomeSkeleton />;
  if (q.error || !v) return <ErrorLine error={q.error ?? new Error()} />;

  const s = v.stats;
  return (
    <div className="space-y-6" data-learning-home>
      <section className="lrn-hero p-6 sm:p-8">
        <div className="relative z-10 flex flex-wrap items-center gap-6">
          <Ring percent={s.completionPercent} size={120} caption={t('Complete')} light />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
              <GraduationCap className="size-4" aria-hidden /> {t('Learning & Development')}
            </p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{s.assigned ? t('Keep levelling up') : t('Your learning starts here')}</h2>
            <p className="max-w-xl text-sm text-white/85">
              {s.assigned
                ? t('{done} of {all} modules completed. {left} still to go.', { done: s.completed, all: s.assigned, left: Math.max(0, s.assigned - s.completed) })
                : t('When your manager assigns a module it appears here. You can also explore open training below.')}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <HeroChip icon={Flame} text={t.plural('learning.streak', s.streakDays)} />
              <HeroChip icon={Clock} text={minutesText(s.learningMinutes, t)} />
              <HeroChip icon={Award} text={t.plural('learning.certificates', s.certificates)} />
              {s.overdue > 0 && <HeroChip icon={Hourglass} text={t('{n} overdue', { n: s.overdue })} warn />}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
              <Link href="/app/learning/certificates"><Award className="size-4" aria-hidden /> {t('My certificates')}</Link>
            </Button>
            {v.canManage && (
              <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                <Link href="/app/learning/manage"><Settings2 className="size-4" aria-hidden /> {t('Manage learning')}</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={ListChecks} label={t('Assigned')} value={s.assigned} from="#6366f1" to="#8b5cf6" />
        <StatTile icon={PlayCircle} label={t('In progress')} value={s.inProgress} from="#0ea5e9" to="#6366f1" />
        <StatTile icon={CheckCircle2} label={t('Completed')} value={s.completed} from="#10b981" to="#14b8a6" />
        <StatTile icon={Target} label={t('Average score')} value={pct(s.averageScore)} from="#f59e0b" to="#ef4444" />
      </div>

      <div role="tablist" aria-label={t('Learning views')} className="flex flex-wrap gap-2">
        {(
          [
            ['mine', t('My learning'), BookOpen],
            ['explore', t('Explore'), Compass],
            ['achievements', t('Achievement dashboard'), Trophy],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-transparent bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white shadow' : 'hover:bg-muted',
            )}
          >
            <Icon className="size-4" aria-hidden /> {label}
            {key === 'explore' && v.explore.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{v.explore.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'mine' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['all', t('All')],
                  ['todo', t('Not started')],
                  ['progress', t('In progress')],
                  ['done', t('Completed')],
                  ['overdue', t('Overdue')],
                ] as const
              ).map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn('rounded-full px-3 py-1 text-xs font-medium', filter === key ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                  {label}
                </button>
              ))}
              <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                {t('Category')}
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-8 rounded-md border bg-surface px-2 text-xs text-foreground">
                  <option value="">{t('All categories')}</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>{t.maybe(c.name)}</option>
                  ))}
                </select>
              </label>
            </div>
            {cards.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map((c) => <ModuleCard key={c.moduleId} c={c} />)}
              </div>
            ) : (
              <EmptyState icon={BookOpen} title={v.cards.length ? t('Nothing matches this filter') : t('No learning assigned yet')} body={v.cards.length ? undefined : t('Modules your manager assigns to you will appear here, with their deadline and progress.')} />
            )}
          </div>
          <aside className="space-y-4">
            <SideCard title={t('Upcoming deadlines')} icon={CalendarClock}>
              {v.upcoming.length ? (
                <ul className="space-y-2">
                  {v.upcoming.map((u) => (
                    <li key={u.moduleId}>
                      <Link href={`/app/learning/${u.moduleId}`} className="flex items-start justify-between gap-2 rounded-lg p-2 text-sm hover:bg-muted">
                        <span className="min-w-0 truncate font-medium">{u.title}</span>
                        <span className={cn('shrink-0 text-xs', u.overdue ? 'font-semibold text-critical' : 'text-muted-foreground')}>{dueText(t, u.dueAt, u.overdue)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('No deadlines coming up.')}</p>
              )}
            </SideCard>
            <SideCard title={t('Recent results')} icon={Star}>
              {v.results.length ? (
                <ul className="space-y-2">
                  {v.results.slice(0, 6).map((r) => (
                    <li key={r.attemptId}>
                      <Link href={`/app/learning/${r.moduleId}/attempts/${r.attemptId}`} className="flex items-center justify-between gap-2 rounded-lg p-2 text-sm hover:bg-muted">
                        <span className="min-w-0 truncate">{r.title}</span>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', r.status === 'AWAITING_MARKING' ? 'bg-muted text-muted-foreground' : r.passed ? 'bg-success/15 text-success' : 'bg-critical/15 text-critical')}>
                          {r.status === 'AWAITING_MARKING' ? t('Being marked') : pct(r.percent)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t('Your assessment results will appear here.')}</p>
              )}
            </SideCard>
          </aside>
        </div>
      )}

      {tab === 'explore' &&
        (v.explore.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {v.explore.map((c) => <ModuleCard key={c.moduleId} c={c} explore />)}
          </div>
        ) : (
          <EmptyState icon={Compass} title={t('No open training right now')} body={t('Open modules published for your part of the organisation appear here, so you can learn more than what is assigned.')} />
        ))}

      {tab === 'achievements' && <AchievementDashboard v={v} />}
    </div>
  );
}

function HeroChip({ icon: Icon, text, warn }: { icon: typeof Flame; text: string; warn?: boolean }) {
  return (
    <span className={cn('lrn-glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', warn && 'bg-amber-400/30')}>
      <Icon className="size-3.5" aria-hidden /> {text}
    </span>
  );
}

function SideCard({ title, icon: Icon, children }: { title: string; icon: typeof Flame; children: React.ReactNode }) {
  return (
    <section className="lrn-tile space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-violet-500" aria-hidden /> {title}
      </h3>
      {children}
    </section>
  );
}

export function ModuleCard({ c, explore }: { c: LearningCard; explore?: boolean }) {
  const t = useT();
  const Icon = MATERIAL_ICON[c.materialType];
  const accent = c.category?.color ?? '#7c3aed';
  const action =
    c.status === 'COMPLETED' ? t('Review') : c.status === 'FAILED' ? (c.attemptsUsed < c.attemptsAllowed ? t('Try again') : t('View result')) : c.status === 'NOT_STARTED' ? (explore ? t('Start learning') : t('Start')) : t('Continue');
  const ActionIcon = c.status === 'FAILED' ? RotateCcw : c.status === 'COMPLETED' ? CheckCircle2 : PlayCircle;
  return (
    <article className="lrn-card" style={{ ['--lrn-accent' as string]: accent }} data-module-card={c.number}>
      <div className="lrn-cover" style={c.thumbnailUrl ? { backgroundImage: `url(${c.thumbnailUrl})` } : undefined}>
        {!c.thumbnailUrl && <Icon className="absolute end-4 top-4 size-14 text-white/25" aria-hidden />}
        <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap gap-1.5">
          {c.mandatory && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold uppercase text-white">{t('Mandatory')}</span>}
          {c.isNew && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-950">{t('New')}</span>}
          {c.certificate && <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-800"><Medal className="size-3" aria-hidden />{t('Certificate')}</span>}
        </div>
        <p className="absolute bottom-2 start-3 z-10 font-mono text-[11px] text-white/85">{c.number}</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryChip category={c.category} />
          <LevelBadge level={c.level} />
        </div>
        <div>
          <h3 className="line-clamp-2 font-semibold leading-snug">{c.title}</h3>
          {c.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <MaterialChip type={c.materialType} />
          <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />{minutesText(c.estimatedMinutes, t)}</span>
          <span>{t.plural('learning.lessons', c.lessons)}</span>
        </div>
        {!explore && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <StatusBadge status={c.status} overdue={c.overdue} />
              <span className="tabular-nums text-muted-foreground">{c.progress}%</span>
            </div>
            <Bar percent={c.progress} label={t('Progress')} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span className={cn(c.overdue && 'font-semibold text-critical')}>{dueText(t, c.dueAt, c.overdue)}</span>
              {c.bestScore !== null && <span>{t('Best {score}', { score: pct(c.bestScore) })}</span>}
            </div>
          </div>
        )}
        <Button asChild className="mt-auto w-full" variant={c.status === 'COMPLETED' ? 'outline' : 'default'}>
          <Link href={`/app/learning/${c.moduleId}`}>
            <ActionIcon className="size-4" aria-hidden /> {action}
          </Link>
        </Button>
      </div>
    </article>
  );
}

/** Badges earned from real results only: each one says what it took. */
function earnedBadges(v: MyLearningView, t: ReturnType<typeof useT>) {
  const s = v.stats;
  return [
    { key: 'first', icon: Zap, title: t('First steps'), body: t('Complete your first module'), done: s.completed >= 1 },
    { key: 'five', icon: BookOpen, title: t('Bookworm'), body: t('Complete 5 modules'), done: s.completed >= 5 },
    { key: 'perfect', icon: Star, title: t('Perfect score'), body: t('Score 100% in an assessment'), done: (s.highestScore ?? 0) >= 100 },
    { key: 'high', icon: Target, title: t('High achiever'), body: t('Keep an average of 85% or more'), done: (s.averageScore ?? 0) >= 85 && s.completed >= 3 },
    { key: 'streak', icon: Flame, title: t('On a roll'), body: t('Learn 7 days in a row'), done: s.streakDays >= 7 },
    { key: 'cert', icon: Award, title: t('Certified'), body: t('Earn your first certificate'), done: s.certificates >= 1 },
    { key: 'collector', icon: Trophy, title: t('Collector'), body: t('Earn 5 certificates'), done: s.certificates >= 5 },
    { key: 'clear', icon: CheckCircle2, title: t('All clear'), body: t('Finish everything assigned to you'), done: s.assigned > 0 && s.completed >= s.assigned },
  ];
}

function AchievementDashboard({ v }: { v: MyLearningView }) {
  const t = useT();
  const s = v.stats;
  const badges = earnedBadges(v, t);
  return (
    <div className="space-y-6" data-achievement-dashboard>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={ListChecks} label={t('Modules assigned')} value={s.assigned} from="#6366f1" to="#8b5cf6" />
        <StatTile icon={CheckCircle2} label={t('Modules completed')} value={s.completed} from="#10b981" to="#14b8a6" />
        <StatTile icon={Hourglass} label={t('Pending')} value={s.pending} hint={s.awaitingMarking ? t('{n} being marked', { n: s.awaitingMarking }) : undefined} from="#f59e0b" to="#f97316" />
        <StatTile icon={CalendarClock} label={t('Overdue')} value={s.overdue} from="#ef4444" to="#db2777" />
        <StatTile icon={Star} label={t('Total marks')} value={`${s.totalMarks} / ${s.maxMarks}`} from="#8b5cf6" to="#ec4899" />
        <StatTile icon={Target} label={t('Average score')} value={pct(s.averageScore)} from="#0ea5e9" to="#6366f1" />
        <StatTile icon={Trophy} label={t('Highest score')} value={pct(s.highestScore)} from="#eab308" to="#f97316" />
        <StatTile icon={Award} label={t('Certificates earned')} value={s.certificates} from="#14b8a6" to="#0ea5e9" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="lrn-tile space-y-3">
          <h3 className="font-semibold">{t('Scores over time')}</h3>
          {v.scoreHistory.length ? <ScoreChart points={v.scoreHistory} /> : <p className="text-sm text-muted-foreground">{t('Your scores appear here after your first assessment.')}</p>}
        </section>
        <section className="lrn-tile space-y-3">
          <h3 className="font-semibold">{t('Progress by category')}</h3>
          {v.byCategory.length ? (
            <ul className="space-y-3">
              {v.byCategory.map((c) => (
                <li key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />{t.maybe(c.category)}</span>
                    <span className="text-xs text-muted-foreground">{t('{done}/{all} done · average {avg}', { done: c.completed, all: c.assigned, avg: pct(c.averageScore) })}</span>
                  </div>
                  <Bar percent={c.assigned ? (c.completed / c.assigned) * 100 : 0} label={t.maybe(c.category)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('Nothing assigned yet.')}</p>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold">{t('Badges')}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {badges.map((b) => (
            <div key={b.key} className={cn('lrn-tile flex items-center gap-3', !b.done && 'opacity-55 grayscale')} data-badge={b.key} data-earned={b.done}>
              <span className="lrn-tile-icon shrink-0" style={b.done ? { ['--lrn-from' as string]: '#f59e0b', ['--lrn-to' as string]: '#db2777' } : { ['--lrn-from' as string]: '#94a3b8', ['--lrn-to' as string]: '#64748b' }}>
                <b.icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{b.title}</p>
                <p className="text-xs text-muted-foreground">{b.done ? t('Earned') : b.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lrn-tile space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t('Certificates')}</h3>
          <Link href="/app/learning/certificates" className="text-sm font-medium text-primary hover:underline">{t('See all')}</Link>
        </div>
        {v.certificates.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {v.certificates.slice(0, 4).map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border p-3">
                <Medal className="size-6 shrink-0 text-amber-500" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.moduleTitle}</p>
                  <p className="text-xs text-muted-foreground">{c.number} · {dateText(c.issuedAt)} · {pct(c.score)}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Pass a module that awards a certificate to earn your first one.')}</p>
        )}
      </section>
    </div>
  );
}

/** A small line chart of scores (oldest first). */
function ScoreChart({ points }: { points: { at: string; percent: number; title: string }[] }) {
  const t = useT();
  const w = 520;
  const h = 180;
  const pad = 24;
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (points.length - 1));
  const y = (p: number) => h - pad - (p / 100) * (h - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.percent)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${h - pad} L${x(0)},${h - pad} Z`;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={t('Scores over time')}>
        <defs>
          <linearGradient id="lrn-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="hsl(var(--border))" strokeDasharray="3 4" />
            <text x={4} y={y(g) + 4} fontSize="10" fill="hsl(var(--muted-foreground))">{g}</text>
          </g>
        ))}
        <path d={area} fill="url(#lrn-area)" />
        <path d={line} fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.percent)} r="4" fill="#fff" stroke="#8b5cf6" strokeWidth="2">
            <title>{`${p.title}: ${Math.round(p.percent)}% (${dateText(p.at)})`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48 rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}
