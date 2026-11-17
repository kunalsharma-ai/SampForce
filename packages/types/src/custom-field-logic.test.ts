import { describe, expect, it } from 'vitest';
import { conditionLoop, conditionPasses, evaluateFormula, formulaLoop, parseFormula, resolveFields } from './custom-field-logic';
import { customFieldDefSchema } from './custom-fields';

const run = (f: string, values: Record<string, unknown> = {}) => {
  const p = parseFormula(f);
  if (!p.ok) throw new Error(p.error);
  return evaluateFormula(p.node, (k) => values[k]);
};

describe('formulas', () => {
  it('follows precedence, brackets and unary minus', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-2 * -(3 - 1)')).toBe(4);
    expect(run('10 / 4 - .5')).toBe(2);
  });
  it('reads numbers, numeric text and currency amounts, and is empty when a field is', () => {
    expect(run('{sample_size} * {cpi}', { sample_size: 400, cpi: { amount: 2.5, currency: 'USD' } })).toBe(1000);
    expect(run('{a} + 1', { a: '4' })).toBe(5);
    expect(run('{a} + 1', {})).toBeNull();
    expect(run('{a} / {b}', { a: 1, b: 0 })).toBeNull();
  });
  it('lists the fields it uses and explains mistakes', () => {
    const p = parseFormula('{a} * ({b} + {a})');
    expect(p.ok && p.refs.sort()).toEqual(['a', 'b']);
    expect(parseFormula('')).toEqual({ ok: false, error: 'Enter a formula' });
    expect(parseFormula('(1 + 2')).toEqual({ ok: false, error: 'A bracket is not closed' });
    expect(parseFormula('1 +')).toEqual({ ok: false, error: 'The formula ends too early' });
    expect(parseFormula('{Bad Key}')).toMatchObject({ ok: false });
    expect(parseFormula('2 ^ 3')).toMatchObject({ ok: false });
    expect(parseFormula('1)')).toEqual({ ok: false, error: 'A closing bracket has no opening one' });
  });
  it('spots a formula that uses itself through another', () => {
    const defs = [{ key: 'b', type: 'FORMULA' as const, formula: '{c} * 2' }, { key: 'c', type: 'FORMULA' as const, formula: '{a}' }];
    expect(formulaLoop(defs, 'a', '{b} + 1')).toBe(true);
    expect(formulaLoop(defs, 'a', '{x} + 1')).toBe(false);
  });
  it('needs a formula on a formula field', () => {
    expect(customFieldDefSchema.safeParse({ entity: 'RFQ', key: 'total', label: 'Total', type: 'FORMULA' }).success).toBe(false);
    expect(customFieldDefSchema.safeParse({ entity: 'RFQ', key: 'total', label: 'Total', type: 'FORMULA', formula: '{a} * 2' }).success).toBe(true);
  });
});

describe('conditions', () => {
  it('tests each kind of field', () => {
    expect(conditionPasses('SELECT', { key: 'x', op: 'eq', value: 'Gold' }, 'gold')).toBe(true);
    expect(conditionPasses('SELECT', { key: 'x', op: 'in', value: ['Gold', 'Silver'] }, 'Bronze')).toBe(false);
    expect(conditionPasses('BOOLEAN', { key: 'x', op: 'eq', value: true }, true)).toBe(true);
    expect(conditionPasses('BOOLEAN', { key: 'x', op: 'eq', value: true }, undefined)).toBe(false);
    expect(conditionPasses('NUMBER', { key: 'x', op: 'gte', value: 100 }, '150')).toBe(true);
    expect(conditionPasses('CURRENCY', { key: 'x', op: 'lte', value: 10 }, { amount: 12, currency: 'USD' })).toBe(false);
    expect(conditionPasses('TEXT', { key: 'x', op: 'set' }, '')).toBe(false);
    expect(conditionPasses('MULTISELECT', { key: 'x', op: 'in', value: ['UK'] }, ['India', 'UK'])).toBe(true);
    expect(conditionPasses('DATE', { key: 'x', op: 'gte', value: '2026-01-01' }, '2026-03-01')).toBe(true);
  });
  it('hides a chain below the first failing condition and calculates only shown formulas', () => {
    const defs = [
      { key: 'nda', type: 'BOOLEAN' as const },
      { key: 'nda_date', type: 'DATE' as const, showWhen: { key: 'nda', op: 'eq' as const, value: true } },
      { key: 'nda_note', type: 'TEXT' as const, showWhen: { key: 'nda_date', op: 'set' as const } },
      { key: 'size', type: 'NUMBER' as const },
      { key: 'cpi', type: 'CURRENCY' as const },
      { key: 'total', type: 'FORMULA' as const, formula: '{size} * {cpi}', decimals: 2 },
      { key: 'per_k', type: 'FORMULA' as const, formula: '{total} / 1000', decimals: 3, showWhen: { key: 'total', op: 'gte' as const, value: 500 } },
    ];
    const values: Record<string, unknown> = { nda: false, nda_date: '2026-01-01', size: 300, cpi: { amount: 2.555, currency: 'USD' } };
    const r = resolveFields(defs, (k) => values[k]);
    expect([...r.shown].sort()).toEqual(['cpi', 'nda', 'per_k', 'size', 'total']);
    expect(r.computed.get('total')).toBe(766.5);
    expect(r.computed.get('per_k')).toBe(0.767);
    values.nda = true;
    values.size = 1;
    const r2 = resolveFields(defs, (k) => values[k]);
    expect(r2.shown.has('nda_note')).toBe(true);
    expect(r2.shown.has('per_k')).toBe(false);
    expect(r2.computed.get('per_k')).toBeNull();
  });
  it('spots a loop of conditions', () => {
    const defs = [{ key: 'a', showWhen: { key: 'b', op: 'set' as const } }, { key: 'b', showWhen: null }];
    expect(conditionLoop(defs, 'b', { key: 'a', op: 'set' })).toBe(true);
    expect(conditionLoop(defs, 'b', null)).toBe(false);
  });
});
