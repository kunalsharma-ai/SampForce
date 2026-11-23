'use client';

import type { WorkspaceLevel } from '@dealflow/types';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { LAST_LEVEL_KEY } from './auth-shell';
import { AnimatedMark, SCENE_COPY, SceneBackground, type SceneVariant } from './sign-in-scene';

/** Set by the sign-in forms; the welcome shows once, right after signing in, never on a reload. */
export const WELCOME_KEY = 'sampforce:welcome';

export function markWelcome() {
  try {
    sessionStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // No storage, no welcome: signing in still works.
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
 * The welcome after signing in (ADR 0075): about a second and a half of the level's own scene over the app while it
 * loads, then it steps aside. Any key or click skips it. `name` is null until the signed-in person is known.
 */
export function WelcomeScene({ variant, name, onShown }: { variant: SceneVariant; name: string | null; onShown?: () => void }) {
  const t = useT();
  const [state, setState] = useState<'off' | 'on' | 'leaving'>('off');

  useEffect(() => {
    if (name === null) return;
    onShown?.();
    if (takeWelcome()) setState('on');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per person, not per render of the callback
  }, [name]);

  useEffect(() => {
    if (state !== 'on') return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const leave = () => setState('leaving');
    const timer = setTimeout(leave, reduced ? 900 : 1700);
    window.addEventListener('keydown', leave, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', leave);
    };
  }, [state]);

  useEffect(() => {
    if (state !== 'leaving') return;
    const timer = setTimeout(() => setState('off'), 450);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'off' || name === null) return null;
  const first = name.split(' ')[0] || name;
  const copy = SCENE_COPY[variant];
  return (
    <div
      className={`sfs-root fixed inset-0 z-[200] grid place-items-center overflow-hidden bg-[#140405] text-white ${state === 'leaving' ? 'sfs-welcome-leave' : ''}`}
      onClick={() => setState('leaving')}
      data-welcome={variant}
    >
      <SceneBackground variant={variant} />
      <div className="sfs-welcome-card relative z-10 flex flex-col items-center px-6 text-center">
        <AnimatedMark className="size-28 sm:size-36" />
        <p className="sfs-headline mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-[#ffc857]">{t.maybe(copy.eyebrow)}</p>
        <p role="status" className="sfs-headline mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">
          {t('Welcome back, {name}', { name: first })}
        </p>
        <p className="sfs-sub mt-3 max-w-md text-base text-white/85">{t.maybe(copy.sub)}</p>
      </div>
    </div>
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
