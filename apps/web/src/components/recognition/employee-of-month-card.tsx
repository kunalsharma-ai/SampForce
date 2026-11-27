'use client';

import { RECOGNITION_STATUS_LABEL, type RecognitionAwardRow, type RecognitionCard } from '@dealflow/types';
import { Button, cn, Skeleton } from '@dealflow/ui';
import { Award, CalendarClock, Crown, Download, Gift, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Confetti } from '@/components/achievements/confetti';
import { UserAvatar } from '@/components/people/user-avatar';
import { Ring, useReducedMotion } from '@/components/task-plans/progress-ring';
import { downloadFile } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { monthLabel, useRecognitionCard } from '@/lib/recognition';
import { GoalList } from './goal-list';
import './recognition.css';

/*
 * Employee of the Month on the dashboard (ADR 0102). Always there: the month, who won (or that it is still open), and
 * the person's own target with every goal counted from their records. Eligible is not the same as selected, so the
 * card says which one it is. The person's own award plays a reveal once; the full celebration comes from ADR 0090.
 */

export function EmployeeOfMonthCard({ manageLink = false, own = true }: { manageLink?: boolean; own?: boolean }) {
  const t = useT();
  const q = useRecognitionCard();
  if (q.isPending) return <Skeleton className="h-44" />;
  if (q.error || !q.data) return null;
  return <CardBody c={q.data} manageLink={manageLink} own={own} t={t} />;
}

function daysLeftInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const end = new Date(y, m, 1).getTime();
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

function CardBody({ c, manageLink, own, t }: { c: RecognitionCard; manageLink: boolean; own: boolean; t: ReturnType<typeof useT> }) {
  const still = useReducedMotion();
  const label = monthLabel(c.month, t.formatLocale);
  const target = c.target;
  const mine = c.mine;
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!mine || still) return;
    const key = `sampforce.eom.seen.${mine.id}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, '1');
    } catch {
      return;
    }
    setBurst(true);
    const h = window.setTimeout(() => setBurst(false), 4500);
    return () => window.clearTimeout(h);
  }, [mine, still]);

  const left = daysLeftInMonth(c.month);
  const status = mine ? 'AWARDED' : target?.status;
  return (
    <section className="eom-card rounded-2xl p-5 shadow-sm sm:p-6" data-eom-card aria-labelledby="eom-title">
      {burst && <Confetti style="gold" colors={['#f5c542', '#b45309', '#7f1d1d', '#fde68a']} origin={{ x: 0.2, y: 0.4 }} />}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        {/* The trophy, the month and the winner spotlight. */}
        <div className="flex min-w-0 flex-1 gap-4">
          <Trophy />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[color:color-mix(in_srgb,#b45309_70%,hsl(var(--foreground)))]">
                <Sparkles className="size-3.5" aria-hidden />
                {t('Recognition')}
              </p>
              <h2 id="eom-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                {t('Employee of the Month – {month}', { month: label })}
              </h2>
            </div>
            {mine ? (
              <div className="eom-reveal space-y-2" data-eom-mine>
                <p className="text-base font-semibold">{t('Congratulations, {name}! You have been selected as Employee of the Month for {month}.', { name: mine.person.name.split(' ')[0] ?? mine.person.name, month: label })}</p>
                <AwardFacts a={mine} t={t} />
                <Button size="sm" onClick={() => void downloadFile(`/recognition/awards/${mine.id}/certificate`, `employee-of-the-month-${mine.month}.pdf`)} data-eom-certificate>
                  <Download className="mr-1.5 size-4" aria-hidden />
                  {t('Download certificate')}
                </Button>
              </div>
            ) : c.winners.length ? (
              <div className="space-y-2" data-eom-winners>
                {c.winners.map((w) => (
                  <Winner key={w.id} a={w} t={t} />
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-eom-open>
                <CalendarClock className="size-4 shrink-0" aria-hidden />
                {left > 0 ? t('The winner is announced when the month ends. {days} days to go.', { days: left }) : t('The winner will be announced soon.')}
              </p>
            )}
            {manageLink && (
              <Link href="/app/recognition" className="inline-flex text-sm font-medium text-primary hover:underline">
                {t('Manage recognition and plans')}
              </Link>
            )}
          </div>
        </div>

        {/* The person's own target. */}
        {(own || target || c.history.length > 0) && (
        <div className="min-w-0 rounded-xl border border-border/70 bg-[hsl(var(--surface))]/75 p-4 backdrop-blur lg:w-[26rem]" data-eom-target={target?.status ?? 'NONE'}>
          {target ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Ring percent={target.achievementPercent} id={`eom-${target.id}`} size={76} stroke={8} label={t('Employee of the Month target achievement')} />
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-semibold">{target.name}</p>
                  {status && (
                    <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold', status === 'AWARDED' ? 'bg-[#f5c542]/30 text-[#7c4a03] dark:text-[#fde68a]' : status === 'ELIGIBLE' || status === 'NOT_SELECTED' ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')} data-eom-status={status}>
                      {t.maybe(RECOGNITION_STATUS_LABEL[status])}
                    </span>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {mine
                      ? t('You won this month. Well done!')
                      : target.eligible
                        ? t('Congratulations! You have achieved your Employee of the Month target.')
                        : target.status === 'ACTIVE'
                          ? t('You’re currently at {percent}% of your Employee of the Month target. Keep going!', { percent: Math.round(target.achievementPercent) })
                          : t.maybe(RECOGNITION_STATUS_LABEL[target.status])}
                  </p>
                </div>
              </div>
              {target.eligible && !mine && <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">{t('Eligible means you can be selected. The winner is chosen from the eligible people when the month ends.')}</p>}
              <GoalList goals={target.goals} currency={c.currency} compact />
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{t('Performance score: {score}', { score: Math.round(target.performance.score) })}</span>
                {target.reward && (
                  <span className="inline-flex items-center gap-1">
                    <Gift className="size-3.5" aria-hidden />
                    {t('Reward: {reward}', { reward: target.reward })}
                  </span>
                )}
                {left > 0 && <span>{t('{days} days left', { days: left })}</span>}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col justify-center gap-1 text-sm" data-eom-no-target>
              <p className="font-medium">{t('No Employee of the Month target for you this month.')}</p>
              <p className="text-muted-foreground">{t('When your manager sets one, your goals and progress show here and count by themselves from your work.')}</p>
            </div>
          )}
          {c.history.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-2 text-xs text-muted-foreground" data-eom-history>
              <Award className="size-3.5 text-[#b45309]" aria-hidden />
              {t('Your earlier awards: {months}', { months: c.history.map((h) => monthLabel(h.month, t.formatLocale)).join(', ') })}
            </p>
          )}
        </div>
        )}
      </div>
    </section>
  );
}

function Trophy() {
  return (
    <div className="relative grid size-20 shrink-0 place-items-center sm:size-24" aria-hidden>
      <span className="eom-halo absolute inset-1 rounded-full bg-[radial-gradient(circle,#fde68a_0%,transparent_70%)]" />
      <span className="absolute inset-0">
        <span className="eom-twinkle absolute left-1 top-2 size-1.5 rounded-full bg-[#fde68a]" />
        <span className="eom-twinkle absolute right-2 top-0 size-2 rounded-full bg-[#f5c542]" />
        <span className="eom-twinkle absolute bottom-3 right-0 size-1.5 rounded-full bg-[#fbbf24]" />
      </span>
      <svg viewBox="0 0 64 64" className="eom-trophy relative size-16 sm:size-20">
        <defs>
          <linearGradient id="eom-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="0.5" stopColor="#f5c542" />
            <stop offset="1" stopColor="#b7791f" />
          </linearGradient>
        </defs>
        <path d="M18 10h28v10c0 9-6 16-14 16s-14-7-14-16V10z" fill="url(#eom-gold)" />
        <path d="M18 14h-7c0 8 4 12 9 13M46 14h7c0 8-4 12-9 13" fill="none" stroke="#d4a017" strokeWidth="3" strokeLinecap="round" />
        <path d="M28 36h8v8h-8z" fill="#d4a017" />
        <path d="M20 46h24l2 8H18z" fill="#7f1d1d" />
        <path d="M32 15l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#fffbea" />
      </svg>
    </div>
  );
}

function Winner({ a, t }: { a: RecognitionAwardRow; t: ReturnType<typeof useT> }) {
  return (
    <div className="eom-spotlight eom-reveal flex items-center gap-3 rounded-xl p-3" data-eom-winner={a.person.id}>
      <span className="relative">
        <UserAvatar userId={a.person.id} name={a.person.name} className="size-12 text-sm ring-[#f5c542]" />
        <Crown className="absolute -right-1 -top-2 size-5 rotate-12 fill-[#f5c542] text-[#b7791f]" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold">{a.person.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[a.person.designation, a.scope === 'TEAM' && a.team ? a.team.name : a.person.department].filter(Boolean).join(' · ') || t('Employee of the Month – {month}', { month: monthLabel(a.month, t.formatLocale) })}
        </p>
        <AwardFacts a={a} t={t} />
      </div>
    </div>
  );
}

function AwardFacts({ a, t }: { a: RecognitionAwardRow; t: ReturnType<typeof useT> }) {
  return (
    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
      <span>{a.scope === 'TEAM' ? t('Team winner') : t('Organisation winner')}</span>
      <span>{t('{percent}% of goals', { percent: Math.round(a.achievementPercent) })}</span>
      <span>{t('Score {score}', { score: Math.round(a.score) })}</span>
      {a.reward && <span>{t('Reward: {reward}', { reward: a.reward })}</span>}
    </p>
  );
}
