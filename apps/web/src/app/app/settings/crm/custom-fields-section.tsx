'use client';

import {
  BASIC_CUSTOM_FIELD_ENTITIES,
  BASIC_CUSTOM_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldFilter,
  type CustomFieldFilterOp,
  type CustomFieldType,
  customFieldDefSchema,
  filterOpsFor,
  FORMULA_INPUT_TYPES,
  parseFormula,
  customFieldUpdateSchema,
  type DesignationRow,
  SEARCHABLE_FIELD_TYPES,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { ArrowDown, ArrowUp, Calculator, Eye, EyeOff, GitBranch, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { CustomFieldInput, fieldFormValue, fieldPayloadValue } from '@/components/crm/custom-field-input';
import { describeFieldTest, OP_LABEL } from '@/components/crm/custom-field-filter';
import { Select, Textarea } from '@/components/crm/select';
import { CurrencySelect } from '@/components/forms/inputs';
import { InfoTip } from '@/components/info-tip';
import { ApiError } from '@/lib/api';
import { useDesignations } from '@/lib/company-crm';
import { useFieldAdmin, useFieldMutations } from '@/lib/crm-admin';
import { useHasFeature } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';

export const FIELD_ENTITY_LABEL = {
  COMPANY: 'Companies',
  CONTACT: 'Employees',
  LEAD: 'Inbound leads',
  OPPORTUNITY: 'Deals',
  FOLLOW_UP: 'Follow-ups',
  RFQ: 'RFQs',
} as const satisfies Record<CustomFieldEntity, MessageKey>;

export const FIELD_TYPE_LABEL = {
  TEXT: 'Single-line text',
  TEXTAREA: 'Multi-line text',
  NUMBER: 'Number',
  CURRENCY: 'Currency',
  DATE: 'Date',
  DATETIME: 'Date and time',
  SELECT: 'Dropdown',
  MULTISELECT: 'Multi-select',
  CHECKBOX: 'Checkbox',
  BOOLEAN: 'Yes / no',
  URL: 'URL',
  EMAIL: 'Email',
  PHONE: 'Phone number',
  FILE: 'File attachment',
  FORMULA: 'Formula',
} as const satisfies Record<CustomFieldType, MessageKey>;

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : null);

/** Settings → CRM configuration → Custom fields (ADR 0062). */
export function CustomFieldsSection({ canManage }: { canManage: boolean }) {
  const t = useT();
  const advanced = useHasFeature('custom_fields_advanced');
  const [entity, setEntity] = useState<CustomFieldEntity>('COMPANY');
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const list = useFieldAdmin(entity);
  const m = useFieldMutations(entity);
  const designations = useDesignations();
  const rows = list.data ?? [];
  const locked = !advanced && !BASIC_CUSTOM_FIELD_ENTITIES.includes(entity);
  const move = (i: number, by: -1 | 1) => {
    const ids = rows.map((r) => r.id);
    [ids[i], ids[i + by]] = [ids[i + by]!, ids[i]!];
    m.reorder.mutate(ids);
  };
  const failure = m.update.error ?? m.reorder.error ?? m.remove.error;
  const names = new Map((designations.data ?? []).map((d) => [d.id, d.name]));

  return (
    <div className="space-y-4">
      <Field id="cf-entity" label={t('Record type')}>
        <Select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value as CustomFieldEntity);
            setEditing(null);
          }}
        >
          {CUSTOM_FIELD_ENTITIES.map((en) => (
            <option key={en} value={en}>
              {t(FIELD_ENTITY_LABEL[en])}
            </option>
          ))}
        </Select>
      </Field>
      {locked && <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">{t('Fields on follow-ups and RFQs need the advanced custom fields feature of your plan.')}</p>}
      {canManage && !locked && (
        <FieldForm key={editing?.id ?? `new-${entity}`} entity={entity} editing={editing} siblings={rows.filter((r) => r.active && r.id !== editing?.id)} designations={designations.data ?? []} onDone={() => setEditing(null)} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Fields on {type}', { type: t(FIELD_ENTITY_LABEL[entity]).toLowerCase() })}
            <InfoTip topic="crm.customFields" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No custom fields.')}</p>
          ) : (
            <ol className="divide-y divide-border" aria-label={t('Fields on {type}', { type: t(FIELD_ENTITY_LABEL[entity]).toLowerCase() })}>
              {rows.map((d, i) => (
                <li key={d.id} className={`flex flex-wrap items-center gap-2 py-2.5 text-sm ${d.active ? '' : 'opacity-60'}`}>
                  <span className="w-6 text-end text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{d.label}</span>
                      <code className="rounded bg-muted px-1.5 text-xs">{d.key}</code>
                      <Badge>{t(FIELD_TYPE_LABEL[d.type])}</Badge>
                      {d.required && <Badge tone="warning">{t('Required')}</Badge>}
                      {!d.active && <Badge>{t('Switched off')}</Badge>}
                      {d.searchable && (
                        <Badge tone="primary">
                          <Search className="size-3" aria-hidden />
                          {t('Searchable')}
                        </Badge>
                      )}
                      {!d.showInForms && <Badge>{t('Record page only')}</Badge>}
                    </span>
                    {(d.viewDesignationIds.length > 0 || d.editDesignationIds.length > 0) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        {d.viewDesignationIds.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Eye className="size-3" aria-hidden />
                            {t('Seen by: {names}', { names: d.viewDesignationIds.map((x) => t.maybe(names.get(x) ?? '?')).join(', ') })}
                          </span>
                        )}
                        {d.editDesignationIds.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Lock className="size-3" aria-hidden />
                            {t('Changed by: {names}', { names: d.editDesignationIds.map((x) => t.maybe(names.get(x) ?? '?')).join(', ') })}
                          </span>
                        )}
                      </span>
                    )}
                    {d.options.length > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{d.options.join(' · ')}</span>}
                    {d.formula && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Calculator className="size-3" aria-hidden />
                        <code>= {d.formula}</code>
                      </span>
                    )}
                    {d.showWhen && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <GitBranch className="size-3" aria-hidden />
                        {t('Shown when {test}', { test: describeFieldTest(t, rows, d.showWhen) })}
                      </span>
                    )}
                  </span>
                  {canManage && (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} up', { name: d.label })} disabled={i === 0 || m.reorder.isPending} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Move {name} down', { name: d.label })} disabled={i === rows.length - 1 || m.reorder.isPending} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={d.active ? t('Switch off {name}', { name: d.label }) : t('Switch on {name}', { name: d.label })}
                        disabled={m.update.isPending}
                        onClick={() => m.update.mutate({ id: d.id, input: { active: !d.active } })}
                      >
                        {d.active ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={t('Edit {name}', { name: d.label })} onClick={() => setEditing(d)}>
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('Delete {name}', { name: d.label })}
                        disabled={m.remove.isPending}
                        onClick={() => window.confirm(t('Delete {name}? Its values disappear from every record, and its key cannot be used again.', { name: d.label })) && m.remove.mutate(d.id)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {failure && (
            <p role="alert" className="mt-2 text-sm text-critical">
              {errorText(failure)}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t('Switching a field off hides it everywhere but keeps its values, so you can switch it on again. Custom fields can be filtered in lists, searched, reported on and exported.')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type Draft = {
  label: string;
  key: string;
  keyTouched: boolean;
  type: CustomFieldType;
  description: string;
  options: string;
  required: boolean;
  defaultValue: unknown;
  currency: string;
  viewDesignationIds: string[];
  editDesignationIds: string[];
  showInForms: boolean;
  searchable: boolean;
  formula: string;
  decimals: number;
  /** Shown only when: the controlling field's key ('' for always), the test and the value as the inputs hold it. */
  condKey: string;
  condOp: CustomFieldFilterOp;
  condValue: string | string[];
};

const keyFrom = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);

const condValueOf = (c: CustomFieldFilter | null): string | string[] => (!c || c.value === undefined ? '' : Array.isArray(c.value) ? c.value : String(c.value));

function FieldForm({
  entity,
  editing,
  siblings,
  designations,
  onDone,
}: {
  entity: CustomFieldEntity;
  editing: CustomFieldDef | null;
  siblings: CustomFieldDef[];
  designations: DesignationRow[];
  onDone: () => void;
}) {
  const t = useT();
  const advanced = useHasFeature('custom_fields_advanced');
  const m = useFieldMutations(entity);
  const [v, setV] = useState<Draft>(() =>
    editing
      ? {
          label: editing.label, key: editing.key, keyTouched: true, type: editing.type, description: editing.description ?? '', options: editing.options.join('\n'), required: editing.required,
          defaultValue: fieldFormValue(editing, editing.defaultValue), currency: editing.currency ?? '', viewDesignationIds: editing.viewDesignationIds, editDesignationIds: editing.editDesignationIds,
          showInForms: editing.showInForms, searchable: editing.searchable, formula: editing.formula ?? '', decimals: editing.decimals ?? 2,
          condKey: editing.showWhen?.key ?? '', condOp: editing.showWhen?.op ?? 'set', condValue: condValueOf(editing.showWhen),
        }
      : {
          label: '', key: '', keyTouched: false, type: 'TEXT', description: '', options: '', required: false, defaultValue: '', currency: '', viewDesignationIds: [], editDesignationIds: [], showInForms: true,
          searchable: false, formula: '', decimals: 2, condKey: '', condOp: 'set', condValue: '',
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const key = v.keyTouched ? v.key : keyFrom(v.label);
  const options = v.options.split(/[\n,]/).map((o) => o.trim()).filter(Boolean);
  const choice = CHOICE_FIELD_TYPES.includes(v.type);
  // A stand-in definition, so the default value uses the same input as records do.
  const preview: CustomFieldDef = {
    id: 'preview', entity, key: key || 'preview', label: t('Default value'), description: t('Filled in on new records. Optional.'), type: v.type, options, required: false, defaultValue: null,
    currency: v.currency || 'USD', viewDesignationIds: [], editDesignationIds: [], showInForms: true, searchable: false, active: true, position: 0, access: { view: true, edit: true },
    showWhen: null, formula: null, decimals: null,
  };
  const isFormula = v.type === 'FORMULA';
  const formulaInputs = siblings.filter((d) => FORMULA_INPUT_TYPES.includes(d.type));
  // The formula is checked as it is typed, against the fields it may use.
  const formulaProblem = (() => {
    if (!isFormula || !v.formula.trim()) return null;
    const p = parseFormula(v.formula);
    if (!p.ok) return t.maybe(p.error);
    const unknown = p.refs.find((r) => !formulaInputs.some((d) => d.key === r));
    return unknown ? t('{field} is not a number, currency or formula field of this record type', { field: `{${unknown}}` }) : null;
  })();
  const condField = siblings.find((d) => d.key === v.condKey) ?? null;
  const condition = (): CustomFieldFilter | null => {
    if (!condField) return null;
    if (v.condOp === 'set' || v.condOp === 'unset') return { key: condField.key, op: v.condOp };
    const raw = v.condValue;
    if (Array.isArray(raw)) return { key: condField.key, op: v.condOp, value: raw };
    if (condField.type === 'BOOLEAN' || condField.type === 'CHECKBOX') return { key: condField.key, op: v.condOp, value: raw !== 'false' };
    if (FORMULA_INPUT_TYPES.includes(condField.type)) return { key: condField.key, op: v.condOp, value: Number(raw) };
    return { key: condField.key, op: v.condOp, value: raw };
  };
  const pending = m.create.isPending || m.update.isPending;
  const failure = editing ? m.update.error : m.create.error;
  const advancedChoice = (ty: CustomFieldType) => !advanced && !BASIC_CUSTOM_FIELD_TYPES.includes(ty);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{editing ? t('Edit {name}', { name: editing.label }) : t('Add a field')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice(null);
            const def = fieldPayloadValue(preview, v.defaultValue);
            const common = {
              label: v.label, description: v.description || null, options: choice ? options : [], required: !isFormula && v.required, defaultValue: def === '' || isFormula ? null : def,
              ...(v.type === 'CURRENCY' || isFormula ? { currency: v.currency || null } : {}),
              ...(isFormula ? { formula: v.formula, decimals: v.decimals } : {}),
              showWhen: condition(),
              viewDesignationIds: v.viewDesignationIds, editDesignationIds: v.editDesignationIds, showInForms: v.showInForms, searchable: SEARCHABLE_FIELD_TYPES.includes(v.type) && v.searchable,
            };
            const parsed = editing ? customFieldUpdateSchema.safeParse(common) : customFieldDefSchema.safeParse({ ...common, entity, key, type: v.type });
            if (!parsed.success) {
              setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), t.maybe(i.message)])));
              return;
            }
            setErrors({});
            const done = (row: CustomFieldDef) => {
              setNotice(editing ? t('Saved {name}.', { name: row.label }) : t('Added {name}.', { name: row.label }));
              if (editing) onDone();
              else setV({ ...v, label: '', key: '', keyTouched: false, description: '', options: '', defaultValue: '', required: false, searchable: false, formula: '', condKey: '', condOp: 'set', condValue: '' });
            };
            const onError = (err: unknown) => {
              if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path.split('.')[0]!, d.message])));
            };
            if (editing) m.update.mutate({ id: editing.id, input: parsed.data }, { onSuccess: done, onError });
            else m.create.mutate(parsed.data, { onSuccess: done, onError });
          }}
        >
          <Field id="cf-label" label={t('Name')} error={errors.label}>
            <Input value={v.label} maxLength={80} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder={t('For example: Panel size')} />
          </Field>
          <Field id="cf-type" label={t('Type')} hint={editing ? t('The type cannot change once records may hold values.') : undefined}>
            <Select value={v.type} disabled={!!editing} onChange={(e) => setV({ ...v, type: e.target.value as CustomFieldType, defaultValue: '' })}>
              {CUSTOM_FIELD_TYPES.map((ty) => (
                <option key={ty} value={ty} disabled={advancedChoice(ty)}>
                  {advancedChoice(ty) ? `${t(FIELD_TYPE_LABEL[ty])} (${t('upgrade')})` : t(FIELD_TYPE_LABEL[ty])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="cf-key" label={t('Key')} error={errors.key} hint={editing ? t('Used in imports, filters and the API. It cannot change.') : t('Used in imports, filters and the API.')}>
            <Input value={key} disabled={!!editing} maxLength={40} className="font-mono" onChange={(e) => setV({ ...v, key: e.target.value, keyTouched: true })} />
          </Field>
          <Field id="cf-description" label={t('Description')} hint={t('Shown under the field in forms. Optional.')} error={errors.description}>
            <Input value={v.description} maxLength={500} onChange={(e) => setV({ ...v, description: e.target.value })} />
          </Field>
          {choice && (
            <div className="sm:col-span-2">
              <Field id="cf-options" label={t('Dropdown values')} error={errors.options} hint={t('One per line, or separated with commas.')}>
                <Textarea rows={4} value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} />
              </Field>
            </div>
          )}
          {v.type === 'CURRENCY' && (
            <Field id="cf-currency" label={t('Currency')} error={errors.currency} hint={t('A plain number entered in this field is in this currency.')}>
              <CurrencySelect value={v.currency} onChange={(currency) => setV({ ...v, currency })} />
            </Field>
          )}
          {isFormula && (
            <>
              <div className="sm:col-span-2">
                <Field
                  id="cf-formula"
                  label={t('Formula')}
                  error={errors.formula ?? formulaProblem ?? undefined}
                  hint={t('Use + - * / and brackets with numbers and fields in curly brackets, for example {example}. The result is worked out on every record and cannot be typed in.', { example: '{sample_size} * {cpi}' })}
                >
                  <Input value={v.formula} maxLength={500} className="font-mono" onChange={(e) => setV({ ...v, formula: e.target.value })} placeholder="{sample_size} * {cpi}" />
                </Field>
                {formulaInputs.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t('Insert a field:')}</span>
                    {formulaInputs.map((d) => (
                      <Button key={d.key} type="button" variant="outline" size="sm" onClick={() => setV({ ...v, formula: `${v.formula.trimEnd()}${v.formula.trim() ? ' ' : ''}{${d.key}}` })}>
                        <Plus aria-hidden />
                        {d.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{t('Add a number or currency field first, then use it here.')}</p>
                )}
              </div>
              <Field id="cf-decimals" label={t('Decimal places')}>
                <Select value={String(v.decimals)} onChange={(e) => setV({ ...v, decimals: Number(e.target.value) })}>
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="cf-currency" label={t('Show as money in')} hint={t('Optional. Leave empty for a plain number.')} error={errors.currency}>
                <CurrencySelect value={v.currency} onChange={(currency) => setV({ ...v, currency })} />
              </Field>
            </>
          )}
          <ConditionPicker
            fields={siblings}
            disabled={!advanced}
            fieldKey={v.condKey}
            op={v.condOp}
            value={v.condValue}
            error={errors.showWhen}
            onChange={(p) => setV({ ...v, ...p })}
          />
          {v.type !== 'FILE' && !isFormula && (!choice || options.length > 0) && (
            <CustomFieldInput def={preview} entity={entity} id="cf-default" value={v.defaultValue} onChange={(defaultValue) => setV({ ...v, defaultValue })} error={errors.defaultValue} />
          )}
          <DesignationPicker
            legend={t('Who can see it')}
            hint={t('Nobody picked: everyone who can see the record. Administrators always see every field.')}
            designations={designations}
            value={v.viewDesignationIds}
            onChange={(viewDesignationIds) => setV({ ...v, viewDesignationIds })}
            disabled={!advanced}
          />
          {!isFormula && (
          <DesignationPicker
            legend={t('Who can change it')}
            hint={t('Nobody picked: everyone who can change the record. Others see it read-only.')}
            designations={designations}
            value={v.editDesignationIds}
            onChange={(editDesignationIds) => setV({ ...v, editDesignationIds })}
            disabled={!advanced}
          />
          )}
          <div className="flex flex-col gap-2 sm:col-span-2">
            {!isFormula && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} />
                {condField ? t('Required while it is shown') : t('Required on new and edited records')}
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={v.showInForms} onChange={(e) => setV({ ...v, showInForms: e.target.checked })} />
              {t('Show on forms for new records (off: only on the record page)')}
            </label>
            {SEARCHABLE_FIELD_TYPES.includes(v.type) && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={v.searchable} onChange={(e) => setV({ ...v, searchable: e.target.checked })} />
                {t('Global search looks through this field')}
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending || !v.label.trim() || !!formulaProblem}>
              {pending ? t('Saving…') : editing ? t('Save changes') : t('Add field')}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" onClick={onDone}>
                {t('Cancel')}
              </Button>
            )}
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {notice}
            </p>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {errorText(failure)}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function DesignationPicker({ legend, hint, designations, value, onChange, disabled }: { legend: string; hint: string; designations: DesignationRow[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const t = useT();
  const active = designations.filter((d) => !d.archived || value.includes(d.id));
  return (
    <fieldset className="rounded-md border border-border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <p className="mb-2 text-xs text-muted-foreground">{disabled ? t('Limiting fields to designations needs the advanced custom fields feature of your plan.') : hint}</p>
      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('Add designations first.')}</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {active.map((d) => (
            <label key={d.id} className="flex min-h-6 items-center gap-1.5 text-sm">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={value.includes(d.id)} onChange={(e) => onChange(e.target.checked ? [...value, d.id] : value.filter((x) => x !== d.id))} />
              {t.maybe(d.name)}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** "Show only when": another field of the record type, a test that fits it and the value to test for. */
function ConditionPicker({
  fields,
  fieldKey,
  op,
  value,
  error,
  disabled,
  onChange,
}: {
  fields: CustomFieldDef[];
  fieldKey: string;
  op: CustomFieldFilterOp;
  value: string | string[];
  error?: string;
  disabled: boolean;
  onChange: (p: { condKey?: string; condOp?: CustomFieldFilterOp; condValue?: string | string[] }) => void;
}) {
  const t = useT();
  const usable = fields.filter((d) => d.type !== 'FILE');
  const field = usable.find((d) => d.key === fieldKey) ?? null;
  const ops = field ? filterOpsFor(field.type) : [];
  const needsValue = op !== 'set' && op !== 'unset';
  const yesNo = field?.type === 'BOOLEAN' || field?.type === 'CHECKBOX';
  const list = Array.isArray(value) ? value : [];
  const text = Array.isArray(value) ? '' : value;
  return (
    <fieldset className="rounded-md border border-border p-3 sm:col-span-2" disabled={disabled}>
      <legend className="flex items-center gap-1.5 px-1 text-sm font-medium">
        <GitBranch className="size-3.5" aria-hidden />
        {t('Show only when')}
      </legend>
      <p className="mb-2 text-xs text-muted-foreground">
        {disabled ? t('Conditional fields need the advanced custom fields feature of your plan.') : t('Hidden fields are not required, and a value is cleared when the record is saved while its field is hidden.')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="cf-cond-field" label={t('Field')}>
          <Select
            value={fieldKey}
            onChange={(e) => {
              const next = usable.find((d) => d.key === e.target.value);
              onChange({ condKey: e.target.value, condOp: next ? (filterOpsFor(next.type).includes('set') ? 'set' : filterOpsFor(next.type)[0]!) : 'set', condValue: '' });
            }}
          >
            <option value="">{t('Always show')}</option>
            {usable.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
        {field && (
          <Field id="cf-cond-op" label={t('Test')}>
            <Select value={op} onChange={(e) => onChange({ condOp: e.target.value as CustomFieldFilterOp, condValue: e.target.value === 'in' ? [] : '' })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {t(OP_LABEL[o])}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {field && needsValue && op === 'in' && (
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 font-medium">{t('Values')}</legend>
            {field.options.map((o) => (
              <label key={o} className="flex min-h-6 items-center gap-2">
                <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={list.includes(o)} onChange={(e) => onChange({ condValue: e.target.checked ? [...list, o] : list.filter((x) => x !== o) })} />
                {o}
              </label>
            ))}
          </fieldset>
        )}
        {field && needsValue && op !== 'in' && (
          <Field id="cf-cond-value" label={t('Value')} error={error}>
            {yesNo || field.type === 'SELECT' || field.type === 'MULTISELECT' ? (
              <Select value={text} onChange={(e) => onChange({ condValue: e.target.value })}>
                <option value="">—</option>
                {(yesNo ? [{ v: 'true', l: t('Yes') }, { v: 'false', l: t('No') }] : field.options.map((o) => ({ v: o, l: o }))).map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={field.type === 'DATE' || field.type === 'DATETIME' ? 'date' : FORMULA_INPUT_TYPES.includes(field.type) ? 'number' : 'text'}
                value={text}
                onChange={(e) => onChange({ condValue: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>
      {error && !(field && needsValue && op !== 'in') && <p className="mt-2 text-xs text-critical">{error}</p>}
    </fieldset>
  );
}
