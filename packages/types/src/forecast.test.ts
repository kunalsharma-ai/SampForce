import { describe, expect, it } from 'vitest';
import { creditsFor, monthlyCreditAllowance } from './ai';
import { compareLines, computeTotals, type ForecastLine, quarterPeriod } from './forecast';

const line = (dealId: string, amount: number, probability: number, status: 'OPEN' | 'WON' = 'OPEN', extra: Partial<ForecastLine> = {}): ForecastLine => ({
  dealId, name: dealId, amount, probability, status, stage: 'Proposal', owner: null, closeDate: '2026-11-15', ...extra,
});

describe('forecast math', () => {
  const lines = [line('w', 10_000, 100, 'WON'), line('c', 20_000, 80), line('b', 10_000, 50), line('p', 5_000, 10)];

  it('splits deals into categories and scenarios', () => {
    expect(computeTotals(lines)).toEqual({
      won: 10_000, commit: 20_000, bestCase: 10_000, pipeline: 5_000,
      weighted: 16_000 + 5_000 + 500, worst: 10_000, base: 31_500, best: 40_000, dealCount: 4,
    });
  });

  it('is reproducible regardless of line order', () => {
    expect(computeTotals([...lines].reverse())).toEqual(computeTotals(lines));
    expect(computeTotals(JSON.parse(JSON.stringify(lines)))).toEqual(computeTotals(lines));
  });

  it('rounds to cents without drift', () => {
    expect(computeTotals([line('a', 0.1, 33), line('b', 0.2, 33)]).weighted).toBe(0.1);
  });

  it('resolves quarters', () => {
    expect(quarterPeriod('2026-Q4')).toEqual({ start: '2026-10-01', end: '2027-01-01', label: '2026-Q4' });
    expect(quarterPeriod(undefined, new Date('2026-02-03T00:00:00Z')).label).toBe('2026-Q1');
  });

  it('lists deal-level changes between snapshots', () => {
    const after = [line('w', 10_000, 100, 'WON'), line('c', 25_000, 80), line('b', 10_000, 50, 'WON'), line('n', 3_000, 20)];
    const kinds = compareLines(lines, after).map((c) => `${c.dealId}:${c.kind}`);
    expect(kinds.sort()).toEqual(['b:won', 'c:amount', 'n:added', 'p:removed'].sort());
  });
});

describe('AI credits', () => {
  it('charges one credit for a standard step and more for heavier tiers', () => {
    expect(creditsFor(3000, 500, 'fast')).toBe(1);
    expect(creditsFor(3001, 500, 'fast')).toBe(2);
    expect(creditsFor(100, 10, 'balanced')).toBe(2);
    expect(creditsFor(100, 10, 'deep')).toBe(4);
  });

  it('pools the per-seat allowance', () => {
    expect(monthlyCreditAllowance('growth', 3)).toBe(1500);
    expect(monthlyCreditAllowance('unknown', 0)).toBe(50);
  });
});
