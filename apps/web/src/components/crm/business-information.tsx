'use client';

import {
  type CompanyRow,
  ENRICH_FIELD_LABELS,
  type EnrichField,
  FIELD_SOURCE_LABELS,
  type FieldSource,
  OPERATING_STATUSES,
  SOCIAL_PLATFORM_LABELS,
  socialPlatformOf,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { CountrySelect, TimeZoneSelect } from '@/components/forms/inputs';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { Select, Textarea } from './select';
import { CountryFlag } from './status-chip';

type T = ReturnType<typeof useT>;
type Row = { field: EnrichField | 'notes'; label: string; value: React.ReactNode };

const link = (href: string, text?: string) => (
  <a className="inline-flex min-h-6 items-center gap-1 break-all text-primary hover:underline" href={href} target="_blank" rel="noopener noreferrer">
    {text ?? href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
  </a>
);

const plainList = (items: string[]) =>
  items.length ? (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <li key={x} className="rounded-md border border-border bg-muted/40 px-2 py-0.5">
          {x}
        </li>
      ))}
    </ul>
  ) : null;

/**
 * Business Information (ADR 0076): every detail about the company in one place, grouped, each value telling whether
 * auto-fill found it (with its source) or someone on the team entered it. One Edit opens every field.
 */
export function BusinessInformation({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const canWrite = useCan('companies:write');
  const [editing, setEditing] = React.useState(false);
  const label = (f: EnrichField) => t.maybe(ENRICH_FIELD_LABELS[f]);
  const points = (list: { value: string; primary?: boolean }[], kind: 'mailto' | 'tel') =>
    list.length ? (
      <ul className="space-y-0.5">
        {list.map((p) => (
          <li key={p.value}>
            <a className="inline-flex min-h-6 items-center break-all text-primary hover:underline" href={`${kind}:${p.value}`}>
              {p.value}
            </a>
            {p.primary && list.length > 1 && <span className="ms-1 text-xs text-muted-foreground">({t('primary')})</span>}
          </li>
        ))}
      </ul>
    ) : null;
  const hq = [c.address, c.city, c.state, c.postalCode].filter(Boolean).join(', ');
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t('Overview'),
      rows: [
        { field: 'overview', label: label('overview'), value: c.overview && <p className="whitespace-pre-line">{c.overview}</p> },
        { field: 'legalName', label: label('legalName'), value: c.legalName },
        { field: 'industry', label: label('industry'), value: c.industry },
        { field: 'businessCategory', label: label('businessCategory'), value: c.businessCategory },
        { field: 'companyType', label: label('companyType'), value: c.companyType && t.maybe(c.companyType) },
        { field: 'foundedYear', label: label('foundedYear'), value: c.foundedYear },
        { field: 'employeeCount', label: label('employeeCount'), value: c.employeeCount?.toLocaleString(t.formatLocale) },
        { field: 'companySize', label: label('companySize'), value: c.companySize && t('{range} employees', { range: c.companySize }) },
        { field: 'operatingStatus', label: label('operatingStatus'), value: c.operatingStatus && t.maybe(c.operatingStatus) },
        { field: 'specialties', label: label('specialties'), value: c.specialties },
        { field: 'services', label: label('services'), value: plainList(c.services) },
        { field: 'products', label: label('products'), value: plainList(c.products) },
        { field: 'industriesServed', label: label('industriesServed'), value: plainList(c.industriesServed) },
      ],
    },
    {
      title: t('HQ & Locations'),
      rows: [
        { field: 'address', label: t('Headquarters address'), value: hq || null },
        { field: 'country', label: label('country'), value: c.country && <CountryFlag code={c.country} withName /> },
        { field: 'headquarters', label: label('headquarters'), value: c.headquarters },
        { field: 'timezone', label: label('timezone'), value: c.timezone },
        { field: 'branchCount', label: label('branchCount'), value: c.branchCount },
        {
          field: 'addresses',
          label: label('addresses'),
          value: c.addresses.length ? (
            <ul className="space-y-1">
              {c.addresses.map((a, i) => (
                <li key={i}>
                  {a.label && <span className="font-medium">{a.label}: </span>}
                  {[a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', ')}
                  {a.country && (
                    <>
                      {' '}
                      <CountryFlag code={a.country} withName />
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null,
        },
      ],
    },
    {
      title: t('Contact'),
      rows: [
        { field: 'website', label: label('website'), value: c.website && link(c.website) },
        { field: 'emails', label: label('emails'), value: points(c.emails.length ? c.emails : c.primaryEmail ? [{ value: c.primaryEmail, primary: true }] : [], 'mailto') },
        { field: 'phones', label: label('phones'), value: points(c.phones.length ? c.phones : c.primaryPhone ? [{ value: c.primaryPhone, primary: true }] : [], 'tel') },
        { field: 'contactPageUrl', label: label('contactPageUrl'), value: c.contactPageUrl && link(c.contactPageUrl) },
      ],
    },
    {
      title: t('Leadership & Ownership'),
      rows: [
        { field: 'ceo', label: label('ceo'), value: c.ceo },
        { field: 'founders', label: label('founders'), value: plainList(c.founders) },
        {
          field: 'leadership',
          label: label('leadership'),
          value: c.leadership.length ? (
            <ul className="space-y-0.5">
              {c.leadership.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.name}</span>
                  {l.title && <span className="text-muted-foreground">, {l.title}</span>}
                </li>
              ))}
            </ul>
          ) : null,
        },
        { field: 'parentCompanyName', label: label('parentCompanyName'), value: c.parentCompanyName },
        { field: 'ownership', label: label('ownership'), value: c.ownership },
      ],
    },
    {
      title: t('Digital presence'),
      rows: [
        { field: 'linkedinUrl', label: label('linkedinUrl'), value: c.linkedinUrl && link(c.linkedinUrl) },
        {
          field: 'socialLinks',
          label: label('socialLinks'),
          value: c.socialLinks.filter((s) => s.platform !== 'linkedin' || s.url !== c.linkedinUrl).length ? (
            <ul className="space-y-0.5">
              {c.socialLinks
                .filter((s) => s.platform !== 'linkedin' || s.url !== c.linkedinUrl)
                .map((s) => (
                  <li key={s.url}>
                    <span className="text-muted-foreground">{SOCIAL_PLATFORM_LABELS[s.platform]}: </span>
                    {link(s.url)}
                  </li>
                ))}
            </ul>
          ) : null,
        },
      ],
    },
    { title: t('Certifications'), rows: [{ field: 'certifications', label: label('certifications'), value: plainList(c.certifications) }] },
    {
      title: t('More details'),
      rows: [
        ...c.moreDetails.map((d, i): Row => ({ field: 'moreDetails', label: d.label, value: <span key={i} className="whitespace-pre-line">{d.value}</span> })),
        { field: 'notes', label: t('Remarks'), value: c.notes && <span className="whitespace-pre-line">{c.notes}</span> },
      ],
    },
  ];
  const shown = sections.map((s) => ({ ...s, rows: s.rows.filter((r) => r.value !== null && r.value !== undefined && r.value !== '') })).filter((s) => s.rows.length);
  const editable = canWrite && !c.restricted;
  return (
    <Card id="business-information">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 aria-hidden className="size-4" /> {t('Business information')} <InfoTip topic="crm.businessInformation" />
        </CardTitle>
        {editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> {t('Edit')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {shown.length === 0 && <p className="text-sm text-muted-foreground">{t('No business details yet. Add the website and auto-fill finds the rest, or select Edit.')}</p>}
        {shown.map((s) => (
          <section key={s.title} aria-label={s.title} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</h3>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {s.rows.map((r, i) => {
                const wide = ['overview', 'services', 'products', 'industriesServed', 'addresses', 'leadership', 'certifications', 'socialLinks', 'notes'].includes(r.field);
                return (
                  <div key={`${r.field}-${i}`} className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                    <dt className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {r.label}
                      {r.field !== 'notes' && <SourceTag source={c.fieldSources[r.field]} t={t} />}
                    </dt>
                    <dd className="mt-0.5 break-words text-sm">{r.value}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
        {shown.length > 0 && <p className="text-xs text-muted-foreground">{t('Values marked Auto were found by auto-fill; select one to see where. Everything else was entered by your team.')}</p>}
      </CardContent>
      {editable && <BusinessInfoDialog company={c} open={editing} onOpenChange={setEditing} />}
    </Card>
  );
}

/** "Auto" with where and when it was found; nothing for values someone entered. */
function SourceTag({ source, t }: { source: FieldSource | undefined; t: T }) {
  if (!source || source.source === 'USER') return null;
  const from = t.maybe(FIELD_SOURCE_LABELS[source.source]);
  const title = t('Found by auto-fill: {source}, {date}', { source: from, date: formatDate(source.at) });
  const chip = (
    <Badge tone={source.confidence === 'uncertain' ? 'warning' : 'primary'} className="px-1.5 py-0 text-[10px]">
      {source.confidence === 'uncertain' ? t('Auto, uncertain') : t('Auto')}
    </Badge>
  );
  return source.url ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className="inline-flex min-h-6 items-center gap-0.5 hover:underline">
      {chip}
      <ExternalLink aria-hidden className="size-3" />
    </a>
  ) : (
    <span title={title} aria-label={title}>
      {chip}
    </span>
  );
}

// ─── The edit dialog ───

type Pair = { a: string; b: string };
type Office = { label: string; address: string; city: string; country: string; state: string; postalCode: string };

interface Form {
  overview: string; legalName: string; industry: string; businessCategory: string; companyType: string; foundedYear: string; employeeCount: string;
  companySize: string; operatingStatus: string; specialties: string; services: string; products: string; industriesServed: string;
  address: string; city: string; state: string; postalCode: string; country: string; headquarters: string; timezone: string; branchCount: string; addresses: Office[];
  website: string; emails: string; phones: string; contactPageUrl: string;
  ceo: string; founders: string; leadership: Pair[]; parentCompanyName: string; ownership: string;
  linkedinUrl: string; socialLinks: string; certifications: string; moreDetails: Pair[]; notes: string;
}

const lines = (s: string) => [...new Set(s.split('\n').map((x) => x.trim()).filter(Boolean))];
const primaryFirst = (list: { value: string; primary?: boolean }[], one: string | null) =>
  (list.length ? [...list].sort((x, y) => Number(!!y.primary) - Number(!!x.primary)).map((p) => p.value) : one ? [one] : []).join('\n');

function formFrom(c: CompanyRow): Form {
  return {
    overview: c.overview ?? '', legalName: c.legalName ?? '', industry: c.industry ?? '', businessCategory: c.businessCategory ?? '', companyType: c.companyType ?? '',
    foundedYear: c.foundedYear?.toString() ?? '', employeeCount: c.employeeCount?.toString() ?? '', companySize: c.companySize ?? '', operatingStatus: c.operatingStatus ?? '',
    specialties: c.specialties ?? '', services: c.services.join('\n'), products: c.products.join('\n'), industriesServed: c.industriesServed.join('\n'),
    address: c.address ?? '', city: c.city ?? '', state: c.state ?? '', postalCode: c.postalCode ?? '', country: c.country ?? '', headquarters: c.headquarters ?? '',
    timezone: c.timezone ?? '', branchCount: c.branchCount?.toString() ?? '',
    addresses: c.addresses.map((a) => ({ label: a.label ?? '', address: a.address ?? '', city: a.city ?? '', country: a.country ?? '', state: a.state ?? '', postalCode: a.postalCode ?? '' })),
    website: c.website ?? '', emails: primaryFirst(c.emails, c.primaryEmail), phones: primaryFirst(c.phones, c.primaryPhone), contactPageUrl: c.contactPageUrl ?? '',
    ceo: c.ceo ?? '', founders: c.founders.join('\n'), leadership: c.leadership.map((l) => ({ a: l.name, b: l.title ?? '' })), parentCompanyName: c.parentCompanyName ?? '',
    ownership: c.ownership ?? '', linkedinUrl: c.linkedinUrl ?? '', socialLinks: c.socialLinks.filter((s) => s.platform !== 'linkedin').map((s) => s.url).join('\n'),
    certifications: c.certifications.join('\n'), moreDetails: c.moreDetails.map((d) => ({ a: d.label, b: d.value })), notes: c.notes ?? '',
  };
}

/** The API payload: only what changed, so untouched auto values keep their source. */
export function businessInfoPayload(before: Form, now: Form, t: T): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const text = (v: string) => v.trim() || null;
  const num = (v: string) => (v.trim() ? Number(v) : null);
  const changed = (k: keyof Form) => JSON.stringify(before[k]) !== JSON.stringify(now[k]);
  for (const k of ['overview', 'legalName', 'industry', 'businessCategory', 'companyType', 'companySize', 'specialties', 'address', 'city', 'state', 'postalCode', 'headquarters', 'timezone', 'website', 'contactPageUrl', 'ceo', 'parentCompanyName', 'ownership', 'linkedinUrl', 'notes'] as const) {
    if (changed(k)) out[k] = text(now[k]);
  }
  if (changed('country')) out.country = now.country || null;
  if (changed('operatingStatus')) out.operatingStatus = now.operatingStatus || null;
  for (const k of ['foundedYear', 'employeeCount', 'branchCount'] as const) {
    if (!changed(k)) continue;
    const n = num(now[k]);
    if (n !== null && (!Number.isInteger(n) || n < 0)) errors[k] = t('Enter a whole number');
    else out[k] = n;
  }
  for (const k of ['services', 'products', 'industriesServed', 'founders', 'certifications'] as const) if (changed(k)) out[k] = lines(now[k]);
  if (changed('emails')) out.emails = lines(now.emails).map((value, i) => ({ value, primary: i === 0 }));
  if (changed('phones')) out.phones = lines(now.phones).map((value, i) => ({ value, primary: i === 0 }));
  if (changed('addresses')) {
    out.addresses = now.addresses
      .filter((a) => a.address.trim() || a.city.trim())
      .map((a) => ({ label: a.label.trim() || null, address: a.address.trim() || null, city: a.city.trim() || null, state: a.state.trim() || null, postalCode: a.postalCode.trim() || null, country: a.country || null }));
  }
  if (changed('leadership')) out.leadership = now.leadership.filter((l) => l.a.trim()).map((l) => ({ name: l.a.trim(), title: l.b.trim() || null }));
  if (changed('moreDetails')) {
    const rows = now.moreDetails.filter((d) => d.a.trim() || d.b.trim());
    if (rows.some((d) => !d.a.trim() || !d.b.trim())) errors.moreDetails = t('Give each detail a name and a value');
    out.moreDetails = rows.map((d) => ({ label: d.a.trim(), value: d.b.trim() }));
  }
  if (changed('socialLinks') || changed('linkedinUrl')) {
    const urls = lines(now.socialLinks).map((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`));
    const unknown = urls.filter((u) => !socialPlatformOf(u));
    if (unknown.length) errors.socialLinks = t('Not a social profile link: {url}', { url: unknown[0]! });
    const linkedin = text(now.linkedinUrl);
    out.socialLinks = [
      ...(linkedin && socialPlatformOf(linkedin) === 'linkedin' ? [{ platform: 'linkedin', url: linkedin }] : []),
      ...urls.filter((u) => socialPlatformOf(u)).map((url) => ({ platform: socialPlatformOf(url), url })),
    ];
  }
  return { payload: out, errors };
}

function BusinessInfoDialog({ company: c, open, onOpenChange }: { company: CompanyRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const before = React.useMemo(() => formFrom(c), [c]);
  const [form, setForm] = React.useState<Form>(before);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setForm(before);
      setErrors({});
      setFormError(null);
    }
  }, [open, before]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const label = (f: EnrichField) => t.maybe(ENRICH_FIELD_LABELS[f]);
  const input = (k: keyof Form & EnrichField, type = 'text', extra: { hint?: string; label?: string } = {}) => (
    <Field id={`bi-${k}`} label={extra.label ?? label(k)} error={errors[k]} hint={extra.hint}>
      <Input type={type} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  const area = (k: keyof Form, fieldLabel: string, hint?: string, rows = 3) => (
    <Field id={`bi-${k}`} label={fieldLabel} error={errors[k]} hint={hint}>
      <Textarea rows={rows} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  const onePerLine = t('One per line.');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { payload, errors: errs } = businessInfoPayload(before, form, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!Object.keys(payload).length) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api(`/companies/${c.id}`, { method: 'PATCH', json: payload });
      await Promise.all([qc.invalidateQueries({ queryKey: ['companies', 'detail', c.id] }), qc.invalidateQueries({ queryKey: ['company-enrichment', c.id] })]);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setErrors(Object.fromEntries(err.details.map((d) => [d.path.split('.')[0]!, d.message])));
      }
      setFormError(err instanceof ApiError ? err.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  const group = (title: string, children: React.ReactNode) => (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
  const wide = (node: React.ReactNode) => <div className="sm:col-span-2">{node}</div>;
  const pairs = (k: 'leadership' | 'moreDetails', aLabel: string, bLabel: string, addLabel: string) => (
    <div className="space-y-2 sm:col-span-2" role="group" aria-label={k === 'leadership' ? label('leadership') : label('moreDetails')}>
      <p className="text-sm font-medium">{k === 'leadership' ? label('leadership') : label('moreDetails')}</p>
      {form[k].map((p, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input aria-label={`${aLabel} ${i + 1}`} placeholder={aLabel} value={p.a} onChange={(e) => set(k, form[k].map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} />
          <Input aria-label={`${bLabel} ${i + 1}`} placeholder={bLabel} value={p.b} onChange={(e) => set(k, form[k].map((x, j) => (j === i ? { ...x, b: e.target.value } : x)))} />
          <Button type="button" size="sm" variant="ghost" aria-label={t('Remove row {n}', { n: i + 1 })} onClick={() => set(k, form[k].filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      {errors[k] && (
        <p role="alert" className="text-xs text-critical">
          {errors[k]}
        </p>
      )}
      <Button type="button" size="sm" variant="outline" onClick={() => set(k, [...form[k], { a: '', b: '' }])}>
        <Plus aria-hidden /> {addLabel}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-3xl overflow-y-auto p-6">
        <DialogTitle>{t('Edit business information')}</DialogTitle>
        <DialogDescription>{t('Change or clear anything. Auto-fill never changes a value you edit here, and does not add back what you remove.')}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={save} noValidate>
          {group(
            t('Overview'),
            <>
              {wide(area('overview', label('overview'), undefined, 4))}
              {input('legalName')}
              {input('industry')}
              {input('businessCategory')}
              {input('companyType')}
              {input('foundedYear', 'number')}
              {input('employeeCount', 'number')}
              {input('companySize', 'text', { hint: t('For example 51-200') })}
              <Field id="bi-operatingStatus" label={label('operatingStatus')}>
                <Select value={form.operatingStatus} onChange={(e) => set('operatingStatus', e.target.value)}>
                  <option value="">{t('Not set')}</option>
                  {OPERATING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t.maybe(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              {wide(area('specialties', label('specialties'), undefined, 2))}
              {area('services', label('services'), onePerLine)}
              {area('products', label('products'), onePerLine)}
              {wide(area('industriesServed', label('industriesServed'), onePerLine, 2))}
            </>,
          )}
          {group(
            t('HQ & Locations'),
            <>
              {wide(input('address', 'text', { label: t('Headquarters address') }))}
              {input('city')}
              {input('state')}
              {input('postalCode')}
              <Field id="bi-country" label={label('country')}>
                <CountrySelect value={form.country} onChange={(v) => set('country', v)} />
              </Field>
              {input('headquarters', 'text', { hint: t('How it reads under the name, for example Pune, India') })}
              <Field id="bi-timezone" label={label('timezone')}>
                <TimeZoneSelect value={form.timezone} onChange={(v) => set('timezone', v)} />
              </Field>
              {input('branchCount', 'number')}
              <div className="space-y-2 sm:col-span-2" role="group" aria-label={label('addresses')}>
                <p className="text-sm font-medium">{label('addresses')}</p>
                {form.addresses.map((a, i) => (
                  <div key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_2fr_1fr_1fr_auto]">
                    <Input aria-label={t('Office name {n}', { n: i + 1 })} placeholder={t('Office name')} value={a.label} onChange={(e) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Input aria-label={t('Street address {n}', { n: i + 1 })} placeholder={t('Street address')} value={a.address} onChange={(e) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
                    <Input aria-label={t('City {n}', { n: i + 1 })} placeholder={label('city')} value={a.city} onChange={(e) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))} />
                    <div>
                      <label htmlFor={`bi-office-country-${i}`} className="sr-only">
                        {t('Country {n}', { n: i + 1 })}
                      </label>
                      <CountrySelect id={`bi-office-country-${i}`} value={a.country} onChange={(v) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, country: v } : x)))} />
                    </div>
                    <Button type="button" size="sm" variant="ghost" aria-label={t('Remove row {n}', { n: i + 1 })} onClick={() => set('addresses', form.addresses.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => set('addresses', [...form.addresses, { label: '', address: '', city: '', country: '', state: '', postalCode: '' }])}>
                  <Plus aria-hidden /> {t('Add office')}
                </Button>
              </div>
            </>,
          )}
          {group(
            t('Contact'),
            <>
              {wide(input('website', 'url'))}
              {area('emails', label('emails'), t('One per line. The first is the main one.'))}
              {area('phones', label('phones'), t('One per line. The first is the main one.'))}
              {wide(input('contactPageUrl', 'url'))}
            </>,
          )}
          {group(
            t('Leadership & Ownership'),
            <>
              {input('ceo')}
              {input('parentCompanyName')}
              {area('founders', label('founders'), onePerLine, 2)}
              {area('ownership', label('ownership'), undefined, 2)}
              {pairs('leadership', t('Name'), t('Role'), t('Add person'))}
            </>,
          )}
          {group(
            t('Digital presence'),
            <>
              {wide(input('linkedinUrl', 'url'))}
              {wide(area('socialLinks', label('socialLinks'), t('One link per line: X, Facebook, Instagram, YouTube and others.')))}
            </>,
          )}
          {group(
            t('Certifications and more'),
            <>
              {wide(area('certifications', label('certifications'), onePerLine, 2))}
              {pairs('moreDetails', t('Detail'), t('Value'), t('Add detail'))}
              {wide(area('notes', t('Remarks'), undefined, 3))}
            </>,
          )}
          {formError && (
            <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">
              {formError}
            </p>
          )}
          <div className="sticky bottom-0 flex justify-end gap-2 bg-surface pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('Saving…') : t('Save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
