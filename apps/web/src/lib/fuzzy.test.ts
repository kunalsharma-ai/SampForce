import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyScore('Deals', '  ')).toBe(0);
  });
  it('finds substrings and initials, and rejects letters out of order', () => {
    expect(fuzzyScore('Quick Bid Studio', 'bid')).not.toBeNull();
    expect(fuzzyScore('Quick Bid Studio', 'qbs')).not.toBeNull();
    expect(fuzzyScore('Quick Bid Studio', 'sbq')).toBeNull();
    expect(fuzzyScore('Leads', 'deals')).toBeNull();
  });
  it('does not let scattered letters in a long text match a sentence', () => {
    expect(fuzzyScore('Email Finder Find and verify work emails for contacts at target companies', 'which deals slip this month')).toBeNull();
  });
  it('needs every word', () => {
    expect(fuzzyScore('Email & Communication', 'email comm')).not.toBeNull();
    expect(fuzzyScore('Email & Communication', 'email deal')).toBeNull();
  });
  it('ranks a prefix above a word start above a mid-word hit above a subsequence', () => {
    const prefix = fuzzyScore('Deals', 'de')!;
    const wordStart = fuzzyScore('Win deals', 'de')!;
    const inside = fuzzyScore('Ideas', 'de')!;
    const subseq = fuzzyScore('Dashboard editor', 'de')!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inside);
    expect(fuzzyScore('Dxxe', 'de')!).toBeLessThan(inside);
    expect(subseq).toBeGreaterThan(0);
  });
});

describe('fuzzyFilter', () => {
  const items = ['Command Center', 'Leads', 'Contacts', 'Companies', 'Deals', 'Pipelines'];
  it('keeps the original order without a query', () => {
    expect(fuzzyFilter(items, '', (s) => s)).toEqual(items);
  });
  it('drops non-matches and puts the best match first', () => {
    expect(fuzzyFilter(items, 'co', (s) => s)).toEqual(['Command Center', 'Contacts', 'Companies']);
    expect(fuzzyFilter(items, 'pip', (s) => s)).toEqual(['Pipelines']);
    expect(fuzzyFilter(items, 'tacts', (s) => s)).toEqual(['Contacts']);
  });
});
