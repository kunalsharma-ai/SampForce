import { describe, expect, it } from 'vitest';
import { applyPattern, detectPattern, domainGuesses, finderSearchSchema, splitName } from './finder';

describe('email finder helpers', () => {
  it('fills and detects address patterns, ignoring accents', () => {
    expect(applyPattern('{first}.{last}', 'Tomás', 'Herrera')).toBe('tomas.herrera');
    expect(applyPattern('{f}{last}', 'Jane', "O'Neil")).toBe('joneil');
    expect(detectPattern('jdoe', 'Jane', 'Doe')).toBe('{f}{last}');
    expect(detectPattern('jane', 'Jane', 'Doe')).toBe('{first}');
    expect(detectPattern('sales', 'Jane', 'Doe')).toBeNull();
  });

  it('splits names into first and last', () => {
    expect(splitName('Jane van Doe')).toEqual({ first: 'Jane', last: 'vanDoe' });
    expect(splitName('Prince')).toBeNull();
  });

  it('guesses domains from a company name without legal suffixes', () => {
    const g = domainGuesses('Kestrel Analytics Ltd');
    expect(g.slice(0, 3)).toEqual(['kestrelanalytics.com', 'kestrel-analytics.com', 'kestrel.com']);
    expect(g).toContain('kestrel-analytics.com');
    expect(g).toContain('kestrel.com');
    expect(domainGuesses('Acme')).toContain('acme.com');
    expect(domainGuesses('!!')).toEqual([]);
  });

  it('needs both names or neither', () => {
    expect(finderSearchSchema.safeParse({ company: 'Acme', firstName: 'Jane' }).success).toBe(false);
    expect(finderSearchSchema.safeParse({ company: 'Acme', firstName: 'Jane', lastName: 'Doe' }).success).toBe(true);
  });
});
