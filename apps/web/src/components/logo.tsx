import { cn } from '@dealflow/ui';
import { useId } from 'react';
import './logo.css';

/** The mark's shapes, shared with the animated sign-in mark (ADR 0075) so the two can never drift apart. */
export const LOGO_PARTS = {
  streaks: [
    { x: 1, y: 19, width: 10, height: 3.4 },
    { x: -2, y: 27.5, width: 8, height: 3.4 },
    { x: 2, y: 47, width: 9, height: 3.4 },
  ],
  upper: '41,2 13,37.5 31.5,37.5 36.5,27',
  lower: '33,27 53,27 24,62 29.5,37.5',
  joined: '41,2 13,37.5 29.5,37.5 24,62 53,27 36.5,27',
  spark: 'M55 4C55.6 7.4 55.6 7.4 59 8C55.6 8.6 55.6 8.6 55 12C54.4 8.6 54.4 8.6 51 8C54.4 7.4 54.4 7.4 55 4Z',
} as const;

/**
 * SampForce mark: a two-part lightning bolt with speed streaks and a spark (Sampledge brand artwork, ADR 0055).
 * Static here; the animated original is in public/brand/sampforce-icon.svg for marketing use.
 */
export function LogoMark({ className }: { className?: string }) {
  // A unique gradient id per instance: with a shared id, a second logo on the page (the sign-in layout has one per
  // breakpoint) painted from the first, and showed nothing when the first was hidden.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const a = `sf-a-${id}`;
  const b = `sf-b-${id}`;
  const h = `sf-h-${id}`;
  return (
    <svg viewBox="-4 -1 66 66" className={cn('size-8 overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC857" />
          <stop offset="1" stopColor="#E02424" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E02424" />
          <stop offset="1" stopColor="#7F1D1D" />
        </linearGradient>
        <linearGradient id={h} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* A ring of light that bursts out when the bolt strikes; invisible otherwise. */}
      <circle cx="29" cy="32" r="27" fill="none" stroke="#E02424" strokeWidth="3" opacity="0" className="sf-part sf-ring" />
      {/* The class names only move when a parent has sf-logo-anim (the animated corner logo, logo.css). */}
      {LOGO_PARTS.streaks.map((s, i) => (
        <g key={i} className={`sf-dash sf-dash-${i}`}>
          <rect {...s} rx="1.7" fill={`url(#${i === 2 ? b : a})`} className={`sf-part sf-streak sf-streak-${i}`} />
        </g>
      ))}
      <g className="sf-bolt-hover">
        <g className="sf-part sf-bolt">
          <g className="sf-part sf-upper">
            <polygon points={LOGO_PARTS.upper} fill={`url(#${a})`} />
            <polygon points={LOGO_PARTS.upper} fill={`url(#${h})`} />
          </g>
          <g className="sf-part sf-lower">
            <polygon points={LOGO_PARTS.lower} fill={`url(#${b})`} />
            <polygon points={LOGO_PARTS.lower} fill={`url(#${h})`} opacity=".5" />
          </g>
        </g>
      </g>
      <g className="sf-spark-hover">
        <path d={LOGO_PARTS.spark} fill="#FFC857" className="sf-part sf-spark" />
      </g>
    </svg>
  );
}

/** The wordmark as it sits on SampForce red (the sign-in scenes): the logo's own dark-theme colours. */
export function LogoOnRed({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="leading-tight">
        <span className="block text-base font-semibold tracking-tight" translate="no">
          <span className="text-[color:var(--sfs-logo-a,#cbd5e1)]">Samp</span>
          <span className="sfs-logo-force bg-gradient-to-r from-[#FF8A8A] to-[#FFC857] bg-clip-text font-bold text-transparent">Force</span>
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-[color:var(--sfs-ink-mute,rgba(255,255,255,0.8))]">by Sampledge</span>
      </span>
    </span>
  );
}

/**
 * "Samp" in slate and "Force" in the brand gradient (deep red in light themes, coral to amber in dark ones).
 * `animated` is the app's top-left corner logo: it strikes in on load, twinkles at rest and jolts on hover (logo.css).
 */
export function Logo({ className, compact, animated }: { className?: string; compact?: boolean; animated?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', animated && 'sf-logo-anim', className)} data-logo-animated={animated ? 'yes' : undefined}>
      <LogoMark />
      {!compact && (
        <span className="sf-word leading-tight">
          <span className="block text-base font-semibold tracking-tight" translate="no">
            <span className="text-slate-500 dark:text-slate-400">Samp</span>
            <span className="sf-force font-bold">Force</span>
          </span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">by Sampledge</span>
        </span>
      )}
    </span>
  );
}
