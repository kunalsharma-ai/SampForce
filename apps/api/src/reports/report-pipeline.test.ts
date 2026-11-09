import { reportDefinitionSchema } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { bucketLabel, humanizeEnum } from './report-labels';
import { groupedPipeline, totalsPipeline } from './report-pipeline';

const ctx = { tenantId: '00000000-0000-0000-0000-000000000001', baseCurrency: 'USD', timezone: 'Asia/Kolkata', rates: new Map([['EUR', 1.1]]) };

/** Every object key in the pipeline: operators and field names, never values. */
function keys(x: unknown, out: string[] = []): string[] {
  if (Array.isArray(x)) for (const v of x) keys(v, out);
  else if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      if (k !== '$literal') keys(v, out);
    }
  }
  return out;
}

describe('report pipeline', () => {
  it('keeps user values out of operators and field paths', () => {
    const def = reportDefinitionSchema.parse({
      entity: 'deals', metric: { fn: 'sum', field: 'amount' }, groupBy: { field: 'owner' }, chart: 'bar',
      filters: [{ field: 'name', op: 'contains', value: '$where.*' }, { field: 'country', op: 'in', value: ['de', 'IN'] }, { field: 'stage', op: 'eq', value: '$ne' }],
    });
    for (const p of [groupedPipeline(def, ctx), totalsPipeline(def, ctx)]) {
      const json = JSON.stringify(p);
      expect(keys(p).filter((k) => k.includes('where'))).toEqual([]);
      expect(json).toContain('{"$literal":"\\\\$where\\\\.\\\\*"}');
      expect(json).toContain('{"$literal":["DE","IN"]}');
      expect(json).toContain('{"$literal":"$ne"}');
      expect(json).not.toContain('"$$where');
      expect((p[0] as { $match: { tenant_id: string } }).$match.tenant_id).toBe(ctx.tenantId);
    }
  });

  it('matches the workspace in every join', () => {
    const def = reportDefinitionSchema.parse({ entity: 'deals', metric: { fn: 'count' }, groupBy: { field: 'stage' }, chart: 'bar', filters: [] });
    const lookups = groupedPipeline(def, ctx).filter((s) => '$lookup' in s) as Array<{ $lookup: { pipeline: unknown[] } }>;
    expect(lookups.length).toBe(3);
    for (const l of lookups) expect(JSON.stringify(l.$lookup.pipeline)).toContain(`{"$eq":["$tenant_id",{"$literal":"${ctx.tenantId}"}]}`);
  });

  it('labels buckets and enum values', () => {
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026');
    expect(bucketLabel('2026-10-01', 'quarter')).toBe('2026 Q4');
    expect(bucketLabel('2026-01-01', 'year')).toBe('2026');
    expect(humanizeEnum('PENDING_APPROVAL')).toBe('Pending approval');
  });
});
