'use client';

import {
  COMPANY_TYPES,
  companyLeadSchema,
  type CustomFieldDef,
  type DuplicateMatch,
  LEAD_FORM_STEPS,
  type LeadDraftRow,
  type LeadFormStep,
  PORTAL_DOCUMENT_MAX_BYTES,
  PORTAL_DOCUMENT_TYPES,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import {
  BranchFields,
  branchPayload,
  type BranchValue,
  emptyBranch,
  emptyEmployee,
  EmployeeFields,
  employeePayload,
  type EmployeeValue,
  type Errors,
  filledPoints,
  LocationFields,
  PersonSelect,
  pointErrors,
  PointsEditor,
  type PointValue,
  StatusSelect,
  usePerson,
} from '@/components/crm/lead-fields';
import { CustomFieldInput, fieldDefault, fieldLogic, fieldPayloadValue, useFieldDefs } from '@/components/crm/custom-field-input';
import { Select, Textarea } from '@/components/crm/select';
import { CountryFlag, StatusChip } from '@/components/crm/status-chip';
import { formatBytes, UploadZone } from '@/components/forms/upload-zone';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { useCrmStatuses, useDepartments } from '@/lib/company-crm';
import { personLabel, uploadCompanyFile, useCreateCompanyLead, useLeadDrafts, useLeadDraft, useRemoveLeadDraft, useSaveLeadDraft } from '@/lib/company-leads';
import { useMembers } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useTeams } from '@/lib/gamification';
import { type MessageKey, useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const STEP_LABELS = {
  company: 'Company information',
  location: 'Company location',
  business: 'Business details',
  employees: 'Employees / POCs',
  ownership: 'Lead ownership & POC assignment',
  status: 'Lead status',
  remarks: 'Remarks & attachments',
  review: 'Review & save',
} as const satisfies Record<LeadFormStep, MessageKey>;

export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'] as const;

/** Which step each company field is entered on, to send the person back to the first problem. */
const FIELD_STEP: Record<string, LeadFormStep> = {
  name: 'company', websites: 'company', linkedinUrls: 'company', emails: 'company', phones: 'company', overview: 'company', website: 'company', linkedinUrl: 'company', primaryEmail: 'company', primaryPhone: 'company',
  country: 'location', state: 'location', city: 'location', address: 'location', postalCode: 'location', timezone: 'location', headquarters: 'location',
  foundedYear: 'business', branchCount: 'business', industry: 'business', companySize: 'business', companyType: 'business', specialties: 'business', businessCategory: 'business',
  ownerId: 'ownership', managerId: 'ownership', pocUserId: 'ownership', departmentId: 'ownership', teamId: 'ownership',
  statusId: 'status', notes: 'remarks', customFields: 'remarks',
};

interface CompanyValue {
  name: string;
  websites: PointValue[];
  linkedinUrls: PointValue[];
  emails: PointValue[];
  phones: PointValue[];
  overview: string;
  country: string;
  state: string;
  city: string;
  address: string;
  postalCode: string;
  timezone: string;
  headquarters: string;
  foundedYear: string;
  branchCount: string;
  industry: string;
  companySize: string;
  companyType: string;
  specialties: string;
  businessCategory: string;
  ownerId: string;
  managerId: string;
  pocUserId: string;
  departmentId: string;
  teamId: string;
  statusId: string;
  notes: string;
  /** Custom company fields (ADR 0062), as the inputs hold them. */
  customFields: Record<string, unknown>;
}

interface LeadForm {
  company: CompanyValue;
  branches: BranchValue[];
  employees: EmployeeValue[];
}

const one = (): PointValue[] => [{ value: '', primary: true }];
const emptyForm = (): LeadForm => ({
  company: {
    name: '', websites: one(), linkedinUrls: one(), emails: one(), phones: one(), overview: '', country: '', state: '', city: '', address: '', postalCode: '', timezone: '', headquarters: '',
    foundedYear: '', branchCount: '', industry: '', companySize: '', companyType: '', specialties: '', businessCategory: '', ownerId: '', managerId: '', pocUserId: '', departmentId: '', teamId: '', statusId: '', notes: '', customFields: {},
  },
  branches: [],
  employees: [],
});

/** A draft saved by an older form keeps working: missing parts take their empty values. */
function fromDraft(d: LeadDraftRow): LeadForm {
  const base = emptyForm();
  const data = d.data as Partial<LeadForm>;
  return {
    company: { ...base.company, ...(data.company ?? {}) },
    branches: (data.branches ?? []).map((b) => ({ ...emptyBranch(), ...b })),
    employees: (data.employees ?? []).map((e) => ({ ...emptyEmployee(), ...e })),
  };
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

function payload(form: LeadForm, draftId: string | null, fields: CustomFieldDef[]) {
  const c = form.company;
  // Only fields this person may edit are sent; empty ones are left out.
  const logic = fieldLogic(fields, (k) => {
    const d = fields.find((x) => x.key === k);
    return d ? (c.customFields[k] ?? fieldDefault(d)) : undefined;
  });
  const customFields = Object.fromEntries(
    fields.filter((d) => d.showInForms && d.access.edit && logic.shows(d)).map((d) => [d.key, fieldPayloadValue(d, c.customFields[d.key] ?? fieldDefault(d))] as const).filter(([, v]) => v !== ''),
  );
  return {
    ...(draftId ? { draftId } : {}),
    company: {
      name: c.name,
      websites: filledPoints(c.websites),
      linkedinUrls: filledPoints(c.linkedinUrls),
      emails: filledPoints(c.emails),
      phones: filledPoints(c.phones),
      overview: c.overview,
      country: c.country,
      state: c.state,
      city: c.city,
      address: c.address,
      postalCode: c.postalCode,
      timezone: c.timezone,
      headquarters: c.headquarters,
      foundedYear: num(c.foundedYear),
      branchCount: num(c.branchCount),
      industry: c.industry,
      companySize: c.companySize,
      companyType: c.companyType,
      specialties: c.specialties,
      businessCategory: c.businessCategory,
      ownerId: c.ownerId || null,
      // Left out when empty, so the API fills in the owner's reporting manager.
      ...(c.managerId ? { managerId: c.managerId } : {}),
      pocUserId: c.pocUserId || null,
      departmentId: c.departmentId || null,
      teamId: c.teamId || null,
      statusId: c.statusId || null,
      notes: c.notes,
      customFields,
    },
    branches: form.branches.map(branchPayload),
    employees: form.employees.map(employeePayload),
  };
}

/** "company.emails.1.value" style keys. Errors from the API name company fields without the "company." part. */
function errorKey(path: (string | number)[] | string): string {
  const p = typeof path === 'string' ? path : path.join('.');
  return /^(company|branches|employees)\./.test(p) ? p : `company.${p}`;
}

function stepOf(key: string): LeadFormStep {
  if (key.startsWith('employees.')) return 'employees';
  if (key.startsWith('branches.')) return 'business';
  return FIELD_STEP[key.split('.')[1] ?? ''] ?? 'company';
}

/** Errors under a prefix, with the prefix removed. */
const under = (errors: Errors, prefix: string): Errors =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length).replace(/\.value$/, ''), v]));

export function LeadWizard() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const draftParam = params.get('draft');
  const draft = useLeadDraft(draftParam);
  const [draftId, setDraftId] = React.useState<string | null>(draftParam);
  const [form, setForm] = React.useState<LeadForm>(emptyForm);
  const [step, setStep] = React.useState(0);
  const [errors, setErrors] = React.useState<Errors>({});
  const [files, setFiles] = React.useState<File[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(!draftParam);
  const saveDraft = useSaveLeadDraft();
  const create = useCreateCompanyLead();
  const [saving, setSaving] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const customDefs = useFieldDefs('COMPANY');
  const companyFields = (customDefs.data ?? []).filter((d) => d.showInForms);
  const cfLogic = fieldLogic(customDefs.data ?? [], (k) => {
    const d = customDefs.data?.find((x) => x.key === k);
    return d ? (form.company.customFields[k] ?? fieldDefault(d)) : undefined;
  });

  React.useEffect(() => {
    if (draft.data && !loaded) {
      setForm(fromDraft(draft.data));
      setStep(draft.data.step);
      setDraftId(draft.data.id);
      setLoaded(true);
    }
  }, [draft.data, loaded]);

  const current = LEAD_FORM_STEPS[step]!;
  const goTo = (i: number) => {
    setStep(i);
    setNotice(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const setCompany = (patch: Partial<CompanyValue>) => setForm((f) => ({ ...f, company: { ...f.company, ...patch } }));

  const validate = (): Errors => {
    const parsed = companyLeadSchema.safeParse(payload(form, draftId, customDefs.data ?? []));
    if (parsed.success) return {};
    const out: Errors = {};
    for (const i of parsed.error.issues) {
      const k = errorKey(i.path as (string | number)[]);
      if (!out[k]) out[k] = t.maybe(i.message);
    }
    return out;
  };

  const next = () => {
    const all = validate();
    const here = Object.fromEntries(Object.entries(all).filter(([k]) => stepOf(k) === current));
    setErrors(here);
    if (Object.keys(here).length) {
      focusFirstError();
      return;
    }
    goTo(Math.min(step + 1, LEAD_FORM_STEPS.length - 1));
  };

  const onSaveDraft = async () => {
    setFormError(null);
    try {
      const d = await saveDraft.mutateAsync({ id: draftId, input: { step, data: form as unknown as Record<string, unknown> } });
      if (!draftId) {
        setDraftId(d.id);
        router.replace(`/app/companies/new?draft=${d.id}`, { scroll: false });
      }
      setNotice(t('Draft saved. Attachments are added when you save the lead.'));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  const onSave = async () => {
    setFormError(null);
    const all = validate();
    setErrors(all);
    if (Object.keys(all).length) {
      goTo(LEAD_FORM_STEPS.indexOf(stepOf(Object.keys(all)[0]!)));
      focusFirstError();
      return;
    }
    setSaving(true);
    try {
      const res = await create.mutateAsync(payload(form, draftId, customDefs.data ?? []));
      const failed: string[] = [];
      for (const f of files) await uploadCompanyFile(res.company.id, f).catch(() => failed.push(f.name));
      router.push(`/app/companies/${res.company.id}${failed.length ? `?uploadFailed=${encodeURIComponent(failed.join(', '))}` : ''}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) {
        const out = Object.fromEntries(e.details.map((d) => [errorKey(d.path), t.maybe(d.message)]));
        setErrors(out);
        goTo(LEAD_FORM_STEPS.indexOf(stepOf(Object.keys(out)[0]!)));
      }
      setFormError(e instanceof Error ? e.message : t('Could not save.'));
      setSaving(false);
    }
  };

  if (draftParam && !loaded) {
    if (draft.error) return <p role="alert" className="text-sm text-critical">{t('This draft could not be opened. It may have been saved as a lead or deleted.')}</p>;
    return <Skeleton className="h-96" />;
  }

  const c = form.company;
  const ce = under(errors, 'company.');
  return (
    <div className="grid max-w-6xl gap-6 lg:grid-cols-[15rem_1fr]">
      <nav aria-label={t('Lead form steps')} className="lg:sticky lg:top-4 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:gap-1 lg:overflow-visible">
          {LEAD_FORM_STEPS.map((s, i) => {
            const hasError = Object.keys(errors).some((k) => stepOf(k) === s);
            return (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === step ? 'step' : undefined}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm transition-colors ${i === step ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs ${i === step ? 'border-primary-foreground' : i < step ? 'border-primary bg-primary/10' : 'border-border'}`}>
                    {i < step && !hasError ? <Check className="size-3.5" /> : i + 1}
                  </span>
                  <span>{t(STEP_LABELS[s])}</span>
                  {hasError && <AlertTriangle aria-label={t('Needs attention')} className="ms-auto size-4 text-critical" />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="min-w-0 space-y-4">
        {!draftParam && !draftId && <DraftPicker />}
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
              {t('Step {n} of {total}: {name}', { n: step + 1, total: LEAD_FORM_STEPS.length, name: t(STEP_LABELS[current]) })}
            </h2>
            {draftId && <Badge tone="primary">{t('Draft')}</Badge>}
          </CardHeader>
          <CardContent className="space-y-6">
            {current === 'company' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field id="lead-name" label={t('Company name *')} error={ce.name}>
                    <Input autoComplete="organization" value={c.name} onChange={(e) => setCompany({ name: e.target.value })} />
                  </Field>
                  <DuplicateWarning name={c.name} website={filledPoints(c.websites)[0]?.value} emails={filledPoints(c.emails).map((p) => p.value)} phones={filledPoints(c.phones).map((p) => p.value)} />
                </div>
                <div className="sm:col-span-2">
                  <PointsEditor id="lead-websites" label={t('Official website URL')} kind="url" values={c.websites} onChange={(websites) => setCompany({ websites })} errors={pointErrors(ce, 'websites')} addLabel={t('Add website')} />
                </div>
                <div className="sm:col-span-2">
                  <PointsEditor id="lead-linkedin" label={t('Company LinkedIn URL')} kind="url" values={c.linkedinUrls} onChange={(linkedinUrls) => setCompany({ linkedinUrls })} errors={pointErrors(ce, 'linkedinUrls')} addLabel={t('Add LinkedIn page')} />
                </div>
                <div className="sm:col-span-2">
                  <PointsEditor id="lead-emails" label={t('Company email IDs')} kind="email" values={c.emails} onChange={(emails) => setCompany({ emails })} errors={pointErrors(ce, 'emails')} addLabel={t('Add email')} />
                </div>
                <div className="sm:col-span-2">
                  <PointsEditor id="lead-phones" label={t('Company phone numbers')} kind="phone" values={c.phones} onChange={(phones) => setCompany({ phones })} errors={pointErrors(ce, 'phones')} addLabel={t('Add phone')} />
                </div>
                <div className="sm:col-span-2">
                  <Field id="lead-overview" label={t('Company overview')} error={ce.overview}>
                    <Textarea rows={4} value={c.overview} onChange={(e) => setCompany({ overview: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}

            {current === 'location' && (
              <div className="space-y-4">
                <LocationFields idPrefix="lead" value={c} onChange={setCompany} errors={ce} withTimezone />
                <Field id="lead-headquarters" label={t('Headquarters')} error={ce.headquarters} hint={t('For example "Pune, India" when the head office is not the address above.')}>
                  <Input value={c.headquarters} onChange={(e) => setCompany({ headquarters: e.target.value })} />
                </Field>
              </div>
            )}

            {current === 'business' && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="lead-industry" label={t('Industry')} error={ce.industry}>
                    <Input value={c.industry} onChange={(e) => setCompany({ industry: e.target.value })} />
                  </Field>
                  <Field id="lead-businessCategory" label={t('Business category')} error={ce.businessCategory}>
                    <Input value={c.businessCategory} onChange={(e) => setCompany({ businessCategory: e.target.value })} />
                  </Field>
                  <Field id="lead-companySize" label={t('Company size')} error={ce.companySize}>
                    <Select value={c.companySize} onChange={(e) => setCompany({ companySize: e.target.value })}>
                      <option value="">{t('Not known')}</option>
                      {COMPANY_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {t('{range} employees', { range: s })}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="lead-companyType" label={t('Company type')} error={ce.companyType}>
                    <Select value={c.companyType} onChange={(e) => setCompany({ companyType: e.target.value })}>
                      <option value="">{t('Not known')}</option>
                      {COMPANY_TYPES.map((s) => (
                        <option key={s} value={s}>
                          {t.maybe(s)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="lead-foundedYear" label={t('Founded year')} error={ce.foundedYear}>
                    <Input inputMode="numeric" value={c.foundedYear} onChange={(e) => setCompany({ foundedYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                  </Field>
                  <Field id="lead-branchCount" label={t('Number of branches')} error={ce.branchCount} hint={form.branches.length ? t('Counted from the branches below when left empty.') : undefined}>
                    <Input inputMode="numeric" value={c.branchCount} onChange={(e) => setCompany({ branchCount: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field id="lead-specialties" label={t('Company specialties')} error={ce.specialties}>
                      <Textarea rows={2} value={c.specialties} onChange={(e) => setCompany({ specialties: e.target.value })} />
                    </Field>
                  </div>
                </div>
                <section aria-labelledby="lead-branches-heading" className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="lead-branches-heading" className="text-base font-semibold">
                      {t('Branches')} <span className="text-muted-foreground">({form.branches.length})</span>
                    </h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, branches: [...f.branches, emptyBranch()] }))}>
                      <Plus aria-hidden /> {t('Add branch')}
                    </Button>
                  </div>
                  {form.branches.length === 0 && <p className="text-sm text-muted-foreground">{t('Add each office in another city or country. Branches stay linked to this company.')}</p>}
                  {form.branches.map((b, i) => (
                    <fieldset key={b.key} className="space-y-3 rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <legend className="text-sm font-medium">{b.name || t('Branch {n}', { n: i + 1 })}</legend>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, branches: f.branches.filter((x) => x.key !== b.key) }))} aria-label={t('Remove {value}', { value: b.name || t('Branch {n}', { n: i + 1 }) })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <BranchFields
                        idPrefix={`lead-branch-${i}`}
                        value={b}
                        errors={under(errors, `branches.${i}.`)}
                        onChange={(patch) => setForm((f) => ({ ...f, branches: f.branches.map((x) => (x.key === b.key ? { ...x, ...patch } : x)) }))}
                      />
                    </fieldset>
                  ))}
                </section>
              </div>
            )}

            {current === 'employees' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">{t('The people you deal with at this company. You can add more later from the company page.')}</p>
                  <Button type="button" size="sm" onClick={() => setForm((f) => ({ ...f, employees: [...f.employees, emptyEmployee()] }))}>
                    <Plus aria-hidden /> {t('Add employee / POC')}
                  </Button>
                </div>
                {form.employees.length === 0 && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No employees added yet. A lead can be saved without them.')}</p>}
                {form.employees.map((e, i) => {
                  const label = [e.firstName, e.lastName].filter(Boolean).join(' ') || t('Employee {n}', { n: i + 1 });
                  return (
                    <fieldset key={e.key} className="space-y-3 rounded-lg border border-border p-4">
                      <div className="flex items-center justify-between gap-2">
                        <legend className="text-sm font-medium">{label}</legend>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, employees: f.employees.filter((x) => x.key !== e.key) }))} aria-label={t('Remove {value}', { value: label })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <EmployeeFields
                        idPrefix={`lead-employee-${i}`}
                        value={e}
                        errors={under(errors, `employees.${i}.`)}
                        onChange={(patch) => setForm((f) => ({ ...f, employees: f.employees.map((x) => (x.key === e.key ? { ...x, ...patch } : x)) }))}
                      />
                    </fieldset>
                  );
                })}
              </section>
            )}

            {current === 'ownership' && <OwnershipStep value={c} onChange={setCompany} errors={ce} />}

            {current === 'status' && (
              <div className="max-w-md space-y-3">
                <Field id="lead-statusId" label={t('Company status')} error={ce.statusId}>
                  <StatusSelect kind="COMPANY" value={c.statusId} onChange={(statusId) => setCompany({ statusId })} />
                </Field>
                <StatusPreview id={c.statusId} />
              </div>
            )}

            {current === 'remarks' && (
              <div className="space-y-4">
                <Field id="lead-notes" label={t('Remarks')} error={ce.notes}>
                  <Textarea rows={5} value={c.notes} onChange={(e) => setCompany({ notes: e.target.value })} />
                </Field>
                {companyFields.length > 0 && (
                  <fieldset className="space-y-4">
                    <legend className="mb-2 text-sm font-semibold">{t('Custom fields')}</legend>
                    {companyFields.filter(cfLogic.shows).map((d) => (
                      <CustomFieldInput
                        key={d.key}
                        def={d}
                        entity="COMPANY"
                        id={`lead-cf-${d.key}`}
                        value={cfLogic.valueOf(d, c.customFields[d.key] ?? fieldDefault(d))}
                        onChange={(v) => setCompany({ customFields: { ...c.customFields, [d.key]: v } })}
                        error={ce[`customFields.${d.key}`]}
                      />
                    ))}
                  </fieldset>
                )}
                <div className="space-y-2">
                  <UploadZone
                    label={t('Attachments')}
                    accept={[...PORTAL_DOCUMENT_TYPES]}
                    maxBytes={PORTAL_DOCUMENT_MAX_BYTES}
                    onFile={(f) => setFiles((list) => [...list.filter((x) => x.name !== f.name), f])}
                    hint={t('PDF, image, text, CSV, Word, Excel or PowerPoint, up to 10 MB each. Uploaded when you save the lead; drafts keep the text only.')}
                  />
                  {files.length > 0 && (
                    <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('Attachments')}>
                      {files.map((f) => (
                        <li key={f.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <FileText aria-hidden className="size-4 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{f.name}</span>
                          <span className="text-muted-foreground">{formatBytes(f.size)}</span>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setFiles((list) => list.filter((x) => x !== f))} aria-label={t('Remove {value}', { value: f.name })}>
                            <X aria-hidden />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {current === 'review' && <Review form={form} files={files} errors={errors} onEdit={(s) => goTo(LEAD_FORM_STEPS.indexOf(s))} />}

            {notice && (
              <p role="status" className="text-sm text-success">
                {notice}
              </p>
            )}
            {formError && (
              <p role="alert" className="text-sm text-critical">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0}>
                <ArrowLeft aria-hidden /> {t('Back')}
              </Button>
              <Button type="button" variant="ghost" onClick={onSaveDraft} disabled={saveDraft.isPending || !c.name.trim()} title={!c.name.trim() ? t('Enter a company name to save a draft.') : undefined}>
                <Save aria-hidden /> {saveDraft.isPending ? t('Saving…') : t('Save draft')}
              </Button>
              <div className="ms-auto flex gap-2">
                {current === 'review' ? (
                  <Button type="button" onClick={onSave} disabled={saving}>
                    <Check aria-hidden /> {saving ? t('Saving…') : t('Save lead')}
                  </Button>
                ) : (
                  <Button type="button" onClick={next}>
                    {t('Next')} <ArrowRight aria-hidden className="rtl:rotate-180" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function focusFirstError() {
  requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
}

function OwnershipStep({ value, onChange, errors }: { value: CompanyValue; onChange: (p: Partial<CompanyValue>) => void; errors: Errors }) {
  const t = useT();
  const session = useSession();
  const me = usePerson(session.data?.user.id);
  const ownerId = value.ownerId || session.data?.user.id || '';
  const owner = usePerson(ownerId);
  const members = useMembers();
  const reportsTo = members.data?.find((m) => m.userId === ownerId)?.reportingManager ?? null;
  const departments = useDepartments();
  const teams = useTeams();
  return (
    <div className="space-y-6">
      <dl className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">{t('Lead created by')}</dt>
          <dd className="text-sm font-medium">{me?.name ?? session.data?.user.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('Creator designation')}</dt>
          <dd className="text-sm">{me?.designation ?? t('No designation set')}</dd>
        </div>
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lead-ownerId" label={t('Lead owner')} error={errors.ownerId} hint={t('You can give leads to yourself and to people who report to you.')}>
          <PersonSelect assignableOnly value={ownerId} onChange={(id) => onChange({ ownerId: id })} />
        </Field>
        <div>
          <p className="text-sm font-medium">{t('Lead owner designation')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{owner?.designation ?? t('No designation set')}</p>
        </div>
        <Field id="lead-managerId" label={t('Assigned manager')} error={errors.managerId} hint={reportsTo ? t('Leave empty to use {name}, who the owner reports to.', { name: reportsTo.name }) : t('Leave empty to use the owner’s reporting manager.')}>
          <PersonSelect value={value.managerId} onChange={(id) => onChange({ managerId: id })} />
        </Field>
        <div>
          <p className="text-sm font-medium">{t('Reporting manager')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{reportsTo?.name ?? t('Not set on the Team page')}</p>
        </div>
        <Field id="lead-departmentId" label={t('Assigned department')} error={errors.departmentId}>
          <Select value={value.departmentId} onChange={(e) => onChange({ departmentId: e.target.value })}>
            <option value="">{t('None')}</option>
            {departments.data?.filter((d) => !d.archived).map((d) => (
              <option key={d.id} value={d.id}>
                {t.maybe(d.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="lead-teamId" label={t('Assigned team')} error={errors.teamId}>
          <Select value={value.teamId} onChange={(e) => onChange({ teamId: e.target.value })}>
            <option value="">{t('None')}</option>
            {teams.data?.map((tm) => (
              <option key={tm.id} value={tm.id}>
                {tm.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="lead-pocUserId" label={t('POC name')} error={errors.pocUserId} hint={t('The person on your team who is the point of contact for this company. Kept apart from the creator and the owner.')}>
            <PersonSelect value={value.pocUserId} onChange={(id) => onChange({ pocUserId: id })} />
          </Field>
        </div>
      </div>
    </div>
  );
}

function StatusPreview({ id }: { id: string }) {
  const t = useT();
  const statuses = useCrmStatuses('COMPANY');
  const s = statuses.data?.find((x) => (id ? x.id === id : x.isDefault));
  if (!s) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusChip status={s} />
      {s.description && <span className="text-muted-foreground">{t.maybe(s.description)}</span>}
    </div>
  );
}

/** Possible duplicates across the workspace, by name, website, email or phone (names only). */
function DuplicateWarning({ name, website, emails, phones }: { name: string; website?: string; emails: string[]; phones: string[] }) {
  const t = useT();
  const [matches, setMatches] = React.useState<DuplicateMatch[]>([]);
  const key = JSON.stringify({ name: name.trim(), website, emails, phones });
  React.useEffect(() => {
    if (name.trim().length < 2 && !website && !emails.length) {
      setMatches([]);
      return;
    }
    const h = setTimeout(() => {
      api<DuplicateMatch[]>('/companies/check-duplicates', { method: 'POST', json: { name: name.trim() || undefined, website, emails, phones } })
        .then(setMatches)
        .catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(h);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!matches.length) return null;
  return (
    <div role="status" className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle aria-hidden className="size-4" /> {t('This company may already be in SampForce')}
      </p>
      <ul className="mt-1 space-y-1">
        {matches.map((m) => (
          <li key={m.id}>
            {m.visible ? (
              <Link href={`/app/companies/${m.id}`} className="text-primary hover:underline">
                {m.leadNumber ? `${m.leadNumber} ` : ''}
                {m.name}
              </Link>
            ) : (
              <span>
                {m.leadNumber ? `${m.leadNumber} ` : ''}
                {m.name}
              </span>
            )}
            {m.owner && <span className="text-muted-foreground"> · {t('owned by {name}', { name: m.owner.name })}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Review({ form, files, errors, onEdit }: { form: LeadForm; files: File[]; errors: Errors; onEdit: (s: LeadFormStep) => void }) {
  const t = useT();
  const c = form.company;
  const session = useSession();
  const owner = usePerson(c.ownerId || session.data?.user.id);
  const manager = usePerson(c.managerId);
  const poc = usePerson(c.pocUserId);
  const statuses = useCrmStatuses('COMPANY');
  const status = statuses.data?.find((s) => (c.statusId ? s.id === c.statusId : s.isDefault));
  const list = (p: PointValue[]) => filledPoints(p).map((x) => (x.primary && filledPoints(p).length > 1 ? `${x.value} (${t('primary')})` : x.value)).join(', ');
  const section = (s: LeadFormStep, rows: [MessageKey, React.ReactNode][]) => (
    <section aria-labelledby={`review-${s}`} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={`review-${s}`} className="text-sm font-semibold">
          {t(STEP_LABELS[s])}
          {Object.keys(errors).some((k) => stepOf(k) === s) && <AlertTriangle aria-label={t('Needs attention')} className="ms-2 inline size-4 text-critical" />}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(s)} aria-label={t('Edit {section}', { section: t(STEP_LABELS[s]) })}>
          <Pencil aria-hidden /> {t('Edit')}
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, v]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(label)}</dt>
            <dd className="break-words">{v || <span className="text-muted-foreground">—</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <div className="space-y-6 divide-y divide-border [&>*:not(:first-child)]:pt-6">
      {section('company', [
        ['Company name', c.name],
        ['Official website URL', list(c.websites)],
        ['Company LinkedIn URL', list(c.linkedinUrls)],
        ['Company email IDs', list(c.emails)],
        ['Company phone numbers', list(c.phones)],
        ['Company overview', c.overview],
      ])}
      {section('location', [
        ['Country', c.country && <CountryFlag code={c.country} withName />],
        ['State / province', c.state],
        ['City', c.city],
        ['Full address', [c.address, c.postalCode].filter(Boolean).join(', ')],
        ['Time zone', c.timezone],
        ['Headquarters', c.headquarters],
      ])}
      {section('business', [
        ['Industry', c.industry],
        ['Business category', c.businessCategory],
        ['Company size', c.companySize && t('{range} employees', { range: c.companySize })],
        ['Company type', c.companyType && t.maybe(c.companyType)],
        ['Founded year', c.foundedYear],
        ['Number of branches', c.branchCount || (form.branches.length ? String(form.branches.length) : '')],
        ['Branches', form.branches.map((b) => [b.name, b.city].filter(Boolean).join(', ')).join('; ')],
        ['Company specialties', c.specialties],
      ])}
      {section('employees', [['Employees / POCs', form.employees.map((e) => [e.firstName, e.lastName].filter(Boolean).join(' ') + (e.jobTitle ? ` (${e.jobTitle})` : '')).join(', ')]])}
      {section('ownership', [
        ['Lead owner', personLabel(owner)],
        ['Assigned manager', manager ? personLabel(manager) : t('The owner’s reporting manager')],
        ['POC name', personLabel(poc)],
      ])}
      {section('status', [['Company status', status && <StatusChip status={status} />]])}
      {section('remarks', [
        ['Remarks', c.notes],
        ['Attachments', files.map((f) => f.name).join(', ')],
      ])}
    </div>
  );
}

/** The signed-in person's saved drafts, to carry on with one. */
function DraftPicker() {
  const t = useT();
  const drafts = useLeadDrafts();
  const remove = useRemoveLeadDraft();
  if (!drafts.data?.length) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">{t('Your drafts')}</CardTitle>
        <InfoTip topic="crm.leadDrafts" />
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" aria-label={t('Your drafts')}>
          {drafts.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{d.title ?? t('Untitled lead')}</span>
              <span className="text-muted-foreground">
                {t('Step {n} of {total}: {name}', { n: d.step + 1, total: LEAD_FORM_STEPS.length, name: t(STEP_LABELS[LEAD_FORM_STEPS[d.step] ?? 'company']) })} · {relativeTime(d.updatedAt)}
              </span>
              <span className="ms-auto flex gap-1">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/app/companies/new?draft=${d.id}`}>{t('Continue')}</Link>
                </Button>
                <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(d.id)} aria-label={t('Delete draft {name}', { name: d.title ?? t('Untitled lead') })}>
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
