'use client';

import { cn } from '@dealflow/ui';
import { Moon, Palette, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

/**
 * The sign-in pages' own look (ADR 0075): light or dark, and a colour palette, so anyone can try a different design
 * before signing in. Kept on this device only (a viewer's convenience); the app's appearance settings are separate.
 */
export const SIGN_IN_STYLE_KEY = 'sampforce:sign-in-style';

export const SIGN_IN_PALETTES = [
  { key: 'red', label: 'SampForce red', swatch: ['#e02424', '#ffc857'] },
  { key: 'rose', label: 'Royal rose', swatch: ['#c0267a', '#ffb3e0'] },
  { key: 'ocean', label: 'Ocean blue', swatch: ['#1d6fd8', '#7fe3ff'] },
  { key: 'emerald', label: 'Emerald', swatch: ['#0f9d58', '#c8f56a'] },
  { key: 'sunset', label: 'Sunset amber', swatch: ['#e0661a', '#ffe08a'] },
] as const;

export type SignInPalette = (typeof SIGN_IN_PALETTES)[number]['key'];
export type SignInMode = 'light' | 'dark';

/** The chosen look, as attributes for the page's root element. */
export function useSignInStyle() {
  const [mode, setMode] = useState<SignInMode>('dark');
  const [palette, setPalette] = useState<SignInPalette>('red');
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SIGN_IN_STYLE_KEY) ?? 'null') as { mode?: string; palette?: string } | null;
      if (saved?.mode === 'light' || saved?.mode === 'dark') setMode(saved.mode);
      if (SIGN_IN_PALETTES.some((p) => p.key === saved?.palette)) setPalette(saved!.palette as SignInPalette);
    } catch {
      // Storage may be blocked; the default look is fine.
    }
  }, []);
  const save = (next: { mode: SignInMode; palette: SignInPalette }) => {
    setMode(next.mode);
    setPalette(next.palette);
    try {
      localStorage.setItem(SIGN_IN_STYLE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered, still applied.
    }
  };
  return {
    mode,
    palette,
    attrs: { 'data-sfs-mode': mode, 'data-sfs-palette': palette },
    setMode: (m: SignInMode) => save({ mode: m, palette }),
    setPalette: (p: SignInPalette) => save({ mode, palette: p }),
  };
}

/** The light/dark switch and the palette swatches, in one small floating bar. */
export function SignInStylePicker({ style, translate = true }: { style: ReturnType<typeof useSignInStyle>; translate?: boolean }) {
  const t = useT();
  const tr = (s: string) => (translate ? t.maybe(s) : s);
  const dark = style.mode === 'dark';
  return (
    <div className="sfs-picker flex items-center gap-1.5 rounded-full p-1.5" data-sign-in-style="">
      <button
        type="button"
        className="sfs-picker-mode grid size-8 place-items-center rounded-full"
        aria-label={tr(dark ? 'Switch to light mode' : 'Switch to dark mode')}
        onClick={() => style.setMode(dark ? 'light' : 'dark')}
        data-sign-in-mode={style.mode}
      >
        {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </button>
      <span className="sfs-picker-sep mx-0.5 h-5 w-px" aria-hidden />
      <Palette className="sfs-picker-icon size-4" aria-hidden />
      <div role="radiogroup" aria-label={tr('Colour palette')} className="flex items-center gap-1">
        {SIGN_IN_PALETTES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={style.palette === p.key}
            aria-label={tr(p.label)}
            title={tr(p.label)}
            onClick={() => style.setPalette(p.key)}
            className={cn('sfs-swatch size-6 rounded-full', style.palette === p.key && 'sfs-swatch-on')}
            style={{ background: `linear-gradient(135deg, ${p.swatch[0]} 0 55%, ${p.swatch[1]} 55% 100%)` }}
            data-palette={p.key}
          />
        ))}
      </div>
    </div>
  );
}
