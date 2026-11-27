'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { type CompanyLeadResult, contactInputSchema, DEAL_SOURCES, type CustomFieldDef, type TenantDetails } from '@dealflow/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CUSTOM_FIELD_ENTITY, type CrmEntity, ENTITY_LABEL, useCustomFields, useMembers, usePipelines } from '@/lib/crm';
import { FIELDS, type FieldSpec, SCHEMAS, toPayload } from '@/lib/crm-fields';
import { MultiCombobox } from '@/components/forms/combobox';
import { CountrySelect, CurrencyInput, CurrencySelect, NumberStepper, PhoneInput, TimeZoneSelect } from '@/components/forms/inputs';
import { phoneProblem } from '@/components/forms/locale-data';
import { Segmented } from '@/components/forms/segmented';
import { useFormDraft } from '@/components/forms/use-form-draft';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { CustomFieldInput, fieldDefault, fieldFormValue, fieldLogic, fieldPayloadValue } from './custom-field-input';
import { type PickerValue, RecordPicker } from './record-picker';
import { useHiddenKeys } from '@/lib/session';
import { useRfqs } from '@/lib/company-work';
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
  const t = useT();
  const qc = useQueryClient();
  const formId = useId();
  const [values, setValues] = useState<Record<string, unknown>>(initial ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // An open deal with the same name at the same company (ADR 0096): shown with a link and "Create anyway".
  const [duplicate, setDuplicate] = useState<{ id: string; name: string; dealNumber: string | null } | null>(null);
  const custom = useCustomFields(entity);
  // A new company can be saved with its employees in one go (ADR 0066).
  const withEmployees = entity === 'companies' && mode === 'create';
  const [employees, setEmployees] = useState<QuickEmployee[]>([]);

  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setErrors({});
      setFormError(null);
      setEmployees([]);
      setDuplicate(null);
    }
  }, [open, initial]);

  const set = (name: string, v: unknown) => setValues((prev) => ({ ...prev, [name]: v }));
  // Fields the Console hides from this level are left out (R8, ADR 0092); the server ignores them anyway.
  const hiddenKeys = useHiddenKeys(entity === 'companies' ? 'company' : entity === 'contacts' ? 'contact' : entity === 'deals' ? 'deal' : null);
  const fields = FIELDS[entity].filter((f) => !(f.createOnly && mode === 'edit') && !hiddenKeys.has(f.name));
  // Draft recovery for new records: what was typed survives a closed dialog or a reload on this device.
  const draft = useFormDraft<Record<string, unknown>>(open && mode === 'create' ? `create-${entity}` : null, values, (v) =>
    Object.entries(v).every(([, x]) => x === '' || x === null || x === undefined || (Array.isArray(x) && x.length === 0)),
  );

  // What each custom field holds now, with conditions and formulas worked out as the person types (ADR 0062).
  const cfDefs = custom.data ?? [];
  const cfRaw = (d: CustomFieldDef) => (values[`cf.${d.key}`] === undefined && mode === 'create' ? fieldDefault(d) : fieldFormValue(d, values[`cf.${d.key}`]));
  const cfByKey = new Map(cfDefs.map((d) => [d.key, d]));
  const logic = fieldLogic(cfDefs, (k) => {
    const d = cfByKey.get(k);
    return d ? cfRaw(d) : undefined;
  });

  async function submit(e: React.FormEvent | null, allowDuplicate = false) {
    e?.preventDefault();
    setFormError(null);
    setDuplicate(null);
    // Read-only and hidden fields are not sent; the API keeps read-only values and clears hidden ones.
    const editable = cfDefs.filter((d) => d.access.edit && logic.shows(d));
    const sendable = { ...values, ...Object.fromEntries(editable.map((d) => [`cf.${d.key}`, fieldPayloadValue(d, values[`cf.${d.key}`])])) };
    const payload = toPayload(entity, sendable, mode, editable.map((d) => d.key));
    if (allowDuplicate) payload.allowDuplicate = true;
    const parsed = SCHEMAS[entity][mode === 'create' ? 'create' : 'update'].safeParse(payload);
    const problems: Record<string, string> = parsed.success
      ? {}
      : Object.fromEntries(parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => [String(i.path[0]), t.maybe(i.message)]));
    for (const f of fields) {
      const p = f.type === 'tel' ? phoneProblem(values[f.name] as string) : null;
      if (p && !problems[f.name]) problems[f.name] = p;
    }
    const people = withEmployees ? employees.filter((e) => e.name.trim() || e.email.trim() || e.phone.trim()) : [];
    const team = people.map(quickEmployeePayload);
    team.forEach((e, i) => {
      const r = contactInputSchema.safeParse(e);
      if (!r.success) for (const issue of r.error.issues) problems[`employees.${i}.${String(issue.path[0])}`] ??= t.maybe(issue.message);
    });
    if (Object.keys(problems).length) {
      setErrors(problems);
      requestAnimationFrame(() => document.getElementById(`${formId}-${Object.keys(problems)[0]}`)?.focus());
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      // With employees, the company and its people are saved together: all of it or nothing.
      const raw = team.length
        ? (await api<CompanyLeadResult>('/company-leads', { method: 'POST', json: { company: payload, employees: team } })).company
        : await api<unknown>(mode === 'create' ? `/${entity}` : `/${entity}/${recordId}`, {
            method: mode === 'create' ? 'POST' : 'PATCH',
            json: payload,
          });
      if (team.length) await qc.invalidateQueries({ queryKey: ['contacts'] });
      const row = (entity === 'leads' && mode === 'create' ? (raw as { lead: { id: string } }).lead : raw) as { id: string };
      draft.clear();
      await qc.invalidateQueries({ queryKey: [entity] });
      if (entity === 'deals') await qc.invalidateQueries({ queryKey: ['board'] });
      onOpenChange(false);
      onSaved?.(row, raw);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE_DEAL') {
        const existing = (err.details?.[0] as { existing?: { id: string; name: string; dealNumber: string | null } } | undefined)?.existing;
        if (existing) {
          setDuplicate(existing);
          return;
        }
      }
      if (err instanceof ApiError && err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path.startsWith('customFields.') ? `cf.${d.path.slice(13)}` : d.path.replace(/^company\./, '').replace(/\.0\.value$|\.value$/, ''), d.message])));
      }
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  const label = ENTITY_LABEL[entity].one;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t.maybe(mode === 'create' ? `New ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}`)}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Fields marked * are required.')}</DialogDescription>
        {draft.offer && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <span className="flex-1">{t.maybe(`You have an unsaved ${label.toLowerCase()} from {when}.`, { when: relativeTime(draft.offer.savedAt.toISOString()) })}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { const v = draft.take(); if (v) setValues(v); }}>
              {t('Restore draft')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={draft.discard}>
              {t('Discard')}
            </Button>
          </div>
        )}
        <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.wide ? 'sm:col-span-2' : undefined}>
              <FieldControl spec={f} id={`${formId}-${f.name}`} values={values} set={set} error={errors[f.name] ?? (f.type === 'pipeline' ? errors.stageId : undefined)} />
            </div>
          ))}
          {custom.data && custom.data.length > 0 && !hiddenKeys.has('customFields') && (
            <fieldset className="grid gap-4 border-t border-border pt-4 sm:col-span-2 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium text-muted-foreground">{t('Custom fields')}</legend>
              {custom.data.filter((d) => (mode === 'edit' || d.showInForms) && logic.shows(d)).map((d) => (
                <CustomFieldInput
                  key={d.id}
                  def={d}
                  entity={CUSTOM_FIELD_ENTITY[entity]}
                  id={`${formId}-cf-${d.key}`}
                  value={logic.valueOf(d, cfRaw(d))}
                  onChange={(v) => set(`cf.${d.key}`, v)}
                  error={errors[`cf.${d.key}`]}
                />
              ))}
            </fieldset>
          )}
          {withEmployees && <QuickEmployees idPrefix={`${formId}-emp`} value={employees} onChange={setEmployees} errors={errors} />}
          {duplicate && (
            <div
              role="alert"
              ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm sm:col-span-2"
              data-duplicate-deal
            >
              <span className="min-w-0 flex-1">
                {t('This company already has an open deal called “{name}”{number}. Open it, or create a second deal anyway.', { name: duplicate.name, number: duplicate.dealNumber ? ` (${duplicate.dealNumber})` : '' })}
              </span>
              <Button asChild type="button" size="sm" variant="outline">
                <a href={`/app/deals?deal=${duplicate.id}`}>{t('Open the existing deal')}</a>
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void submit(null, true)}>
                {t('Create anyway')}
              </Button>
            </div>
          )}
          {formError && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('Saving…') : mode === 'create' ? t.maybe(`Create ${label.toLowerCase()}`) : t('Save changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldControl({ spec, id, values, set, error }: { spec: FieldSpec; id: string; values: Record<string, unknown>; set: (n: string, v: unknown) => void; error?: string }) {
  const t = useT();
  const name = t(spec.label);
  const label = spec.required ? `${name} *` : name;
  const hint = spec.hint ? t(spec.hint) : undefined;
  const v = values[spec.name];
  const str = v === null || v === undefined ? '' : String(v);
  switch (spec.type) {
    case 'select':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <Select value={str} onChange={(e) => set(spec.name, e.target.value)}>
            <option value="">{t('Default')}</option>
            {spec.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </Select>
        </Field>
      );
    case 'owner':
      return <OwnerField id={id} label={label} value={str} onChange={(x) => set(spec.name, x)} error={error} hint={hint} />;
    case 'company':
    case 'contact':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <RecordPicker entity={spec.type === 'company' ? 'companies' : 'contacts'} value={(v as PickerValue | null) ?? null} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'pipeline':
      return <PipelineField id={id} values={values} set={set} error={error} />;
    case 'country':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <CountrySelect value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'currency':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <CurrencySelect value={str} onChange={(x) => set(spec.name, x)} placeholder={t('Search currencies')} />
        </Field>
      );
    case 'timezone':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <TimeZoneSelect value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'money':
      return <MoneyField id={id} label={label} spec={spec} value={str} currency={String(values[spec.currencyField ?? 'currency'] ?? '')} set={set} error={error} />;
    case 'percent':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <NumberStepper value={str} onChange={(x) => set(spec.name, x)} min={0} max={100} step={5} suffix="%" label={t.language === 'en' ? spec.label.replace(/\s*\(.*\)$/, '').toLowerCase() : name.replace(/\s*\(.*\)$/, '')} />
        </Field>
      );
    case 'tel':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <PhoneInput value={str} onChange={(x) => set(spec.name, x)} />
        </Field>
      );
    case 'tags':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <MultiCombobox value={Array.isArray(v) ? (v as string[]) : str ? str.split(',').map((t) => t.trim()).filter(Boolean) : []} onChange={(x) => set(spec.name, x)} creatable max={20} itemLabel={t('tag')} placeholder={t('Type a tag')} />
        </Field>
      );
    case 'priority':
      return (
        <Segmented
          legend={name}
          name={id}
          value={(str || 'NONE') as 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'}
          onChange={(x) => set(spec.name, x === 'NONE' ? '' : x)}
          options={[
            { value: 'NONE', label: t('Not set') },
            { value: 'LOW', label: t('Low') },
            { value: 'MEDIUM', label: t('Medium') },
            { value: 'HIGH', label: t('High') },
          ]}
        />
      );
    case 'source':
      return (
        <>
          <Field id={id} label={label} error={error} hint={hint}>
            <Input list={`${id}-sources`} placeholder={spec.placeholder ? t(spec.placeholder) : undefined} value={str} onChange={(e) => set(spec.name, e.target.value)} />
          </Field>
          <datalist id={`${id}-sources`}>
            {DEAL_SOURCES.map((s) => (
              <option key={s} value={t.maybe(s)} />
            ))}
          </datalist>
        </>
      );
    case 'list':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <MultiCombobox value={Array.isArray(v) ? (v as string[]) : []} onChange={(x) => set(spec.name, x)} creatable max={30} itemLabel={t('product or service')} placeholder={spec.placeholder ? t(spec.placeholder) : undefined} />
        </Field>
      );
    case 'rfq':
      return <RfqField id={id} label={label} hint={hint} error={error} value={str} companyId={(values.companyId as PickerValue | null)?.id ?? null} onChange={(x) => set(spec.name, x)} />;
    case 'followUp':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <Input type="date" value={str} onChange={(e) => set(spec.name, e.target.value)} />
        </Field>
      );
    case 'textarea':
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <Textarea value={str} onChange={(e) => set(spec.name, e.target.value)} />
        </Field>
      );
    default:
      return (
        <Field id={id} label={label} error={error} hint={hint}>
          <Input
            type={spec.type}
            inputMode={spec.type === 'number' ? 'decimal' : undefined}
            required={spec.required}
            placeholder={spec.placeholder ? t(spec.placeholder) : undefined}
            value={str}
            onChange={(e) => set(spec.name, e.target.value)}
          />
        </Field>
      );
  }
}

/** The RFQs of the chosen company, to link one to the deal. */
function RfqField({ id, label, hint, error, value, companyId, onChange }: { id: string; label: string; hint?: string; error?: string; value: string; companyId: string | null; onChange: (v: string) => void }) {
  const t = useT();
  const rfqs = useRfqs({ companyId: companyId ?? undefined }, !!companyId);
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Select value={value} disabled={!companyId} onChange={(e) => onChange(e.target.value)}>
        <option value="">{!companyId ? t('Choose a company first') : rfqs.isPending ? t('Loading…') : t('No RFQ')}</option>
        {rfqs.data?.items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.number} · {r.projectName}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function MoneyField({ id, label, spec, value, currency, set, error }: { id: string; label: string; spec: FieldSpec; value: string; currency: string; set: (n: string, v: unknown) => void; error?: string }) {
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<TenantDetails>('/tenants/current'), staleTime: 300_000 });
  const code = currency || tenant.data?.defaultCurrency || 'USD';
  const t = useT();
  return (
    <Field id={id} label={label} error={error} hint={spec.hint ? t(spec.hint) : undefined}>
      <CurrencyInput value={value} onChange={(x) => set(spec.name, x)} currency={code} />
    </Field>
  );
}

function OwnerField({ id, label, value, onChange, error, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string }) {
  const members = useMembers();
  const t = useT();
  return (
    <Field id={id} label={label} error={error} hint={hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{members.isPending ? t('Loading…') : t('Me (default)')}</option>
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
  const t = useT();
  const selected = pipelines.data?.find((p) => p.id === values.pipelineId) ?? pipelines.data?.find((p) => p.isDefault);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id} label={t('Pipeline')} error={error}>
        <Select value={selected?.id ?? ''} onChange={(e) => { set('pipelineId', e.target.value); set('stageId', ''); }}>
          {pipelines.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? t(' (default)') : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-stage`} label={t('Stage')}>
        <Select value={String(values.stageId ?? '')} onChange={(e) => set('stageId', e.target.value)}>
          <option value="">{t('First open stage')}</option>
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

// ─── Employees typed with a new company ───

interface QuickEmployee {
  key: string;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
}

const emptyQuickEmployee = (): QuickEmployee => ({ key: crypto.randomUUID(), name: '', jobTitle: '', email: '', phone: '' });

function quickEmployeePayload(e: QuickEmployee) {
  const [first = '', ...rest] = e.name.trim().split(/\s+/);
  return {
    firstName: first,
    lastName: rest.join(' '),
    jobTitle: e.jobTitle,
    emails: e.email.trim() ? [{ value: e.email.trim(), primary: true }] : [],
    phones: e.phone.trim() ? [{ value: e.phone.trim(), primary: true }] : [],
  };
}

/** Rows for the people at a company being created: name, designation, email and phone. More details later on the company page. */
function QuickEmployees({ idPrefix, value, onChange, errors }: { idPrefix: string; value: QuickEmployee[]; onChange: (v: QuickEmployee[]) => void; errors: Record<string, string> }) {
  const t = useT();
  const patch = (key: string, p: Partial<QuickEmployee>) => onChange(value.map((e) => (e.key === key ? { ...e, ...p } : e)));
  const err = (i: number, field: string) => errors[`employees.${i}.${field}`];
  return (
    <fieldset className="space-y-3 border-t border-border pt-4 sm:col-span-2">
      <legend className="mb-1 text-sm font-medium text-muted-foreground">{t('Employees / POCs')}</legend>
      <p className="text-xs text-muted-foreground">{t('Add the people you deal with at this company. They are saved with the company and listed under Contacts too.')}</p>
      {value.map((e, i) => {
        const id = (f: string) => `${idPrefix}-${i}-${f}`;
        const label = e.name.trim() || t('Employee {n}', { n: i + 1 });
        return (
          <div key={e.key} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Field id={id('name')} label={t('Employee name *')} error={err(i, 'firstName') ?? err(i, 'lastName')}>
              <Input value={e.name} autoComplete="off" onChange={(x) => patch(e.key, { name: x.target.value })} />
            </Field>
            <Field id={id('jobTitle')} label={t('Designation')} error={err(i, 'jobTitle')}>
              <Input value={e.jobTitle} onChange={(x) => patch(e.key, { jobTitle: x.target.value })} />
            </Field>
            <Field id={id('email')} label={t('Email')} error={err(i, 'emails')}>
              <Input type="email" value={e.email} onChange={(x) => patch(e.key, { email: x.target.value })} />
            </Field>
            <Field id={id('phone')} label={t('Phone')} error={err(i, 'phones')}>
              <Input type="tel" value={e.phone} onChange={(x) => patch(e.key, { phone: x.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="button" variant="ghost" size="sm" aria-label={t('Remove {value}', { value: label })} onClick={() => onChange(value.filter((x) => x.key !== e.key))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, emptyQuickEmployee()])}>
        <Plus aria-hidden /> {t('Add employee / POC')}
      </Button>
    </fieldset>
  );
}
