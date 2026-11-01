import { describe, expect, it } from 'vitest';
import { bucketStart, buckets, type FunnelStage, growth, quarterBounds, ratio, round, stageFunnel } from './kpi-math';

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

describe('chart helpers', () => {
  it('buckets by Monday weeks and by months', () => {
    expect(bucketStart(new Date('2026-11-05T10:00:00Z'), 'week').toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(bucketStart(new Date('2026-11-02T00:00:00Z'), 'week').toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(bucketStart(new Date('2026-11-01T23:00:00Z'), 'week').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(buckets(new Date('2026-09-15Z'), new Date('2026-11-01Z'), 'month').map((d) => d.toISOString().slice(0, 7))).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(buckets(new Date('2026-10-01Z'), new Date('2026-10-31Z'), 'week')).toHaveLength(5);
  });

  it('counts deals through the funnel and computes stage-to-stage conversion', () => {
    const stages: FunnelStage[] = [
      { id: 'q', position: 0, category: 'OPEN' },
      { id: 'd', position: 1, category: 'OPEN' },
      { id: 'p', position: 2, category: 'OPEN' },
      { id: 'w', position: 3, category: 'WON' },
      { id: 'l', position: 4, category: 'LOST' },
    ];
    const rows = stageFunnel(stages, [
      { status: 'OPEN', currentStageId: 'q', enteredStageIds: ['q'] },
      { status: 'OPEN', currentStageId: 'd', enteredStageIds: [] }, // created straight into Discovery
      { status: 'LOST', currentStageId: 'l', enteredStageIds: ['q', 'd', 'l'] },
      { status: 'WON', currentStageId: 'w', enteredStageIds: ['q', 'w'] },
    ]);
    expect(rows.map((r) => [r.stageId, r.reached])).toEqual([['q', 4], ['d', 3], ['p', 1], ['w', 1]]);
    expect(rows[0]!.conversion).toBeNull();
    expect(rows[1]!.conversion).toBeCloseTo(0.75);
    expect(rows[3]!.conversion).toBe(1);
  });

  it('handles an empty pipeline', () => {
    expect(stageFunnel([{ id: 'q', position: 0, category: 'OPEN' }], [])).toEqual([{ stageId: 'q', reached: 0, conversion: null }]);
  });
});
