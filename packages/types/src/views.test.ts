import { describe, expect, it } from 'vitest';
import { bulkActionSchema, parseSortParam, sortParam, viewConfigSchema } from './views';

describe('sort parameters', () => {
  it('round-trips a multi-column sort', () => {
    const s = [{ id: 'status', desc: false }, { id: 'createdAt', desc: true }];
    expect(sortParam(s)).toBe('status,-createdAt');
    expect(parseSortParam('status,-createdAt')).toEqual([{ field: 'status', desc: false }, { field: 'createdAt', desc: true }]);
  });
  it('keeps the legacy single key with order', () => {
    expect(parseSortParam('amount', 'asc')).toEqual([{ field: 'amount', desc: false }]);
    expect(parseSortParam('amount')).toEqual([{ field: 'amount', desc: true }]);
    expect(parseSortParam(undefined)).toEqual([]);
    expect(sortParam([])).toBeUndefined();
  });
  it('caps at three keys', () => {
    expect(parseSortParam('a,b,c,d')).toHaveLength(3);
  });
});

describe('view config', () => {
  it('fills defaults and rejects odd column ids', () => {
    expect(viewConfigSchema.parse({ columns: ['name'] })).toEqual({ columns: ['name'], widths: {}, sort: [], filters: {}, q: '', density: 'auto' });
    expect(viewConfigSchema.safeParse({ columns: ['name;drop'] }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ columns: [] }).success).toBe(false);
    expect(viewConfigSchema.safeParse({ columns: ['name'], widths: { name: 5000 } }).success).toBe(false);
  });
});

describe('bulk actions', () => {
  const id = '6f1c1d9e-8f0b-4c55-9b8a-0a6b9f2f8e11';
  it('needs an owner to assign and a status to change status', () => {
    expect(bulkActionSchema.safeParse({ entity: 'leads', ids: [id], action: 'assign' }).success).toBe(false);
    expect(bulkActionSchema.safeParse({ entity: 'leads', ids: [id], action: 'status' }).success).toBe(false);
    expect(bulkActionSchema.safeParse({ entity: 'leads', ids: [id], action: 'delete' }).success).toBe(true);
    expect(bulkActionSchema.safeParse({ entity: 'leads', ids: [], action: 'delete' }).success).toBe(false);
  });
});
