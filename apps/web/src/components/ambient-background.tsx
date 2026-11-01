'use client';

import { usePreferences } from '@/stores/preferences';

/**
 * Soft gradient field behind the app. Purely decorative (aria-hidden) and GPU-cheap (two blurred layers). The
 * Workspace background setting picks Ambient (drifts only on Full motion), Gradient (still) or Plain (nothing);
 * low-power mode removes it entirely.
 */
export function AmbientBackground() {
  const lowPower = usePreferences((s) => s.appearance.lowPower);
  const background = usePreferences((s) => s.appearance.background);
  if (lowPower || background === 'plain') return null;
  const drift = background === 'ambient' ? 'animate-drift' : '';
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className={`absolute -left-1/4 -top-1/3 h-[70vh] w-[70vw] ${drift} rounded-full bg-primary/10 blur-3xl dark:bg-primary/[0.07]`} />
      <div className={`absolute -bottom-1/3 -right-1/4 h-[70vh] w-[60vw] ${drift} rounded-full bg-accent/10 blur-3xl [animation-delay:-12s] dark:bg-accent/[0.08]`} />
      {background === 'ambient' && <div className="absolute inset-0 bg-[radial-gradient(hsl(var(--foreground)/0.05)_1px,transparent_1px)] [background-size:28px_28px]" />}
    </div>
  );
}
