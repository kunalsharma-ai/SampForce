'use client';

import { cn } from '@dealflow/ui';
import type * as React from 'react';
import { LiveClock } from './live-clock';
import { SpecialDay, type SpecialDayLabels } from './special-day';
import './welcome-banner.css';
import { WelcomePhoto } from './welcome-photo';

/** The part of the day, by the viewer's own clock: it picks the greeting, the sky and the scene. */
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export function dayPart(d = new Date()): DayPart {
  const h = d.getHours();
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
}

const SKY: Record<DayPart, string> = { morning: '#f59e0b', afternoon: '#0ea5e9', evening: '#f97316', night: '#6366f1' };

/** One line for the day, the same all day and different tomorrow. */
export function lineOfTheDay<T>(lines: readonly T[], d = new Date()): T {
  const start = Date.UTC(d.getFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86_400_000);
  return lines[day % lines.length]!;
}

/**
 * The welcome at the top of every home dashboard and the Console overview (Kunal, redesign): a greeting by the time
 * of day with the person's name, a waving hand, a scene of the sky, today's date and a line for the day, over the
 * workspace's colours. Texts come in translated; `children` holds the actions under the greeting and `aside` (a
 * period switcher, say) sits at the end of that same row, clear of the sky.
 */
export function WelcomeBanner({
  hello,
  name,
  initials,
  photoUrl,
  badge,
  date,
  line,
  heading,
  headingId,
  colors,
  part = dayPart(),
  aside,
  children,
  className,
  clockLabel = 'Current time',
  locale,
  specialDaysPath,
  specialLabels,
}: {
  hello: string;
  name: string;
  initials: string;
  /** The person's profile photo; their initials show without one, or when it fails to load. */
  photoUrl?: string | null;
  badge?: React.ReactNode;
  date: string;
  line: string;
  heading?: React.ReactNode;
  headingId?: string;
  colors: [string, string];
  part?: DayPart;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /** The clock's accessible name, translated. */
  clockLabel?: string;
  /** The language the clock and date are written in (the browser's when left out). */
  locale?: string;
  /** Where today's holidays and events come from: the workspace's list, or the Console's. */
  specialDaysPath?: string;
  specialLabels?: SpecialDayLabels;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-welcome-banner={part}
      className={cn('sf-welcome', className)}
      style={{ '--wb-a': colors[0], '--wb-b': colors[1], '--wb-sky-a': SKY[part] } as React.CSSProperties}
    >
      <div className="relative space-y-4 p-5 sm:p-7">
        {/* Greeting, clock and sky each have their own cell, so none can sit over another: on wide screens they share
            the top row; below that the clock takes a full-width row under the greeting. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-4 sm:gap-x-4 xl:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="sf-welcome-in col-start-1 row-start-1 flex min-w-0 items-start gap-3 sm:gap-4">
            <span aria-hidden className="sf-welcome-avatar">
              <WelcomePhoto initials={initials} photoUrl={photoUrl ?? null} />
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                {badge}
                <span data-welcome-date>{date}</span>
              </div>
              <p className="text-2xl font-black leading-tight tracking-tight sm:text-4xl" data-welcome-hello>
                {hello}, <span className="text-foreground">{name}</span>{' '}
                <span aria-hidden className="sf-welcome-wave">
                  👋
                </span>
              </p>
              {heading}
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-base" data-welcome-line>
                {line}
              </p>
            </div>
          </div>
          <LiveClock label={clockLabel} locale={locale} className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1" />
          <Scene part={part} />
          {specialDaysPath && <SpecialDay path={specialDaysPath} labels={specialLabels} className="col-span-full" />}
        </div>
        {(children || aside) && (
          <div className="flex flex-wrap items-center gap-3" data-welcome-controls>
            {children}
            {aside && (
              <div className="w-full sm:ms-auto sm:w-auto" data-welcome-aside>
                {aside}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The sky in the top corner: a rising sun, the midday sun with clouds, a sunset, or the moon and stars. It takes its
 * own place in the layout beside the greeting, never under it, so no control (period switcher, quick actions, links)
 * can ever sit on top of or behind it; it only bleeds into the banner's padding at the corner.
 */
function Scene({ part }: { part: DayPart }) {
  return (
    <svg aria-hidden viewBox="0 0 120 120" className="sf-welcome-scene pointer-events-none col-start-2 row-start-1 -me-3 -mt-4 size-20 shrink-0 opacity-90 sm:-me-4 sm:-mt-5 sm:size-32 lg:size-36 xl:col-start-3" data-welcome-scene>
      <defs>
        <radialGradient id={`wb-sun-${part}`} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor={part === 'evening' ? '#fde68a' : '#fef3c7'} />
          <stop offset="60%" stopColor={part === 'evening' ? '#fb923c' : '#fbbf24'} />
          <stop offset="100%" stopColor={part === 'evening' ? '#e11d48' : '#f59e0b'} />
        </radialGradient>
        <radialGradient id="wb-moon" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#c7d2fe" />
        </radialGradient>
        <mask id="wb-crescent" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120">
          <rect width="120" height="120" fill="#fff" />
          <circle cx="74" cy="48" r="24" fill="#000" />
        </mask>
      </defs>
      {part === 'night' ? (
        <g>
          {[
            [18, 22, 1.6],
            [34, 10, 1.1],
            [96, 16, 1.4],
            [104, 44, 1],
            [20, 58, 1.2],
            [88, 86, 1.5],
            [48, 96, 1],
          ].map(([x, y, r], i) => (
            <circle key={i} className="wb-star" cx={x} cy={y} r={r} fill="#fde68a" style={{ transformOrigin: `${x}px ${y}px` }} />
          ))}
          <g className="wb-sun">
            {/* A true crescent cut out with a mask, so it reads as a moon on light and dark banners alike. */}
            <circle cx="62" cy="56" r="26" fill="url(#wb-moon)" mask="url(#wb-crescent)" />
            <circle cx="52" cy="62" r="3" fill="#a5b4fc" opacity="0.6" />
            <circle cx="58" cy="72" r="2" fill="#a5b4fc" opacity="0.5" />
          </g>
        </g>
      ) : (
        <g>
          <g className="wb-rays" opacity={part === 'evening' ? 0.5 : 0.75}>
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} className="wb-ray" x="58" y="12" width="4" height="12" rx="2" fill={part === 'evening' ? '#fb923c' : '#fbbf24'} transform={`rotate(${i * 30} 60 60)`} />
            ))}
          </g>
          <g className="wb-sun">
            <circle cx="60" cy={part === 'morning' ? 66 : part === 'evening' ? 72 : 60} r="26" fill={`url(#wb-sun-${part})`} />
          </g>
          <g className="wb-cloud wb-cloud-1">
            <ellipse cx="34" cy="84" rx="20" ry="9" fill="#fff" opacity="0.95" />
            <ellipse cx="46" cy="78" rx="13" ry="10" fill="#fff" opacity="0.95" />
          </g>
          {part !== 'morning' && (
            <g className="wb-cloud wb-cloud-2">
              <ellipse cx="92" cy="94" rx="16" ry="7" fill="#fff" opacity="0.85" />
              <ellipse cx="100" cy="89" rx="10" ry="8" fill="#fff" opacity="0.85" />
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
