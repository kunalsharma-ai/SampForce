import { reportDefinitionSchema } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { bucketLabel, humanizeEnum } from './report-labels';
import { groupedQuery, likePattern, totalsQuery } from './report-sql';

const ctx = { tenantId: '00000000-0000-0000-0000-000000000001', baseCurrency: 'USD', timezone: 'Asia/Kolkata' };

describe('report SQL', () => {
  it('binds every user value as a parameter', () => {
    const def = reportDefinitionSchema.parse({
      entity: 'deals', metric: { fn: 'sum', field: 'amount' }, groupBy: { field: 'owner' }, chart: 'bar',
      filters: [{ field: 'name', op: 'contains', value: "'; DROP TABLE opportunities; --" }, { field: 'country', op: 'in', value: ['de', 'IN'] }],
    });
    for (const q of [groupedQuery(def, ctx), totalsQuery(def, ctx)]) {
      expect(q.sql).not.toContain('DROP');
      expect(q.sql).not.toContain('Asia/Kolkata');
      expect(q.values).toContain("%'; DROP TABLE opportunities; --%");
      expect(q.values).toContainEqual(['DE', 'IN']);
      expect(q.sql).toMatch(/e\.tenant_id = (\$\d+|\?)/);
    }
  });

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('labels buckets and enum values', () => {
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026');
    expect(bucketLabel('2026-10-01', 'quarter')).toBe('2026 Q4');
    expect(bucketLabel('2026-01-01', 'year')).toBe('2026');
    expect(humanizeEnum('PENDING_APPROVAL')).toBe('Pending approval');
  });
});
