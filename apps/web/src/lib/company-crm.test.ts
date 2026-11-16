import { DEFAULT_STATUSES } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { textOn } from './company-crm';

const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('status chip text', () => {
  it('reaches WCAG AA on every starter status colour', () => {
    for (const s of [...DEFAULT_STATUSES.COMPANY, ...DEFAULT_STATUSES.EMPLOYEE]) expect(contrast(s.color, textOn(s.color)), s.name).toBeGreaterThanOrEqual(4.5);
  });
  it('reaches WCAG AA on any colour an administrator picks', () => {
    for (let n = 0; n < 0x1000000; n += 4099) {
      const hex = `#${n.toString(16).padStart(6, '0')}`;
      expect(contrast(hex, textOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
  });
});
