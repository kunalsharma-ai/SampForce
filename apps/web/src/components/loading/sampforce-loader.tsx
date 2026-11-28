'use client';

import { Button, cn, Skeleton } from '@dealflow/ui';
import { type Query, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, WifiOff } from 'lucide-react';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { LOGO_PARTS } from '@/components/logo';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import './loader.css';

/*
 * The loading experience (Kunal's spec section 3). Three pieces, used together:
 *  - BrandLoader: the animated SampForce logo, for pages and big sections that take a moment.
 *  - PageLoading: what a page shows while it loads: skeletons of its layout at once, the logo when it takes longer than
 *    a blink, and after a while a plain "taking longer than usual" with Retry, so a stuck request is never hidden
 *    behind an endless animation.
 *  - SlowLoadWatcher: watches the data a page asks for the first time. A light runs along the bar under the header,
 *    and when it takes a while a small card counts the parts loaded ("3 of 5"), real counts, never invented progress.
 *    A part that fails (no connection, a server error) offers Retry. Data already on screen refreshing quietly, and
 *    small actions (saving, ticking a box), never show any of it.
 */

/** Waits this long before showing the logo, so fast loads show only skeletons and nothing flickers. */
export const LOGO_AFTER_MS = 500;
/** After this long the loader says so and offers Retry. */
export const SLOW_AFTER_MS = 12_000;

/** The animated SampForce mark: the bolt at the centre of two orbits, a circling spark and a sweeping light. */
export function BrandMark({ className }: { className?: string }) {
  const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 120 120" className={cn('sfl-root size-24 overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFC857" />
          <stop offset="1" stopColor="#E02424" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E02424" />
          <stop offset="1" stopColor="#7F1D1D" />
        </linearGradient>
        <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#E02424" stopOpacity="0" />
          <stop offset="1" stopColor="#FFC857" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#FFC857" stopOpacity=".7" />
          <stop offset=".6" stopColor="#E02424" stopOpacity=".2" />
          <stop offset="1" stopColor="#E02424" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* The outer ring and the light that sweeps round it. */}
      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="3" />
      <g className="sfl-sweep">
        <path d="M60 6 A54 54 0 0 1 114 60" fill="none" stroke={`url(#${id}-sweep)`} strokeWidth="4" strokeLinecap="round" />
      </g>
      {/* The inner orbit, dashed, turning the other way, with the spark riding on it. */}
      <g className="sfl-orbit-b">
        <circle cx="60" cy="60" r="42" fill="none" stroke="#E02424" strokeOpacity=".35" strokeWidth="1.5" strokeDasharray="3 7" />
      </g>
      <g className="sfl-orbit-a">
        <circle cx="60" cy="18" r="3.2" fill="#FFC857" />
        <circle cx="60" cy="18" r="6" fill="#FFC857" opacity=".25" />
      </g>
      <circle cx="60" cy="60" r="34" fill={`url(#${id}-halo)`} className="sfl-part sfl-halo" />
      {/* The logo itself, from the same shapes as the corner logo. */}
      <svg x="36" y="35" width="50" height="50" viewBox="-4 -1 66 66" overflow="visible">
        {LOGO_PARTS.streaks.map((s, i) => (
          <rect key={i} {...s} rx="1.7" fill={`url(#${id}-${i === 2 ? 'b' : 'a'})`} className={`sfl-part sfl-streak sfl-streak-${i}`} />
        ))}
        <g className="sfl-part sfl-bolt">
          <polygon points={LOGO_PARTS.upper} fill={`url(#${id}-a)`} />
          <polygon points={LOGO_PARTS.lower} fill={`url(#${id}-b)`} />
        </g>
        <path d={LOGO_PARTS.spark} fill="#FFC857" className="sfl-part sfl-spark" />
      </svg>
    </svg>
  );
}

/** "Loading" with three rising dots, in the person's language. */
function LoadingWords({ label }: { label?: string }) {
  const t = useT();
  return (
    <span className="inline-flex items-baseline gap-0.5">
      {label ?? t('Loading')}
      <span aria-hidden className="inline-flex gap-0.5">
        <span className="sfl-dot inline-block">.</span>
        <span className="sfl-dot inline-block">.</span>
        <span className="sfl-dot inline-block">.</span>
      </span>
    </span>
  );
}

/** The logo loader with the wordmark and a line saying what is loading. */
export function BrandLoader({ label, className, compact }: { label?: string; className?: string; compact?: boolean }) {
  return (
    <div className={cn('sfl-enter flex flex-col items-center gap-3 text-center', className)} data-brand-loader="">
      <BrandMark className={compact ? 'size-16' : 'size-24'} />
      {!compact && (
        <span className="text-lg font-semibold tracking-tight" translate="no">
          <span className="text-slate-500 dark:text-slate-400">Samp</span>
          <span className="sfl-word font-bold">Force</span>
        </span>
      )}
      <span className="text-sm text-muted-foreground">
        <LoadingWords label={label} />
      </span>
    </div>
  );
}

function useElapsed(ms: number): boolean {
  const [passed, setPassed] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return passed;
}

/**
 * A page loading: skeletons of a page at once, the SampForce logo over them after half a second, and after twelve
 * seconds a plain message with Retry. `onRetry` defaults to loading the page again.
 */
export function PageLoading({ label, onRetry, className }: { label?: string; onRetry?: () => void; className?: string }) {
  const t = useT();
  const showLogo = useElapsed(LOGO_AFTER_MS);
  const slow = useElapsed(SLOW_AFTER_MS);
  return (
    <div role="status" aria-busy="true" aria-label={label ?? t('shell.loading')} className={cn('relative', className)} data-page-loading={slow ? 'slow' : showLogo ? 'logo' : 'skeleton'}>
      <div aria-hidden className={cn('space-y-4 transition-opacity duration-300', showLogo && 'opacity-40')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 max-w-[70vw]" />
            <Skeleton className="h-4 w-96 max-w-[80vw]" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      </div>
      {showLogo && (
        <div className="absolute inset-x-0 top-16 flex justify-center px-4">
          <div className="rounded-3xl border border-border/70 bg-background/85 px-10 py-7 shadow-2xl backdrop-blur-md">
            <BrandLoader label={label} />
            {slow && (
              <div className="mt-4 flex max-w-xs flex-col items-center gap-2 text-center" data-slow-load="">
                <p className="text-sm text-muted-foreground">{t('This is taking longer than usual. Your connection or the server may be slow.')}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
                  <RefreshCw className="size-4" aria-hidden /> {t('Try again')}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** A section or card loading inside a page: its own skeleton height, with the small logo after half a second. */
export function SectionLoading({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  const showLogo = useElapsed(LOGO_AFTER_MS);
  return (
    <div role="status" aria-busy="true" aria-label={label ?? t('shell.loading')} className={cn('relative grid min-h-40 place-items-center rounded-2xl', className)}>
      <Skeleton className="absolute inset-0 rounded-2xl opacity-60" />
      {showLogo && <BrandLoader compact label={label} className="relative" />}
    </div>
  );
}

/** Query keys that belong to the shell's live connections, not to the page (they wait on purpose). */
const BACKGROUND = new Set(['notifications', 'chat', 'session', 'me', 'achievements', 'presence', 'availability']);

/** A query on its first load: no data yet and asking the server now. */
function firstLoad(q: Query): boolean {
  if (BACKGROUND.has(String(q.queryKey[0]))) return false;
  return q.state.data === undefined && q.state.fetchStatus === 'fetching';
}

/** A first load that failed for a reason worth retrying: no connection or a server error (not "not allowed"). */
function failedLoad(q: Query): boolean {
  if (BACKGROUND.has(String(q.queryKey[0]))) return false;
  if (q.state.status !== 'error' || q.state.data !== undefined || q.state.fetchStatus === 'fetching') return false;
  const err = q.state.error;
  return !(err instanceof ApiError) || err.status >= 500;
}

/** Shows the bar after this long, and the "3 of 5" card after this. */
const BAR_AFTER_MS = 200;
const CARD_AFTER_MS = 1_200;

type LoadState = { loading: number; total: number; failed: number };

/**
 * Watches the data the current page loads for the first time (see the top of this file). Mounted once, in the shell.
 */
export function SlowLoadWatcher() {
  const qc = useQueryClient();
  const t = useT();
  const pathname = usePathname();
  const [state, setState] = React.useState<LoadState>({ loading: 0, total: 0, failed: 0 });
  const [since, setSince] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [mounted, setMounted] = React.useState(false);
  const started = React.useRef(new Set<string>());
  React.useEffect(() => setMounted(true), []);

  // A new page starts a new count.
  React.useEffect(() => {
    started.current = new Set();
  }, [pathname]);

  React.useEffect(() => {
    const cache = qc.getQueryCache();
    let frame = 0;
    const measure = () => {
      frame = 0;
      const all = cache.getAll();
      const loading = all.filter(firstLoad);
      for (const q of loading) started.current.add(q.queryHash);
      const failed = all.filter((q) => started.current.has(q.queryHash) && failedLoad(q)).length;
      if (loading.length === 0 && failed === 0) started.current = new Set();
      setState((s) => {
        const next = { loading: loading.length, total: started.current.size, failed };
        return s.loading === next.loading && s.total === next.total && s.failed === next.failed ? s : next;
      });
    };
    const unsubscribe = cache.subscribe(() => {
      if (!frame) frame = requestAnimationFrame(measure);
    });
    measure();
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [qc]);

  const busy = state.loading > 0;
  React.useEffect(() => {
    if (!busy) {
      setSince(null);
      return;
    }
    setSince((s) => s ?? Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [busy]);

  const waited = since === null ? 0 : now - since;
  const retry = () => void qc.refetchQueries({ predicate: (q) => started.current.has(q.queryHash) && (failedLoad(q) || firstLoad(q)) });

  if (!mounted) return null;
  const showBar = busy && waited >= BAR_AFTER_MS;
  const showCard = (busy && waited >= CARD_AFTER_MS) || state.failed > 0;
  const slow = busy && waited >= SLOW_AFTER_MS;
  const done = state.total - state.loading - state.failed;

  return createPortal(
    <>
      {showBar && (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-16 z-[45] h-[3px] overflow-hidden bg-[#e02424]/10" data-load-bar="">
          <div className="sfl-bar h-full w-full" />
        </div>
      )}
      {showCard && (
        <div
          // Above the phone's navigation bar; under the header on a computer, in the middle, clear of the pop-ups.
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[55] flex justify-center px-4 lg:bottom-auto lg:top-[4.75rem]"
        >
          <div
            role="status"
            aria-live="polite"
            data-load-card={state.failed > 0 && !busy ? 'failed' : slow ? 'slow' : 'loading'}
            className="sfl-enter pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border/80 bg-popover/95 py-1.5 pe-2 ps-1.5 text-sm text-popover-foreground shadow-xl backdrop-blur-xl"
          >
            {state.failed > 0 && !busy ? (
              <>
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-critical/15 text-critical">
                  <WifiOff className="size-4" />
                </span>
                <span className="min-w-0">{t('Part of this page did not load.')}</span>
              </>
            ) : (
              <>
                <BrandMark className="size-8 shrink-0" />
                <span className="min-w-0">
                  {slow ? (
                    t('Taking longer than usual')
                  ) : (
                    <LoadingWords label={state.total > 1 ? t('Loading {done} of {total}', { done: Math.min(done + 1, state.total), total: state.total }) : undefined} />
                  )}
                </span>
              </>
            )}
            {(slow || (state.failed > 0 && !busy)) && (
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 rounded-full" onClick={retry}>
                <RefreshCw className="size-3.5" aria-hidden /> {t('Try again')}
              </Button>
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
