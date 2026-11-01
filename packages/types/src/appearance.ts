import { z } from 'zod';

/*
 * Theme engine shared by the web app (to paint tokens) and the API (to validate what is saved).
 *
 * A theme is a small base palette per mode (background, surface, foreground, primary, secondary, accent and a chart
 * palette). Every other token is derived from it, and every text or control colour is pushed lighter or darker
 * until it meets WCAG 2.2 AA against the surfaces it sits on, so a theme or a custom brand colour can never make the
 * interface unreadable. `resolveTheme` returns HSL triplets ("191 100% 26%") for the CSS variables in
 * packages/ui/src/tokens.css.
 */

// ───── Settings schema ─────

export const THEME_IDS = [
  'signature',
  'obsidian',
  'sapphire',
  'aurora',
  'arctic',
  'pearl',
  'emerald',
  'titanium',
  'solar',
  'rose',
  'cyber',
  'oceanic',
  'custom',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const COLOR_MODES = ['system', 'dark', 'light'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];
/** Balanced is the default: interface transitions and counters, no ambient drift, and it follows the OS reduce-motion setting. */
export const MOTION_LEVELS = ['full', 'balanced', 'minimal', 'off'] as const;
export type MotionSetting = (typeof MOTION_LEVELS)[number];
export const DENSITIES = ['comfortable', 'balanced', 'compact', 'ultra'] as const;
export type Density = (typeof DENSITIES)[number];
export const FONT_SCALES = ['small', 'default', 'large', 'larger'] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export const SIDEBAR_STYLES = ['glass', 'solid', 'tinted'] as const;
export const CARD_STYLES = ['outlined', 'flat', 'elevated'] as const;
export const SHADOW_LEVELS = ['none', 'soft', 'medium', 'strong'] as const;
export const CHART_PALETTES = ['theme', 'vivid', 'calm', 'colorblind'] as const;
export type ChartPalette = (typeof CHART_PALETTES)[number];
export const ICON_STYLES = ['thin', 'regular', 'bold'] as const;
export const BACKGROUND_STYLES = ['ambient', 'gradient', 'plain'] as const;
export const BACKGROUND_TONES = ['theme', 'neutral', 'cool', 'warm'] as const;
export const SURFACE_INTENSITIES = ['subtle', 'standard', 'strong'] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #00D9FF');

export const appearanceSchema = z
  .object({
    themeId: z.enum(THEME_IDS),
    mode: z.enum(COLOR_MODES),
    /** Optional colour overrides on top of the chosen theme. Custom Brand Studio uses them as its palette. */
    primary: hex.nullable(),
    secondary: hex.nullable(),
    accent: hex.nullable(),
    /** Custom Brand Studio only: page background per mode. Surfaces are derived from it. */
    backgroundDark: hex.nullable(),
    backgroundLight: hex.nullable(),
    backgroundTone: z.enum(BACKGROUND_TONES),
    surfaceIntensity: z.enum(SURFACE_INTENSITIES),
    /** Corner radius in pixels. */
    radius: z.number().int().min(0).max(20),
    fontScale: z.enum(FONT_SCALES),
    density: z.enum(DENSITIES),
    sidebarStyle: z.enum(SIDEBAR_STYLES),
    cardStyle: z.enum(CARD_STYLES),
    shadow: z.enum(SHADOW_LEVELS),
    /** 0 = opaque overlays, 100 = strongest blur. Forms and tables stay opaque whatever this is. */
    glass: z.number().int().min(0).max(100),
    motion: z.enum(MOTION_LEVELS),
    chartPalette: z.enum(CHART_PALETTES),
    iconStyle: z.enum(ICON_STYLES),
    background: z.enum(BACKGROUND_STYLES),
    /** Removes ambient effects and swaps 3D scenes for 2D. */
    lowPower: z.boolean(),
  })
  .strict();
export type Appearance = z.infer<typeof appearanceSchema>;

export const DEFAULT_APPEARANCE: Appearance = {
  themeId: 'signature',
  mode: 'dark',
  primary: null,
  secondary: null,
  accent: null,
  backgroundDark: null,
  backgroundLight: null,
  backgroundTone: 'theme',
  surfaceIntensity: 'standard',
  radius: 12,
  fontScale: 'default',
  density: 'balanced',
  sidebarStyle: 'glass',
  cardStyle: 'outlined',
  shadow: 'soft',
  glass: 60,
  motion: 'balanced',
  chartPalette: 'theme',
  iconStyle: 'regular',
  background: 'ambient',
  lowPower: false,
};

/** Accepts a partial or older settings object and fills the gaps with defaults; unknown values are dropped. */
export function normalizeAppearance(input: unknown): Appearance {
  const merged = { ...DEFAULT_APPEARANCE } as Record<string, unknown>;
  if (input && typeof input === 'object') {
    const shape = appearanceSchema.shape as Record<string, z.ZodTypeAny>;
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k in shape && shape[k]!.safeParse(v).success) merged[k] = v;
    }
  }
  return merged as Appearance;
}

export const savedThemeInputSchema = z.object({ name: z.string().trim().min(1).max(60), settings: appearanceSchema }).strict();
export type SavedThemeInput = z.infer<typeof savedThemeInputSchema>;
export const MAX_SAVED_THEMES = 20;

export interface SavedTheme {
  id: string;
  name: string;
  settings: Appearance;
  createdAt: string;
}

export interface PreferencesResponse {
  /** What the person sees: their own settings, else the workspace default, else DealFlow's default. */
  appearance: Appearance;
  source: 'user' | 'workspace' | 'default';
  workspaceDefault: Appearance | null;
  updatedAt: string | null;
}

// ───── Colour maths ─────

type Rgb = [number, number, number];

export function hexToRgb(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** "H S% L%" for a hex colour, the format the CSS tokens use. */
export function hexToHslTriplet(h: string): string {
  const [hh, s, l] = rgbToHsl(hexToRgb(h));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return `${r1(hh)} ${r1(s)}% ${r1(l)}%`;
}

function luminance(h: string): number {
  const ch = hexToRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mixes `b` into `a` by `t` (0 = a, 1 = b) in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => ra[i]! + (rb[i]! - ra[i]!) * t) as Rgb);
}

function setHsl(h: string, fn: (hsl: [number, number, number]) => [number, number, number]): string {
  const [hh, s, l] = fn(rgbToHsl(hexToRgb(h)));
  return rgbToHex(hslToRgb(hh, s, l));
}

const isDarkColor = (h: string) => luminance(h) < 0.18;

/**
 * Moves `fg`'s lightness away from the backgrounds, keeping its hue, until it reaches `ratio` against every one of
 * them. Returns the colour unchanged when it already passes.
 */
export function ensureContrast(fg: string, backgrounds: string[], ratio: number): string {
  // A small margin absorbs rounding when the colour is written out as an HSL triplet.
  const passes = (c: string) => backgrounds.every((bg) => contrastRatio(c, bg) >= ratio + 0.04);
  if (passes(fg)) return fg.toUpperCase();
  const lighten = isDarkColor(backgrounds[0]!);
  const [h, s, l] = rgbToHsl(hexToRgb(fg));
  for (let step = 1; step <= 100; step++) {
    const nl = lighten ? Math.min(100, l + step) : Math.max(0, l - step);
    const c = rgbToHex(hslToRgb(h, s, nl));
    if (passes(c)) return c;
    if (nl === 0 || nl === 100) break;
  }
  return lighten ? '#FFFFFF' : '#000000';
}

/** Whichever of near-white or near-black reads better on `bg`. */
function onColor(bg: string, darkInk: string): string {
  return contrastRatio('#FFFFFF', bg) >= contrastRatio(darkInk, bg) ? '#FFFFFF' : darkInk;
}

// ───── Theme catalogue ─────

interface ModeBase {
  background: string;
  surface: string;
  foreground: string;
  primary: string;
  secondary: string;
  accent: string;
  chart: [string, string, string, string, string, string];
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  /** The mode the theme was designed around; the other mode is a matching variant. */
  preferredMode: 'dark' | 'light';
  dark: ModeBase;
  light: ModeBase;
}

const LIGHT_INK = '#F5F8FF';

export const THEMES: ThemeDefinition[] = [
  {
    id: 'signature',
    name: 'DealFlow Signature',
    description: 'Midnight navy, electric cyan and royal violet. The original DealFlow look.',
    preferredMode: 'dark',
    dark: { background: '#070B1A', surface: '#10172D', foreground: '#F5F8FF', primary: '#00D9FF', secondary: '#4D8DFF', accent: '#8057FF', chart: ['#00D9FF', '#8057FF', '#00D49A', '#FFB547', '#FF6178', '#5B9BF0'] },
    light: { background: '#F7F9FD', surface: '#FFFFFF', foreground: '#0E1428', primary: '#007185', secondary: '#1F5FD1', accent: '#6A33FF', chart: ['#00879C', '#6A3BDB', '#008556', '#C26A00', '#C9304A', '#2563A8'] },
  },
  {
    id: 'obsidian',
    name: 'Obsidian Intelligence',
    description: 'Black and charcoal with electric violet.',
    preferredMode: 'dark',
    dark: { background: '#09090B', surface: '#141417', foreground: '#F4F4F6', primary: '#A78BFA', secondary: '#818CF8', accent: '#E879F9', chart: ['#A78BFA', '#38BDF8', '#34D399', '#FBBF24', '#F472B6', '#94A3B8'] },
    light: { background: '#F7F7F8', surface: '#FFFFFF', foreground: '#111114', primary: '#6D28D9', secondary: '#4F46E5', accent: '#A21CAF', chart: ['#6D28D9', '#0369A1', '#047857', '#B45309', '#BE185D', '#475569'] },
  },
  {
    id: 'sapphire',
    name: 'Midnight Sapphire',
    description: 'Navy and royal blue with cyan highlights.',
    preferredMode: 'dark',
    dark: { background: '#060D1F', surface: '#0D1830', foreground: '#EEF4FF', primary: '#5B8CFF', secondary: '#22D3EE', accent: '#38BDF8', chart: ['#5B8CFF', '#22D3EE', '#34D399', '#FBBF24', '#F87171', '#A78BFA'] },
    light: { background: '#F5F8FE', surface: '#FFFFFF', foreground: '#0B1530', primary: '#1D4ED8', secondary: '#0E7490', accent: '#0369A1', chart: ['#1D4ED8', '#0E7490', '#047857', '#B45309', '#B91C1C', '#6D28D9'] },
  },
  {
    id: 'aurora',
    name: 'Aurora Enterprise',
    description: 'Deep indigo with teal and violet.',
    preferredMode: 'dark',
    dark: { background: '#0B0A1F', surface: '#15132F', foreground: '#F1F0FF', primary: '#2DD4BF', secondary: '#8B5CF6', accent: '#C084FC', chart: ['#2DD4BF', '#8B5CF6', '#60A5FA', '#FBBF24', '#F472B6', '#A3E635'] },
    light: { background: '#F7F6FE', surface: '#FFFFFF', foreground: '#17133A', primary: '#0F766E', secondary: '#6D28D9', accent: '#7E22CE', chart: ['#0F766E', '#6D28D9', '#1D4ED8', '#B45309', '#BE185D', '#4D7C0F'] },
  },
  {
    id: 'arctic',
    name: 'Arctic Professional',
    description: 'White and slate with clear blue.',
    preferredMode: 'light',
    dark: { background: '#0E141B', surface: '#17202A', foreground: '#F1F5F9', primary: '#60A5FA', secondary: '#94A3B8', accent: '#38BDF8', chart: ['#60A5FA', '#94A3B8', '#34D399', '#FBBF24', '#F87171', '#A78BFA'] },
    light: { background: '#F8FAFC', surface: '#FFFFFF', foreground: '#0F172A', primary: '#2563EB', secondary: '#475569', accent: '#0284C7', chart: ['#2563EB', '#475569', '#059669', '#D97706', '#DC2626', '#7C3AED'] },
  },
  {
    id: 'pearl',
    name: 'Pearl Executive',
    description: 'Pearl white and champagne with graphite.',
    preferredMode: 'light',
    dark: { background: '#14120F', surface: '#1E1B17', foreground: '#F7F3EC', primary: '#E2C58F', secondary: '#B8B2A7', accent: '#D6A86B', chart: ['#E2C58F', '#B8B2A7', '#86C5A4', '#E8A87C', '#E07A7A', '#9FB4D9'] },
    light: { background: '#FAF8F4', surface: '#FFFFFF', foreground: '#26231F', primary: '#8A6A2F', secondary: '#4A4741', accent: '#9C5B1F', chart: ['#8A6A2F', '#4A4741', '#2F7A57', '#B45309', '#B42318', '#3B5B8C'] },
  },
  {
    id: 'emerald',
    name: 'Emerald Command',
    description: 'Forest green and mint on charcoal.',
    preferredMode: 'dark',
    dark: { background: '#0A110E', surface: '#121C17', foreground: '#EEF7F1', primary: '#4ADE80', secondary: '#6EE7B7', accent: '#A3E635', chart: ['#4ADE80', '#6EE7B7', '#60A5FA', '#FBBF24', '#F87171', '#C4B5FD'] },
    light: { background: '#F5FAF7', surface: '#FFFFFF', foreground: '#0F2219', primary: '#15803D', secondary: '#047857', accent: '#4D7C0F', chart: ['#15803D', '#047857', '#1D4ED8', '#B45309', '#B91C1C', '#6D28D9'] },
  },
  {
    id: 'titanium',
    name: 'Titanium Silver',
    description: 'Metallic grey with ice blue.',
    preferredMode: 'dark',
    dark: { background: '#121417', surface: '#1C1F23', foreground: '#F2F4F7', primary: '#93C5FD', secondary: '#CBD5E1', accent: '#7DD3FC', chart: ['#93C5FD', '#CBD5E1', '#6EE7B7', '#FCD34D', '#FCA5A5', '#C4B5FD'] },
    light: { background: '#F3F4F6', surface: '#FFFFFF', foreground: '#111827', primary: '#1E6FB8', secondary: '#4B5563', accent: '#0369A1', chart: ['#1E6FB8', '#4B5563', '#047857', '#B45309', '#B91C1C', '#6D28D9'] },
  },
  {
    id: 'solar',
    name: 'Solar Horizon',
    description: 'Warm ivory and amber with deep navy.',
    preferredMode: 'light',
    dark: { background: '#0D1324', surface: '#161D33', foreground: '#FBF6EC', primary: '#FBBF24', secondary: '#93C5FD', accent: '#FB923C', chart: ['#FBBF24', '#93C5FD', '#34D399', '#FB923C', '#F87171', '#C4B5FD'] },
    light: { background: '#FBF8F1', surface: '#FFFFFF', foreground: '#14213D', primary: '#B45309', secondary: '#1E3A8A', accent: '#C2410C', chart: ['#B45309', '#1E3A8A', '#047857', '#C2410C', '#B91C1C', '#6D28D9'] },
  },
  {
    id: 'rose',
    name: 'Rose Quartz',
    description: 'Soft rose and plum with neutral grey.',
    preferredMode: 'light',
    dark: { background: '#140E12', surface: '#1F171C', foreground: '#FBF1F5', primary: '#F9A8D4', secondary: '#C4B5FD', accent: '#F0ABFC', chart: ['#F9A8D4', '#C4B5FD', '#6EE7B7', '#FCD34D', '#FCA5A5', '#93C5FD'] },
    light: { background: '#FCF7F9', surface: '#FFFFFF', foreground: '#2A1A24', primary: '#BE185D', secondary: '#6B21A8', accent: '#86198F', chart: ['#BE185D', '#6B21A8', '#047857', '#B45309', '#9F1239', '#1D4ED8'] },
  },
  {
    id: 'cyber',
    name: 'Cyber Graphite',
    description: 'Graphite with electric cyan.',
    preferredMode: 'dark',
    dark: { background: '#0C0E10', surface: '#16191C', foreground: '#EDF6F8', primary: '#22D3EE', secondary: '#A1A1AA', accent: '#2DD4BF', chart: ['#22D3EE', '#A1A1AA', '#A3E635', '#FACC15', '#FB7185', '#818CF8'] },
    light: { background: '#F4F6F7', surface: '#FFFFFF', foreground: '#101415', primary: '#0E7490', secondary: '#52525B', accent: '#0F766E', chart: ['#0E7490', '#52525B', '#4D7C0F', '#A16207', '#BE123C', '#4338CA'] },
  },
  {
    id: 'oceanic',
    name: 'Oceanic Intelligence',
    description: 'Marine blue with turquoise.',
    preferredMode: 'dark',
    dark: { background: '#051419', surface: '#0B2028', foreground: '#ECFAFC', primary: '#2DD4BF', secondary: '#38BDF8', accent: '#5EEAD4', chart: ['#2DD4BF', '#38BDF8', '#A3E635', '#FBBF24', '#FB7185', '#A78BFA'] },
    light: { background: '#F2F9FA', surface: '#FFFFFF', foreground: '#082A33', primary: '#0F766E', secondary: '#0369A1', accent: '#115E59', chart: ['#0F766E', '#0369A1', '#4D7C0F', '#B45309', '#BE123C', '#6D28D9'] },
  },
  {
    id: 'custom',
    name: 'Custom Brand Studio',
    description: 'Your own palette: pick the primary, secondary, accent and background colours.',
    preferredMode: 'dark',
    dark: { background: '#0B0D12', surface: '#151821', foreground: '#F3F5F9', primary: '#4F8CFF', secondary: '#A0AEC0', accent: '#B07CFF', chart: ['#4F8CFF', '#B07CFF', '#34D399', '#FBBF24', '#F87171', '#94A3B8'] },
    light: { background: '#F7F8FA', surface: '#FFFFFF', foreground: '#10131A', primary: '#2F5FD0', secondary: '#4A5568', accent: '#7B3FE4', chart: ['#2F5FD0', '#7B3FE4', '#047857', '#B45309', '#B91C1C', '#475569'] },
  },
];

export function getTheme(id: ThemeId): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

const CHART_PRESETS: Record<Exclude<ChartPalette, 'theme'>, { dark: string[]; light: string[] }> = {
  vivid: {
    dark: ['#38BDF8', '#F472B6', '#A3E635', '#FB923C', '#C084FC', '#FACC15'],
    light: ['#0369A1', '#BE185D', '#4D7C0F', '#C2410C', '#7E22CE', '#A16207'],
  },
  calm: {
    dark: ['#93B4D9', '#B9A6D8', '#9CCBB4', '#D9C08F', '#D99B9B', '#A3B1C2'],
    light: ['#3F6A99', '#6B5B95', '#3E7B62', '#8C6D2E', '#9A4F4F', '#55657A'],
  },
  // Okabe–Ito, distinguishable with the common colour-vision deficiencies.
  colorblind: {
    dark: ['#56B4E9', '#E69F00', '#009E73', '#F0E442', '#CC79A7', '#D55E00'],
    light: ['#0072B2', '#B36B00', '#007A5A', '#8A7F00', '#A8457F', '#B34700'],
  },
};

const SEMANTIC = {
  dark: { success: '#00D49A', warning: '#FFB547', critical: '#FF6178', info: '#5BA8FF' },
  light: { success: '#007A5A', warning: '#995200', critical: '#BD1E3A', info: '#1F5FD1' },
};

const TONES = { neutral: [220, 6], cool: [222, 34], warm: [32, 30] } as const;

export const TOKEN_NAMES = [
  'background', 'foreground', 'surface', 'surface-raised', 'border', 'input', 'ring', 'primary', 'primary-foreground',
  'secondary', 'secondary-foreground', 'accent', 'accent-foreground', 'muted', 'muted-foreground', 'success', 'warning',
  'critical', 'critical-foreground', 'info', 'popover', 'popover-foreground', 'chart-1', 'chart-2', 'chart-3', 'chart-4',
  'chart-5', 'chart-6',
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

export interface ResolvedTheme {
  mode: 'dark' | 'light';
  /** Token values as hex, for contrast reports and previews. */
  hex: Record<TokenName, string>;
  /** Token values as "H S% L%" triplets for the CSS variables. */
  css: Record<TokenName, string>;
  /** Plain-language notes on colours that were adjusted to stay readable. */
  adjustments: string[];
}

export interface ContrastCheck {
  label: string;
  foreground: TokenName;
  background: TokenName;
  ratio: number;
  required: number;
  passes: boolean;
}

/** Resolves a theme with the person's overrides into concrete tokens for one mode. */
export function resolveTheme(a: Appearance, mode: 'dark' | 'light', opts: { brandColor?: string | null } = {}): ResolvedTheme {
  const theme = getTheme(a.themeId);
  const base = theme[mode];
  const dark = mode === 'dark';
  const adjustments: string[] = [];

  let background = base.background;
  let surface = base.surface;
  const customBg = a.themeId === 'custom' ? (dark ? a.backgroundDark : a.backgroundLight) : null;
  if (customBg) {
    background = customBg;
    surface = dark ? mix(customBg, '#FFFFFF', 0.05) : mix(customBg, '#FFFFFF', 0.85);
  } else if (a.backgroundTone !== 'theme') {
    const [h, s] = TONES[a.backgroundTone];
    background = setHsl(background, ([, , l]) => [h, dark ? s : s * 0.6, l]);
    surface = setHsl(surface, ([, , l]) => [h, dark ? s : s * 0.4, l]);
  }
  if (a.surfaceIntensity === 'subtle') surface = mix(surface, background, 0.5);
  if (a.surfaceIntensity === 'strong') {
    if (dark) surface = mix(surface, '#FFFFFF', 0.04);
    else background = mix(background, '#000000', 0.03);
  }

  const fgBase = customBg ? (isDarkColor(background) ? LIGHT_INK : '#10131A') : base.foreground;
  const foreground = ensureContrast(fgBase, [background, surface], 7);
  const surfaceRaised = mix(surface, foreground, dark ? 0.05 : 0.03);
  const muted = mix(background, foreground, dark ? 0.07 : 0.045);
  const mutedForeground = ensureContrast(mix(foreground, background, dark ? 0.32 : 0.38), [background, surface, surfaceRaised, muted], 4.5);
  const border = mix(surface, foreground, dark ? 0.14 : 0.13);
  const input = mix(surface, foreground, dark ? 0.2 : 0.22);

  // Text colours must read on the page, cards and muted areas, and on their own 10-15% tint (badges, active nav).
  const readable = (wanted: string, ratio = 4.5) => {
    let c = wanted;
    for (let i = 0; i < 3; i++) c = ensureContrast(c, [background, surface, surfaceRaised, muted, mix(surface, c, 0.15), mix(background, c, 0.15)], ratio);
    return c;
  };
  const fix = (name: string, wanted: string, ratio: number) => {
    const got = readable(wanted, ratio);
    if (got !== wanted.toUpperCase()) adjustments.push(`${name} was ${dark ? 'lightened' : 'darkened'} from ${wanted.toUpperCase()} to ${got} so text in it stays readable (${ratio}:1).`);
    return got;
  };
  const primaryWanted = a.primary ?? opts.brandColor ?? base.primary;
  const primary = a.primary || opts.brandColor ? fix('Primary', primaryWanted, 4.5) : readable(primaryWanted);
  const secondary = a.secondary ? fix('Secondary', a.secondary, 4.5) : readable(base.secondary);
  const accent = a.accent ? fix('Accent', a.accent, 4.5) : readable(base.accent);
  const ink = dark ? background : '#0B0F1A';

  const sem = SEMANTIC[mode];
  const success = readable(sem.success);
  const warning = readable(sem.warning);
  const critical = readable(sem.critical);
  const info = readable(sem.info);

  const chartSource = a.chartPalette === 'theme' ? base.chart : CHART_PRESETS[a.chartPalette][mode];
  const chart = chartSource.map((c) => ensureContrast(c, [surface], 3));

  const hexTokens: Record<TokenName, string> = {
    background: background.toUpperCase(),
    foreground,
    surface: surface.toUpperCase(),
    'surface-raised': surfaceRaised,
    border,
    input,
    ring: primary,
    primary,
    'primary-foreground': onColor(primary, ink),
    secondary,
    'secondary-foreground': onColor(secondary, ink),
    accent,
    'accent-foreground': onColor(accent, ink),
    muted,
    'muted-foreground': mutedForeground,
    success,
    warning,
    critical,
    'critical-foreground': onColor(critical, ink),
    info,
    popover: surface.toUpperCase(),
    'popover-foreground': foreground,
    'chart-1': chart[0]!,
    'chart-2': chart[1]!,
    'chart-3': chart[2]!,
    'chart-4': chart[3]!,
    'chart-5': chart[4]!,
    'chart-6': chart[5]!,
  };
  const css = Object.fromEntries(TOKEN_NAMES.map((k) => [k, hexToHslTriplet(hexTokens[k])])) as Record<TokenName, string>;
  return { mode, hex: hexTokens, css, adjustments };
}

const CHECKS: [string, TokenName, TokenName, number][] = [
  ['Body text on page', 'foreground', 'background', 4.5],
  ['Body text on cards', 'foreground', 'surface', 4.5],
  ['Secondary text on page', 'muted-foreground', 'background', 4.5],
  ['Secondary text on cards', 'muted-foreground', 'surface', 4.5],
  ['Primary button label', 'primary-foreground', 'primary', 4.5],
  ['Links and primary text', 'primary', 'surface', 4.5],
  ['Accent text', 'accent', 'surface', 4.5],
  ['Error text', 'critical', 'surface', 4.5],
  ['Warning text', 'warning', 'surface', 4.5],
  ['Success text', 'success', 'surface', 4.5],
  ['Focus ring against page', 'ring', 'background', 3],
  ['Chart series against cards', 'chart-1', 'surface', 3],
];

/** The WCAG checks the Theme Studio shows. Every built-in theme passes all of them (packages/types tests). */
export function contrastReport(t: ResolvedTheme): ContrastCheck[] {
  return CHECKS.map(([label, fg, bg, required]) => {
    const ratio = Math.round(contrastRatio(t.hex[fg], t.hex[bg]) * 100) / 100;
    return { label, foreground: fg, background: bg, ratio, required, passes: ratio >= required };
  });
}

// ───── Non-colour tokens ─────

const FONT_SCALE_VALUE: Record<FontScale, number> = { small: 0.9375, default: 1, large: 1.0625, larger: 1.125 };
const DENSITY_VALUE: Record<Density, { control: string; pad: string; cellY: string; gap: string }> = {
  comfortable: { control: '2.75rem', pad: '1.5rem', cellY: '0.875rem', gap: '1.5rem' },
  balanced: { control: '2.5rem', pad: '1.25rem', cellY: '0.625rem', gap: '1.25rem' },
  compact: { control: '2.25rem', pad: '1rem', cellY: '0.4375rem', gap: '1rem' },
  // Small buttons are floored at 24 px in CSS, the WCAG 2.2 minimum target size.
  ultra: { control: '2rem', pad: '0.75rem', cellY: '0.25rem', gap: '0.75rem' },
};
const SHADOW_VALUE = { none: '0', soft: '0.5', medium: '1', strong: '1.6' } as const;
const ICON_STROKE = { thin: '1.5', regular: '2', bold: '2.5' } as const;

/** CSS variables that do not depend on the colour mode. */
export function layoutVariables(a: Appearance): Record<string, string> {
  const d = DENSITY_VALUE[a.density];
  return {
    '--radius': `${a.radius / 16}rem`,
    '--font-scale': String(FONT_SCALE_VALUE[a.fontScale]),
    '--control-h': d.control,
    '--card-pad': d.pad,
    '--cell-py': d.cellY,
    '--layout-gap': d.gap,
    '--shadow-strength': SHADOW_VALUE[a.shadow],
    '--glass': String(a.glass / 100),
    '--icon-stroke': ICON_STROKE[a.iconStyle],
  };
}
