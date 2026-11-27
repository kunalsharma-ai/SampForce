'use client';

import { type OrgOverview, WORKSPACE_LEVEL_LABEL } from '@dealflow/types';
import { Button, cn, Skeleton } from '@dealflow/ui';
import { Activity, AlarmClock, Building2, CheckCircle2, Eye, FileStack, KeyRound, LayoutGrid, Link2, Pencil, Send, Share2, Upload, UserRoundCog } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { CompanyLogo } from '@/components/crm/company-logo';
import { CountryFlag } from '@/components/crm/status-chip';
import { PageHelp } from '@/components/page-help';
import { type MessageKey, useT } from '@/lib/i18n';
import { useOrgOverview } from '@/lib/my-organization';
import { ActivityPanel } from './activity';
import { CredentialsPanel } from './credentials';
import { DocumentsPanel } from './documents';
import { OverviewPanel } from './overview';
import { CompletenessRing, TONES, type Tone } from './parts';
import { LogoMenu, ProfileForm } from './profile-form';
import { SharePanel, ShareDialog } from './shares';

export type HubTab = 'overview' | 'profile' | 'documents' | 'credentials' | 'shares' | 'activity';
const TABS: { key: HubTab; label: MessageKey; icon: typeof LayoutGrid }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'profile', label: 'Company profile', icon: Building2 },
  { key: 'documents', label: 'Documents', icon: FileStack },
  { key: 'credentials', label: 'Credentials', icon: KeyRound },
  { key: 'shares', label: 'Client shares', icon: Share2 },
  { key: 'activity', label: 'Activity history', icon: Activity },
];

/**
 * My Organization (ADR 0100): the organisation's own company hub. One record for every workspace: the Super and
 * Manager Workspaces keep it up to date, everyone uses it and shares the approved parts with clients.
 */
export function OrganizationHub() {
  const t = useT();
  const overview = useOrgOverview();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'overview') as HubTab;
  const [sharing, setSharing] = React.useState<string[] | null>(null);
  const go = React.useCallback(
    (next: HubTab, extra: Record<string, string> = {}) => {
      const qs = new URLSearchParams({ ...(next === 'overview' ? {} : { tab: next }), ...extra }).toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [pathname, router],
  );

  if (overview.isPending) return <HubSkeleton />;
  if (overview.isError || !overview.data) return <p className="rounded-xl border border-critical/40 bg-critical/5 p-4 text-sm">{t('Could not load My Organization. Refresh to try again.')}</p>;
  const o = overview.data;
  const tabs = TABS.filter((x) => x.key !== 'credentials' || o.access.canSeeCredentials);

  return (
    <div className="space-y-6">
      <HubHeader o={o} onEdit={() => go('profile')} onUpload={() => go('documents', { upload: '1' })} onShare={() => setSharing([])} />
      <StatStrip o={o} go={go} />
      <nav aria-label={t('My Organization sections')} className="-mx-1 overflow-x-auto px-1 pb-1">
        <div role="tablist" className="inline-flex min-w-full gap-1 rounded-2xl border border-border bg-surface p-1 shadow-sm sm:min-w-0">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`org-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`org-panel-${key}`}
              onClick={() => go(key)}
              className={cn(
                'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === key ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
      </nav>
      <div role="tabpanel" id={`org-panel-${tab}`} aria-labelledby={`org-tab-${tab}`}>
        {tab === 'overview' && <OverviewPanel o={o} go={go} onShare={(ids) => setSharing(ids)} />}
        {tab === 'profile' && (o.access.canEdit ? <ProfileForm profile={o.profile} onSaved={() => go('overview')} /> : <ReadOnlyNote />)}
        {tab === 'documents' && <DocumentsPanel access={o.access} onShare={(ids) => setSharing(ids)} />}
        {tab === 'credentials' && o.access.canSeeCredentials && <CredentialsPanel access={o.access} />}
        {tab === 'shares' && <SharePanel onShare={() => setSharing([])} canManage={o.access.canEdit} />}
        {tab === 'activity' && <ActivityPanel />}
      </div>
      {sharing && <ShareDialog open profileReady={o.profile.exists} preselected={sharing} onOpenChange={(v) => !v && setSharing(null)} onDone={() => go('shares')} />}
    </div>
  );
}

function HubHeader({ o, onEdit, onUpload, onShare }: { o: OrgOverview; onEdit: () => void; onUpload: () => void; onShare: () => void }) {
  const t = useT();
  const p = o.profile;
  const brand = p.brandColors[0] ?? null;
  const place = [p.registeredAddress?.city, p.registeredAddress?.state].filter(Boolean).join(', ');
  const facts = [
    p.companyType,
    p.foundedYear ? t('Founded {year}', { year: String(p.foundedYear) }) : null,
    p.employeeCount ? t('{count} people', { count: p.employeeCount.toLocaleString(t.formatLocale) }) : p.companySize,
    p.registrationNumber ? t('Reg. no. {number}', { number: p.registrationNumber }) : null,
  ].filter((v): v is string => !!v);
  return (
    <section aria-labelledby="org-name" className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        style={{ backgroundImage: brand ? `linear-gradient(120deg, ${brand}55, ${brand}18 55%, transparent)` : undefined }}
      >
        {!brand && <div className="h-full bg-gradient-to-r from-primary/25 via-accent/15 to-transparent" />}
      </div>
      <div aria-hidden className="pointer-events-none absolute -end-16 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-wrap items-start gap-5 p-5 sm:p-7">
        <div className="relative">
          <CompanyLogo company={{ name: p.brandName || '?', logo: p.logoUrl ? { url: p.logoUrl, source: 'UPLOAD', status: 'FOUND', width: null } : null, country: p.incorporationCountry ?? p.registeredAddress?.country ?? null }} size="xl" flag />
          {o.access.canEdit && p.exists && <LogoMenu hasLogo={!!p.logoUrl} />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
              <Building2 className="size-3.5" aria-hidden /> {t('Our organization')}
            </span>
            <AccessChip o={o} />
          </div>
          <div className="flex items-center gap-1.5">
            <h1 id="org-name" className="break-words text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              {p.brandName || t('My Organization')}
            </h1>
            <PageHelp />
          </div>
          {(p.legalName || p.tagline) && (
            <p className="text-base text-muted-foreground">
              {p.legalName && <span className="font-medium text-foreground">{p.legalName}</span>}
              {p.legalName && p.tagline && <span aria-hidden> · </span>}
              {p.tagline}
            </p>
          )}
          <ul className="flex flex-wrap items-center gap-1.5 pt-1" aria-label={t('Company facts')}>
            {place && (
              <li className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-2.5 py-0.5 text-xs font-medium">
                {p.registeredAddress?.country && <CountryFlag code={p.registeredAddress.country} decorative />}
                {place}
              </li>
            )}
            {facts.map((f) => (
              <li key={f} className="rounded-full border border-border bg-background/70 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:items-end">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/70 p-3">
            <CompletenessRing value={p.completeness} />
            <div className="text-sm">
              <p className="font-semibold">{t('Profile completeness')}</p>
              <p className="max-w-[12rem] text-xs text-muted-foreground">{p.missing.length ? t('Next: {field}', { field: t.maybe(p.missing[0]!) }) : t('Everything important is filled in.')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button onClick={onShare} disabled={!p.exists}>
              <Send className="size-4" aria-hidden /> {t('Share with a client')}
            </Button>
            {o.access.canEdit && (
              <>
                <Button variant="outline" onClick={onUpload}>
                  <Upload className="size-4" aria-hidden /> {t('Upload document')}
                </Button>
                <Button variant="outline" onClick={onEdit}>
                  <Pencil className="size-4" aria-hidden /> {p.exists ? t('Edit profile') : t('Set up profile')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccessChip({ o }: { o: OrgOverview }) {
  const t = useT();
  const level = t.maybe(WORKSPACE_LEVEL_LABEL[o.access.level]);
  return o.access.canEdit ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-500/30 dark:text-emerald-300">
      <UserRoundCog className="size-3.5" aria-hidden /> {t('{level}: you can edit', { level })}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-sky-500/30 dark:text-sky-300">
      <Eye className="size-3.5" aria-hidden /> {t('{level}: view and share', { level })}
    </span>
  );
}

function StatStrip({ o, go }: { o: OrgOverview; go: (tab: HubTab, extra?: Record<string, string>) => void }) {
  const t = useT();
  const stats: { label: MessageKey; value: number; icon: typeof FileStack; tone: Tone; onClick: () => void; hint?: string }[] = [
    { label: 'Documents', value: o.documents.total, icon: FileStack, tone: 'primary', onClick: () => go('documents') },
    { label: 'Approved for clients', value: o.documents.shareable, icon: CheckCircle2, tone: 'emerald', onClick: () => go('documents', { shareable: 'true' }) },
    {
      label: 'Expiring soon',
      value: o.documents.expiringSoon + o.documents.expired,
      icon: AlarmClock,
      tone: o.documents.expired ? 'rose' : 'amber',
      onClick: () => go('documents', { expiry: o.documents.expired ? 'expired' : 'expiring' }),
      hint: o.documents.expired ? t('{count} expired', { count: o.documents.expired }) : undefined,
    },
    ...(o.credentials !== null ? [{ label: 'Credentials' as MessageKey, value: o.credentials, icon: KeyRound, tone: 'violet' as Tone, onClick: () => go('credentials') }] : []),
    { label: 'Active client links', value: o.shares.active, icon: Link2, tone: 'sky', onClick: () => go('shares') },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('At a glance')}>
      {stats.map((s) => (
        <li key={s.label}>
          <button
            type="button"
            onClick={s.onClick}
            className="group flex h-full w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', TONES[s.tone])}>
              <s.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-2xl font-bold tabular-nums leading-tight">{s.value.toLocaleString(t.formatLocale)}</span>
              <span className="block truncate text-xs font-medium text-muted-foreground">{t(s.label)}</span>
              {s.hint && <span className="block text-xs font-semibold text-rose-700 dark:text-rose-300">{s.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReadOnlyNote() {
  const t = useT();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/5 p-5 text-sm">
      <Eye className="mt-0.5 size-5 shrink-0 text-sky-600" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">{t('You can view and share this profile')}</p>
        <p className="text-muted-foreground">{t('The Super and Manager Workspaces keep the organization profile up to date. Ask them if something needs changing.')}</p>
      </div>
    </div>
  );
}

function HubSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-48 rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}
