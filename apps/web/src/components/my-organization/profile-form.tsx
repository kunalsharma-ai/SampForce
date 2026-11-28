'use client';

import {
  COMPANY_TYPES,
  ORG_SHARE_SECTION_LABELS,
  ORG_SHARE_SECTIONS,
  type OrgAddress,
  type OrgKeyContact,
  type OrgProfile,
  type OrgProfileInput,
  type OrgShareSection,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
} from '@dealflow/types';
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, Input } from '@dealflow/ui';
import { Building2, Camera, Contact, Globe, Landmark, Loader2, MapPin, Plus, Save, ShieldCheck, Trash2, Upload, UserRound, X } from 'lucide-react';
import * as React from 'react';
import { CountrySelect } from '@/components/forms/inputs';
import { Select, Textarea } from '@/components/crm/select';
import { ApiError } from '@/lib/api';
import { type MessageKey, useT } from '@/lib/i18n';
import { useOrgMutations } from '@/lib/my-organization';
import { HubCard } from './parts';

type Form = Required<{ [K in keyof OrgProfileInput]-?: NonNullable<OrgProfileInput[K]> }>;

const emptyAddress = (): OrgAddress => ({ label: null, country: null, state: null, city: null, address: null, postalCode: null });

function fromProfile(p: OrgProfile): Form {
  return {
    brandName: p.brandName,
    legalName: p.legalName ?? '',
    tagline: p.tagline ?? '',
    description: p.description ?? '',
    businessActivities: p.businessActivities ?? '',
    services: p.services,
    products: p.products,
    industriesServed: p.industriesServed,
    certifications: p.certifications,
    companyType: p.companyType ?? '',
    companySize: p.companySize ?? '',
    employeeCount: p.employeeCount ?? 0,
    foundedYear: p.foundedYear ?? 0,
    incorporationDate: p.incorporationDate ?? '',
    incorporationCountry: p.incorporationCountry ?? '',
    registrationNumber: p.registrationNumber ?? '',
    registrationAuthority: p.registrationAuthority ?? '',
    taxIds: p.taxIds,
    registeredAddress: p.registeredAddress ?? emptyAddress(),
    offices: p.offices,
    phones: p.phones,
    emails: p.emails,
    website: p.website ?? '',
    websiteLinks: p.websiteLinks,
    socialLinks: p.socialLinks,
    keyContacts: p.keyContacts,
    moreDetails: p.moreDetails,
    brandColors: p.brandColors,
    sharedSections: p.sharedSections,
  } as Form;
}

/** What is sent: blanks become null, empty rows are dropped, so a half-typed row never blocks saving. */
function toInput(f: Form): OrgProfileInput {
  const s = (v: string | null | undefined) => (v ?? '').trim() || null;
  const filled = <T extends object>(list: T[]) => list.filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.trim()));
  const addressFilled = (a: OrgAddress) => [a.country, a.state, a.city, a.address, a.postalCode].some((v) => v && v.trim());
  return {
    brandName: f.brandName.trim(),
    legalName: s(f.legalName),
    tagline: s(f.tagline),
    description: s(f.description),
    businessActivities: s(f.businessActivities),
    services: f.services,
    products: f.products,
    industriesServed: f.industriesServed,
    certifications: f.certifications,
    companyType: s(f.companyType),
    companySize: s(f.companySize),
    employeeCount: f.employeeCount ? Number(f.employeeCount) : null,
    foundedYear: f.foundedYear ? Number(f.foundedYear) : null,
    incorporationDate: s(f.incorporationDate),
    incorporationCountry: s(f.incorporationCountry),
    registrationNumber: s(f.registrationNumber),
    registrationAuthority: s(f.registrationAuthority),
    taxIds: filled(f.taxIds),
    registeredAddress: addressFilled(f.registeredAddress) ? f.registeredAddress : null,
    offices: f.offices.filter(addressFilled),
    phones: f.phones.filter((p) => p.value.trim()),
    emails: f.emails.filter((p) => p.value.trim()),
    website: s(f.website),
    websiteLinks: f.websiteLinks.filter((l) => l.url.trim()),
    socialLinks: f.socialLinks.filter((l) => l.url.trim()),
    keyContacts: f.keyContacts.filter((k) => k.name.trim()),
    moreDetails: filled(f.moreDetails),
    brandColors: f.brandColors,
    sharedSections: f.sharedSections,
  };
}

/**
 * Setting up and editing the organisation's profile: every detail in clear sections, saved together. Lists (offices,
 * links, contacts) grow with "Add"; nothing half-typed is sent.
 */
export function ProfileForm({ profile, onSaved }: { profile: OrgProfile; onSaved: () => void }) {
  const t = useT();
  const { saveProfile } = useOrgMutations();
  const [f, setF] = React.useState<Form>(() => fromProfile(profile));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = (path: string) => errors[path];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!f.brandName.trim()) {
      setErrors({ brandName: t('Enter your company name') });
      return;
    }
    saveProfile.mutate(toInput(f), {
      onSuccess: onSaved,
      onError: (x) => {
        if (x instanceof ApiError && x.details?.length) setErrors(Object.fromEntries(x.details.map((d) => [d.path, t.maybe(d.message)])));
      },
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" aria-label={t('Company profile')} noValidate>
      <HubCard title={t('Company identity')} icon={Building2} id="pf-identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pf-brand" label={t('Company name')} error={err('brandName')}>
            <Input value={f.brandName} onChange={(e) => set('brandName', e.target.value)} required maxLength={200} />
          </Field>
          <Field id="pf-legal" label={t('Legal name')} error={err('legalName')}>
            <Input value={f.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={200} />
          </Field>
          <Field id="pf-tagline" label={t('Tagline')} error={err('tagline')}>
            <Input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={200} />
          </Field>
          <Field id="pf-type" label={t('Company type')}>
            <Select value={f.companyType} onChange={(e) => set('companyType', e.target.value)}>
              <option value="">{t('Not set')}</option>
              {COMPANY_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t.maybe(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="pf-founded" label={t('Founded in')} error={err('foundedYear')}>
            <Input type="number" inputMode="numeric" min={1800} max={2100} value={f.foundedYear || ''} onChange={(e) => set('foundedYear', Number(e.target.value) || 0)} />
          </Field>
          <Field id="pf-employees" label={t('Number of employees')} error={err('employeeCount')}>
            <Input type="number" inputMode="numeric" min={1} value={f.employeeCount || ''} onChange={(e) => set('employeeCount', Number(e.target.value) || 0)} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4">
          <Field id="pf-description" label={t('Company description')} error={err('description')}>
            <Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </Field>
          <Field id="pf-activities" label={t('Business activities')} error={err('businessActivities')}>
            <Textarea rows={3} value={f.businessActivities} onChange={(e) => set('businessActivities', e.target.value)} maxLength={5000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <TagInput id="pf-services" label={t('Services')} values={f.services} onChange={(v) => set('services', v)} />
            <TagInput id="pf-products" label={t('Products')} values={f.products} onChange={(v) => set('products', v)} />
            <TagInput id="pf-industries" label={t('Industries served')} values={f.industriesServed} onChange={(v) => set('industriesServed', v)} />
            <TagInput id="pf-certs" label={t('Certifications')} values={f.certifications} onChange={(v) => set('certifications', v)} />
          </div>
          <BrandColours values={f.brandColors} onChange={(v) => set('brandColors', v)} />
        </div>
      </HubCard>

      <HubCard title={t('Registration and tax')} icon={Landmark} tone="amber" id="pf-registration">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pf-reg" label={t('Registration number')} error={err('registrationNumber')}>
            <Input value={f.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} maxLength={120} />
          </Field>
          <Field id="pf-authority" label={t('Registered with')} hint={t('The body that registered the company, such as a Registrar of Companies.')}>
            <Input value={f.registrationAuthority} onChange={(e) => set('registrationAuthority', e.target.value)} maxLength={200} />
          </Field>
          <Field id="pf-incorporated" label={t('Incorporation date')} error={err('incorporationDate')}>
            <Input type="date" value={f.incorporationDate} onChange={(e) => set('incorporationDate', e.target.value)} />
          </Field>
          <Field id="pf-inc-country" label={t('Country of incorporation')} error={err('incorporationCountry')}>
            <CountrySelect value={f.incorporationCountry} onChange={(c) => set('incorporationCountry', c)} />
          </Field>
        </div>
        <PairList
          title={t('Tax and business IDs')}
          addLabel={t('Add a tax ID')}
          rows={f.taxIds}
          onChange={(v) => set('taxIds', v)}
          labelPlaceholder={t('GSTIN, VAT, PAN, EIN…')}
          valuePlaceholder={t('Number')}
          errors={errors}
          path="taxIds"
        />
      </HubCard>

      <HubCard title={t('Contact details')} icon={Contact} tone="emerald" id="pf-contact">
        <div className="grid gap-5 md:grid-cols-2">
          <PointList kind="email" title={t('Official emails')} rows={f.emails} onChange={(v) => set('emails', v)} errors={errors} />
          <PointList kind="phone" title={t('Phone numbers')} rows={f.phones} onChange={(v) => set('phones', v)} errors={errors} />
        </div>
      </HubCard>

      <HubCard title={t('Offices')} icon={MapPin} tone="rose" id="pf-offices">
        <p className="mb-2 text-sm font-semibold">{t('Registered office')}</p>
        <AddressFields value={f.registeredAddress} onChange={(v) => set('registeredAddress', v)} idPrefix="pf-ro" />
        <div className="mt-5 space-y-3">
          <p className="text-sm font-semibold">{t('Other offices')}</p>
          {f.offices.map((a, i) => (
            <div key={i} className="relative rounded-xl border border-border p-3">
              <RemoveRow label={t('Remove this office')} onClick={() => set('offices', f.offices.filter((_, j) => j !== i))} />
              <AddressFields value={a} onChange={(v) => set('offices', f.offices.map((x, j) => (j === i ? v : x)))} idPrefix={`pf-o${i}`} withLabel />
            </div>
          ))}
          <AddRow label={t('Add an office')} onClick={() => set('offices', [...f.offices, emptyAddress()])} />
        </div>
      </HubCard>

      <HubCard title={t('Website and links')} icon={Globe} tone="sky" id="pf-links">
        <Field id="pf-website" label={t('Website')} error={err('website')}>
          <Input type="url" inputMode="url" placeholder="https://" value={f.website} onChange={(e) => set('website', e.target.value)} />
        </Field>
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold">{t('Other website pages and links')}</p>
          {f.websiteLinks.map((l, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <Input aria-label={t('Link name')} placeholder={t('Case studies, Careers, Brochure…')} className="sm:w-56" value={l.label} onChange={(e) => set('websiteLinks', f.websiteLinks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <div className="min-w-[12rem] flex-1">
                <Input aria-label={t('Link address')} aria-invalid={!!err(`websiteLinks.${i}.url`)} placeholder="https://" value={l.url} onChange={(e) => set('websiteLinks', f.websiteLinks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                {err(`websiteLinks.${i}.url`) && <p className="mt-1 text-xs text-critical">{err(`websiteLinks.${i}.url`)}</p>}
              </div>
              <RemoveRow inline label={t('Remove this link')} onClick={() => set('websiteLinks', f.websiteLinks.filter((_, j) => j !== i))} />
            </div>
          ))}
          <AddRow label={t('Add a link')} onClick={() => set('websiteLinks', [...f.websiteLinks, { label: '', url: '' }])} />
        </div>
        <div className="mt-5 space-y-2">
          <p className="text-sm font-semibold">{t('Social media')}</p>
          {f.socialLinks.map((l, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <Select aria-label={t('Platform')} className="sm:w-48" value={l.platform} onChange={(e) => set('socialLinks', f.socialLinks.map((x, j) => (j === i ? { ...x, platform: e.target.value as SocialPlatform } : x)))}>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {SOCIAL_PLATFORM_LABELS[p]}
                  </option>
                ))}
              </Select>
              <div className="min-w-[12rem] flex-1">
                <Input aria-label={t('Profile address')} aria-invalid={!!err(`socialLinks.${i}.url`)} placeholder="https://" value={l.url} onChange={(e) => set('socialLinks', f.socialLinks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                {err(`socialLinks.${i}.url`) && <p className="mt-1 text-xs text-critical">{err(`socialLinks.${i}.url`)}</p>}
              </div>
              <RemoveRow inline label={t('Remove this profile')} onClick={() => set('socialLinks', f.socialLinks.filter((_, j) => j !== i))} />
            </div>
          ))}
          <AddRow label={t('Add a social profile')} onClick={() => set('socialLinks', [...f.socialLinks, { platform: 'linkedin', url: '' }])} />
        </div>
      </HubCard>

      <HubCard title={t('Key contact persons')} icon={UserRound} tone="violet" id="pf-people">
        <div className="space-y-3">
          {f.keyContacts.map((k, i) => (
            <div key={i} className="relative grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2 lg:grid-cols-5">
              {(['name', 'designation', 'department', 'email', 'phone'] as const).map((field) => (
                <Field key={field} id={`pf-k${i}-${field}`} label={t(KEY_LABELS[field])} error={err(`keyContacts.${i}.${field}`)}>
                  <Input
                    type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                    value={k[field] ?? ''}
                    onChange={(e) => set('keyContacts', f.keyContacts.map((x, j) => (j === i ? ({ ...x, [field]: e.target.value } as OrgKeyContact) : x)))}
                  />
                </Field>
              ))}
              <RemoveRow label={t('Remove this person')} onClick={() => set('keyContacts', f.keyContacts.filter((_, j) => j !== i))} />
            </div>
          ))}
          <AddRow label={t('Add a key contact')} onClick={() => set('keyContacts', [...f.keyContacts, { name: '', designation: null, department: null, email: null, phone: null }])} />
        </div>
        <div className="mt-5">
          <PairList title={t('Other details')} addLabel={t('Add a detail')} rows={f.moreDetails} onChange={(v) => set('moreDetails', v)} labelPlaceholder={t('Detail')} valuePlaceholder={t('Value')} errors={errors} path="moreDetails" />
        </div>
      </HubCard>

      <HubCard title={t('What clients may see')} icon={ShieldCheck} tone="emerald" id="pf-sharing">
        <p className="mb-3 text-sm text-muted-foreground">{t('Choose the parts of this profile a client sees through a share link. Credentials and documents not approved for clients are never included.')}</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">{t('Profile sections approved for clients')}</legend>
          {ORG_SHARE_SECTIONS.map((s) => {
            const on = f.sharedSections.includes(s);
            return (
              <label key={s} className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition', on ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border')}>
                <input
                  type="checkbox"
                  className="size-4 accent-emerald-600"
                  checked={on}
                  onChange={(e) => set('sharedSections', e.target.checked ? [...f.sharedSections, s] : f.sharedSections.filter((x: OrgShareSection) => x !== s))}
                />
                <span className="font-medium">{t.maybe(ORG_SHARE_SECTION_LABELS[s])}</span>
              </label>
            );
          })}
        </fieldset>
      </HubCard>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
        {saveProfile.isError && <p role="alert" className="me-auto text-sm text-critical">{saveProfile.error instanceof ApiError ? saveProfile.error.message : t('Could not save. Try again.')}</p>}
        <Button type="button" variant="outline" onClick={onSaved}>
          {t('Cancel')}
        </Button>
        <Button type="submit" disabled={saveProfile.isPending}>
          {saveProfile.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t('Save profile')}
        </Button>
      </div>
    </form>
  );
}

const KEY_LABELS: Record<keyof OrgKeyContact, MessageKey> = { name: 'Name', designation: 'Designation', department: 'Department', email: 'Email', phone: 'Phone' };

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Plus className="size-4" aria-hidden /> {label}
    </Button>
  );
}

function RemoveRow({ label, onClick, inline = false }: { label: string; onClick: () => void; inline?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-critical/10 hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', !inline && 'absolute end-2 top-2')}
    >
      <Trash2 className="size-4" aria-hidden />
    </button>
  );
}

function AddressFields({ value: a, onChange, idPrefix, withLabel = false }: { value: OrgAddress; onChange: (v: OrgAddress) => void; idPrefix: string; withLabel?: boolean }) {
  const t = useT();
  const set = (k: keyof OrgAddress, v: string) => onChange({ ...a, [k]: v || null });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {withLabel && (
        <Field id={`${idPrefix}-label`} label={t('Office name')}>
          <Input value={a.label ?? ''} onChange={(e) => set('label', e.target.value)} placeholder={t('Delhi office')} />
        </Field>
      )}
      <Field id={`${idPrefix}-address`} label={t('Address')}>
        <Input value={a.address ?? ''} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-city`} label={t('City')}>
        <Input value={a.city ?? ''} onChange={(e) => set('city', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-state`} label={t('State or region')}>
        <Input value={a.state ?? ''} onChange={(e) => set('state', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-postal`} label={t('Postal code')}>
        <Input value={a.postalCode ?? ''} onChange={(e) => set('postalCode', e.target.value)} />
      </Field>
      <Field id={`${idPrefix}-country`} label={t('Country')}>
        <CountrySelect value={a.country ?? ''} onChange={(c) => set('country', c)} />
      </Field>
    </div>
  );
}

function PointList({ kind, title, rows, onChange, errors }: { kind: 'email' | 'phone'; title: string; rows: { value: string; label?: string | null }[]; onChange: (v: { value: string; label?: string | null }[]) => void; errors: Record<string, string> }) {
  const t = useT();
  const path = kind === 'email' ? 'emails' : 'phones';
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2">
          <Input aria-label={t('Label')} placeholder={kind === 'email' ? t('Sales, Support…') : t('Main, Office…')} className="w-32" value={r.label ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)))} />
          <div className="min-w-[10rem] flex-1">
            <Input
              type={kind === 'email' ? 'email' : 'tel'}
              aria-label={kind === 'email' ? t('Email') : t('Phone')}
              aria-invalid={!!errors[`${path}.${i}.value`]}
              value={r.value}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            {errors[`${path}.${i}.value`] && <p className="mt-1 text-xs text-critical">{errors[`${path}.${i}.value`]}</p>}
          </div>
          <RemoveRow inline label={t('Remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddRow label={kind === 'email' ? t('Add an email') : t('Add a phone number')} onClick={() => onChange([...rows, { value: '', label: null }])} />
    </div>
  );
}

function PairList({ title, addLabel, rows, onChange, labelPlaceholder, valuePlaceholder, errors, path }: { title: string; addLabel: string; rows: { label: string; value: string }[]; onChange: (v: { label: string; value: string }[]) => void; labelPlaceholder: string; valuePlaceholder: string; errors: Record<string, string>; path: string }) {
  const t = useT();
  return (
    <div className="mt-4 space-y-2">
      <p className="text-sm font-semibold">{title}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2">
          <Input aria-label={t('Label')} placeholder={labelPlaceholder} className="sm:w-56" value={r.label} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          <div className="min-w-[10rem] flex-1">
            <Input aria-label={t('Value')} placeholder={valuePlaceholder} value={r.value} aria-invalid={!!errors[`${path}.${i}.value`]} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          </div>
          <RemoveRow inline label={t('Remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddRow label={addLabel} onClick={() => onChange([...rows, { label: '', value: '' }])} />
    </div>
  );
}

/** Short lists typed one item at a time: Enter or a comma adds, × removes. */
function TagInput({ id, label, values, onChange }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = React.useState('');
  const add = () => {
    const v = draft.trim().replace(/,$/, '');
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex min-h-control flex-wrap items-center gap-1.5 rounded-md border border-input bg-surface p-1.5 focus-within:ring-2 focus-within:ring-ring">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pe-1 ps-2.5 text-xs font-medium text-primary">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={t('Remove {name}', { name: v })} className="rounded-full p-0.5 hover:bg-primary/20">
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(',') ? (setDraft(e.target.value), queueMicrotask(add)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={add}
          placeholder={values.length ? '' : t('Type and press Enter')}
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function BrandColours({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('Brand colours')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {values.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border p-1 pe-2">
            <input type="color" aria-label={t('Brand colour {n}', { n: i + 1 })} value={c} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
            <span className="font-mono text-xs">{c}</span>
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={t('Remove {name}', { name: c })} className="rounded-full p-0.5 text-muted-foreground hover:text-critical">
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        {values.length < 6 && <AddRow label={t('Add a colour')} onClick={() => onChange([...values, '#E8590C'])} />}
      </div>
      <p className="text-xs text-muted-foreground">{t('The first colour tints this page and the page clients see.')}</p>
    </div>
  );
}

/** The camera button on the logo: upload a new one or remove it. */
export function LogoMenu({ hasLogo }: { hasLogo: boolean }) {
  const t = useT();
  const { uploadLogo, removeLogo } = useOrgMutations();
  const input = React.useRef<HTMLInputElement>(null);
  const busy = uploadLogo.isPending || removeLogo.isPending;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadLogo.mutate(file);
          e.target.value = '';
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('Change the logo')}
            className="absolute -bottom-2 -start-2 inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Upload className="size-4" aria-hidden /> {t('Upload a logo')}
          </DropdownMenuItem>
          {hasLogo && (
            <DropdownMenuItem onSelect={() => removeLogo.mutate()}>
              <Trash2 className="size-4" aria-hidden /> {t('Remove the logo')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {uploadLogo.isError && (
        <p role="alert" className="absolute start-0 top-full mt-3 w-56 text-xs text-critical">
          {uploadLogo.error instanceof ApiError ? uploadLogo.error.message : t('Could not save. Try again.')}
        </p>
      )}
    </>
  );
}
