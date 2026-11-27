'use client';

import type { MessageKey } from '@/lib/i18n';
import { useT } from '@/lib/i18n';
import { useEffect, useState } from 'react';

/*
 * Progress drawn as a ring (ADR 0096). The ring fills to the real percentage, from the records; past 100% a gold
 * second lap shows how far the target was exceeded. Colours follow the milestones Kunal asked for: early progress
 * (30%), halfway (50%), near completion (75%), achieved (100%) and exceeded (above 100%).
 */

export type Milestone = 'START' | 'EARLY' | 'HALF' | 'NEAR' | 'DONE' | 'EXCEEDED';

export function milestoneOf(percent: number): Milestone {
  if (percent > 100) return 'EXCEEDED';
  if (percent >= 100) return 'DONE';
  if (percent >= 75) return 'NEAR';
  if (percent >= 50) return 'HALF';
  if (percent >= 30) return 'EARLY';
  return 'START';
}

export const MILESTONE_LABEL: Record<Milestone, MessageKey> = {
  START: 'Getting started',
  EARLY: 'Early progress',
  HALF: 'Halfway milestone',
  NEAR: 'Near completion',
  DONE: 'Target achieved',
  EXCEEDED: 'Target exceeded',
};

/** Two stops per milestone, for the ring's gradient and the chips. */
export const MILESTONE_COLORS: Record<Milestone, [string, string]> = {
  START: ['#64748b', '#94a3b8'],
  EARLY: ['#d97706', '#fbbf24'],
  HALF: ['#0284c7', '#38bdf8'],
  NEAR: ['#7c3aed', '#a78bfa'],
  DONE: ['#059669', '#34d399'],
  EXCEEDED: ['#b45309', '#facc15'],
};

/** A milestone colour as text: mixed with the theme's text colour, so it stays readable in light and dark themes. */
export const readable = (c: string) => `color-mix(in srgb, ${c} 50%, hsl(var(--foreground)))`;

/** True when the person asked the system (or SampForce) for less motion. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const set = () => setReduce(q.matches || document.documentElement.dataset.motion === 'reduced');
    set();
    q.addEventListener?.('change', set);
    return () => q.removeEventListener?.('change', set);
  }, []);
  return reduce;
}

/** Counts from 0 up to the value once, then follows it; shows the value at once with reduced motion. */
export function useCountTo(value: number, still: boolean, ms = 900): number {
  const [shown, setShown] = useState(still ? value : 0);
  useEffect(() => {
    if (still) {
      setShown(value);
      return;
    }
    let raf = 0;
    const from = shown;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      setShown(from + (value - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, still, ms]);
  return shown;
}

export function Ring({
  percent,
  size = 88,
  stroke = 9,
  label,
  caption,
  id,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  /** Read out with the percentage (what is measured). */
  label: string;
  /** Small text under the percentage inside the ring. */
  caption?: string;
  id: string;
}) {
  const t = useT();
  const still = useReducedMotion();
  const [drawn, setDrawn] = useState(still ? percent : 0);
  useEffect(() => {
    if (still) {
      setDrawn(percent);
      return;
    }
    const h = requestAnimationFrame(() => setDrawn(percent));
    return () => cancelAnimationFrame(h);
  }, [percent, still]);
  const shown = Math.round(useCountTo(percent, still));
  const m = milestoneOf(percent);
  const [c1, c2] = MILESTONE_COLORS[m];
  const r = 50 - stroke / 2 - 1;
  const len = 2 * Math.PI * r;
  const first = Math.min(100, Math.max(0, drawn));
  const extra = Math.min(100, Math.max(0, drawn - 100));
  const gid = `ring-${id.replace(/[^a-z0-9]/gi, '')}`;
  const text = `${shown}%`;
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={t('{percent}%: {state}', { percent: Math.round(percent), state: t(MILESTONE_LABEL[m]) })}
      data-ring={m}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={`url(#${gid})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - first / 100)}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-out"
        />
        {extra > 0 && (
          <circle
            cx="50" cy="50" r={r - stroke - 1} fill="none" stroke="#facc15" strokeWidth={Math.max(3, stroke - 4)} strokeLinecap="round"
            strokeDasharray={2 * Math.PI * (r - stroke - 1)} strokeDashoffset={2 * Math.PI * (r - stroke - 1) * (1 - extra / 100)}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:delay-700 motion-safe:duration-700"
          />
        )}
        {[30, 50, 75].map((p) => {
          const a = (p / 100) * Math.PI * 2;
          return <circle key={p} cx={50 + Math.cos(a) * r} cy={50 + Math.sin(a) * r} r={stroke / 4} fill={percent >= p ? '#fff' : 'hsl(var(--border))'} />;
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div className="max-w-[70%] leading-tight">
          <div className="font-bold tabular-nums" style={{ fontSize: Math.round(size * (text.length > 3 ? 0.19 : 0.24)), color: readable(c1) }}>
            {text}
          </div>
          {caption && (
            <div className="truncate text-muted-foreground" style={{ fontSize: Math.max(9, Math.round(size * 0.11)) }}>
              {caption}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A coloured chip naming the milestone reached. */
export function MilestoneChip({ percent }: { percent: number }) {
  const t = useT();
  const m = milestoneOf(percent);
  const [c1] = MILESTONE_COLORS[m];
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold"
      style={{ color: readable(c1), backgroundColor: `color-mix(in srgb, ${c1} 14%, transparent)` }}
      data-milestone={m}
    >
      {t(MILESTONE_LABEL[m])}
    </span>
  );
}

/** A straight progress bar in the milestone colours, for tables. */
export function Bar({ percent, label }: { percent: number; label: string }) {
  const m = milestoneOf(percent);
  const [c1, c2] = MILESTONE_COLORS[m];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(percent, 100))}>
      <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundImage: `linear-gradient(90deg, ${c1}, ${c2})` }} />
    </div>
  );
}
