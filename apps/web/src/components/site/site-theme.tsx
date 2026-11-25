'use client';

import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PAINT_CACHE_KEY } from '@/lib/appearance-engine';
import { useT } from '@/lib/i18n';

/**
 * The public website's own light and dark modes (ADR 0078), in its own Aurora palette. The choice is kept on this
 * device only; until a visitor picks one, the site follows the device's colour scheme. The workspace theme the app
 * paints on <html> is put back when the visitor leaves the site.
 */
export const SITE_THEME_KEY = 'sampforce:site-theme';

export type SiteMode = 'light' | 'dark';

export function readSiteMode(stored: string | null, systemDark: boolean): SiteMode {
  return stored === 'light' || stored === 'dark' ? stored : systemDark ? 'dark' : 'light';
}

/** Whether the app's own theme (the one painted on <html> before the site took over) is dark. */
function appDark(): boolean {
  try {
    const paint = JSON.parse(localStorage.getItem(PAINT_CACHE_KEY) ?? 'null') as { mode?: string } | null;
    if (paint?.mode === 'light') return false;
    if (paint?.mode === 'system') return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    // Unknown: the signature dark theme.
  }
  return true;
}

export function useSiteTheme() {
  const [mode, setModeState] = useState<SiteMode>('dark');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SITE_THEME_KEY);
    } catch {
      // Storage blocked: follow the device.
    }
    const media = matchMedia('(prefers-color-scheme: dark)');
    setModeState(readSiteMode(stored, media.matches));
    setReady(true);
    if (stored) return;
    const follow = () => setModeState(readSiteMode(null, media.matches));
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  // `dark:` utilities in shared components (the logo, inputs) read the class on <html>, so the site sets it while it
  // is open and keeps it set if the app's theme painter runs again; leaving the site puts the app's theme back.
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    const apply = () => {
      if (root.classList.contains('dark') !== (mode === 'dark')) root.classList.toggle('dark', mode === 'dark');
    };
    apply();
    const watch = new MutationObserver(apply);
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, [mode, ready]);

  useEffect(
    () => () => {
      document.documentElement.classList.toggle('dark', appDark());
    },
    [],
  );

  const setMode = useCallback((next: SiteMode) => {
    setModeState(next);
    try {
      localStorage.setItem(SITE_THEME_KEY, next);
    } catch {
      // Not remembered, still applied.
    }
  }, []);

  return { mode, ready, setMode, attrs: { 'data-sfx-mode': mode } as const };
}

/** The sun and moon switch: the icon turns over as the sky changes. */
export function SiteThemeToggle({ mode, onChange }: { mode: SiteMode; onChange: (m: SiteMode) => void }) {
  const t = useT();
  const dark = mode === 'dark';
  return (
    <button
      type="button"
      onClick={() => onChange(dark ? 'light' : 'dark')}
      className="sfx-theme-toggle relative grid size-10 place-items-center overflow-hidden rounded-full border border-border bg-surface/70 text-foreground transition hover:border-primary/60"
      data-site-theme={mode}
    >
      <span className="sr-only">{dark ? t('Switch to light mode') : t('Switch to dark mode')}</span>
      <Sun className="sfx-sun size-[18px]" aria-hidden />
      <Moon className="sfx-moon size-[18px]" aria-hidden />
    </button>
  );
}
