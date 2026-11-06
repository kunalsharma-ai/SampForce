import { describe, expect, it } from 'vitest';
import {
  appearanceSchema,
  CHART_PALETTES,
  contrastRatio,
  contrastReport,
  DEFAULT_APPEARANCE,
  ensureContrast,
  layoutVariables,
  normalizeAppearance,
  resolveTheme,
  THEMES,
} from './appearance';

describe('theme catalogue', () => {
  it('has the 12 themes from the design spec plus the SampForce signature theme', () => {
    expect(THEMES.map((t) => t.name)).toEqual([
      'SampForce Signature',
      'Obsidian Intelligence',
      'Midnight Sapphire',
      'Aurora Enterprise',
      'Arctic Professional',
      'Pearl Executive',
      'Emerald Command',
      'Titanium Silver',
      'Solar Horizon',
      'Rose Quartz',
      'Cyber Graphite',
      'Oceanic Intelligence',
      'Custom Brand Studio',
    ]);
  });

  for (const theme of THEMES) {
    for (const mode of ['dark', 'light'] as const) {
      for (const chartPalette of CHART_PALETTES) {
        it(`${theme.name} (${mode}, ${chartPalette} charts) passes every WCAG AA check`, () => {
          const resolved = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: theme.id, chartPalette }, mode);
          const failing = contrastReport(resolved).filter((c) => !c.passes);
          expect(failing).toEqual([]);
        });
      }
    }
  }
});

describe('custom colours', () => {
  it('darkens a pale brand colour in light mode until text in it is readable', () => {
    const t = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: 'custom', primary: '#FFE066' }, 'light');
    expect(contrastRatio(t.hex.primary, t.hex.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.hex['primary-foreground'], t.hex.primary)).toBeGreaterThanOrEqual(4.5);
    expect(t.adjustments[0]).toMatch(/^Primary was darkened from #FFE066/);
  });

  it('lightens a dark brand colour on a dark background', () => {
    const t = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: 'obsidian', accent: '#2A0F5C' }, 'dark');
    expect(contrastRatio(t.hex.accent, t.hex.surface)).toBeGreaterThanOrEqual(4.5);
    expect(t.adjustments.some((a) => a.startsWith('Accent was lightened'))).toBe(true);
  });

  it('keeps readable colours unchanged and reports nothing', () => {
    const t = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: 'arctic', primary: '#1D4ED8' }, 'light');
    expect(t.hex.primary).toBe('#1D4ED8');
    expect(t.adjustments).toEqual([]);
  });

  it('derives readable text for a user-defined background', () => {
    for (const [mode, bg] of [['dark', '#1A0B2E'], ['light', '#FFF4E0'], ['dark', '#3A3A3A']] as const) {
      const t = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: 'custom', backgroundDark: bg, backgroundLight: bg }, mode);
      expect(t.hex.background).toBe(bg);
      expect(contrastReport(t).filter((c) => !c.passes)).toEqual([]);
    }
  });

  it('applies a workspace brand colour when the person has not picked one', () => {
    const t = resolveTheme(DEFAULT_APPEARANCE, 'dark', { brandColor: '#FF5A1F' });
    expect(t.hex.primary).toBe('#FF5A1F');
    const own = resolveTheme({ ...DEFAULT_APPEARANCE, primary: '#22C55E' }, 'dark', { brandColor: '#FF5A1F' });
    expect(own.hex.primary).toBe('#22C55E');
  });

  it('background tones and surface intensity stay readable', () => {
    for (const backgroundTone of ['neutral', 'cool', 'warm'] as const) {
      for (const surfaceIntensity of ['subtle', 'strong'] as const) {
        for (const mode of ['dark', 'light'] as const) {
          const t = resolveTheme({ ...DEFAULT_APPEARANCE, themeId: 'pearl', backgroundTone, surfaceIntensity }, mode);
          expect(contrastReport(t).filter((c) => !c.passes)).toEqual([]);
        }
      }
    }
  });
});

describe('ensureContrast', () => {
  it('returns the colour when it already passes', () => {
    expect(ensureContrast('#000000', ['#FFFFFF'], 4.5)).toBe('#000000');
  });
  it('moves lightness away from the background', () => {
    const c = ensureContrast('#777777', ['#FFFFFF'], 7);
    expect(contrastRatio(c, '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });
});

describe('settings', () => {
  it('fills gaps from older or partial settings and drops invalid values', () => {
    const a = normalizeAppearance({ themeId: 'rose', radius: 999, density: 'compact', nonsense: true });
    expect(a.themeId).toBe('rose');
    expect(a.radius).toBe(DEFAULT_APPEARANCE.radius);
    expect(a.density).toBe('compact');
    expect('nonsense' in a).toBe(false);
    expect(appearanceSchema.safeParse(a).success).toBe(true);
  });

  it('rejects unknown keys and out-of-range values', () => {
    expect(appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, extra: 1 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, glass: 101 }).success).toBe(false);
    expect(appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, primary: 'red' }).success).toBe(false);
  });

  it('ultra-compact controls stay above the 24px WCAG target size', () => {
    const v = layoutVariables({ ...DEFAULT_APPEARANCE, density: 'ultra', fontScale: 'small' });
    expect(parseFloat(v['--control-h']!) * 16 * parseFloat(v['--font-scale']!)).toBeGreaterThanOrEqual(24);
  });
});
