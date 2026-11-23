'use client';

import { consoleAppearance, type ConsolePreferences } from '@dealflow/types';
import { useEffect, useMemo } from 'react';
import { applyPaint, computePaint, isDarkMode } from '@/lib/appearance-engine';
import { usePreferences } from '@/stores/preferences';

/** localStorage key for the Console's last painted tokens; the layout's pre-paint script reads it on /operator pages. */
export const CONSOLE_PAINT_KEY = 'dealflow:console-paint';

/**
 * Paints the operator's Console palette (ADR 0074) on <html> while a Console page is open, and puts the workspace
 * appearance back when the operator leaves the Console, so the two never mix in one browser.
 */
export function useConsolePaint(prefs: Pick<ConsolePreferences, 'palette' | 'mode'> | null) {
  const paint = useMemo(() => (prefs ? computePaint(consoleAppearance(prefs)) : null), [prefs]);
  useEffect(() => {
    if (!paint) return;
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    // The workspace painter also listens for the OS scheme; painting a tick later keeps the Console's colours on top.
    const apply = () =>
      setTimeout(() => applyPaint(root, paint, isDarkMode(paint.mode, media.matches)), 0);
    apply();
    try {
      localStorage.setItem(CONSOLE_PAINT_KEY, JSON.stringify(paint));
    } catch {
      // Storage blocked: only the next first paint may flash.
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [paint]);

  useEffect(
    () => () => {
      const { appearance, brandColor } = usePreferences.getState();
      const back = computePaint(appearance, brandColor);
      applyPaint(
        document.documentElement,
        back,
        isDarkMode(back.mode, window.matchMedia('(prefers-color-scheme: dark)').matches),
      );
    },
    [],
  );
}

export function isDarkNow(mode: ConsolePreferences['mode']): boolean {
  return isDarkMode(
    mode,
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}
