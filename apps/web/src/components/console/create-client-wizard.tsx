'use client';

import { Badge, Button, Card, cn, Input } from '@dealflow/ui';
import {
  CLIENT_DETAIL_FIELDS,
  type ConsoleClientCreated,
  type ConsoleClientCreateWithDetailsInput,
  type ConsoleClientDetail,
  type ConsoleClientDetails,
  type ConsoleClientExtract,
  type ConsolePlanRow,
  ENRICH_FIELD_LABELS,
  type EnrichField,
  FIELD_SOURCE_LABELS,
  type FieldSourceKind,
  LIST_ENRICH_FIELDS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUSES,
  type PaymentStatus,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Globe,
  ImageOff,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LocationPicker, type LocationValue } from '@/components/console/location-picker';
import { BrandLoader } from '@/components/loading/sampforce-loader';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { price, selectClass, toCents, toLimit } from '@/app/operator/console-ui';

/**
 * Create Client (control-center K2): four steps that end in one POST /operator/clients.
 *
 * 1. Company: name, company email and website (the minimum), with the primary contact, place and industry.
 * 2. Review: "Find company details" runs the company auto-fill engine Create Company uses (the company's own website
 *    and Wikidata; no AI). Every field shows what was found and where, or "Not found"; the operator corrects, removes or
 *    adds values. Nothing is stored until step 4.
 * 3. Plan and administrator: the subscription terms and limits, and who receives the administrator invitation.
 * 4. Confirm: a summary, then Approve & create client. The website's logo, if kept, is uploaded to the new client.
 */

const STEPS = [
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'review', label: 'Review details', icon: Sparkles },
  { key: 'plan', label: 'Plan & administrator', icon: CreditCard },
  { key: 'confirm', label: 'Approve & create', icon: ShieldCheck },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

type Source = { source: FieldSourceKind; url: string | null };
type Row = { value: string; source: Source | null; removed: boolean; found: boolean };

const isList = (f: EnrichField) => LIST_ENRICH_FIELDS.includes(f);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEBSITE = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i;

/** A found value as text: list items one per line; a social link as its address; a person or office as its parts. */
function asText(value: unknown): string {
  const one = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.url === 'string') return o.url;
      return Object.values(o)
        .filter((x) => typeof x === 'string' || typeof x === 'number')
        .join(', ');
    }
    return '';
  };
  return Array.isArray(value) ? value.map(one).filter(Boolean).join('\n') : one(value);
}

function sourceTone(s: Source | null): 'success' | 'neutral' | 'warning' {
  if (!s) return 'warning';
  return s.source === 'USER' ? 'neutral' : 'success';
}

function SourceBadge({ row }: { row: Row }) {
  if (row.removed) return <Badge tone="neutral">Removed</Badge>;
  if (!row.value.trim()) return <Badge tone="warning">Not found</Badge>;
  const s = row.source;
  const label = !s ? 'Not found' : s.source === 'USER' ? (row.found ? 'Corrected by you' : 'Added by you') : FIELD_SOURCE_LABELS[s.source];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={sourceTone(s)}>{label}</Badge>
      {s?.url && s.source !== 'USER' && (
        <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-muted-foreground hover:text-foreground" aria-label={`Open the source of this value: ${s.url}`}>
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </span>
  );
}

function Stepper({ step, onGo, reached }: { step: StepKey; onGo: (k: StepKey) => void; reached: number }) {
  const at = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Steps" data-wizard-steps>
      {STEPS.map((s, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={s.key}>
            <button
              type="button"
              disabled={i > reached}
              onClick={() => onGo(s.key)}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start text-sm transition-colors',
                current ? 'border-primary bg-primary/10 shadow-sm' : done ? 'border-success/40 bg-success/5 hover:bg-success/10' : 'border-border bg-surface',
                i > reached && 'cursor-not-allowed opacity-60',
              )}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg',
                  current ? 'bg-primary text-primary-foreground' : done ? 'bg-success text-white' : 'bg-muted text-muted-foreground',
                )}
                aria-hidden
              >
                {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-xs', current ? 'text-foreground' : 'text-muted-foreground')}>Step {i + 1}</span>
                <span className="block truncate font-medium">{s.label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Decodes a base64 data URL in the page. fetch() cannot read data: URLs here, because the page's CSP allows only 'self'. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64 = ''] = dataUrl.split(',', 2);
  const type = /^data:([^;,]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function CreateClientWizard() {
  const qc = useQueryClient();
  const router = useRouter();
  const [step, setStep] = useState<StepKey>('company');
  const [reached, setReached] = useState(0);
  const go = (k: StepKey) => {
    setStep(k);
    setReached((r) => Math.max(r, STEPS.findIndex((s) => s.key === k)));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── Step 1 ──
  const [company, setCompany] = useState({ name: '', email: '', website: '', contactName: '', contactEmail: '', contactPhone: '', industry: '' });
  const [place, setPlace] = useState<LocationValue>({ countryCode: '', regionCode: '', city: '' });
  const [touched, setTouched] = useState(false);
  const companyErrors: Partial<Record<keyof typeof company, string>> = {
    ...(company.name.trim().length < 2 ? { name: 'Enter the company name.' } : {}),
    ...(!EMAIL.test(company.email.trim()) ? { email: 'Enter the company email, such as info@example.com.' } : {}),
    ...(!WEBSITE.test(company.website.trim()) ? { website: 'Enter the website, such as example.com.' } : {}),
    ...(company.contactEmail.trim() && !EMAIL.test(company.contactEmail.trim()) ? { contactEmail: 'Use an email address such as name@example.com.' } : {}),
    ...(company.contactPhone.trim() && !/^\+?[0-9 ()./-]{6,}$/.test(company.contactPhone.trim()) ? { contactPhone: 'Use digits, spaces and an optional + only.' } : {}),
  };
  const companyOk = Object.keys(companyErrors).length === 0;
  const setC = (k: keyof typeof company) => (e: React.ChangeEvent<HTMLInputElement>) => setCompany((c) => ({ ...c, [k]: e.target.value }));

  // ── Step 2 ──
  const [rows, setRows] = useState<Partial<Record<EnrichField, Row>>>({});
  const [extract, setExtract] = useState<ConsoleClientExtract | null>(null);
  const [keepLogo, setKeepLogo] = useState(true);
  const find = useMutation({
    mutationFn: () =>
      api<ConsoleClientExtract>('/operator/clients/extract', {
        method: 'POST',
        json: { name: company.name.trim(), website: company.website.trim(), email: company.email.trim() },
      }),
    onSuccess: (r) => {
      setExtract(r);
      setKeepLogo(!!r.logo);
      setRows(seedRows(r));
    },
  });
  /** Every review field: what was found (best source first), else what step 1 typed, else empty ("Not found"). */
  function seedRows(r: ConsoleClientExtract | null): Partial<Record<EnrichField, Row>> {
    const out: Partial<Record<EnrichField, Row>> = {};
    const typed: Partial<Record<EnrichField, string>> = {
      industry: company.industry.trim(),
      city: place.city.trim(),
      country: place.countryCode,
      primaryEmail: company.email.trim().toLowerCase(),
      primaryPhone: company.contactPhone.trim(),
    };
    for (const f of CLIENT_DETAIL_FIELDS) {
      const hit = r?.found.find((x) => x.field === f);
      if (hit) out[f] = { value: asText(hit.value) || hit.display, source: { source: hit.source, url: hit.url }, removed: false, found: true };
      else if (typed[f]) out[f] = { value: typed[f]!, source: { source: 'USER', url: null }, removed: false, found: false };
      else out[f] = { value: '', source: null, removed: false, found: false };
    }
    return out;
  }
  const edit = (f: EnrichField, value: string) =>
    setRows((r) => ({ ...r, [f]: { ...(r[f] ?? { found: false, removed: false }), value, removed: false, source: { source: 'USER', url: null } } }));
  const remove = (f: EnrichField) => setRows((r) => ({ ...r, [f]: { ...r[f]!, removed: true } }));
  const restore = (f: EnrichField) => {
    const hit = extract?.found.find((x) => x.field === f);
    setRows((r) => ({ ...r, [f]: hit ? { value: asText(hit.value) || hit.display, source: { source: hit.source, url: hit.url }, removed: false, found: true } : { ...r[f]!, removed: false } }));
  };
  const kept = CLIENT_DETAIL_FIELDS.filter((f) => rows[f] && !rows[f]!.removed && rows[f]!.value.trim());
  const foundCount = CLIENT_DETAIL_FIELDS.filter((f) => rows[f]?.found).length;

  // ── Step 3 ──
  const plans = useQuery({ queryKey: ['operator', 'console-plans'], queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans') });
  const offered = (plans.data ?? []).filter((p) => p.terms.available);
  const [sub, setSub] = useState({
    adminName: '',
    adminEmail: '',
    designation: 'Client Administrator',
    planCode: '',
    seats: '10',
    startsOn: new Date().toISOString().slice(0, 10),
    months: '',
    price: '',
    currency: '',
    paymentStatus: 'PENDING' as PaymentStatus,
    managers: '',
    executives: '',
    superExecutives: true,
    anotherSuper: false,
  });
  const setS = (k: keyof typeof sub) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSub((s) => ({ ...s, [k]: e.target.value }));
  const plan = offered.find((p) => p.code === sub.planCode) ?? offered[0];
  const adminName = sub.adminName || company.contactName;
  const adminEmail = sub.adminEmail || company.contactEmail;
  const subErrors: Record<string, string> = {
    ...(!adminName.trim() ? { adminName: 'Enter the administrator’s name.' } : {}),
    ...(!EMAIL.test(adminEmail.trim()) ? { adminEmail: 'Enter the administrator’s email.' } : {}),
    ...(!(Number(sub.seats) >= 1) ? { seats: 'At least one seat.' } : {}),
    ...(!plan ? { plan: 'No plan is on sale. Make one available on Plans first.' } : {}),
  };
  const subOk = Object.keys(subErrors).length === 0;
  const [subTouched, setSubTouched] = useState(false);

  // ── Step 4 ──
  const [created, setCreated] = useState<ConsoleClientCreated | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const details = (): ConsoleClientDetails => ({
    values: Object.fromEntries(kept.map((f) => [f, isList(f) ? rows[f]!.value.split('\n').map((v) => v.trim()).filter(Boolean) : rows[f]!.value.trim()])),
    sources: Object.fromEntries(kept.map((f) => [f, rows[f]!.source ?? { source: 'USER' as const, url: null }])),
  });
  /** Step 1's profile, with what the review approved filling the gaps (legal name, address, postal code). */
  const profile = () => {
    const v = (f: EnrichField) => (rows[f] && !rows[f]!.removed ? rows[f]!.value.trim() : '');
    const country = /^[A-Za-z]{2}$/.test(v('country')) ? v('country') : place.countryCode;
    return {
      website: company.website.trim(),
      ...(v('legalName') ? { legalName: v('legalName') } : {}),
      ...((company.industry.trim() || v('industry')) ? { industry: company.industry.trim() || v('industry') } : {}),
      ...(country ? { countryCode: country } : {}),
      ...(place.regionCode && country === place.countryCode ? { regionCode: place.regionCode } : {}),
      ...((place.city.trim() || v('city')) ? { city: place.city.trim() || v('city') } : {}),
      ...(v('address') ? { addressLine1: v('address').slice(0, 200) } : {}),
      ...(v('postalCode') ? { postalCode: v('postalCode').slice(0, 20) } : {}),
      ...(company.contactName.trim() ? { contactName: company.contactName.trim() } : {}),
      ...(company.contactEmail.trim() ? { contactEmail: company.contactEmail.trim() } : {}),
      ...(company.contactPhone.trim() ? { contactPhone: company.contactPhone.trim() } : {}),
    };
  };
  const create = useMutation({
    mutationFn: async () => {
      const body: ConsoleClientCreateWithDetailsInput = {
        organisation: { name: company.name.trim() },
        administrator: { name: adminName.trim(), email: adminEmail.trim(), ...(sub.designation.trim() ? { designation: sub.designation.trim() } : {}) },
        planCode: plan?.code ?? '',
        seats: Number(sub.seats) || 1,
        startsOn: sub.startsOn,
        ...(sub.months ? { durationMonths: Number(sub.months) } : {}),
        ...(sub.price.trim() ? { priceCents: toCents(sub.price) } : {}),
        ...(sub.currency.trim() ? { currency: sub.currency } : {}),
        paymentStatus: sub.paymentStatus,
        ...(sub.managers.trim() ? { maxManagerWorkspaces: toLimit(sub.managers) } : {}),
        ...(sub.executives.trim() ? { maxExecutiveWorkspaces: toLimit(sub.executives) } : {}),
        superCanCreateExecutives: sub.superExecutives,
        ...(sub.anotherSuper ? { allowAnotherSuper: true } : {}),
        companyEmail: company.email.trim(),
        profile: profile(),
        ...(kept.length ? { details: details() } : {}),
        reason: 'New client',
      };
      const res = await api<ConsoleClientCreated>('/operator/clients', { method: 'POST', json: body });
      // The website's logo, when kept: uploaded through the client logo route, which checks the image again.
      if (keepLogo && extract?.logo) {
        try {
          const blob = dataUrlToBlob(extract.logo.dataUrl);
          const withLogo = await api<ConsoleClientDetail>(`/operator/clients/${res.client.id}/logo`, { method: 'PUT', body: blob, headers: { 'content-type': extract.logo.contentType } });
          return { ...res, client: withLogo };
        } catch (e) {
          setLogoError(e instanceof Error ? e.message : 'The logo could not be saved.');
        }
      }
      return res;
    },
    onSuccess: (r) => {
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['operator', 'overview'] });
    },
  });

  if (created) return <Created created={created} logoError={logoError} onOpen={() => router.push(`/operator/clients/${created.client.id}`)} />;

  return (
    <div data-create-client-wizard>
      <Stepper step={step} onGo={go} reached={reached} />

      {step === 'company' && (
        <Card className="p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Company</h2>
          <p className="mt-1 text-sm text-muted-foreground">The name, email and website are enough: SampForce looks up the rest on the next step.</p>
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!companyOk) return;
              find.reset();
              setExtract(null);
              setRows(seedRows(null));
              go('review');
              find.mutate();
            }}
          >
            <Field id="cc-name" label="Company name" error={touched ? companyErrors.name : undefined} className="sm:col-span-2">
              <Input id="cc-name" autoComplete="organization" value={company.name} onChange={setC('name')} aria-invalid={touched && !!companyErrors.name} />
            </Field>
            <Field id="cc-email" label="Company email" error={touched ? companyErrors.email : undefined}>
              <Input id="cc-email" type="email" value={company.email} onChange={setC('email')} aria-invalid={touched && !!companyErrors.email} placeholder="info@example.com" />
            </Field>
            <Field id="cc-website" label="Website" error={touched ? companyErrors.website : undefined}>
              <Input id="cc-website" inputMode="url" value={company.website} onChange={setC('website')} aria-invalid={touched && !!companyErrors.website} placeholder="example.com" />
            </Field>
            <Field id="cc-contact" label="Primary contact">
              <Input id="cc-contact" autoComplete="off" value={company.contactName} onChange={setC('contactName')} />
            </Field>
            <Field id="cc-contact-email" label="Contact email" error={touched ? companyErrors.contactEmail : undefined}>
              <Input id="cc-contact-email" type="email" value={company.contactEmail} onChange={setC('contactEmail')} />
            </Field>
            <Field id="cc-contact-phone" label="Contact phone" error={touched ? companyErrors.contactPhone : undefined}>
              <Input id="cc-contact-phone" type="tel" value={company.contactPhone} onChange={setC('contactPhone')} />
            </Field>
            <Field id="cc-industry" label="Industry">
              <Input id="cc-industry" value={company.industry} onChange={setC('industry')} />
            </Field>
            <div className="sm:col-span-2">
              <LocationPicker idPrefix="cc" value={place} onChange={setPlace} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTouched(true);
                  if (!companyOk) return;
                  setExtract(null);
                  setRows(seedRows(null));
                  go('review');
                }}
              >
                Skip, I’ll enter the details
              </Button>
              <Button type="submit">
                <Search aria-hidden /> Find company details
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {find.isPending ? (
            <Card className="grid min-h-72 place-items-center p-8" data-extract-state="loading">
              <div className="text-center">
                <BrandLoader compact label={`Reading ${company.website.trim()}`} />
                <p className="mt-3 max-w-md text-sm text-muted-foreground">Reading the company’s own website and Wikidata, and looking for its logo. This can take up to a minute for sites built with JavaScript.</p>
              </div>
            </Card>
          ) : (
            <>
              <Card className="p-5 sm:p-6" data-extract-summary>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-surface" data-found-logo={extract?.logo && keepLogo ? 'kept' : 'none'}>
                    {extract?.logo && keepLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={extract.logo.dataUrl} alt={`${company.name} logo`} className="size-full object-contain p-2" />
                    ) : (
                      <ImageOff className="size-7 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{company.name}</h2>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Globe className="size-4" aria-hidden /> {company.website}
                    </p>
                    <p className="mt-2 text-sm" data-found-count={foundCount}>
                      {extract
                        ? foundCount
                          ? `Found ${foundCount} of ${CLIENT_DETAIL_FIELDS.length} details${extract.sources.length ? ` from ${extract.sources.length} ${extract.sources.length === 1 ? 'source' : 'sources'}` : ''}. Check each one before you approve it.`
                          : 'Nothing could be confirmed from public sources. Enter what you know; empty fields stay empty.'
                        : find.isError
                          ? 'The look-up did not run. Enter the details yourself or try again.'
                          : 'Enter the details you know. Empty fields stay empty.'}
                    </p>
                    {extract?.error && <p className="mt-1 text-sm text-foreground">{extract.error}</p>}
                    {extract?.logo ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setKeepLogo((k) => !k)}>
                          {keepLogo ? 'Don’t use this logo' : 'Use the website’s logo'}
                        </Button>
                      </div>
                    ) : extract ? (
                      <p className="mt-1 text-xs text-muted-foreground">No usable logo was found. Add one from the client’s page after it is created.</p>
                    ) : null}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => find.mutate()} disabled={find.isPending}>
                    <RotateCw aria-hidden /> Look again
                  </Button>
                </div>
                {find.error ? <div className="mt-3"><ErrorText error={find.error} /></div> : null}
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="border-b border-border px-5 py-3">
                  <h2 className="font-semibold">Company information found</h2>
                  <p className="text-sm text-muted-foreground">Edit, correct or remove anything. Lists take one item per line.</p>
                </div>
                <ul className="divide-y divide-border" data-review-fields>
                  {CLIENT_DETAIL_FIELDS.map((f) => {
                    const row = rows[f] ?? { value: '', source: null, removed: false, found: false };
                    const id = `cd-${f}`;
                    return (
                      <li key={f} className={cn('grid gap-2 px-5 py-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start', row.removed && 'bg-muted/40')} data-review-field={f}>
                        <div className="pt-1.5">
                          <label htmlFor={id} className="text-sm font-medium">
                            {ENRICH_FIELD_LABELS[f]}
                          </label>
                          <div className="mt-1">
                            <SourceBadge row={row} />
                          </div>
                        </div>
                        {row.removed ? (
                          <p className="pt-2 text-sm text-muted-foreground line-through">{row.value || '—'}</p>
                        ) : isList(f) || f === 'overview' ? (
                          <textarea
                            id={id}
                            rows={Math.min(6, Math.max(2, row.value.split('\n').length))}
                            className="w-full rounded-md border border-input bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            value={row.value}
                            placeholder={row.found ? '' : 'Not found. Type to add it.'}
                            onChange={(e) => edit(f, e.target.value)}
                          />
                        ) : (
                          <Input id={id} value={row.value} placeholder={row.found ? '' : 'Not found. Type to add it.'} onChange={(e) => edit(f, e.target.value)} />
                        )}
                        <div className="flex gap-1 sm:pt-0.5">
                          {row.removed ? (
                            <Button size="sm" variant="ghost" onClick={() => restore(f)} aria-label={`Restore ${ENRICH_FIELD_LABELS[f]}`}>
                              <Undo2 aria-hidden /> Restore
                            </Button>
                          ) : row.value.trim() ? (
                            <Button size="sm" variant="ghost" onClick={() => remove(f)} aria-label={`Remove ${ENRICH_FIELD_LABELS[f]}`}>
                              <Trash2 aria-hidden />
                            </Button>
                          ) : (
                            <span className="inline-flex size-8 items-center justify-center text-muted-foreground" aria-hidden>
                              <Plus className="size-4" />
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              {extract && extract.people.length > 0 && (
                <p className="text-sm text-muted-foreground" data-found-people>
                  The website also lists {extract.people.length} {extract.people.length === 1 ? 'person' : 'people'}. People are not copied into the Console; the client’s team adds its own employees.
                </p>
              )}
              <div className="flex flex-wrap justify-between gap-2">
                <Button variant="outline" onClick={() => go('company')}>
                  <ArrowLeft aria-hidden /> Back
                </Button>
                <Button onClick={() => go('plan')}>
                  Approve details <ArrowRight aria-hidden />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'plan' && (
        <Card className="p-5 sm:p-6">
          <form
            className="space-y-6"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setSubTouched(true);
              if (subOk) go('confirm');
            }}
          >
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-lg font-semibold">Administrator</legend>
              <p className="-mt-2 text-sm text-muted-foreground sm:col-span-2">They receive an invitation and own the client’s Super Workspace.</p>
              <Field id="cc-admin" label="Administrator’s name" error={subTouched ? subErrors.adminName : undefined}>
                <Input id="cc-admin" value={adminName} onChange={setS('adminName')} />
              </Field>
              <Field id="cc-admin-email" label="Administrator’s email" error={subTouched ? subErrors.adminEmail : undefined}>
                <Input id="cc-admin-email" type="email" value={adminEmail} onChange={setS('adminEmail')} />
              </Field>
              <Field id="cc-designation" label="Administrator’s designation" hint="Shown in their profile. It grants nothing by itself." className="sm:col-span-2">
                <Input id="cc-designation" value={sub.designation} onChange={setS('designation')} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-3">
              <legend className="mb-2 text-lg font-semibold">Subscription</legend>
              <Field id="cc-plan" label="Plan" className="sm:col-span-2" error={subTouched ? subErrors.plan : undefined}>
                <select id="cc-plan" className={selectClass} value={plan?.code ?? ''} onChange={setS('planCode')}>
                  {offered.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name.replace('SampForce ', '')} · {p.features.length} features · {price(p.terms.priceCents, p.terms.currency, p.terms.billingFrequency)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="cc-seats" label="Seats" error={subTouched ? subErrors.seats : undefined}>
                <Input id="cc-seats" type="number" min={1} value={sub.seats} onChange={setS('seats')} />
              </Field>
              <Field id="cc-start" label="Starts on">
                <Input id="cc-start" type="date" value={sub.startsOn} onChange={setS('startsOn')} />
              </Field>
              <Field id="cc-months" label="Term in months" hint={plan ? `Plan: ${plan.terms.durationMonths}` : undefined}>
                <Input id="cc-months" type="number" min={1} max={120} value={sub.months} onChange={setS('months')} placeholder={plan ? String(plan.terms.durationMonths) : ''} />
              </Field>
              <Field id="cc-payment" label="Payment">
                <select id="cc-payment" className={selectClass} value={sub.paymentStatus} onChange={setS('paymentStatus')}>
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PAYMENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="cc-price" label="Agreed price per period" hint={plan ? `Plan: ${price(plan.terms.priceCents, plan.terms.currency)}` : undefined}>
                <Input id="cc-price" inputMode="decimal" value={sub.price} onChange={setS('price')} placeholder="Plan price" />
              </Field>
              <Field id="cc-currency" label="Currency">
                <Input id="cc-currency" maxLength={3} value={sub.currency} onChange={setS('currency')} placeholder={plan?.terms.currency ?? 'USD'} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-lg font-semibold">Workspace limits</legend>
              <Field id="cc-managers" label="Manager Workspaces" hint={`Empty: the plan’s limit (${plan?.limits.maxManagerWorkspaces ?? 'none'})`}>
                <Input id="cc-managers" type="number" min={0} value={sub.managers} onChange={setS('managers')} />
              </Field>
              <Field id="cc-executives" label="Executive Workspaces" hint={`Empty: the plan’s limit (${plan?.limits.maxExecutiveWorkspaces ?? 'none'})`}>
                <Input id="cc-executives" type="number" min={0} value={sub.executives} onChange={setS('executives')} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={sub.superExecutives} onChange={(e) => setSub((s) => ({ ...s, superExecutives: e.target.checked }))} />
                The Super Workspace may create Executive Workspaces itself
              </label>
            </fieldset>
            <ErrorText error={plans.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => go('review')}>
                <ArrowLeft aria-hidden /> Back
              </Button>
              <Button type="submit">
                Continue <ArrowRight aria-hidden />
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2" data-confirm-company>
              <h2 className="font-semibold">Company</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {[
                  ['Name', company.name],
                  ['Email', company.email],
                  ['Website', company.website],
                  ['Primary contact', [company.contactName, company.contactEmail, company.contactPhone].filter(Boolean).join(' · ') || '—'],
                  ['Location', [place.city || rows.city?.value, place.countryCode || rows.country?.value].filter(Boolean).join(', ') || '—'],
                  ['Industry', company.industry || (rows.industry && !rows.industry.removed ? rows.industry.value : '') || '—'],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-sm" data-confirm-details={kept.length}>
                {kept.length} approved {kept.length === 1 ? 'detail' : 'details'}
                {kept.length ? `, ${kept.filter((f) => rows[f]!.source && rows[f]!.source!.source !== 'USER').length} found automatically` : ''}
                {extract?.logo && keepLogo ? ', with the website’s logo' : ''}.
              </p>
            </Card>
            <Card className="p-5" data-confirm-plan>
              <h2 className="font-semibold">Plan & administrator</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium">{plan?.name.replace('SampForce ', '')} · {sub.seats} seats</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Payment</dt>
                  <dd className="font-medium">{PAYMENT_STATUS_LABEL[sub.paymentStatus]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Administrator</dt>
                  <dd className="font-medium">{adminName} · {adminEmail}</dd>
                </div>
              </dl>
            </Card>
          </div>
          <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-4 text-sm">
            <ShieldCheck className="size-5 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              Approving creates the client with a customer ID, its Super Workspace and subscription, and an invitation for {adminEmail}. Every value is written to the audit log.
            </span>
          </Card>
          {(create.error instanceof ApiError && create.error.code === 'SUPER_WORKSPACE_LIMIT') || sub.anotherSuper ? (
            <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm" data-allow-another-super>
              <input type="checkbox" className="mt-0.5" checked={sub.anotherSuper} onChange={(e) => setSub((s) => ({ ...s, anotherSuper: e.target.checked }))} />
              <span>
                <span className="block font-medium">Allow another Super Workspace</span>
                <span className="text-muted-foreground">One person owns one Super Workspace. Tick this only if {adminEmail} should own this client’s Super Workspace as well; it is written to the audit log.</span>
              </span>
            </label>
          ) : null}
          <ErrorText error={create.error} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => go('plan')} disabled={create.isPending}>
              <ArrowLeft aria-hidden /> Back
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending} data-approve-create>
              <CheckCircle2 aria-hidden /> {create.isPending ? 'Creating…' : 'Approve & create client'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Created({ created, logoError, onOpen }: { created: ConsoleClientCreated; logoError: string | null; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="relative overflow-hidden p-6 sm:p-8" data-client-created>
      <span className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-success/15 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-start gap-4">
        <span className="grid size-14 place-items-center rounded-2xl bg-success text-white shadow-lg shadow-success/30" aria-hidden>
          <CheckCircle2 className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{created.client.name} is ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer ID <span className="font-mono font-medium text-foreground" data-created-customer-id>{created.client.customerId}</span>. Send this link to the administrator; it works once and for seven days.
          </p>
          <div className="mt-4 flex max-w-2xl gap-2">
            <Input readOnly value={created.inviteUrl} aria-label="Administrator invitation link" />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(created.inviteUrl);
                setCopied(true);
              }}
            >
              <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {logoError && <p className="mt-2 text-sm text-foreground">The client was created, but the logo was not saved ({logoError.replace(/\.$/, '')}). Add it from the client’s page.</p>}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={onOpen}>Open client</Button>
            <Button variant="outline" asChild>
              <Link href="/operator/clients">Back to all clients</Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
