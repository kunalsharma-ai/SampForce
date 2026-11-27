'use client';

import { ORG_DOCUMENT_CATEGORY_LABELS, ORG_SHARE_SECTION_LABELS, type OrgAddress, type OrgOverview } from '@dealflow/types';
import { Button, cn } from '@dealflow/ui';
import { AlarmClock, ArrowUpRight, Building2, ClipboardList, Contact, FileCheck2, Globe, Landmark, Mail, MapPin, Phone, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import * as React from 'react';
import { countryName } from '@/components/forms/locale-data';
import { SocialIconRow } from '@/components/crm/social-icons';
import { CountryFlag } from '@/components/crm/status-chip';
import { useT } from '@/lib/i18n';
import { useOrgDocuments } from '@/lib/my-organization';
import { RecentActivity } from './activity';
import type { HubTab } from './hub';
import { CATEGORY_STYLE, CopyButton, EmptyState, ExpiryBadge, Fact, FileTypeIcon, HubCard, TONES } from './parts';

/** The hub's first page: everything important about the organisation, each part in its own card. */
export function OverviewPanel({ o, go, onShare }: { o: OrgOverview; go: (tab: HubTab, extra?: Record<string, string>) => void; onShare: (ids: string[]) => void }) {
  const t = useT();
  const p = o.profile;
  if (!p.exists) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t('Set up your organization once, for every workspace')}
        text={t('Add your company details, website links, documents and credentials here. Every workspace uses this one record and can share the approved parts with clients.')}
        action={o.access.canEdit ? <Button onClick={() => go('profile')}>{t('Set up profile')}</Button> : <p className="text-sm text-muted-foreground">{t('The Super Workspace has not set it up yet.')}</p>}
      />
    );
  }
  const links: { label: string; url: string }[] = [...(p.website ? [{ label: t('Website'), url: p.website }] : []), ...p.websiteLinks.map((l) => ({ label: l.label, url: l.url }))];
  const services = [...p.services, ...p.products];
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <HubCard title={t('About the company')} icon={Building2} id="org-about">
          {p.description ? <p className="whitespace-pre-line text-sm leading-relaxed">{p.description}</p> : <p className="text-sm text-muted-foreground">{t('No description yet.')}</p>}
          {p.businessActivities && (
            <div className="mt-4 rounded-xl bg-muted/50 p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Business activities')}</p>
              <p className="whitespace-pre-line text-sm">{p.businessActivities}</p>
            </div>
          )}
          {services.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Services and products')}</p>
              <ul className="flex flex-wrap gap-1.5">
                {services.map((s, i) => (
                  <li key={s} className={cn('rounded-full px-3 py-1 text-xs font-semibold', TONES[(['primary', 'sky', 'emerald', 'violet', 'amber', 'teal'] as const)[i % 6] ?? 'primary'])}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(p.industriesServed.length > 0 || p.certifications.length > 0) && (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <Fact label="Industries served">{p.industriesServed.join(', ') || null}</Fact>
              <Fact label="Certifications">{p.certifications.join(', ') || null}</Fact>
            </dl>
          )}
        </HubCard>

        <div className="grid gap-5 md:grid-cols-2">
          <HubCard title={t('Website and links')} icon={Globe} tone="sky" id="org-links">
            {links.length || p.socialLinks.length ? (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {links.map((l) => (
                    <li key={l.url} className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2 ps-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.label}</p>
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary hover:underline">
                          {l.url.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      </div>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={t('Open {name}', { name: l.label })} className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                        <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden />
                      </a>
                      <CopyButton value={l.url} label={t('Copy the {name} link', { name: l.label })} compact />
                    </li>
                  ))}
                </ul>
                <SocialIconRow company={{ name: p.brandName, website: null, domain: null, linkedinUrl: null, socialLinks: p.socialLinks }} size="sm" />
                {p.socialLinks.length > 0 && (
                  <ul className="space-y-1">
                    {p.socialLinks.map((s) => (
                      <li key={s.url} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{s.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                        <CopyButton value={s.url} label={t('Copy the {name} link', { name: s.platform })} compact />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('No links yet.')}</p>
            )}
          </HubCard>

          <HubCard title={t('Contact details')} icon={Contact} tone="emerald" id="org-contact">
            {p.phones.length || p.emails.length ? (
              <ul className="space-y-2">
                {p.emails.map((e) => (
                  <ContactLine key={e.value} icon={Mail} label={e.label} value={e.value} href={`mailto:${e.value}`} />
                ))}
                {p.phones.map((ph) => (
                  <ContactLine key={ph.value} icon={Phone} label={ph.label} value={ph.value} href={`tel:${ph.value.replace(/[^+\d]/g, '')}`} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('No phone numbers or emails yet.')}</p>
            )}
          </HubCard>
        </div>

        <HubCard title={t('Offices')} icon={MapPin} tone="rose" id="org-offices">
          {p.registeredAddress || p.offices.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {p.registeredAddress && <AddressCard address={p.registeredAddress} title={t('Registered office')} primary />}
              {p.offices.map((a, i) => (
                <AddressCard key={i} address={a} title={a.label ?? t('Office')} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('No addresses yet.')}</p>
          )}
        </HubCard>

        <HubCard title={t('Key contact persons')} icon={UserRound} tone="violet" id="org-people">
          {p.keyContacts.length ? (
            <ul className="grid gap-3 sm:grid-cols-2">
              {p.keyContacts.map((k) => (
                <li key={`${k.name}-${k.email ?? ''}`} className="flex gap-3 rounded-xl border border-border bg-background/60 p-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold text-white" aria-hidden>
                    {k.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 space-y-0.5 text-sm">
                    <p className="font-semibold">{k.name}</p>
                    {(k.designation || k.department) && <p className="text-xs text-muted-foreground">{[k.designation, k.department].filter(Boolean).join(' · ')}</p>}
                    {k.email && (
                      <a href={`mailto:${k.email}`} className="block truncate text-xs text-primary hover:underline">
                        {k.email}
                      </a>
                    )}
                    {k.phone && <p className="text-xs">{k.phone}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('No key contacts yet.')}</p>
          )}
        </HubCard>
      </div>

      <div className="space-y-5">
        <HubCard title={t('Registration and tax')} icon={Landmark} tone="amber" id="org-registration">
          <dl className="grid gap-3">
            <Fact label="Registration number">
              {p.registrationNumber && (
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono">{p.registrationNumber}</span>
                  <CopyButton value={p.registrationNumber} label={t('Copy the registration number')} compact />
                </span>
              )}
            </Fact>
            <Fact label="Registered with">{p.registrationAuthority}</Fact>
            <Fact label="Incorporated">
              {[p.incorporationDate, p.incorporationCountry ? countryName(p.incorporationCountry, t.formatLocale) : null].filter(Boolean).join(' · ') || null}
            </Fact>
            {p.taxIds.map((x) => (
              <div key={`${x.label}-${x.value}`} className="space-y-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{x.label}</dt>
                <dd className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span className="break-all font-mono">{x.value}</span>
                  <CopyButton value={x.value} label={t('Copy {name}', { name: x.label })} compact />
                </dd>
              </div>
            ))}
            {p.moreDetails.map((x) => (
              <div key={`${x.label}-${x.value}`} className="space-y-0.5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{x.label}</dt>
                <dd className="break-words text-sm font-medium">{x.value}</dd>
              </div>
            ))}
          </dl>
          {!p.registrationNumber && !p.taxIds.length && !p.incorporationDate && <p className="text-sm text-muted-foreground">{t('No registration details yet.')}</p>}
        </HubCard>

        <AttentionCard go={go} />

        <HubCard title={t('Approved for clients')} icon={ShieldCheck} tone="emerald" id="org-approved">
          <p className="mb-3 text-xs text-muted-foreground">{t('Only these parts of the profile reach a client through a share link. Credentials never do.')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {p.sharedSections.map((s) => (
              <li key={s} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                <FileCheck2 className="size-3.5" aria-hidden /> {t.maybe(ORG_SHARE_SECTION_LABELS[s])}
              </li>
            ))}
          </ul>
          <ApprovedDocuments onShare={onShare} />
        </HubCard>

        <HubCard title={t('Recent activity')} icon={ClipboardList} tone="slate" id="org-recent" action={<Button variant="ghost" size="sm" onClick={() => go('activity')}>{t('See all')}</Button>}>
          <RecentActivity limit={6} />
        </HubCard>
      </div>
    </div>
  );
}

export function ContactLine({ icon: Icon, label, value, href }: { icon: typeof Mail; label: string | null; value: string; href: string }) {
  const t = useT();
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2 ps-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        {label && <p className="text-xs text-muted-foreground">{label}</p>}
        <a href={href} className="block truncate text-sm font-medium hover:underline">
          {value}
        </a>
      </div>
      <CopyButton value={value} label={t('Copy {name}', { name: value })} compact />
    </li>
  );
}

export function AddressCard({ address: a, title, primary = false }: { address: OrgAddress; title: string; primary?: boolean }) {
  const t = useT();
  const line = [a.address, a.city, a.state, a.postalCode, a.country ? countryName(a.country, t.formatLocale) : null].filter(Boolean).join(', ');
  return (
    <li className={cn('space-y-1 rounded-xl border p-3', primary ? 'border-rose-500/30 bg-rose-500/5' : 'border-border bg-background/60')}>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        {a.country && <CountryFlag code={a.country} decorative />}
        {title}
      </p>
      <p className="text-sm text-muted-foreground">{line || '—'}</p>
      {line && <CopyButton value={line} label={t('Copy the address')} />}
    </li>
  );
}

function AttentionCard({ go }: { go: (tab: HubTab, extra?: Record<string, string>) => void }) {
  const t = useT();
  const docs = useOrgDocuments({ sort: 'expiry' });
  const due = (docs.data ?? []).filter((d) => d.expiry === 'expired' || d.expiry === 'expiring').slice(0, 5);
  if (!due.length) return null;
  return (
    <HubCard title={t('Needs renewal')} icon={AlarmClock} tone="rose" id="org-renewal">
      <ul className="space-y-2">
        {due.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => go('documents', { document: d.id })} className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/60 p-2.5 text-start hover:border-primary/40">
              <FileTypeIcon contentType={d.file.contentType} fileName={d.file.fileName} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{d.title}</span>
                <ExpiryBadge expiry={d.expiry} daysLeft={d.daysLeft} expiryDate={d.expiryDate} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </HubCard>
  );
}

function ApprovedDocuments({ onShare }: { onShare: (ids: string[]) => void }) {
  const t = useT();
  const docs = useOrgDocuments({ shareable: 'true' });
  const list = (docs.data ?? []).slice(0, 6);
  if (!list.length) return null;
  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Documents ready to share')}</p>
      <ul className="space-y-1.5">
        {list.map((d) => {
          const style = CATEGORY_STYLE[d.category];
          return (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <span className={cn('inline-flex size-6 items-center justify-center rounded-md', TONES[style.tone])}>
                <style.icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate" title={t.maybe(ORG_DOCUMENT_CATEGORY_LABELS[d.category])}>
                {d.title}
              </span>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="outline" className="w-full" onClick={() => onShare(list.map((d) => d.id))}>
        {t('Share these with a client')}
      </Button>
    </div>
  );
}

