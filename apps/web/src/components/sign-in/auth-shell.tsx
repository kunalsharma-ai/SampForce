'use client';

import { Lock } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthLanguage } from '@/components/auth-language';
import { LogoOnRed } from '@/components/logo';
import { Tr, useT } from '@/lib/i18n';
import { SignInStylePicker, useSignInStyle } from './sign-in-style';
import { RevealText, SCENE_COPY, SceneBackground, SceneGreeting, SceneStage, type SceneVariant, WorkspaceBadge } from './sign-in-scene';

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
  const t = useT();
  const style = useSignInStyle();
  const params = useSearchParams();
  const pathname = usePathname();
  // The first render (on the server too) already shows a scene, the one the link names or the default, so the
  // greeting, the stage and the workspace badge are there from the first frame and the form does not jump down
  // while someone starts typing. This device's last level, which only the browser knows, then takes over.
  const [variant, setVariant] = useState<Exclude<SceneVariant, 'console'> | null>(() => LEVELS[params.get('workspace')?.toLowerCase() ?? ''] ?? 'executive');
  useEffect(() => setVariant(pickScene(params.get('workspace'))), [params]);
  const copy = variant ? SCENE_COPY[variant] : null;
  // The welcome is for signing in; the other pages (sign-up, reset) keep the scene with a shorter line.
  const isLogin = pathname === '/login';

  return (
    <main className="sfs-root relative min-h-screen overflow-hidden" data-sign-in-scene={variant ?? ''} {...style.attrs}>
      {variant && <SceneBackground variant={variant} />}
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        <section className="flex flex-col gap-5 p-6 sm:p-10 lg:gap-6 lg:p-12">
          <div className="flex items-center justify-between gap-3">
            <LogoOnRed />
            <SignInStylePicker style={style} />
          </div>
          {copy && variant && (
            <div className="sfs-hero-text flex flex-col gap-3 lg:max-w-2xl">
              <SceneGreeting key={`greet-${variant}`} variant={variant} />
              <h2 className="text-[color:var(--sfs-ink)] text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-4xl lg:text-[3.4rem]">
                <RevealText key={variant} text={t.maybe(isLogin ? copy.headline : 'Welcome to SampForce')} />
              </h2>
              <p className="sfs-sub hidden max-w-lg text-base text-[color:var(--sfs-ink-soft)] sm:block lg:text-lg">
                <Tr text={copy.sub} />
              </p>
            </div>
          )}
          {variant && (
            <div className="sfs-stage relative min-h-[150px] flex-1 sm:min-h-[220px] lg:min-h-[260px]">
              <SceneStage key={variant} variant={variant} className="absolute inset-0 h-full w-full" />
            </div>
          )}
          <p className="hidden text-xs text-[color:var(--sfs-ink-mute)] lg:block">© {new Date().getFullYear()} Sampledge</p>
        </section>
        <section className="flex items-start justify-center px-4 pb-10 sm:px-6 lg:items-center lg:p-10">
          <div className="sfs-card-frame w-full max-w-md" data-card-variant={variant ?? undefined}>
            <div className="sfs-card space-y-6 bg-background p-6 text-foreground sm:p-8">
              <div className="flex justify-end">
                <AuthLanguage />
              </div>
              {variant && isLogin && <WorkspaceBadge key={`badge-${variant}`} variant={variant} />}
              {children}
              {isLogin && (
                <p className="sfs-trust flex items-center justify-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden /> {t('Secure, encrypted sign-in')}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
