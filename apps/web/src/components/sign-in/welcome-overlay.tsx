'use client';

import type { WorkspaceLevel } from '@dealflow/types';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { LAST_LEVEL_KEY } from './auth-shell';
import { AnimatedMark, BoldIn, SCENE_COPY, SceneBackground, SceneStage, type SceneVariant, sceneName, useDayPart } from './sign-in-scene';
import { SIGN_IN_STYLE_KEY } from './sign-in-style';

/** Set by the sign-in forms; the welcome shows once, right after signing in, never on a reload. */
export const WELCOME_KEY = 'sampforce:welcome';

export function markWelcome() {
  try {
    sessionStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // No storage, no welcome: signing in still works.
  }
}

/** Whether a welcome is waiting, without using it up. */
function welcomePending(): boolean {
  try {
    return sessionStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** True once, when the page opened right after a sign-in form marked it. */
function takeWelcome(): boolean {
  try {
    if (sessionStorage.getItem(WELCOME_KEY) !== '1') return false;
    sessionStorage.removeItem(WELCOME_KEY);
    return true;
  } catch {
    return false;
  }
}

const VARIANT: Record<WorkspaceLevel, Exclude<SceneVariant, 'console'>> = { SUPER: 'super', MANAGER: 'manager', EXECUTIVE: 'executive' };

/**
 * The welcome after signing in (ADR 0075): three seconds of the level's own scene and animation, sparkles, the
 * greeting and a bar filling while the dashboard loads behind it, then it opens like a closing iris. Any key or click skips it. `name` is null until the signed-in person is known.
 */
export function WelcomeScene({ variant, name, onShown }: { variant: SceneVariant; name: string | null; onShown?: () => void }) {
  const t = useT();
  const part = useDayPart();
  const [state, setState] = useState<'off' | 'on' | 'leaving'>('off');
  // The palette chosen on the sign-in page carries on into the welcome.
  const [palette, setPalette] = useState('red');
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SIGN_IN_STYLE_KEY) ?? 'null') as { palette?: string } | null;
      if (saved?.palette) setPalette(saved.palette);
    } catch {
      // The default palette is fine.
    }
  }, []);

  // While the signed-in person is still loading, a plain cover in the scene's colours stands in for the welcome, so the
  // app's loading placeholders never flash between the green tick and the welcome. Measured before the first paint.
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    if (!welcomePending()) return;
    setPending(true);
    // Never hide the page for long if the person cannot be loaded (an error shows behind it instead).
    const timer = setTimeout(() => setPending(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (name === null) return;
    setPending(false);
    onShown?.();
    if (takeWelcome()) setState('on');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per person, not per render of the callback
  }, [name]);

  useEffect(() => {
    if (state !== 'on') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const leave = () => setState('leaving');
    const timer = setTimeout(leave, reduced ? 900 : 3000);
    window.addEventListener('keydown', leave, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', leave);
    };
  }, [state]);

  useEffect(() => {
    if (state !== 'leaving') return;
    const timer = setTimeout(() => setState('off'), 700);
    return () => clearTimeout(timer);
  }, [state]);

  if (pending && name === null)
    return (
      <div className="sfs-root fixed inset-0 z-[200] overflow-hidden bg-[#140405]" data-sfs-palette={palette} data-welcome-pending="" aria-hidden>
        <SceneBackground variant={variant} />
      </div>
    );
  if (state === 'off' || name === null) return null;
  const first = name.split(' ')[0] || name;
  const copy = SCENE_COPY[variant];
  const level = t.maybe(sceneName(variant));
  return (
    <div
      className={`sfs-root fixed inset-0 z-[200] overflow-hidden bg-[#140405] text-white ${state === 'leaving' ? 'sfs-welcome-leave' : ''}`}
      onClick={() => setState('leaving')}
      data-welcome={variant}
      data-sfs-palette={palette}
    >
      <SceneBackground variant={variant} />
      <Sparkles />
      <div className="sfs-welcome-card relative z-10 mx-auto flex h-full max-w-4xl flex-col items-center justify-center gap-2 px-6 py-8 text-center">
        <div className="sfs-stage relative h-[30vh] w-full max-w-2xl sm:h-[34vh]" aria-hidden>
          <SceneStage variant={variant} className="absolute inset-0 h-full w-full" />
        </div>
        <span className="relative mt-2 grid place-items-center" aria-hidden>
          <span className="sfs-burst absolute size-24 rounded-full border-2 border-[#ffc857]" />
          <span className="sfs-burst sfs-burst-2 absolute size-24 rounded-full border-2 border-[#ff6b6b]" />
          <AnimatedMark className="size-16 sm:size-20" />
        </span>
        <p className="sfs-greet mt-1 text-lg font-semibold text-[#ffd98a] sm:text-xl">
          <span className="sfs-wave me-2 inline-block" aria-hidden>
            👋
          </span>
          {part ? `${t(part)}!` : null}
        </p>
        <p role="status" className="sfs-headline sfs-welcome-name text-4xl font-extrabold tracking-tight sm:text-6xl">
          {t('Welcome back, {name}', { name: first })}
        </p>
        <p className="sfs-sub mt-1 text-xl text-white sm:text-2xl">
          <BoldIn template={t('Welcome to {name}', { name: '\u0001' })} value={level} className="text-[#ffd98a]" />
        </p>
        <p className="sfs-sub max-w-md text-base text-white/85">{t.maybe(copy.sub)}</p>
        <div className="mt-4 w-full max-w-xs" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="sfs-welcome-progress h-full rounded-full bg-gradient-to-r from-[#e02424] via-[#ffc857] to-white" />
          </div>
          <p className="mt-2 text-xs uppercase tracking-[0.2em] text-white/75">{t.maybe(variant === 'console' ? 'Getting the Console ready…' : 'Getting your dashboard ready…')}</p>
        </div>
      </div>
    </div>
  );
}

/** Gold and white sparkles bursting out from the middle of the welcome. */
function Sparkles() {
  const bits = Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    const d = 180 + ((i * 53) % 220);
    return { dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d * 0.7), s: 6 + ((i * 7) % 10), c: i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#ffc857' : '#ff8a8a', delay: ((i % 7) * 0.12).toFixed(2) };
  });
  return (
    <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden>
      <svg x="50%" y="55%" overflow="visible">
        {bits.map((b, i) => (
          <path
            key={i}
            d={`M0 ${-b.s}C1 -1 1 -1 ${b.s} 0C1 1 1 1 0 ${b.s}C-1 1 -1 1 ${-b.s} 0C-1 -1 -1 -1 0 ${-b.s}Z`}
            fill={b.c}
            className="sfs-sparkle"
            style={{ '--dx': `${b.dx}px`, '--dy': `${b.dy}px`, animationDelay: `${0.5 + Number(b.delay)}s` } as React.CSSProperties}
          />
        ))}
      </svg>
    </svg>
  );
}

/** The workspace welcome: the scene of the level really opened. It also remembers the level for the next sign-in. */
export function WelcomeOverlay() {
  const { data } = useSession();
  const variant = VARIANT[data?.workspace?.level ?? 'SUPER'];
  return (
    <WelcomeScene
      variant={variant}
      name={data ? data.user.name : null}
      onShown={() => {
        try {
          localStorage.setItem(LAST_LEVEL_KEY, variant);
        } catch {
          // Storage may be blocked; the default scene is fine.
        }
      }}
    />
  );
}
