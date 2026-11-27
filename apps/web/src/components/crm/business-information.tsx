'use client';

import {
  type CompanyRow,
  ENRICH_FIELD_LABELS,
  type EnrichField,
  FIELD_SOURCE_LABELS,
  type FieldSource,
  OPERATING_STATUSES,
  SOCIAL_PLATFORM_LABELS,
  type SocialPlatform,
  socialPlatformOf,
} from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { RemoveValue, useRemoveValue } from './remove-value';
import {
  Activity,
  BadgeCheck,
  Briefcase,
  Building,
  Building2,
  CalendarDays,
  Clock,
  Contact,
  Crown,
  ExternalLink,
  Factory,
  Globe,
  Info,
  Landmark,
  Layers,
  Link2,
  Mail,
  MapPin,
  Network,
  Package,
  Pencil,
  Phone,
  Plus,
  Quote,
  ScrollText,
  Share2,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react';
import * as React from 'react';
import { CountrySelect, TimeZoneSelect } from '@/components/forms/inputs';
import { countryName } from '@/components/forms/locale-data';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan, useHiddenKeys } from '@/lib/session';
import { Select, Textarea } from './select';
import { BRAND_MARKS } from './brand-marks';
import { INSTAGRAM_GRADIENT, profileLinks } from './social-icons';
import { CountryFlag } from './status-chip';

type T = ReturnType<typeof useT>;
type Icon = typeof Globe;
type Sources = CompanyRow['fieldSources'];

const short = (href: string) => href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const has = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/** Tinted colour sets for the section icons, so each section is easy to find at a glance. */
const TINTS = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  critical: 'bg-critical/10 text-critical',
} as const;

function Section({ id, icon: I, tint, title, children }: { id: string; icon: Icon; tint: keyof typeof TINTS; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`bi-sec-${id}`} className="space-y-3 rounded-xl border border-border bg-background/40 p-4">
      <h3 id={`bi-sec-${id}`} className="flex items-center gap-2.5 text-sm font-semibold">
        <span className={`inline-flex size-8 items-center justify-center rounded-lg ${TINTS[tint]}`}>
          <I aria-hidden className="size-4" />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A labelled value with a small icon, and the Auto mark when auto-fill found it. */
function Item({ icon: I, label, source, wide, remove, children }: { icon?: Icon; label: string; source?: FieldSource; wide?: boolean; remove?: () => Promise<unknown>; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className={wide ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
      <dt className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {I && <I aria-hidden className="size-3.5" />}
        {label}
        <SourceTag source={source} t={t} />
        {remove && <RemoveValue label={label} onRemove={remove} />}
      </dt>
      <dd className="mt-1 break-words text-sm">{children}</dd>
    </div>
  );
}

function Chips({ items, tone, icon: I, onRemove }: { items: string[]; tone: keyof typeof TINTS; icon?: Icon; onRemove?: (item: string) => Promise<unknown> }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((x) => (
        <li key={x} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TINTS[tone]}`}>
          {I && <I aria-hidden className="size-3.5" />}
          {x}
          {onRemove && <RemoveValue label={x} onRemove={() => onRemove(x)} className="-me-1 size-5" />}
        </li>
      ))}
    </ul>
  );
}

/** A big number with its label, for the key facts strip. */
function Stat({ icon: I, tint, label, value, source, remove }: { icon: Icon; tint: keyof typeof TINTS; label: string; value: React.ReactNode; source?: FieldSource; remove?: () => Promise<unknown> }) {
  const t = useT();
  return (
    <div className="flex min-w-[9.5rem] flex-1 basis-40 items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
      <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${TINTS[tint]}`}>
        <I aria-hidden className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {label} <SourceTag source={source} t={t} />
          {remove && <RemoveValue label={label} onRemove={remove} />}
        </p>
        <p className="truncate text-base font-semibold">{value}</p>
      </div>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function Person({ name, role, icon: I, remove }: { name: string; role?: string | null; icon?: Icon; remove?: () => Promise<unknown> }) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background/60 p-2.5">
      <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-accent/80 text-xs font-bold text-white">
        {initials(name)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 truncate text-sm font-semibold">
          {name}
          {I && <I aria-hidden className="size-3.5 text-warning" />}
        </span>
        {role && <span className="block truncate text-xs text-muted-foreground">{role}</span>}
      </span>
      {remove && <RemoveValue label={name} onRemove={remove} className="ms-auto" />}
    </li>
  );
}

/** A labelled pill in the platform's colours that opens the profile. */
function ProfilePill({ platform, url, name }: { platform: SocialPlatform | 'website'; url: string; name: string }) {
  const mark = platform === 'website' ? null : BRAND_MARKS[platform];
  const style: React.CSSProperties = platform === 'instagram' ? { backgroundImage: INSTAGRAM_GRADIENT } : mark ? { backgroundColor: mark.hex } : {};
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={short(url)}
      className="group inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-surface py-1 pe-3 ps-1 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span style={style} className={`inline-flex size-7 items-center justify-center rounded-full text-white ${platform === 'website' ? 'bg-primary text-primary-foreground' : ''}`}>
        {mark ? (
          <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
            <path d={mark.path} />
          </svg>
        ) : (
          <Globe aria-hidden className="size-4" />
        )}
      </span>
      {name}
      <ExternalLink aria-hidden className="size-3 text-muted-foreground" />
    </a>
  );
}

/**
 * Business Information (ADR 0076): every detail about the company in one place, grouped into sections with their
 * own icons, flags beside every country, and each value telling whether auto-fill found it (with its source) or
 * someone on the team entered it. One Edit opens every field.
 */
export function BusinessInformation({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const canWrite = useCan('companies:write');
  const [editing, setEditing] = React.useState(false);
  const label = (f: EnrichField) => t.maybe(ENRICH_FIELD_LABELS[f]);
  const src: Sources = c.fieldSources;
  const emails = c.emails.length ? c.emails : c.primaryEmail ? [{ value: c.primaryEmail, primary: true }] : [];
  const phones = c.phones.length ? c.phones : c.primaryPhone ? [{ value: c.primaryPhone, primary: true }] : [];
  const hqLine = [c.address, c.city, c.state, c.postalCode].filter(Boolean).join(', ');
  const profiles = profileLinks(c);

  const stats = [
    c.foundedYear && { icon: CalendarDays, tint: 'primary' as const, label: label('foundedYear'), value: c.foundedYear, source: src.foundedYear, field: 'foundedYear' },
    c.employeeCount !== null && { icon: Users, tint: 'accent' as const, label: label('employeeCount'), value: c.employeeCount.toLocaleString(t.formatLocale), source: src.employeeCount, field: 'employeeCount' },
    c.companySize && { icon: UsersRound, tint: 'info' as const, label: label('companySize'), value: c.companySize, source: src.companySize, field: 'companySize' },
    c.branchCount !== null && { icon: Building, tint: 'success' as const, label: label('branchCount'), value: c.branchCount, source: src.branchCount, field: 'branchCount' },
    c.operatingStatus && { icon: Activity, tint: 'warning' as const, label: label('operatingStatus'), value: t.maybe(c.operatingStatus), source: src.operatingStatus, field: 'operatingStatus' },
  ].filter(Boolean) as { icon: Icon; tint: keyof typeof TINTS; label: string; value: React.ReactNode; source?: FieldSource; field: string }[];

  const overview = has(c.overview) || has(c.legalName) || has(c.industry) || has(c.businessCategory) || has(c.companyType) || has(c.specialties) || has(c.services) || has(c.products) || has(c.industriesServed);
  const locations = has(hqLine) || has(c.country) || has(c.headquarters) || has(c.timezone) || has(c.addresses);
  const contact = has(c.website) || emails.length > 0 || phones.length > 0 || has(c.contactPageUrl);
  const people = has(c.ceo) || has(c.founders) || has(c.leadership) || has(c.parentCompanyName) || has(c.ownership);
  const more = has(c.moreDetails) || has(c.notes);
  const empty = !stats.length && !overview && !locations && !contact && !people && !profiles.length && !has(c.certifications) && !more;
  const editable = canWrite && !c.restricted;
  // Removing one value is an edit of that field (ADR 0097); auto-fill never writes a removed value back.
  const remover = useRemoveValue('companies', c.id);
  const rm = (patch: Record<string, unknown>) => (editable ? () => remover.mutateAsync(patch) : undefined);
  const rmItem = <K extends 'services' | 'products' | 'industriesServed' | 'certifications' | 'founders'>(field: K) =>
    editable ? (item: string) => remover.mutateAsync({ [field]: c[field].filter((x) => x !== item) }) : undefined;
  const pointLinks = (list: { value: string; primary?: boolean }[], kind: 'mailto' | 'tel') => (
    <ul className="space-y-1">
      {list.map((p) => (
        <li key={p.value} className="flex flex-wrap items-center gap-1.5">
          <a className="inline-flex min-h-6 items-center break-all font-medium text-primary hover:underline" href={`${kind}:${p.value}`}>
            {p.value}
          </a>
          {p.primary && list.length > 1 && <Badge className="px-1.5 py-0 text-[10px]">{t('primary')}</Badge>}
          {editable && (
            <RemoveValue
              label={p.value}
              onRemove={() => remover.mutateAsync(kind === 'mailto' ? { emails: emails.filter((e) => e.value !== p.value) } : { phones: phones.filter((e) => e.value !== p.value) })}
            />
          )}
        </li>
      ))}
    </ul>
  );

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
      <CardContent className="space-y-4">
        <AiSummary company={c} />
        {empty && <p className="text-sm text-muted-foreground">{t('No business details yet. Add the website and auto-fill finds the rest, or select Edit.')}</p>}

        {stats.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Company facts')}>
            {stats.map(({ field, ...s }) => (
              <Stat key={s.label} {...s} remove={rm({ [field]: null })} />
            ))}
          </div>
        )}

        {overview && (
          <Section id="overview" icon={Factory} tint="primary" title={t('Overview')}>
            {c.overview && (
              <blockquote className="relative rounded-lg border-s-4 border-primary/60 bg-primary/5 py-2 pe-3 ps-4 text-sm leading-relaxed">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Quote aria-hidden className="size-3.5" /> {label('overview')} <SourceTag source={src.overview} t={t} />
                  {editable && <RemoveValue label={label('overview')} onRemove={() => remover.mutateAsync({ overview: null })} />}
                </span>
                <span className="whitespace-pre-line">{c.overview}</span>
              </blockquote>
            )}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {c.legalName && <Item icon={Landmark} label={label('legalName')} source={src.legalName} remove={rm({ legalName: null })}>{c.legalName}</Item>}
              {c.industry && <Item icon={Factory} label={label('industry')} source={src.industry} remove={rm({ industry: null })}>{c.industry}</Item>}
              {c.businessCategory && <Item icon={Layers} label={label('businessCategory')} source={src.businessCategory} remove={rm({ businessCategory: null })}>{c.businessCategory}</Item>}
              {c.companyType && <Item icon={Building2} label={label('companyType')} source={src.companyType} remove={rm({ companyType: null })}>{t.maybe(c.companyType)}</Item>}
              {c.specialties && <Item icon={Sparkles} label={label('specialties')} source={src.specialties} remove={rm({ specialties: null })} wide>{c.specialties}</Item>}
              {c.services.length > 0 && <Item icon={Briefcase} label={label('services')} source={src.services} wide><Chips items={c.services} tone="primary" onRemove={rmItem('services')} /></Item>}
              {c.products.length > 0 && <Item icon={Package} label={label('products')} source={src.products} wide><Chips items={c.products} tone="accent" onRemove={rmItem('products')} /></Item>}
              {c.industriesServed.length > 0 && <Item icon={Layers} label={label('industriesServed')} source={src.industriesServed} wide><Chips items={c.industriesServed} tone="info" onRemove={rmItem('industriesServed')} /></Item>}
            </dl>
          </Section>
        )}

        {locations && (
          <Section id="locations" icon={MapPin} tint="critical" title={t('HQ & Locations')}>
            {(hqLine || c.country || c.headquarters) && (
              <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-3">
                {c.country ? <CountryFlag code={c.country} className="mt-0.5 text-2xl" /> : <MapPin aria-hidden className="mt-0.5 size-5 text-primary" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    {t('Headquarters')} <SourceTag source={src.address ?? src.headquarters ?? src.country} t={t} />
                    {editable && <RemoveValue label={t('Headquarters')} onRemove={() => remover.mutateAsync({ headquarters: null, address: null, city: null, state: null, postalCode: null })} />}
                  </p>
                  <p className="text-sm font-semibold">{c.headquarters || [c.city, c.country && countryName(c.country, t.formatLocale)].filter(Boolean).join(', ')}</p>
                  {hqLine && <p className="text-sm text-muted-foreground">{hqLine}</p>}
                  {c.timezone && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock aria-hidden className="size-3.5" /> {c.timezone}
                    </p>
                  )}
                </div>
              </div>
            )}
            {c.addresses.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Building aria-hidden className="size-3.5" /> {label('addresses')} ({c.addresses.length}) <SourceTag source={src.addresses} t={t} />
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {c.addresses.map((a, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-background/60 p-3">
                      {a.country ? <CountryFlag code={a.country} className="mt-0.5 text-lg" /> : <MapPin aria-hidden className="mt-0.5 size-4 text-muted-foreground" />}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-semibold">{a.label || [a.city, a.country && countryName(a.country, t.formatLocale)].filter(Boolean).join(', ')}</p>
                        <p className="text-muted-foreground">{[a.address, a.city, a.state, a.postalCode].filter(Boolean).join(', ')}</p>
                      </div>
                      {editable && <RemoveValue label={a.label || a.city || label('addresses')} onRemove={() => remover.mutateAsync({ addresses: c.addresses.filter((_, j) => j !== i) })} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        )}

        {contact && (
          <Section id="contact" icon={Contact} tint="success" title={t('Contact')}>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {c.website && (
                <Item icon={Globe} label={label('website')} source={src.website} remove={rm({ websites: c.websites.filter((w) => w.value !== c.website) })}>
                  <a className="inline-flex min-h-6 items-center break-all font-medium text-primary hover:underline" href={c.website} target="_blank" rel="noopener noreferrer">
                    {short(c.website)}
                  </a>
                </Item>
              )}
              {c.contactPageUrl && (
                <Item icon={Link2} label={label('contactPageUrl')} source={src.contactPageUrl} remove={rm({ contactPageUrl: null })}>
                  <a className="inline-flex min-h-6 items-center break-all font-medium text-primary hover:underline" href={c.contactPageUrl} target="_blank" rel="noopener noreferrer">
                    {short(c.contactPageUrl)}
                  </a>
                </Item>
              )}
              {emails.length > 0 && <Item icon={Mail} label={label('emails')} source={src.emails ?? src.primaryEmail}>{pointLinks(emails, 'mailto')}</Item>}
              {phones.length > 0 && <Item icon={Phone} label={label('phones')} source={src.phones ?? src.primaryPhone}>{pointLinks(phones, 'tel')}</Item>}
            </dl>
          </Section>
        )}

        {people && (
          <Section id="people" icon={Crown} tint="warning" title={t('Leadership & Ownership')}>
            {(c.ceo || c.leadership.length > 0) && (
              <ul className="grid gap-2 sm:grid-cols-2" aria-label={label('leadership')}>
                {c.ceo && !c.leadership.some((l) => l.name === c.ceo) && <Person name={c.ceo} role={label('ceo')} icon={Crown} remove={rm({ ceo: null })} />}
                {c.leadership.map((l, i) => (
                  <Person
                    key={i}
                    name={l.name}
                    role={l.title}
                    icon={l.name === c.ceo ? Crown : undefined}
                    remove={rm({ leadership: c.leadership.filter((_, j) => j !== i), ...(l.name === c.ceo ? { ceo: null } : {}) })}
                  />
                ))}
              </ul>
            )}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {c.founders.length > 0 && <Item icon={UserRound} label={label('founders')} source={src.founders} wide><Chips items={c.founders} tone="warning" onRemove={rmItem('founders')} /></Item>}
              {c.parentCompanyName && <Item icon={Network} label={label('parentCompanyName')} source={src.parentCompanyName} remove={rm({ parentCompanyName: null })}>{c.parentCompanyName}</Item>}
              {c.ownership && <Item icon={Landmark} label={label('ownership')} source={src.ownership} remove={rm({ ownership: null })}>{c.ownership}</Item>}
            </dl>
          </Section>
        )}

        {profiles.length > 0 && (
          <Section id="digital" icon={Share2} tint="info" title={t('Digital presence')}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {label('socialLinks')} <SourceTag source={src.socialLinks ?? src.linkedinUrl} t={t} />
            </p>
            <ul className="flex flex-wrap gap-2" aria-label={t('Online profiles')}>
              {profiles.map((p) => (
                <li key={p.platform} className="inline-flex items-center gap-0.5">
                  <ProfilePill platform={p.platform} url={p.url} name={p.platform === 'website' ? t('Website') : SOCIAL_PLATFORM_LABELS[p.platform]} />
                  {editable && (
                    <RemoveValue
                      label={p.platform === 'website' ? t('Website') : SOCIAL_PLATFORM_LABELS[p.platform]}
                      onRemove={() =>
                        remover.mutateAsync(
                          p.platform === 'website'
                            ? { websites: c.websites.filter((w) => w.value !== p.url) }
                            : p.platform === 'linkedin'
                              ? { linkedinUrls: c.linkedinUrls.filter((w) => w.value !== p.url), socialLinks: c.socialLinks.filter((x) => x.platform !== 'linkedin') }
                              : { socialLinks: c.socialLinks.filter((x) => x.platform !== p.platform) },
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {c.certifications.length > 0 && (
          <Section id="certifications" icon={ShieldCheck} tint="success" title={t('Certifications')}>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {label('certifications')} <SourceTag source={src.certifications} t={t} />
            </p>
            <Chips items={c.certifications} tone="success" icon={BadgeCheck} onRemove={rmItem('certifications')} />
          </Section>
        )}

        {more && (
          <Section id="more" icon={Info} tint="accent" title={t('More details')}>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {c.moreDetails.map((d, i) => (
                <Item key={i} icon={ScrollText} label={d.label} source={i === 0 ? src.moreDetails : undefined} remove={rm({ moreDetails: c.moreDetails.filter((_, j) => j !== i) })}>
                  <span className="whitespace-pre-line">{d.value}</span>
                </Item>
              ))}
              {c.notes && (
                <Item icon={StickyNote} label={t('Remarks')} wide remove={rm({ notes: null })}>
                  <span className="whitespace-pre-line">{c.notes}</span>
                </Item>
              )}
            </dl>
          </Section>
        )}

        {!empty && <p className="text-xs text-muted-foreground">{t('Values marked Auto were found by auto-fill; select one to see where. Everything else was entered by your team.')}</p>}
      </CardContent>
      {editable && <BusinessInfoDialog company={c} open={editing} onOpenChange={setEditing} />}
    </Card>
  );
}

/** The AI summary (ADR 0076): always labelled as AI, with when it was written, and written again on request. */
function AiSummary({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const qc = useQueryClient();
  const canCompanies = useCan('companies:write');
  const canAi = useCan('ai:use');
  const canWrite = canCompanies && canAi && !c.restricted;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!c.aiSummary && !canWrite) return null;
  async function write() {
    setBusy(true);
    setError(null);
    try {
      await api(`/companies/${c.id}/ai-summary`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['companies', 'detail', c.id] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="bi-ai-summary" className="rounded-xl bg-gradient-to-r from-primary/60 via-accent/60 to-primary/40 p-px">
      <div className="space-y-2 rounded-[11px] bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="bi-ai-summary" className="flex items-center gap-2 text-sm font-semibold">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-white">
              <Sparkles aria-hidden className="size-4" />
            </span>
            {t('AI summary')}
            <Badge tone="accent" className="px-1.5 py-0 text-[10px]">
              AI
            </Badge>
          </h3>
          {canWrite && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void write()}>
              <Sparkles aria-hidden /> {busy ? t('Writing…') : c.aiSummary ? t('Write again') : t('Write AI summary')}
            </Button>
          )}
        </div>
        {c.aiSummary ? (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed">{c.aiSummary}</p>
            {c.aiSummaryAt && <p className="text-xs text-muted-foreground">{t('Written by AI from the details below, {when}. Check it before relying on it.', { when: formatDate(c.aiSummaryAt) })}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('A few sentences on what this company does, written by AI from its Business Information.')}</p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
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
  // Fields the Console hides from this level are left out (R8); the server ignores them anyway.
  const hiddenKeys = useHiddenKeys('company');
  const label = (f: EnrichField) => t.maybe(ENRICH_FIELD_LABELS[f]);
  const input = (k: keyof Form & EnrichField, type = 'text', extra: { hint?: string; label?: string } = {}) => hiddenKeys.has(k) ? null : (
    <Field id={`bi-${k}`} label={extra.label ?? label(k)} error={errors[k]} hint={extra.hint}>
      <Input type={type} value={form[k] as string} onChange={(e) => set(k, e.target.value as never)} />
    </Field>
  );
  const area = (k: keyof Form, fieldLabel: string, hint?: string, rows = 3) => hiddenKeys.has(k) ? null : (
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
