'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import type { CustomFieldDef, TenantDetails } from '@dealflow/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type CrmEntity, ENTITY_LABEL, useCustomFields, useMembers, usePipelines } from '@/lib/crm';
import { FIELDS, type FieldSpec, SCHEMAS, toPayload } from '@/lib/crm-fields';
import { MultiCombobox } from '@/components/forms/combobox';
import { CountrySelect, CurrencyInput, CurrencySelect, NumberStepper, PhoneInput, TimeZoneSelect } from '@/components/forms/inputs';
import { phoneProblem } from '@/components/forms/locale-data';
import { Segmented } from '@/components/forms/segmented';
import { useFormDraft } from '@/components/forms/use-form-draft';
import { relativeTime } from '@/lib/format';
import { type PickerValue, RecordPicker } from './record-picker';
import { Select, Textarea } from './select';

interface Props {
  entity: CrmEntity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  recordId?: string;
  initial?: Record<string, unknown>;
  onSaved?: (row: { id: string }, raw: unknown) => void;
}

/** Create/edit dialog for leads, contacts, companies and deals, including the workspace's custom fields. */
export function RecordFormDialog({ entity, open, onOpenChange, recordId, initial, onSaved }: Props) {
  const mode = recordId ? 'edit' : 'create';
  const qc = useQueryClient();
  const formId = useId();
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const custom = useCustomFields(entity);

  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setErrors({});
      setFormError(null);
    }
  }, [open, initial]);

  const set = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));
  const fields = FIELDS[entity].filter((f) => !(f.createOnly && mode === 'edit'));
  // Draft recovery for new records: what was typed survives a closed dialog or a reload on this device.
  const draft = useFormDraft<Record<string, unknown>>(open && mode === 'create' ? `create-${entity}` : null, values, (v) =>
    Object.entries(v).every(([, x]) => x === '' || x === null || x === undefined || (Array.isArray(x) && x.length === 0)),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = toPayload(entity, values, mode, custom.data?.map((d) => d.key));
    const parsed = SCHEMAS[entity][mode === 'create' ? 'create' : 'update'].safeParse(payload);
    const problems: Record<string, string> = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => [String(i.path[0]), i.message]));
    for (const f of fields) {
      const p = f.type === 'tel' ? phoneProblem(values[f.name] as string) : null;
      if (p && !problems[f.name]) problems[f.name] = p;
    }
    if (Object.keys(problems).length) {
      setErrors(problems);
      requestAnimationFrame(() => document.getElementById(`${formId}-${Object.keys(problems)[0]}`)?.focus());
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const raw = await api<unknown>(mode === 'create' ? `/${entity}` : `/${entity}/${recordId}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        json: payload,
      });
      const row = (entity === 'leads' && mode === 'create' ? (raw as { lead: { id: string } }).lead : raw) as { id: string };
      draft.clear();
      await qc.invalidateQueries({ queryKey: [entity] });
      if (entity === 'deals') await qc.invalidateQueries({ queryKey: ['board'] });
      onOpenChange(false);
      onSaved?.(row, raw);
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path.startsWith('customFields.') ? `cf.${d.path.slice(13)}` : d.path, d.message])));
      }
      setFormError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  const label = ENTITY_LABEL[entity].one;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{mode === 'create' ? `New ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">Fields marked * are required.</DialogDescription>
        {draft.offer && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <span className="flex-1">You have an unsaved {label.toLowerCase()} from {relativeTime(draft.offer.savedAt.toISOString())}.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { const v = draft.take(); if (v) setValues(v); }}>
              Restore draft
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={draft.discard}>
              Discard
            </Button>
          </div>
        )}
        <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.wide ? 'sm:col-span-2' : undefined}>
              <FieldControl spec={f} id={`${formId}-${f.name}`} values={values} set={set} error={errors[f.name] ?? (f.type === 'pipeline' ? errors.stageId : undefined)} />
            </div>
          ))}
          {custom.data && custom.data.length > 0 && (
            <fieldset className="grid gap-4 border-t border-border pt-4 sm:col-span-2 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium text-muted-foreground">Custom fields</legend>
              {custom.data.map((d) => (
                <CustomFieldControl key={d.id} def={d} id={`${formId}-cf-${d.key}`} value={values[`cf.${d.key}`]} onChange={(v) => set(`cf.${d.key}`, v)} error={errors[`cf.${d.key}`]} />
              ))}
            </fieldset>
          )}
          {formError && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : mode === 'create' ? `Create ${label.toLowerCase()}` : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldControl({ spec, id, values, set, error }: { spec: FieldSpec; id: string; values: Record<string, unknown>; set: (n: string, v: unknown) => void; error?: string }) {
  const label = spec.required ? `${spec.label} *` : spec.label;
  const v = values[spec.name];
  const str = v === null || v === undefined ? '' : String(v);
  switch (spec.type) {
    case 'select':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <Select value={str} onChange={(e) => set(spec.name, e.target.value)}>
            <option value="">Default</option>
            {spec.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'owner':
      return <OwnerField id={id} label={label} value={str} onChange={(x) => set(spec.name, x)} error={error} hint={spec.hint} />;
    case 'company':
    case 'contact':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <RecordPicker entity={spec.type === 'company' ? 'companies' : 'contacts'} value={(v as PickerValue | null) ?? null} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'pipeline':
      return <PipelineField id={id} values={values} set={set} error={error} />;
    case 'country':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <CountrySelect value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'currency':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <CurrencySelect value={str} onChange={(x) => set(spec.name, x)} placeholder="Search currencies" />
        </Field>
      );
    case 'timezone':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <TimeZoneSelect value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'money':
      return <MoneyField id={id} label={label} spec={spec} value={str} currency={String(values[spec.currencyField ?? 'currency'] ?? '')} set={set} error={error} />;
    case 'percent':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <NumberStepper value={str} onChange={(x) => set(spec.name, x)} min={0} max={100} step={5} suffix="%" label={spec.label.replace(/\s*\(.*\)$/, '').toLowerCase()} />
        </Field>
      );
    case 'tel':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <PhoneInput value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'tags':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <MultiCombobox value={Array.isArray(v) ? (v as string[]) : str ? str.split(',').map((t) => t.trim()).filter(Boolean) : []} onChange={(x) => set(spec.name, x)} creatable max={20} itemLabel="tag" placeholder="Type a tag" />
        </Field>
      );
    case 'priority':
      return (
        <Segmented
          legend={spec.label}
          name={id}
          value={(str || 'NONE') as 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'}
          onChange={(x) => set(spec.name, x === 'NONE' ? '' : x)}
          options={[
            { value: 'NONE', label: 'Not set' },
            { value: 'LOW', label: 'Low' },
            { value: 'MEDIUM', label: 'Medium' },
            { value: 'HIGH', label: 'High' },
          ]}
        />
      );
    case 'textarea':
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <Textarea value={str} onChange={(e) => set(spec.name, e.target.value)} />
        </Field>
      );
    default:
      return (
        <Field id={id} label={label} error={error} hint={spec.hint}>
          <Input
            type={spec.type}
            inputMode={spec.type === 'number' ? 'decimal' : undefined}
            required={spec.required}
            placeholder={spec.placeholder}
            value={str}
            onChange={(e) => set(spec.name, e.target.value)}
          />
        </Field>
      );
  }
}

function MoneyField({ id, label, spec, value, currency, set, error }: { id: string; label: string; spec: FieldSpec; value: string; currency: string; set: (n: string, v: unknown) => void; error?: string }) {
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<TenantDetails>('/tenants/current'), staleTime: 300_000 });
  const code = currency || tenant.data?.defaultCurrency || 'USD';
  return (
    <Field id={id} label={label} error={error} hint={spec.hint}>
      <CurrencyInput value={value} onChange={(x) => set(spec.name, x)} currency={code} />
    </Field>
  );
}

function OwnerField({ id, label, value, onChange, error, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  const members = useMembers();
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{members.isPending ? 'Loading…' : 'Me (default)'}</option>
        {members.data?.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function PipelineField({ id, values, set, error }: { id: string; values: Record<string, unknown>; set: (n: string, v: unknown) => void; error?: string }) {
  const pipelines = usePipelines();
  const selected = pipelines.data?.find((p) => p.id === values.pipelineId) ?? pipelines.data?.find((p) => p.isDefault);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id} label="Pipeline" error={error}>
        <Select value={selected?.id ?? ''} onChange={(e) => { set('pipelineId', e.target.value); set('stageId', ''); }}>
          {pipelines.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-stage`} label="Stage">
        <Select value={String(values.stageId ?? '')} onChange={(e) => set('stageId', e.target.value)}>
          <option value="">First open stage</option>
          {selected?.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.probability}%
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function CustomFieldControl({ def, id, value, onChange, error }: { def: CustomFieldDef; id: string; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const label = def.required ? `${def.label} *` : def.label;
  const str = value === null || value === undefined ? '' : String(value);
  if (def.type === 'SELECT' || def.type === 'BOOLEAN') {
    const options = def.type === 'BOOLEAN' ? [{ v: 'true', l: 'Yes' }, { v: 'false', l: 'No' }] : def.options.map((o) => ({ v: o, l: o }));
    return (
      <Field id={id} label={label} error={error}>
        <Select value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field id={id} label={label} error={error}>
      <Input type={def.type === 'NUMBER' ? 'number' : def.type === 'DATE' ? 'date' : 'text'} value={str} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
