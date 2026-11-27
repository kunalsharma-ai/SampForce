'use client';

import type { AchievementLevel, AchievementRow } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { ArrowRight, X } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { achievementCopy } from './copy';
import { DrawnCheck, LevelMark, ProgressRing, SceneArt, type SceneSpec } from './scenes';
import './celebrations.css';

export function useLevelLabel(): (level: AchievementLevel) => string {
  const t = useT();
  return (level) =>
    ({ ROUTINE: t('Nice work'), DAILY: t('Daily milestone'), MAJOR: t('Major achievement'), EXCEPTIONAL: t('Exceptional milestone') })[level];
}

/**
 * One achievement, drawn in its own scene. `still` shows the final frame without motion (reduced motion, and the
 * history page, which never replays a celebration). `onClose` adds the close button and, with `ms`, the timer bar.
 */
export function CelebrationCard({
  a,
  scene,
  still,
  onClose,
  ms,
  className,
}: {
  a: AchievementRow;
  scene: SceneSpec;
  still: boolean;
  onClose?: () => void;
  ms?: number;
  className?: string;
}) {
  const t = useT();
  const levelLabel = useLevelLabel();
  const copy = achievementCopy(a, t);
  const view = a.link ? (
    <Link
      href={a.link}
      onClick={onClose}
      className="inline-flex items-center gap-1 rounded-md px-1 text-sm font-semibold sfc-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copy.linkLabel} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  ) : null;
  const close = onClose ? (
    <button
      type="button"
      onClick={onClose}
      aria-label={t('Close celebration')}
      className="grid size-8 shrink-0 place-items-center rounded-full text-current opacity-80 transition hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="size-4" aria-hidden />
    </button>
  ) : null;
  const timer = onClose && ms ? (
    <div className="h-1 w-full bg-[color-mix(in_srgb,var(--c1)_15%,transparent)]" aria-hidden>
      <div className="sfc-timer h-full bg-[var(--c1)]" style={{ ['--sfc-ms' as string]: `${ms}ms` }} />
    </div>
  ) : null;
  const common = { 'data-tone': scene.tone, 'data-kind': a.kind, 'data-level': a.level, 'data-sfc-still': still ? '' : undefined, 'data-celebration': a.id } as const;

  if (scene.layout === 'toast') {
    return (
      <section {...common} aria-label={copy.title} className={cn('sfc sfc-enter sfc-glow pointer-events-auto w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-[hsl(var(--surface))] text-foreground', className)}>
        <div className="flex items-center gap-3 p-3">
          <div className="shrink-0"><DrawnCheck size={40} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold sfc-accent">{copy.title}</h2>
            <p className="truncate text-sm text-muted-foreground">{copy.message}</p>
            {copy.facts.map((f) => (
              <p key={f.label} className="truncate text-xs text-muted-foreground">{f.label}: {f.value}</p>
            ))}
          </div>
          {close}
        </div>
        {timer}
      </section>
    );
  }

  if (scene.layout === 'compact') {
    return (
      <section {...common} aria-label={copy.title} className={cn('sfc sfc-enter sfc-glow pointer-events-auto w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-[hsl(var(--surface))] text-foreground', className)}>
        <div className="flex items-center gap-4 p-4">
          <ProgressRing percent={a.details.percent ?? 0} from={Math.max(0, (a.details.percent ?? 25) - 25)} size={84} still={still} light={false} label={`${a.details.actual ?? 0}/${a.details.target ?? 0}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{levelLabel(a.level)}</p>
            <h2 className="text-base font-bold leading-snug">{copy.title}</h2>
            <p className="text-sm text-muted-foreground">{copy.message}</p>
            <div className="mt-1">{view}</div>
          </div>
          <div className="self-start">{close}</div>
        </div>
        {timer}
      </section>
    );
  }

  const stage = scene.layout === 'stage';
  return (
    <section
      {...common}
      aria-label={copy.title}
      className={cn(
        'sfc sfc-glow pointer-events-auto overflow-hidden rounded-3xl border bg-[hsl(var(--surface))] text-foreground',
        stage ? 'sfc-enter-full w-[min(30rem,calc(100vw-2rem))]' : 'sfc-enter w-[min(27rem,calc(100vw-2rem))]',
        className,
      )}
    >
      <div className={cn('sfc-band relative px-4 pt-3', stage ? 'pb-4' : 'pb-2')}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur">
            <LevelMark level={a.level} /> {levelLabel(a.level)}
          </span>
          {close}
        </div>
        <div className={cn('mx-auto', stage ? 'max-w-[20rem]' : 'max-w-[17rem]')}>
          <SceneArt a={a} still={still} />
        </div>
      </div>
      <div className="space-y-3 px-5 pb-4 pt-4">
        <div className="sfc-rise">
          <h2 className={cn('font-extrabold leading-tight tracking-tight', stage ? 'text-2xl' : 'text-xl')}>{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.message}</p>
        </div>
        {copy.facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-2">
            {copy.facts.map((f) => (
              <div key={f.label} className="sfc-chip min-w-0 rounded-xl px-3 py-2">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd className="truncate text-sm font-semibold" title={f.value}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {copy.note && <p className="rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">{copy.note}</p>}
        {view && <div className="flex justify-end">{view}</div>}
      </div>
      {timer}
    </section>
  );
}
