'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthLanguage } from '@/components/auth-language';
import { LogoOnRed } from '@/components/logo';
import { Tr } from '@/lib/i18n';
import { AnimatedMark, SCENE_COPY, SceneBackground, type SceneVariant } from './sign-in-scene';

/** The level this device last signed in to, so the next sign-in opens on its scene. */
export const LAST_LEVEL_KEY = 'sampforce:last-level';
const LEVELS: Record<string, Exclude<SceneVariant, 'console'>> = { super: 'super', manager: 'manager', executive: 'executive' };

/** Which scene to show: `?workspace=` (invitation and workspace links), else this device's last level, else Executive. */
export function pickScene(param: string | null): Exclude<SceneVariant, 'console'> {
  if (param && LEVELS[param.toLowerCase()]) return LEVELS[param.toLowerCase()]!;
  try {
    const last = localStorage.getItem(LAST_LEVEL_KEY);
    if (last && LEVELS[last]) return LEVELS[last]!;
  } catch {
    // Storage may be blocked; the default scene is fine.
  }
  return 'executive';
}

/**
 * The sign-in pages (ADR 0075): the level's animated scene fills the screen, the logo assembles itself with the
 * welcome, and the form sits on an opaque card that is usable from the first frame.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [variant, setVariant] = useState<Exclude<SceneVariant, 'console'> | null>(null);
  useEffect(() => setVariant(pickScene(params.get('workspace'))), [params]);
  const copy = variant ? SCENE_COPY[variant] : null;
  // The welcome is for signing in; the other pages (sign-up, reset) keep the scene with a shorter line.
  const isLogin = pathname === '/login';

  return (
    <main className="sfs-root relative min-h-screen overflow-hidden bg-[#140405] text-white" data-sign-in-scene={variant ?? ''}>
      {variant && <SceneBackground variant={variant} />}
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        <section className="flex flex-col gap-6 p-6 sm:p-10 lg:justify-between lg:p-12">
          <LogoOnRed />
          {copy && (
            <div className="flex items-center gap-5 lg:block lg:max-w-xl">
              <AnimatedMark key={variant} className="size-20 shrink-0 sm:size-24 lg:mb-8 lg:size-44" />
              <div className="min-w-0">
                <p className="sfs-headline text-xs font-semibold uppercase tracking-[0.22em] text-[#ffc857]">
                  <Tr text={copy.eyebrow} />
                </p>
                <h2 className="sfs-headline mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-5xl">
                  <Tr text={isLogin ? copy.headline : 'Welcome to SampForce'} />
                </h2>
                <p className="sfs-sub mt-3 hidden max-w-md text-base text-white/85 sm:block lg:text-lg">
                  <Tr text={copy.sub} />
                </p>
              </div>
            </div>
          )}
          <p className="hidden text-xs text-white/70 lg:block">© {new Date().getFullYear()} Sampledge</p>
        </section>
        <section className="flex items-start justify-center px-4 pb-10 sm:px-6 lg:items-center lg:p-10">
          <div className="sfs-card w-full max-w-sm space-y-6 rounded-2xl bg-background p-6 text-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/10 sm:p-8">
            <div className="flex justify-end">
              <AuthLanguage />
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
