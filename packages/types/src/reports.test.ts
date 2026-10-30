import { describe, expect, it } from 'vitest';
import { REPORT_TEMPLATES, reportDefinitionSchema } from './reports';

describe('report definitions', () => {
  it('accepts every built-in template', () => {
    for (const t of REPORT_TEMPLATES) expect(reportDefinitionSchema.safeParse(t.definition).success).toBe(true);
  });

  it('checks fields, operators and values against the catalogue', () => {
    const ok = (d: object) => reportDefinitionSchema.safeParse({ entity: 'deals', metric: { fn: 'count' }, ...d }).success;
    expect(ok({ filters: [{ field: 'amount', op: 'gte', value: 10 }] })).toBe(true);
    expect(ok({ filters: [{ field: 'amount', op: 'contains', value: '1' }] })).toBe(false);
    expect(ok({ filters: [{ field: 'closedAt', op: 'gte', value: '2026-13' }] })).toBe(false);
    expect(ok({ filters: [{ field: 'status', op: 'in', value: ['OPEN', 'WON'] }] })).toBe(true);
    expect(ok({ filters: [{ field: 'status', op: 'is_empty', value: 'x' }] })).toBe(false);
    expect(ok({ groupBy: { field: 'name' } })).toBe(false);
    expect(ok({ groupBy: { field: 'stage', bucket: 'month' } })).toBe(false);
    expect(ok({ groupBy: { field: 'stage' }, chart: 'line' })).toBe(false);
    expect(ok({ metric: { fn: 'count', field: 'amount' } })).toBe(false);
    expect(ok({ metric: { fn: 'avg', field: 'probability' }, chart: 'number' })).toBe(true);
  });
});
