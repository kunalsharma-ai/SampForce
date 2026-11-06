'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DirectionProvider, TooltipProvider } from '@dealflow/ui';
import { MotionConfig } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useActiveLocale } from '@/lib/i18n';
import { translateData } from '@/lib/i18n/translate';
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

/** Keeps <html lang dir> in step with the person's language (the layout's bootstrap script sets it before first paint). */
function useDocumentLocale() {
  const { language, dir } = useActiveLocale();
  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = dir;
  }, [language, dir]);
  return dir;
}

/**
 * The API writes its sentences and messages in the language the request asks for (ADR 0052), so data already loaded
 * in another language is fetched again when the person switches language.
 */
function useRefetchOnLanguageChange(client: QueryClient) {
  const { language } = useActiveLocale();
  const first = useRef(language);
  useEffect(() => {
    if (first.current === language) return;
    first.current = language;
    void client.invalidateQueries();
  }, [client, language]);
}

/**
 * Browser tab titles come from each page's metadata in English ("Deals · SampForce"). Each part is translated when the
 * title is set, and again when the language changes; a title with no translation stays as it is.
 */
function useTranslatedTitle() {
  const { language, formatLocale } = useActiveLocale();
  useEffect(() => {
    if (language === 'en') return;
    let english = document.title;
    let shown = '';
    const apply = () => {
      if (document.title === shown) return;
      english = document.title;
      shown = english
        .split(' · ')
        .map((part) => translateData(language, part, undefined, formatLocale))
        .join(' · ');
      if (shown !== document.title) document.title = shown;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === shown) document.title = english;
    };
  }, [language, formatLocale]);
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
  const dir = useDocumentLocale();
  useRefetchOnLanguageChange(client);
  useTranslatedTitle();
  const motion = usePreferences((s) => s.appearance.motion);
  // Full ignores the OS setting; Balanced follows it; Minimal and Off keep only essential fades (CSS handles Off).
  const reducedMotion = motion === 'full' ? 'never' : motion === 'balanced' ? 'user' : 'always';

  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion={reducedMotion}>
        <DirectionProvider dir={dir}>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </DirectionProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
