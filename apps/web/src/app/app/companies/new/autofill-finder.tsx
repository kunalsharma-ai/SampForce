'use client';

import { COMPANY_TYPES, ENRICH_FIELD_LABELS, ENRICH_FIELDS, type EnrichField, type EnrichmentPreview, FIELD_SOURCE_LABELS, type FoundPerson } from '@dealflow/types';
import { Badge, Button } from '@dealflow/ui';
import { Check, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { PointValue } from '@/components/crm/lead-fields';
import { FoundPeople } from '@/components/crm/found-people';
import { CountryFlag } from '@/components/crm/status-chip';
import { api, ApiError } from '@/lib/api';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import type { CompanyValue } from './lead-wizard';
import { COMPANY_SIZES } from './lead-wizard';

type Found = EnrichmentPreview['found'][number];

/** The form fields a found value goes into on this form, or null when it is added after saving. */
const TEXT_FIELDS = ['overview', 'industry', 'businessCategory', 'specialties', 'country', 'state', 'city', 'address', 'postalCode', 'timezone', 'headquarters'] as const;

const pointsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : String((x as { value?: unknown })?.value ?? ''))).filter(Boolean);
const hasPoints = (list: PointValue[]) => list.some((p) => p.value.trim());

/** What a found value changes in the form, if the form has a place for it and that place is still empty. */
export function patchFor(f: Found, c: CompanyValue): Partial<CompanyValue> | null {
  const field = f.field as string;
  if ((TEXT_FIELDS as readonly string[]).includes(field)) {
    const k = field as (typeof TEXT_FIELDS)[number];
    return c[k].trim() ? null : { [k]: String(f.value) };
  }
  if (field === 'foundedYear' || field === 'branchCount') return c[field].trim() ? null : { [field]: String(f.value) };
  if (field === 'companySize') return c.companySize || !(COMPANY_SIZES as readonly string[]).includes(String(f.value)) ? null : { companySize: String(f.value) };
  if (field === 'companyType') return c.companyType || !(COMPANY_TYPES as readonly string[]).includes(String(f.value)) ? null : { companyType: String(f.value) };
  const points = (key: 'emails' | 'phones' | 'linkedinUrls') => {
    if (hasPoints(c[key])) return null;
    return { [key]: pointsOf(f.value).map((value, i) => ({ value, primary: i === 0 })) } as Partial<CompanyValue>;
  };
  if (field === 'primaryEmail' || field === 'emails') return points('emails');
  if (field === 'primaryPhone' || field === 'phones') return points('phones');
  if (field === 'linkedinUrl') return points('linkedinUrls');
  return null;
}

/** Applies every chosen value; emails and phones found as a main one and a list are put together, main one first. */
export function applyFound(found: Found[], chosen: Set<number>, c: CompanyValue): Partial<CompanyValue> {
  const out: Partial<CompanyValue> = {};
  const lists: Record<'emails' | 'phones', string[]> = { emails: [], phones: [] };
  found.forEach((f, i) => {
    if (!chosen.has(i)) return;
    const p = patchFor(f, c);
    if (!p) return;
    for (const key of ['emails', 'phones'] as const) {
      if (p[key]) {
        const values = p[key]!.map((x) => x.value);
        lists[key] = f.field.startsWith('primary') ? [...values, ...lists[key]] : [...lists[key], ...values];
        delete p[key];
      }
    }
    Object.assign(out, p);
  });
  for (const key of ['emails', 'phones'] as const) {
    const unique = [...new Map(lists[key].map((v) => [v.toLowerCase().replace(/\s+/g, ''), v])).values()];
    if (unique.length) out[key] = unique.map((value, i) => ({ value, primary: i === 0 }));
  }
  return out;
}

/**
 * Create Company (ADR 0076): with a name and website entered, looks the company up and shows what it found, each value
 * with its source. The person picks what goes into the form and checks it on the next steps before saving; the rest
 * (services, profiles, certifications...) is added by auto-fill once the company is saved.
 */
export function AutofillFinder({
  company: c,
  onApply,
  skip = [],
  onSkip,
  onAddPeople,
  employeeNames = [],
}: {
  company: CompanyValue;
  onApply: (patch: Partial<CompanyValue>) => void;
  /** Details the form has no place for that the person unticked: the run after saving leaves them out. */
  skip?: EnrichField[];
  onSkip?: (fields: EnrichField[]) => void;
  /** Adds the people the person picked as employees of the lead. */
  onAddPeople?: (people: FoundPerson[]) => void;
  /** Names already on the Employees step, not offered again. */
  employeeNames?: string[];
}) {
  const t = useT();
  const enabled = useHasFeature('company_enrichment');
  const [result, setResult] = React.useState<EnrichmentPreview | null>(null);
  const [chosen, setChosen] = React.useState<Set<number>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [applied, setApplied] = React.useState<number | null>(null);
  const [addedPeople, setAddedPeople] = React.useState<number | null>(null);
  if (!enabled) return null;
  const website = c.websites.find((w) => w.primary && w.value.trim())?.value ?? c.websites.find((w) => w.value.trim())?.value ?? '';
  const label = (f: EnrichField) => t.maybe(ENRICH_FIELD_LABELS[f]);

  async function find() {
    setBusy(true);
    setError(null);
    setApplied(null);
    setAddedPeople(null);
    try {
      const r = await api<EnrichmentPreview>('/companies/autofill-preview', { method: 'POST', json: { name: c.name.trim(), website: website.trim() || null } });
      setResult(r);
      onSkip?.([]);
      setChosen(new Set(r.found.map((f, i) => (patchFor(f, c) ? i : -1)).filter((i) => i >= 0)));
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : t('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  function use() {
    if (!result) return;
    const patch = applyFound(result.found, chosen, c);
    onApply(patch);
    setApplied(Object.keys(patch).length);
    setChosen(new Set());
  }

  const fits = result?.found.map((f) => patchFor(f, c) !== null) ?? [];
  const forForm = (result?.found.map((f, i) => ({ f, i })).filter(({ i }) => fits[i]) ?? []).sort((a, b) => ENRICH_FIELDS.indexOf(a.f.field) - ENRICH_FIELDS.indexOf(b.f.field));
  const filledAlready = result?.found.filter((f, i) => !fits[i] && patchFor(f, { ...c, ...blankCompany }) !== null) ?? [];
  const later = result?.found.filter((f) => patchFor(f, { ...c, ...blankCompany }) === null) ?? [];

  return (
    <section aria-labelledby="autofill-finder" className="rounded-xl bg-gradient-to-r from-primary/50 via-accent/50 to-primary/30 p-px sm:col-span-2">
      <div className="space-y-3 rounded-[11px] bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="autofill-finder" className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles aria-hidden className="size-4 text-primary" /> {t('Fill in the rest automatically')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('Enter the name and website, then find the company’s details on its website and Wikidata. You choose what to use.')}</p>
          </div>
          <Button type="button" size="sm" disabled={busy || !c.name.trim()} onClick={() => void find()}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />} {busy ? t('Reading the website…') : result ? t('Find again') : t('Find details')}
          </Button>
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">
            {error}
          </p>
        )}
        {applied !== null && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-sm">
            <Check aria-hidden className="size-4 text-success" /> {t('Added {count} details to the form. Check them on each step before saving.', { count: applied })}
          </p>
        )}
        {addedPeople !== null && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-sm">
            <Check aria-hidden className="size-4 text-success" /> {t('Added {count} people to the Employees step. Check them there before saving.', { count: addedPeople })}
          </p>
        )}
        {result && !result.found.length && !result.people.length && <p role="status" className="text-sm text-muted-foreground">{result.error ? (result.error.startsWith('Could not reach ') ? t('Could not reach {site}', { site: result.error.slice('Could not reach '.length) }) : t.maybe(result.error)) : t('Nothing found. You can fill the details in yourself.')}</p>}
        {result && result.people.length > 0 && onAddPeople && (
          <FoundPeople
            people={result.people}
            skipNames={employeeNames}
            onAdd={(chosen) => {
              onAddPeople(chosen);
              setAddedPeople(chosen.length);
            }}
          />
        )}
        {result && result.found.length > 0 && (
          <>
            {forForm.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t('Found for this form ({count})', { count: forForm.length })}</legend>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {forForm.map(({ f, i }) => (
                    <li key={i}>
                      <FoundCard
                        f={f}
                        label={label(f.field)}
                        checked={chosen.has(i)}
                        onChange={(on) => setChosen((s) => { const n = new Set(s); if (on) n.add(i); else n.delete(i); return n; })}
                      />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button type="button" size="sm" disabled={!chosen.size} onClick={use}>
                    <Check aria-hidden /> {t('Use {count} selected', { count: chosen.size })}
                  </Button>
                </div>
              </fieldset>
            )}
            {filledAlready.length > 0 && <p className="text-xs text-muted-foreground">{t('Fields you already filled are kept: {fields}.', { fields: [...new Set(filledAlready.map((f) => label(f.field)))].join(', ') })}</p>}
            {later.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t('Added when you save ({count}), with their sources. Untick what you do not want.', { count: later.length })}</legend>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {later.map((f, i) => (
                    <li key={`${f.field}-${i}`}>
                      <FoundCard
                        f={f}
                        label={label(f.field)}
                        checked={!skip.includes(f.field)}
                        onChange={(on) => onSkip?.(on ? skip.filter((x) => x !== f.field) : [...new Set([...skip, f.field])])}
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** One found value with its tick box, its source and how sure it is. */
function FoundCard({ f, label, checked, onChange }: { f: Found; label: string; checked: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex h-full cursor-pointer items-start gap-3 rounded-lg border border-border p-2.5 hover:border-primary/50 hover:bg-muted/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
      <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted-foreground">{label}</span>
        <span className="line-clamp-3 block break-words text-sm" title={f.display}>
          {f.field === 'country' ? <CountryFlag code={String(f.value)} withName /> : f.display}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {f.url ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 hover:underline" onClick={(e) => e.stopPropagation()}>
              {t.maybe(FIELD_SOURCE_LABELS[f.source])} <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            t.maybe(FIELD_SOURCE_LABELS[f.source])
          )}
          {f.confidence === 'low' && <Badge className="px-1.5 py-0 text-[10px]">{t('Best guess')}</Badge>}
          {f.confidence === 'uncertain' && <Badge tone="warning" className="px-1.5 py-0 text-[10px]">{t('Uncertain')}</Badge>}
        </span>
      </span>
    </label>
  );
}

/** Every form field empty, to tell "the form has a place for it" from "already filled". */
const blankCompany: Partial<CompanyValue> = {
  overview: '', industry: '', businessCategory: '', specialties: '', country: '', state: '', city: '', address: '', postalCode: '', timezone: '', headquarters: '',
  foundedYear: '', branchCount: '', companySize: '', companyType: '', emails: [], phones: [], linkedinUrls: [],
};
