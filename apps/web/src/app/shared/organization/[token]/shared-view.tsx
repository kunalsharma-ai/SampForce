'use client';

import { ORG_DOCUMENT_CATEGORY_LABELS, ORG_PREVIEW_TYPES, type OrgSharedView } from '@dealflow/types';
import { Button, cn, Skeleton } from '@dealflow/ui';
import { ArrowUpRight, Building2, Contact, Download, Eye, FileCheck2, Globe, Landmark, Link2Off, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import * as React from 'react';
import { CompanyLogo } from '@/components/crm/company-logo';
import { SocialIconRow } from '@/components/crm/social-icons';
import { AddressCard, ContactLine } from '@/components/my-organization/overview';
import { CATEGORY_STYLE, CopyButton, Fact, FileTypeIcon, formatDay, formatSize, formatWhen, HubCard, TONES } from '@/components/my-organization/parts';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fetchSharedOrganization, sharedFileUrl } from '@/lib/my-organization';

type State = { kind: 'loading' } | { kind: 'missing'; message: string } | { kind: 'ready'; v: OrgSharedView };

/** The client's page: the shared profile sections and approved documents, read-only, with preview and download. */
export function SharedOrganizationView({ token }: { token: string }) {
  const t = useT();
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const loaded = React.useRef(false);

  React.useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    fetchSharedOrganization(token).then(
      (v) => setState({ kind: 'ready', v }),
      (e) => setState({ kind: 'missing', message: e instanceof ApiError && e.status !== 0 ? e.message : t('Could not reach SampForce. Check your connection.') }),
    );
  }, [token, t]);

  if (state.kind === 'loading')
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  if (state.kind === 'missing')
    return (
      <div className="mx-auto mt-16 max-w-md space-y-3 rounded-3xl border border-border bg-surface p-8 text-center shadow-sm">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Link2Off className="size-6" aria-hidden />
        </span>
        <h1 className="text-xl font-bold">{t('This link is not available')}</h1>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <p className="text-sm text-muted-foreground">{t('Ask the person who sent it for a new link.')}</p>
      </div>
    );

  const { v } = state;
  const o = v.organization;
  const has = (s: OrgSharedView['sections'][number]) => v.sections.includes(s);
  const brand = o.brandColors?.[0] ?? null;
  const links = [...(o.website ? [{ label: t('Website'), url: o.website }] : []), ...(o.websiteLinks ?? [])].map((l) => ({ label: l.label, url: l.url }));
  const services = [...(o.services ?? []), ...(o.products ?? [])];
  const facts = [o.companyType, o.foundedYear ? t('Founded {year}', { year: String(o.foundedYear) }) : null, o.employeeCount ? t('{count} people', { count: o.employeeCount.toLocaleString(t.formatLocale) }) : o.companySize].filter((x): x is string => !!x);

  return (
    <div className="space-y-6">
      <section aria-labelledby="shared-org-name" className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div aria-hidden className="absolute inset-x-0 top-0 h-36 [mask-image:linear-gradient(to_bottom,black,transparent)]" style={{ backgroundImage: brand ? `linear-gradient(120deg, ${brand}55, ${brand}18 55%, transparent)` : undefined }}>
          {!brand && <div className="h-full bg-gradient-to-r from-primary/25 via-accent/15 to-transparent" />}
        </div>
        <div className="relative flex flex-wrap items-center gap-5 p-6 sm:p-8">
          <CompanyLogo company={{ name: o.brandName, logo: o.logoUrl ? { url: o.logoUrl, source: 'UPLOAD', status: 'FOUND', width: null } : null }} size="xl" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 id="shared-org-name" className="break-words text-3xl font-extrabold tracking-tight sm:text-4xl">
              {o.brandName}
            </h1>
            {(o.legalName || o.tagline) && (
              <p className="text-muted-foreground">
                {o.legalName && <span className="font-medium text-foreground">{o.legalName}</span>}
                {o.legalName && o.tagline && <span aria-hidden> · </span>}
                {o.tagline}
              </p>
            )}
            {facts.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {facts.map((f) => (
                  <li key={f} className="rounded-full border border-border bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {(v.message || v.sharedBy) && (
          <div className="relative border-t border-border bg-background/50 px-6 py-4 text-sm sm:px-8">
            {v.message && <p className="whitespace-pre-line">{v.message}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {v.sharedBy ? t('Shared by {name}', { name: v.sharedBy }) : null}
              {v.sharedBy ? ' · ' : ''}
              {t('This link works until {when}.', { when: formatWhen(v.expiresAt, t.formatLocale) })}
            </p>
          </div>
        )}
      </section>

      {v.documents.length > 0 && (
        <HubCard title={t('Documents')} icon={FileCheck2} tone="emerald" id="shared-docs">
          <ul className="grid gap-3 sm:grid-cols-2">
            {v.documents.map((d) => {
              const style = CATEGORY_STYLE[d.category];
              const canPreview = ORG_PREVIEW_TYPES.includes(d.contentType);
              return (
                <li key={d.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-background/60 p-4" data-shared-document={d.title}>
                  <div className="flex items-start gap-3">
                    <FileTypeIcon contentType={d.contentType} fileName={d.fileName} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-semibold">{d.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium', TONES[style.tone])}>
                          <style.icon className="size-3" aria-hidden />
                          {t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[d.category])}
                        </span>
                        <span className="text-muted-foreground">{formatSize(d.sizeBytes)}</span>
                      </p>
                    </div>
                  </div>
                  {d.description && <p className="line-clamp-3 text-sm text-muted-foreground">{d.description}</p>}
                  {(d.issueDate || d.expiryDate) && (
                    <p className="text-xs text-muted-foreground">
                      {d.issueDate && t('Issued {date}', { date: formatDay(d.issueDate, t.formatLocale) })}
                      {d.issueDate && d.expiryDate && ' · '}
                      {d.expiryDate && t('Valid until {date}', { date: formatDay(d.expiryDate, t.formatLocale) })}
                    </p>
                  )}
                  <div className="mt-auto flex gap-2">
                    {canPreview && (
                      <Button asChild size="sm" variant="outline">
                        <a href={sharedFileUrl(token, d.id, true)} target="_blank" rel="noopener noreferrer">
                          <Eye className="size-4" aria-hidden /> {t('View')}
                        </a>
                      </Button>
                    )}
                    <Button asChild size="sm">
                      <a href={sharedFileUrl(token, d.id)}>
                        <Download className="size-4" aria-hidden /> {t('Download')}
                      </a>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </HubCard>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {has('overview') && (o.description || o.businessActivities) && (
          <HubCard title={t('About the company')} icon={Building2} id="shared-about" className="md:col-span-2">
            {o.description && <p className="whitespace-pre-line text-sm leading-relaxed">{o.description}</p>}
            {o.businessActivities && <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{o.businessActivities}</p>}
          </HubCard>
        )}
        {has('services') && (services.length > 0 || (o.industriesServed?.length ?? 0) > 0 || (o.certifications?.length ?? 0) > 0) && (
          <HubCard title={t('Services and products')} icon={FileCheck2} tone="violet" id="shared-services" className="md:col-span-2">
            {services.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {services.map((s, i) => (
                  <li key={s} className={cn('rounded-full px-3 py-1 text-xs font-semibold', TONES[(['primary', 'sky', 'emerald', 'violet', 'amber', 'teal'] as const)[i % 6] ?? 'primary'])}>
                    {s}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Fact label="Industries served">{o.industriesServed?.join(', ') || null}</Fact>
              <Fact label="Certifications">{o.certifications?.join(', ') || null}</Fact>
            </dl>
          </HubCard>
        )}
        {has('contact') && ((o.emails?.length ?? 0) > 0 || (o.phones?.length ?? 0) > 0) && (
          <HubCard title={t('Contact details')} icon={Contact} tone="emerald" id="shared-contact">
            <ul className="space-y-2">
              {o.emails?.map((e) => <ContactLine key={e.value} icon={Mail} label={e.label} value={e.value} href={`mailto:${e.value}`} />)}
              {o.phones?.map((p) => <ContactLine key={p.value} icon={Phone} label={p.label} value={p.value} href={`tel:${p.value.replace(/[^+\d]/g, '')}`} />)}
            </ul>
          </HubCard>
        )}
        {has('links') && (links.length > 0 || (o.socialLinks?.length ?? 0) > 0) && (
          <HubCard title={t('Website and links')} icon={Globe} tone="sky" id="shared-links">
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.url} className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2 ps-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.label}</p>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary hover:underline">
                      {l.url.replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  </div>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={t('Open {name}', { name: l.label })} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
                    <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden />
                  </a>
                  <CopyButton value={l.url} label={t('Copy the {name} link', { name: l.label })} compact />
                </li>
              ))}
            </ul>
            {(o.socialLinks?.length ?? 0) > 0 && (
              <div className="mt-3">
                <SocialIconRow company={{ name: o.brandName, website: null, domain: null, linkedinUrl: null, socialLinks: o.socialLinks ?? [] }} size="sm" />
              </div>
            )}
          </HubCard>
        )}
        {has('addresses') && (o.registeredAddress || (o.offices?.length ?? 0) > 0) && (
          <HubCard title={t('Offices')} icon={MapPin} tone="rose" id="shared-offices" className="md:col-span-2">
            <ul className="grid gap-3 sm:grid-cols-2">
              {o.registeredAddress && <AddressCard address={o.registeredAddress} title={t('Registered office')} primary />}
              {o.offices?.map((a, i) => <AddressCard key={i} address={a} title={a.label || t('Office {n}', { n: i + 1 })} />)}
            </ul>
          </HubCard>
        )}
        {(has('registration') || has('tax')) && (o.registrationNumber || (o.taxIds?.length ?? 0) > 0 || o.incorporationDate) && (
          <HubCard title={t('Registration and tax')} icon={Landmark} tone="amber" id="shared-registration">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Registration number">{o.registrationNumber}</Fact>
              <Fact label="Registered with">{o.registrationAuthority}</Fact>
              <Fact label="Incorporated">{o.incorporationDate && formatDay(o.incorporationDate, t.formatLocale)}</Fact>
              {o.taxIds?.map((x) => (
                <div key={x.label} className="min-w-0 space-y-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{x.label}</dt>
                  <dd className="flex items-center gap-2 break-all text-sm font-medium">
                    {x.value} <CopyButton value={x.value} label={t('Copy {name}', { name: x.label })} compact />
                  </dd>
                </div>
              ))}
            </dl>
          </HubCard>
        )}
        {has('key_contacts') && (o.keyContacts?.length ?? 0) > 0 && (
          <HubCard title={t('Key contacts')} icon={UserRound} tone="teal" id="shared-people">
            <ul className="space-y-2">
              {o.keyContacts?.map((c) => (
                <li key={`${c.name}-${c.email ?? ''}`} className="rounded-xl border border-border bg-background/60 p-3 text-sm">
                  <p className="font-semibold">{c.name}</p>
                  {(c.designation || c.department) && <p className="text-xs text-muted-foreground">{[c.designation, c.department].filter(Boolean).join(' · ')}</p>}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                        {c.email}
                      </a>
                    )}
                    {c.phone && <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a>}
                  </p>
                </li>
              ))}
            </ul>
          </HubCard>
        )}
      </div>
      <p className="pb-4 text-center text-xs text-muted-foreground">{t('Shared securely with SampForce')}</p>
    </div>
  );
}
