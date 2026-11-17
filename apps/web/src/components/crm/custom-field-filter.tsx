'use client';

import { type CustomFieldDef, type CustomFieldEntity, type CustomFieldFilter, type CustomFieldFilterOp, filterOpsFor } from '@dealflow/types';
import { Badge, Button, Input, Popover, PopoverContent, PopoverTrigger } from '@dealflow/ui';
import { ListFilter, X } from 'lucide-react';
import { useState } from 'react';
import { type MessageKey, useT } from '@/lib/i18n';
import { useFieldDefs } from './custom-field-input';
import { Select } from './select';

export const OP_LABEL = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  gte: 'is at least',
  lte: 'is at most',
  in: 'is any of',
  set: 'has a value',
  unset: 'is empty',
} as const satisfies Record<CustomFieldFilterOp, MessageKey>;

/** "Tier is Gold": a filter or a field's condition, in words. */
export function describeFieldTest(t: ReturnType<typeof useT>, defs: readonly CustomFieldDef[], f: CustomFieldFilter): string {
  const d = defs.find((x) => x.key === f.key);
  const shown = Array.isArray(f.value) ? f.value.join(', ') : typeof f.value === 'boolean' || f.value === 'true' || f.value === 'false' ? (f.value === true || f.value === 'true' ? t('Yes') : t('No')) : (f.value ?? '');
  return `${d?.label ?? f.key} ${t(OP_LABEL[f.op])}${f.op === 'set' || f.op === 'unset' ? '' : ` ${shown}`}`;
}

/** Filters by custom fields (ADR 0062): pick a field, a test and a value; several filters all apply. */
export function CustomFieldFilters({ entity, value, onChange }: { entity: CustomFieldEntity; value: CustomFieldFilter[]; onChange: (v: CustomFieldFilter[]) => void }) {
  const t = useT();
  const defs = useFieldDefs(entity);
  const usable = (defs.data ?? []).filter((d) => d.type !== 'FILE' && filterOpsFor(d.type).length > 0);
  const [open, setOpen] = useState(false);
  if (!usable.length) return null;
  const describe = (f: CustomFieldFilter) => describeFieldTest(t, usable, f);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((f, i) => (
        <Badge key={`${f.key}-${i}`} tone="primary" className="gap-1">
          {describe(f)}
          <button type="button" aria-label={t('Remove filter {name}', { name: describe(f) })} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-3" aria-hidden />
          </button>
        </Badge>
      ))}
      {value.length < 10 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <ListFilter aria-hidden />
              {t('Custom field filter')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <NewFilter
              defs={usable}
              onAdd={(f) => {
                onChange([...value, f]);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function NewFilter({ defs, onAdd }: { defs: CustomFieldDef[]; onAdd: (f: CustomFieldFilter) => void }) {
  const t = useT();
  const [key, setKey] = useState(defs[0]!.key);
  const def = defs.find((d) => d.key === key) ?? defs[0]!;
  const ops = filterOpsFor(def.type);
  const [op, setOp] = useState<CustomFieldFilterOp>(ops[0]!);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const effectiveOp = ops.includes(op) ? op : ops[0]!;
  const needsValue = effectiveOp !== 'set' && effectiveOp !== 'unset';
  const choice = def.type === 'SELECT' || def.type === 'MULTISELECT';
  const yesNo = def.type === 'BOOLEAN' || def.type === 'CHECKBOX';

  const build = (): CustomFieldFilter | null => {
    if (!needsValue) return { key, op: effectiveOp };
    if (effectiveOp === 'in') return picked.length ? { key, op: 'in', value: picked } : null;
    if (yesNo) return { key, op: effectiveOp, value: text !== 'false' };
    if (!text.trim()) return null;
    if (def.type === 'NUMBER' || def.type === 'CURRENCY') return Number.isFinite(Number(text)) ? { key, op: effectiveOp, value: Number(text) } : null;
    return { key, op: effectiveOp, value: text.trim() };
  };
  const ready = build();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onAdd(ready);
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('Field')}</span>
        <Select
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setText('');
            setPicked([]);
          }}
        >
          {defs.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{t('Test')}</span>
        <Select value={effectiveOp} onChange={(e) => setOp(e.target.value as CustomFieldFilterOp)}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {t(OP_LABEL[o])}
            </option>
          ))}
        </Select>
      </label>
      {needsValue &&
        (effectiveOp === 'in' ? (
          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">{t('Values')}</legend>
            {def.options.map((o) => (
              <label key={o} className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={picked.includes(o)} onChange={(e) => setPicked(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} />
                {o}
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">{t('Value')}</span>
            {choice || yesNo ? (
              <Select value={text} onChange={(e) => setText(e.target.value)}>
                <option value="">—</option>
                {(yesNo ? [{ v: 'true', l: t('Yes') }, { v: 'false', l: t('No') }] : def.options.map((o) => ({ v: o, l: o }))).map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </Select>
            ) : (
              <Input type={def.type === 'DATE' || def.type === 'DATETIME' ? 'date' : def.type === 'NUMBER' || def.type === 'CURRENCY' ? 'number' : 'text'} value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </label>
        ))}
      <Button type="submit" size="sm" disabled={!ready}>
        {t('Add filter')}
      </Button>
    </form>
  );
}
