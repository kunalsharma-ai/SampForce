import { type MobileResolvedConfig, readableTextOn } from '@dealflow/types';

/** Colours for the screens, from the organisation's published branding (ADR 0072, M2). */
export interface Theme {
  dark: boolean;
  primary: string;
  onPrimary: string;
  /** The brand colour made dark or light enough to read as text on cards (WCAG AA, 4.5:1). */
  primaryText: string;
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
    primaryText: readableOn(primary, dark ? '#111A2E' : '#FFFFFF', dark ? '#FFFFFF' : '#000000'),
    accent: branding?.accentColor ?? '#7C3AED',
    background: dark ? '#0B1120' : '#F8FAFC',
    card: dark ? '#111A2E' : '#FFFFFF',
    text: dark ? '#F8FAFC' : '#0F172A',
    muted: dark ? '#A3B1C6' : '#475569',
    border: dark ? '#22304A' : '#E2E8F0',
    danger: dark ? '#FCA5A5' : '#B91C1C',
  };
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = channel(hex, i) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
const mix = (a: string, b: string, t: number) =>
  `#${[0, 1, 2].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The colour moved towards `toward` (black on light cards, white on dark) just until it reads on `background`. */
export function readableOn(color: string, background: string, toward: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(color, toward, t);
    if (contrast(c, background) >= 4.5) return c;
  }
  return toward;
}
