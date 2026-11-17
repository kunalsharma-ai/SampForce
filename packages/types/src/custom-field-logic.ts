import type { CustomFieldFilter, CustomFieldType } from './custom-fields';

/*
 * Conditional and formula custom fields (ADR 0062). The same code runs in the browser (forms show, hide and
 * calculate as people type) and on the server (which decides what is stored), so the two never disagree.
 */

// ───────────── Formulas ─────────────

/** A parsed formula: numbers, `{field_key}` references, + - * / and brackets. */
export type FormulaNode =
  | { k: 'num'; v: number }
  | { k: 'ref'; key: string }
  | { k: 'neg'; a: FormulaNode }
  | { k: 'op'; op: '+' | '-' | '*' | '/'; a: FormulaNode; b: FormulaNode };

/** Field types a formula can use. */
export const FORMULA_INPUT_TYPES: readonly CustomFieldType[] = ['NUMBER', 'CURRENCY', 'FORMULA'];

export type FormulaParse = { ok: true; node: FormulaNode; refs: string[] } | { ok: false; error: string };

/** Parses a formula. The error is a short sentence for the person typing it. */
export function parseFormula(text: string): FormulaParse {
  const src = text.trim();
  if (!src) return { ok: false, error: 'Enter a formula' };
  let i = 0;
  const refs = new Set<string>();
  const skip = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const fail = (error: string): never => {
    throw new FormulaError(error);
  };
  let depth = 0;
  const primary = (): FormulaNode => {
    skip();
    const c = src[i];
    if (c === undefined) return fail('The formula ends too early');
    if (c === '(') {
      i++;
      if (++depth > 20) fail('Too many brackets');
      const n = expr();
      skip();
      if (src[i] !== ')') fail('A bracket is not closed');
      i++;
      depth--;
      return n;
    }
    if (c === '-' || c === '+') {
      i++;
      const a = primary();
      return c === '-' ? { k: 'neg', a } : a;
    }
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) fail('A field name is not closed with }');
      const key = src.slice(i + 1, end).trim();
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) fail(`“${key}” is not a field key`);
      i = end + 1;
      refs.add(key);
      return { k: 'ref', key };
    }
    const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (!m) return fail(`Unexpected “${c}”`);
    i += m[0].length;
    return { k: 'num', v: Number(m[0]) };
  };
  const term = (): FormulaNode => {
    let a = primary();
    for (;;) {
      skip();
      const c = src[i];
      if (c !== '*' && c !== '/') return a;
      i++;
      a = { k: 'op', op: c, a, b: primary() };
    }
  };
  const expr = (): FormulaNode => {
    let a = term();
    for (;;) {
      skip();
      const c = src[i];
      if (c !== '+' && c !== '-') return a;
      i++;
      a = { k: 'op', op: c, a, b: term() };
    }
  };
  try {
    const node = expr();
    skip();
    if (i < src.length) fail(src[i] === ')' ? 'A closing bracket has no opening one' : `Unexpected “${src[i]}”`);
    return { ok: true, node, refs: [...refs] };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}

class FormulaError extends Error {}

/** A number from a stored or typed value: numbers, numeric text and currency amounts. */
export function numericValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v && typeof v === 'object' && 'amount' in v) return numericValue((v as { amount: unknown }).amount);
  return null;
}

/** The result, or null when a field it uses is empty or it divides by zero. */
export function evaluateFormula(node: FormulaNode, value: (key: string) => unknown): number | null {
  const run = (n: FormulaNode): number | null => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'ref':
        return numericValue(value(n.key));
      case 'neg': {
        const a = run(n.a);
        return a === null ? null : -a;
      }
      case 'op': {
        const a = run(n.a);
        const b = run(n.b);
        if (a === null || b === null) return null;
        if (n.op === '/' && b === 0) return null;
        const r = n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : a / b;
        return Number.isFinite(r) ? r : null;
      }
    }
  };
  return run(node);
}

export const roundTo = (n: number, decimals: number | null | undefined) => {
  const f = 10 ** Math.min(Math.max(decimals ?? 2, 0), 6);
  return Math.round(n * f) / f;
};

// ───────────── Conditions ─────────────

/** Whether a test on one field passes for a value (stored or as a form holds it). */
export function conditionPasses(type: CustomFieldType, cond: CustomFieldFilter, raw: unknown): boolean {
  const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0) || (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'amount' in raw && numericValue(raw) === null);
  if (cond.op === 'set') return !empty;
  if (cond.op === 'unset') return empty;
  if (type === 'BOOLEAN' || type === 'CHECKBOX') {
    const want = cond.value === true || cond.value === 'true';
    const have = raw === true || raw === 'true';
    return cond.op === 'neq' ? have !== want : have === want;
  }
  if (empty) return cond.op === 'neq';
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  const wanted = Array.isArray(cond.value) ? cond.value.map(String) : cond.value === undefined ? [] : [String(cond.value)];
  if (type === 'NUMBER' || type === 'CURRENCY' || type === 'FORMULA') {
    const a = numericValue(raw);
    const b = numericValue(cond.value);
    if (a === null || b === null) return false;
    return cond.op === 'eq' ? a === b : cond.op === 'neq' ? a !== b : cond.op === 'gte' ? a >= b : cond.op === 'lte' ? a <= b : false;
  }
  if (type === 'DATE' || type === 'DATETIME') {
    const a = String(raw).slice(0, type === 'DATE' ? 10 : 16);
    const b = String(cond.value ?? '').slice(0, type === 'DATE' ? 10 : 16);
    return cond.op === 'eq' ? a === b : cond.op === 'gte' ? a >= b : cond.op === 'lte' ? a <= b : false;
  }
  switch (cond.op) {
    case 'eq':
      return type === 'MULTISELECT' ? wanted.every((w) => list.includes(w)) : list.some((x) => wanted.some((w) => x.toLowerCase() === w.toLowerCase()));
    case 'neq':
      return !list.some((x) => wanted.some((w) => x.toLowerCase() === w.toLowerCase()));
    case 'in':
      return list.some((x) => wanted.includes(x));
    case 'contains':
      return wanted.length > 0 && list.some((x) => x.toLowerCase().includes(wanted[0]!.toLowerCase()));
    default:
      return false;
  }
}

interface LogicDef {
  key: string;
  type: CustomFieldType;
  showWhen?: CustomFieldFilter | null;
  formula?: string | null;
  decimals?: number | null;
}

/**
 * Applies conditions and formulas to a record's values, in field order: formulas are calculated (from fields that
 * are shown), and fields whose condition fails are left out. A condition on a hidden field fails too, so a chain
 * of conditions hides everything below the first failing one. `get` reads a value the way the caller holds it.
 */
export function resolveFields<D extends LogicDef>(defs: readonly D[], get: (key: string) => unknown): { shown: Set<string>; computed: Map<string, number | null> } {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const shown = new Map<string, boolean>();
  const computed = new Map<string, number | null>();
  const parsed = new Map<string, FormulaNode | null>();
  const visiting = new Set<string>();
  const valueOf = (key: string): unknown => {
    const d = byKey.get(key);
    if (!d || !isShown(key)) return undefined;
    return d.type === 'FORMULA' ? formulaOf(d) : get(key);
  };
  const formulaOf = (d: D): number | null => {
    if (computed.has(d.key)) return computed.get(d.key)!;
    if (visiting.has(d.key)) return null; // a loop the API refuses; never hang on old data
    visiting.add(d.key);
    if (!parsed.has(d.key)) {
      const p = d.formula ? parseFormula(d.formula) : null;
      parsed.set(d.key, p?.ok ? p.node : null);
    }
    const node = parsed.get(d.key);
    const r = node ? evaluateFormula(node, valueOf) : null;
    visiting.delete(d.key);
    const out = r === null ? null : roundTo(r, d.decimals);
    computed.set(d.key, out);
    return out;
  };
  const isShown = (key: string): boolean => {
    if (shown.has(key)) return shown.get(key)!;
    const d = byKey.get(key);
    if (!d) return false;
    if (!d.showWhen) {
      shown.set(key, true);
      return true;
    }
    if (visiting.has(`?${key}`)) return false;
    visiting.add(`?${key}`);
    const ctrl = byKey.get(d.showWhen.key);
    const ok = !!ctrl && isShown(ctrl.key) && conditionPasses(ctrl.type, d.showWhen, ctrl.type === 'FORMULA' ? formulaOf(ctrl) : get(ctrl.key));
    visiting.delete(`?${key}`);
    shown.set(key, ok);
    return ok;
  };
  for (const d of defs) {
    isShown(d.key);
    if (d.type === 'FORMULA') {
      if (shown.get(d.key)) formulaOf(d);
      else computed.set(d.key, null);
    }
  }
  return { shown: new Set([...shown].filter(([, v]) => v).map(([k]) => k)), computed };
}

/** True when following `showWhen` from `start` comes back to it (the API refuses such a set-up). */
export function conditionLoop(defs: ReadonlyArray<{ key: string; showWhen?: CustomFieldFilter | null }>, start: string, showWhen: CustomFieldFilter | null): boolean {
  const next = new Map(defs.map((d) => [d.key, d.showWhen?.key ?? null]));
  next.set(start, showWhen?.key ?? null);
  const seen = new Set<string>();
  let k: string | null = start;
  while (k) {
    if (seen.has(k)) return true;
    seen.add(k);
    k = next.get(k) ?? null;
  }
  return false;
}

/** True when a formula, through the formulas it uses, uses itself. */
export function formulaLoop(defs: ReadonlyArray<{ key: string; type: CustomFieldType; formula?: string | null }>, start: string, formula: string): boolean {
  const refsOf = (f: string | null | undefined) => {
    const p = f ? parseFormula(f) : null;
    return p?.ok ? p.refs : [];
  };
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const stack = [...refsOf(formula)];
  const seen = new Set<string>();
  while (stack.length) {
    const k = stack.pop()!;
    if (k === start) return true;
    if (seen.has(k)) continue;
    seen.add(k);
    const d = byKey.get(k);
    if (d?.type === 'FORMULA') stack.push(...refsOf(d.formula));
  }
  return false;
}
