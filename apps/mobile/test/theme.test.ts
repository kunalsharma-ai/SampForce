import { describe, expect, it } from 'vitest';
import { contrast, readableOn, themeFor } from '../src/lib/theme';

describe('brand colours as text', () => {
  it('darkens a light brand colour just enough to read on a white card', () => {
    const c = readableOn('#0EA5E9', '#FFFFFF', '#000000');
    expect(contrast(c, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#0EA5E9', '#FFFFFF')).toBeLessThan(4.5);
    // A colour that already reads is kept as it is.
    expect(readableOn('#B91C1C', '#FFFFFF', '#000000')).toBe('#B91C1C');
  });

  it('gives every theme a readable primary text colour, light and dark', () => {
    for (const primaryColor of ['#0EA5E9', '#E11D48', '#FACC15', '#1E293B']) {
      for (const theme of ['light', 'dark'] as const) {
        const th = themeFor({ primaryColor, accentColor: '#7C3AED', theme }, false);
        expect(contrast(th.primaryText, th.card), `${primaryColor} ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
