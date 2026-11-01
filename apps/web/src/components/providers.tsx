'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@dealflow/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { applyPaint, computePaint, isDarkMode, PAINT_CACHE_KEY } from '@/lib/appearance-engine';
import { usePreferences } from '@/stores/preferences';

/** Paints the theme engine's tokens on <html> whenever the settings (or the OS colour scheme) change. */
function useAppearancePaint() {
  const appearance = usePreferences((s) => s.appearance);
  const brandColor = usePreferences((s) => s.brandColor);
  const paint = useMemo(() => computePaint(appearance, brandColor), [appearance, brandColor]);
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyPaint(root, paint, isDarkMode(paint.mode, media.matches));
    apply();
    try {
      localStorage.setItem(PAINT_CACHE_KEY, JSON.stringify(paint));
    } catch {
      // Storage full or blocked: the page still paints, only the next first paint may flash.
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [paint]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  useAppearancePaint();
  const motion = usePreferences((s) => s.appearance.motion);
  // Full ignores the OS setting; Balanced follows it; Minimal and Off keep only essential fades (CSS handles Off).
  const reducedMotion = motion === 'full' ? 'never' : motion === 'balanced' ? 'user' : 'always';

  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion={reducedMotion}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
