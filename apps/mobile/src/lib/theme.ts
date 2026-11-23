import { type MobileResolvedConfig, readableTextOn } from '@dealflow/types';

/** Colours for the screens, from the organisation's published branding (ADR 0072, M2). */
export interface Theme {
  dark: boolean;
  primary: string;
  onPrimary: string;
  accent: string;
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
}

/** SampForce's own colours, used before sign-in and when no configuration has loaded. */
export const BASE_PRIMARY = '#0E7490';

export function themeFor(branding: Pick<MobileResolvedConfig['branding'], 'primaryColor' | 'accentColor' | 'theme'> | null, systemDark: boolean): Theme {
  const dark = branding?.theme === 'dark' || (branding?.theme !== 'light' && systemDark);
  const primary = branding?.primaryColor ?? BASE_PRIMARY;
  return {
    dark,
    primary,
    onPrimary: readableTextOn(primary),
    accent: branding?.accentColor ?? '#7C3AED',
    background: dark ? '#0B1120' : '#F8FAFC',
    card: dark ? '#111A2E' : '#FFFFFF',
    text: dark ? '#F8FAFC' : '#0F172A',
    muted: dark ? '#A3B1C6' : '#475569',
    border: dark ? '#22304A' : '#E2E8F0',
    danger: dark ? '#FCA5A5' : '#B91C1C',
  };
}
