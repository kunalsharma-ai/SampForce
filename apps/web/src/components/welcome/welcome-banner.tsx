'use client';

import { cn } from '@dealflow/ui';
import type * as React from 'react';
import './welcome-banner.css';

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
 * workspace's colours. Texts come in translated; `children` holds the actions under it and `aside` sits on the right.
 */
export function WelcomeBanner({
  hello,
  name,
  initials,
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
}: {
  hello: string;
  name: string;
  initials: string;
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
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-welcome={part}
      className={cn('sf-welcome', className)}
      style={{ '--wb-a': colors[0], '--wb-b': colors[1], '--wb-sky-a': SKY[part] } as React.CSSProperties}
    >
      <Scene part={part} />
      <div className="relative space-y-4 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="sf-welcome-in flex min-w-0 flex-1 items-start gap-4 sm:pe-40">
            <span aria-hidden className="sf-welcome-avatar">
              {initials}
            </span>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                {badge}
                <span data-welcome-date>{date}</span>
              </div>
              <p className="text-3xl font-black leading-tight tracking-tight sm:text-4xl" data-welcome-hello>
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
          {aside && <div className="relative z-10">{aside}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** The sky in the top corner: a rising sun, the midday sun with clouds, a sunset, or the moon and stars. */
function Scene({ part }: { part: DayPart }) {
  return (
    <svg aria-hidden viewBox="0 0 120 120" className="sf-welcome-scene pointer-events-none absolute -end-4 -top-6 size-36 opacity-90 sm:-top-4 sm:end-2 sm:size-44">
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
            <circle cx="62" cy="56" r="26" fill="url(#wb-moon)" />
            <circle cx="74" cy="48" r="24" fill="currentColor" className="text-surface" opacity="0.92" />
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
