'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import type { CustomFieldDef } from '@dealflow/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type CrmEntity, ENTITY_LABEL, useCustomFields, useMembers, usePipelines } from '@/lib/crm';
import { FIELDS, type FieldSpec, SCHEMAS, toPayload } from '@/lib/crm-fields';
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const payload = toPayload(entity, values, mode, custom.data?.map((d) => d.key));
    const parsed = SCHEMAS[entity][mode === 'create' ? 'create' : 'update'].safeParse(payload);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => [String(i.path[0]), i.message])));
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
            type={spec.type === 'tags' ? 'text' : spec.type}
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
