import { cn } from '@dealflow/ui';
import { useId } from 'react';

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
    <svg viewBox="-4 -1 66 66" className={cn('size-8', className)} aria-hidden>
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
      <rect x="1" y="19" width="10" height="3.4" rx="1.7" fill={`url(#${a})`} />
      <rect x="-2" y="27.5" width="8" height="3.4" rx="1.7" fill={`url(#${a})`} />
      <rect x="2" y="47" width="9" height="3.4" rx="1.7" fill={`url(#${b})`} />
      <polygon points="41,2 13,37.5 31.5,37.5 36.5,27" fill={`url(#${a})`} />
      <polygon points="41,2 13,37.5 31.5,37.5 36.5,27" fill={`url(#${h})`} />
      <polygon points="33,27 53,27 24,62 29.5,37.5" fill={`url(#${b})`} />
      <polygon points="33,27 53,27 24,62 29.5,37.5" fill={`url(#${h})`} opacity=".5" />
      <path d="M55 4C55.6 7.4 55.6 7.4 59 8C55.6 8.6 55.6 8.6 55 12C54.4 8.6 54.4 8.6 51 8C54.4 7.4 54.4 7.4 55 4Z" fill="#FFC857" />
    </svg>
  );
}

/** "Samp" in slate and "Force" in the brand gradient (deep red in light themes, coral to amber in dark ones). */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      {!compact && (
        <span className="leading-tight">
          <span className="block text-base font-semibold tracking-tight" translate="no">
            <span className="text-slate-500 dark:text-slate-400">Samp</span>
            <span className="bg-gradient-to-r from-[#C81E1E] to-[#8B1A1A] bg-clip-text font-bold text-transparent dark:from-[#FF8A8A] dark:to-[#FFC857]">
              Force
            </span>
          </span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">by Sampledge</span>
        </span>
      )}
    </span>
  );
}
