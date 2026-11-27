'use client';

import { type CrmStatusKind, geoCountry } from '@dealflow/types';
import { Button, Field, Input } from '@dealflow/ui';
import { Plus, Star, Trash2 } from 'lucide-react';
import * as React from 'react';
import { Combobox, type ComboOption } from '@/components/forms/combobox';
import { CountrySelect, PhoneInput, TimeZoneSelect } from '@/components/forms/inputs';
import { countryName, currencyOptions } from '@/components/forms/locale-data';
import { useCities, useCrmStatuses, useRegions } from '@/lib/company-crm';
import { type LeadPerson, personLabel, useLeadPeople } from '@/lib/company-leads';
import { useT } from '@/lib/i18n';
import { CountryFlag } from './status-chip';
import { Select, Textarea } from './select';

/*
 * Building blocks of the lead form and the employee and branch dialogs: lists of emails or phones with one primary,
 * location pickers backed by the country dataset, and pickers for people and statuses.
 */

export type Errors = Record<string, string>;

export interface PointValue {
  value: string;
  primary: boolean;
}

/** Several emails, phones or links, with exactly one marked primary. */
export function PointsEditor({
  id,
  label,
  kind,
  values,
  onChange,
  errors,
  addLabel,
}: {
  id: string;
  label: string;
  kind: 'email' | 'phone' | 'url';
  values: PointValue[];
  onChange: (v: PointValue[]) => void;
  /** Errors by position ("0", "1"…). */
  errors?: Errors;
  addLabel: string;
}) {
  const t = useT();
  const list = values.length ? values : [{ value: '', primary: true }];
  const set = (i: number, patch: Partial<PointValue>) => onChange(list.map((p, j) => (j === i ? { ...p, ...patch } : patch.primary ? { ...p, primary: false } : p)));
  const remove = (i: number) => {
    const next = list.filter((_, j) => j !== i);
    if (next.length && !next.some((p) => p.primary)) next[0] = { ...next[0]!, primary: true };
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {list.map((p, i) => {
        const fid = `${id}-${i}`;
        const err = errors?.[String(i)];
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {kind === 'phone' ? (
                  <PhoneInput id={fid} aria-label={`${label} ${i + 1}`} aria-invalid={!!err} aria-describedby={err ? `${fid}-error` : undefined} value={p.value} onChange={(v) => set(i, { value: v })} />
                ) : (
                  <Input
                    id={fid}
                    aria-label={`${label} ${i + 1}`}
                    aria-invalid={!!err}
                    aria-describedby={err ? `${fid}-error` : undefined}
                    type={kind === 'email' ? 'email' : 'url'}
                    inputMode={kind === 'email' ? 'email' : 'url'}
                    value={p.value}
                    onChange={(e) => set(i, { value: e.target.value })}
                  />
                )}
              </div>
              <Button
                type="button"
                variant={p.primary ? 'outline' : 'ghost'}
                size="sm"
                aria-pressed={p.primary}
                onClick={() => set(i, { primary: true })}
                aria-label={t('Make {value} primary', { value: p.value || `${label} ${i + 1}` })}
              >
                <Star aria-hidden className={p.primary ? 'fill-current' : undefined} />
                <span className="hidden sm:inline">{p.primary ? t('Primary') : t('Secondary')}</span>
              </Button>
              {list.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)} aria-label={t('Remove {value}', { value: p.value || `${label} ${i + 1}` })}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
            {err && (
              <p id={`${fid}-error`} role="alert" className="text-xs text-critical">
                {err}
              </p>
            )}
          </div>
        );
      })}
      {list.length < 20 && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, { value: '', primary: false }])}>
          <Plus aria-hidden /> {addLabel}
        </Button>
      )}
    </fieldset>
  );
}

/** Filled-in entries only, ready for the API. */
export const filledPoints = (list: PointValue[]) => list.filter((p) => p.value.trim()).map((p) => ({ value: p.value.trim(), primary: p.primary }));

export interface LocationValue {
  country: string;
  state: string;
  city: string;
  address: string;
  postalCode: string;
  timezone?: string;
}

/**
 * Country with its flag, dialling code, currency and time zones; state and city suggested from the dataset but
 * always free to type, for places the list does not have.
 */
export function LocationFields({
  idPrefix,
  value,
  onChange,
  errors = {},
  withTimezone,
  withAddress = true,
}: {
  idPrefix: string;
  value: LocationValue;
  onChange: (patch: Partial<LocationValue>) => void;
  errors?: Errors;
  withTimezone?: boolean;
  withAddress?: boolean;
}) {
  const t = useT();
  const country = geoCountry(value.country);
  const regions = useRegions(country?.code);
  const region = regions.data?.find((r) => r.name.toLowerCase() === value.state.trim().toLowerCase() || r.code === value.state.trim().toUpperCase());
  const [cityQuery, setCityQuery] = React.useState('');
  React.useEffect(() => {
    const h = setTimeout(() => setCityQuery(value.city.trim()), 250);
    return () => clearTimeout(h);
  }, [value.city]);
  const cities = useCities(country?.code, region?.code, cityQuery);
  const currency = country ? currencyOptions().find((c) => c.value === country.currency) : undefined;
  const id = (f: string) => `${idPrefix}-${f}`;
  const pickCountry = (code: string) => {
    const c = geoCountry(code);
    // A country with one time zone fills it in; otherwise the person picks one of the country's zones.
    onChange({ country: code, state: '', city: '', ...(withTimezone ? { timezone: c && c.timezones.length === 1 ? c.timezones[0] : '' } : {}) });
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={id('country')} label={t('Country')} error={errors.country}>
          <CountrySelect value={value.country} onChange={pickCountry} />
        </Field>
        {country && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" aria-live="polite">
            <CountryFlag code={country.code} withName />
            <span>{t('Dialling code {code}', { code: country.dialCode.startsWith('+') ? country.dialCode : `+${country.dialCode}` })}</span>
            <span>{currency?.label ?? country.currency}</span>
          </p>
        )}
      </div>
      <Field id={id('state')} label={t('State / province')} error={errors.state}>
        <Input list={`${id('state')}-list`} autoComplete="off" value={value.state} onChange={(e) => onChange({ state: e.target.value })} />
      </Field>
      <datalist id={`${id('state')}-list`}>
        {regions.data?.map((r) => (
          <option key={r.code} value={r.name} />
        ))}
      </datalist>
      <Field id={id('city')} label={t('City')} error={errors.city}>
        <Input list={`${id('city')}-list`} autoComplete="off" value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
      </Field>
      <datalist id={`${id('city')}-list`}>
        {cities.data?.map((c) => (
          <option key={`${c.name}-${c.region}`} value={c.name} />
        ))}
      </datalist>
      {withAddress && (
        <>
          <div className="sm:col-span-2">
            <Field id={id('address')} label={t('Full address')} error={errors.address}>
              <Textarea rows={2} value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
            </Field>
          </div>
          <Field id={id('postalCode')} label={t('ZIP / postal code')} error={errors.postalCode}>
            <Input autoComplete="off" value={value.postalCode} onChange={(e) => onChange({ postalCode: e.target.value })} />
          </Field>
        </>
      )}
      {withTimezone && (
        <Field id={id('timezone')} label={t('Time zone')} error={errors.timezone} hint={country && country.timezones.length > 1 ? t('{country} has {count} time zones.', { country: countryName(country.code), count: country.timezones.length }) : undefined}>
          {country && country.timezones.length > 0 ? (
            <Select value={value.timezone ?? ''} onChange={(e) => onChange({ timezone: e.target.value })}>
              <option value="">{t('Choose a time zone')}</option>
              {country.timezones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          ) : (
            <TimeZoneSelect value={value.timezone ?? ''} onChange={(z) => onChange({ timezone: z })} />
          )}
        </Field>
      )}
      <p className="text-xs text-muted-foreground sm:col-span-2">{t('Places from GeoNames (CC BY 4.0) and OpenStreetMap contributors (ODbL). Type any place that is not listed.')}</p>
    </div>
  );
}

/** Searchable list of workspace people, shown as "Name – Designation". */
export function PersonSelect({
  id,
  value,
  onChange,
  assignableOnly,
  placeholder,
  ...aria
}: {
  id?: string;
  value: string;
  onChange: (userId: string) => void;
  /** Only people the signed-in user may give a lead to. */
  assignableOnly?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}) {
  const t = useT();
  const people = useLeadPeople();
  const options = React.useMemo<ComboOption[]>(
    () => (people.data ?? []).filter((p) => !assignableOnly || p.assignable || p.id === value).map((p) => ({ value: p.id, label: personLabel(p), keywords: p.designation ?? '' })),
    [people.data, assignableOnly, value],
  );
  return <Combobox id={id} {...aria} options={options} value={value} onChange={onChange} placeholder={placeholder ?? t('Search people')} />;
}

export function usePerson(id: string | null | undefined): LeadPerson | undefined {
  const people = useLeadPeople();
  return id ? people.data?.find((p) => p.id === id) : undefined;
}

/** Active statuses of a kind, in order. */
export function StatusSelect({ kind, value, onChange, id, ...aria }: { kind: CrmStatusKind; value: string; onChange: (id: string) => void; id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) {
  const t = useT();
  const statuses = useCrmStatuses(kind);
  const active = (statuses.data ?? []).filter((s) => !s.archived);
  return (
    <Select id={id} {...aria} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('Default ({name})', { name: t.maybe(active.find((s) => s.isDefault)?.name ?? '') })}</option>
      {active.map((s) => (
        <option key={s.id} value={s.id}>
          {t.maybe(s.name)}
        </option>
      ))}
    </Select>
  );
}

// ─── Branches ───

export interface BranchValue extends LocationValue {
  key: string;
  name: string;
  email: string;
  phone: string;
  contactPerson: string;
  website: string;
}

export const emptyBranch = (): BranchValue => ({ key: crypto.randomUUID(), name: '', country: '', state: '', city: '', address: '', postalCode: '', email: '', phone: '', contactPerson: '', website: '' });

export function branchPayload(b: BranchValue) {
  return { name: b.name, country: b.country, state: b.state, city: b.city, address: b.address, postalCode: b.postalCode, email: b.email, phone: b.phone, contactPerson: b.contactPerson, website: b.website };
}

export function BranchFields({ idPrefix, value, onChange, errors = {} }: { idPrefix: string; value: BranchValue; onChange: (patch: Partial<BranchValue>) => void; errors?: Errors }) {
  const t = useT();
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <div className="space-y-4">
      <Field id={id('name')} label={t('Branch name *')} error={errors.name}>
        <Input value={value.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <LocationFields idPrefix={idPrefix} value={value} onChange={onChange} errors={errors} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('email')} label={t('Branch email')} error={errors.email}>
          <Input type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} />
        </Field>
        <Field id={id('phone')} label={t('Branch phone')} error={errors.phone}>
          <PhoneInput value={value.phone} onChange={(v) => onChange({ phone: v })} />
        </Field>
        <Field id={id('contactPerson')} label={t('Branch contact person')} error={errors.contactPerson}>
          <Input value={value.contactPerson} onChange={(e) => onChange({ contactPerson: e.target.value })} />
        </Field>
        <Field id={id('website')} label={t('Branch website')} error={errors.website}>
          <Input type="url" inputMode="url" value={value.website} onChange={(e) => onChange({ website: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

// ─── Employees ───

export interface EmployeeValue {
  key: string;
  firstName: string;
  lastName: string;
  linkedinUrl: string;
  jobTitle: string;
  department: string;
  emails: PointValue[];
  phones: PointValue[];
  country: string;
  state: string;
  city: string;
  remarks: string;
  statusId: string;
  /** YYYY-MM-DD */
  nextFollowUpAt: string;
  ownerId: string;
}

export const emptyEmployee = (): EmployeeValue => ({
  key: crypto.randomUUID(), firstName: '', lastName: '', linkedinUrl: '', jobTitle: '', department: '', emails: [{ value: '', primary: true }], phones: [{ value: '', primary: true }],
  country: '', state: '', city: '', remarks: '', statusId: '', nextFollowUpAt: '', ownerId: '',
});

/** Splits "Priya Nair" into first and last name; the form keeps them as one "Employee name" field. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export function employeePayload(e: EmployeeValue) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    linkedinUrl: e.linkedinUrl,
    jobTitle: e.jobTitle,
    department: e.department,
    emails: filledPoints(e.emails),
    phones: filledPoints(e.phones),
    country: e.country,
    state: e.state,
    city: e.city,
    remarks: e.remarks,
    statusId: e.statusId || null,
    // A follow-up date is kept as 9 AM in the user's own time zone.
    nextFollowUpAt: e.nextFollowUpAt ? new Date(`${e.nextFollowUpAt}T09:00:00`).toISOString() : null,
    ownerId: e.ownerId || null,
  };
}

/** Errors for list entries ("emails.1.value") by position, for PointsEditor. */
export const pointErrors = (errors: Errors, list: string): Errors =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`${list}.`)).map(([k, v]) => [k.split('.')[1]!, v]));

export function EmployeeFields({ idPrefix, value, onChange, errors = {} }: { idPrefix: string; value: EmployeeValue; onChange: (patch: Partial<EmployeeValue>) => void; errors?: Errors }) {
  const t = useT();
  const id = (f: string) => `${idPrefix}-${f}`;
  const name = [value.firstName, value.lastName].filter(Boolean).join(' ');
  const [nameText, setNameText] = React.useState(name);
  React.useEffect(() => {
    if ([splitName(nameText).firstName, splitName(nameText).lastName].filter(Boolean).join(' ') !== name) setNameText(name);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={id('firstName')} label={t('Employee name *')} error={errors.firstName ?? errors.lastName}>
        <Input
          autoComplete="off"
          value={nameText}
          onChange={(e) => {
            setNameText(e.target.value);
            onChange(splitName(e.target.value));
          }}
        />
      </Field>
      <Field id={id('jobTitle')} label={t('Designation')} error={errors.jobTitle}>
        <Input value={value.jobTitle} onChange={(e) => onChange({ jobTitle: e.target.value })} />
      </Field>
      <Field id={id('department')} label={t('Department')} error={errors.department}>
        <Input value={value.department} onChange={(e) => onChange({ department: e.target.value })} />
      </Field>
      <Field id={id('linkedinUrl')} label={t('LinkedIn URL')} error={errors.linkedinUrl}>
        <Input type="url" inputMode="url" value={value.linkedinUrl} onChange={(e) => onChange({ linkedinUrl: e.target.value })} />
      </Field>
      <div className="sm:col-span-2">
        <PointsEditor id={id('emails')} label={t('Email IDs')} kind="email" values={value.emails} onChange={(emails) => onChange({ emails })} errors={pointErrors(errors, 'emails')} addLabel={t('Add email')} />
      </div>
      <div className="sm:col-span-2">
        <PointsEditor id={id('phones')} label={t('Phone numbers')} kind="phone" values={value.phones} onChange={(phones) => onChange({ phones })} errors={pointErrors(errors, 'phones')} addLabel={t('Add phone')} />
      </div>
      <div className="sm:col-span-2">
        <LocationFields idPrefix={idPrefix} value={{ ...value, address: '', postalCode: '' }} onChange={onChange} errors={errors} withAddress={false} />
      </div>
      <Field id={id('statusId')} label={t('Employee status')} error={errors.statusId}>
        <StatusSelect kind="EMPLOYEE" value={value.statusId} onChange={(statusId) => onChange({ statusId })} />
      </Field>
      <Field id={id('nextFollowUpAt')} label={t('Next follow-up date')} error={errors.nextFollowUpAt}>
        <Input type="date" value={value.nextFollowUpAt} onChange={(e) => onChange({ nextFollowUpAt: e.target.value })} />
      </Field>
      <Field id={id('ownerId')} label={t('Assigned sales executive')} error={errors.ownerId} hint={t('Leave empty to use the company owner.')}>
        <PersonSelect value={value.ownerId} onChange={(ownerId) => onChange({ ownerId })} />
      </Field>
      <div className="sm:col-span-2">
        <Field id={id('remarks')} label={t('Employee remarks')} error={errors.remarks}>
          <Textarea rows={3} value={value.remarks} onChange={(e) => onChange({ remarks: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}
