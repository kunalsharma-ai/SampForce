'use client';

import type { WorkspaceLevel } from '@dealflow/types';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { LAST_LEVEL_KEY } from './auth-shell';
import { AnimatedMark, SCENE_COPY, SceneBackground, type SceneVariant } from './sign-in-scene';

/** Set by the sign-in form; the welcome shows once, right after signing in, never on a reload. */
export const WELCOME_KEY = 'sampforce:welcome';

export function markWelcome() {
  try {
    sessionStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // No storage, no welcome: signing in still works.
  }
}

const VARIANT: Record<WorkspaceLevel, Exclude<SceneVariant, 'console'>> = { SUPER: 'super', MANAGER: 'manager', EXECUTIVE: 'executive' };

/**
 * The welcome after signing in (ADR 0075): about a second and a half of the workspace's own scene over the app while
 * it loads, then it steps aside. Any key or click skips it. It also remembers the level for the next sign-in page.
 */
export function WelcomeOverlay() {
  const t = useT();
  const { data } = useSession();
  const [state, setState] = useState<'off' | 'on' | 'leaving'>('off');
  const level: WorkspaceLevel = data?.workspace?.level ?? 'SUPER';
  const variant = VARIANT[level];

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(LAST_LEVEL_KEY, variant);
      if (sessionStorage.getItem(WELCOME_KEY) !== '1') return;
      sessionStorage.removeItem(WELCOME_KEY);
    } catch {
      return;
    }
    setState('on');
  }, [data, variant]);

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

  if (state === 'off' || !data) return null;
  const first = data.user.name.split(' ')[0] ?? data.user.name;
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
