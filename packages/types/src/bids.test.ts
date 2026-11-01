import { describe, expect, it } from 'vitest';
import { contrastRatio } from './appearance';
import { BID_TEMPLATES, bidStyle, bidTemplateKeySchema, quoteInputSchema, textOn } from './index';

describe('bid templates', () => {
  it('has ten templates with unique keys, valid accents and starting sections', () => {
    expect(BID_TEMPLATES).toHaveLength(10);
    expect(new Set(BID_TEMPLATES.map((t) => t.key)).size).toBe(10);
    for (const t of BID_TEMPLATES) {
      expect(t.style.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.sections.length).toBeGreaterThan(0);
      expect(bidTemplateKeySchema.safeParse(t.key).success).toBe(true);
    }
  });

  it('resolves the look: accent override, then template, then brand colour', () => {
    expect(bidStyle('dark-luxury', null)).toEqual({ templateKey: 'dark-luxury', accent: '#b08d57', font: 'serif', cover: 'dark' });
    expect(bidStyle('dark-luxury', '#123456').accent).toBe('#123456');
    expect(bidStyle(null, null, '#ff0000')).toEqual({ templateKey: null, accent: '#ff0000', font: 'sans', cover: 'minimal' });
    expect(bidStyle('gone', null)).toMatchObject({ templateKey: null, accent: '#2563eb' });
  });

  it('picks band text that meets large-text contrast on every template accent', () => {
    for (const t of BID_TEMPLATES) expect(contrastRatio(textOn(t.style.accent), t.style.accent)).toBeGreaterThanOrEqual(3);
    expect(textOn('#fde047')).toBe('#111111');
    expect(textOn('#1e3a8a')).toBe('#ffffff');
  });

  it('validates template and accent on quotes', () => {
    const base = { opportunityId: '00000000-0000-4000-8000-000000000000' };
    expect(quoteInputSchema.safeParse({ ...base, templateKey: 'modern-blue', accentColor: '#AABBCC' }).success).toBe(true);
    expect(quoteInputSchema.safeParse({ ...base, templateKey: 'nope' }).success).toBe(false);
    expect(quoteInputSchema.safeParse({ ...base, accentColor: 'red' }).success).toBe(false);
  });
});
