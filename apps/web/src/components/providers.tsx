'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@dealflow/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { usePreferences } from '@/stores/preferences';

function usePreferenceAttributes() {
  const { theme, motion, lowPower } = usePreferences();
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply();
    media.addEventListener('change', apply);
    root.dataset.motion = motion;
    root.dataset.lowPower = String(lowPower);
    return () => media.removeEventListener('change', apply);
  }, [theme, motion, lowPower]);
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
  usePreferenceAttributes();
  const motion = usePreferences((s) => s.motion);
  const reducedMotion = motion === 'full' ? 'never' : motion === 'system' ? 'user' : 'always';

  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion={reducedMotion}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
