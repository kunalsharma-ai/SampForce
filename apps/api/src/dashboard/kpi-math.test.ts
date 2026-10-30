import { describe, expect, it } from 'vitest';
import { growth, quarterBounds, ratio, round } from './kpi-math';

describe('kpi math', () => {
  it('returns null instead of dividing by zero', () => {
    expect(ratio(3, 0)).toBeNull();
    expect(growth(10, 0)).toBeNull();
  });

  it('computes growth against the previous period', () => {
    expect(growth(150, 100)).toBeCloseTo(0.5);
    expect(growth(50, 100)).toBeCloseTo(-0.5);
  });

  it('finds calendar quarter bounds in UTC', () => {
    const { start, end } = quarterBounds(new Date('2026-11-15T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rounds and preserves null', () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(null)).toBeNull();
  });
});
