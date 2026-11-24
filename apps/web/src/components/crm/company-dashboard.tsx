'use client';

import type { CompanyEmployeeRow, CompanyRow } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Skeleton } from '@dealflow/ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  FileSignature,
  FileX2,
  Globe,
  Handshake,
  Linkedin,
  Mail,
  MailOpen,
  MailPlus,
  MapPin,
  MessageSquarePlus,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Send,
  Sparkles,
  Trophy,
  Upload,
  UserPlus,
  UserRoundCog,
  Users,
  UsersRound,
  Wallet,
  ArrowRightLeft,
  MessageSquareWarning,
  Link2,
  UserMinus,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { countryName } from '@/components/forms/locale-data';
import { PageHelp } from '@/components/page-help';
import { InfoTip } from '@/components/info-tip';
import { personLabel } from '@/lib/company-leads';
import { formatMoneyList, useCompanyDashboard, useCompanyEmployees } from '@/lib/company-work';
import { formatDate } from '@/lib/crm';
import { useHasFeature } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { type CompanyAction, useCompanyAction, useCompanyActions } from './company-actions';
import { AddEmployeeDialog, LinkContactDialog } from './company-parts';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from './follow-ups';
import { CompanyLogoEditor } from './company-logo';
import { CountryFlag, StatusChip } from './status-chip';
import { SocialIconRow } from './social-icons';
import { INTERACTION_LABEL } from './work-labels';

const QUICK_ACTIONS: { action: CompanyAction; label: MessageKey; icon: typeof Plus }[] = [
  { action: 'edit', label: 'Edit company', icon: Pencil },
  { action: 'enrich', label: 'Enrich', icon: Sparkles },
  { action: 'aiEmail', label: 'Write email with AI', icon: MailPlus },
  { action: 'addEmployee', label: 'Add employee', icon: UserPlus },
  { action: 'addBranch', label: 'Add branch', icon: Building2 },
  { action: 'addFollowUp', label: 'Add follow-up', icon: CalendarClock },
  { action: 'logInteraction', label: 'Log interaction', icon: MessageSquarePlus },
  { action: 'scheduleCall', label: 'Schedule call', icon: PhoneCall },
  { action: 'addRfq', label: 'Add RFQ', icon: FilePlus2 },
  { action: 'upload', label: 'Upload document', icon: Upload },
  { action: 'changeStatus', label: 'Change status', icon: BadgeCheck },
  { action: 'transfer', label: 'Transfer ownership', icon: UserRoundCog },
  { action: 'requestTransfer', label: 'Request transfer', icon: ArrowRightLeft },
  { action: 'raiseConcern', label: 'Raise concern', icon: MessageSquareWarning },
];

/**
 * The company profile header (section 7.1): the company name is the largest thing on the page, with its logo (and a
 * small country flag on the logo's corner),
 * status, lead number, business facts, contact points, the people responsible and the quick actions.
 */
export function CompanyHero({ company: c, actions }: { company: CompanyRow; actions?: React.ReactNode }) {
  const t = useT();
  const quick = useCompanyActions();
  const country = c.country ? countryName(c.country, t.formatLocale) : null;
  const website = c.website ?? (c.domain ? `https://${c.domain}` : null);
  const facts = [
    c.industry,
    c.companySize && t('{range} employees', { range: c.companySize }),
    c.foundedYear && t('Founded {year}', { year: String(c.foundedYear) }),
  ].filter(Boolean) as string[];
  // The website and LinkedIn are in the profile buttons; the chips are for reaching someone.
  const contact: { href: string; label: string; icon: typeof Globe; external?: boolean; name: MessageKey }[] = [
    ...(website ? [{ href: website.startsWith('http') ? website : `https://${website}`, label: website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), icon: Globe, external: true, name: 'Website' as const }] : []),
    ...(c.primaryEmail ? [{ href: `mailto:${c.primaryEmail}`, label: c.primaryEmail, icon: Mail, name: 'Email' as const }] : []),
    ...(c.primaryPhone ? [{ href: `tel:${c.primaryPhone}`, label: c.primaryPhone, icon: Phone, name: 'Phone' as const }] : []),
  ];
  const place = [c.city, c.state, country].filter(Boolean).join(', ');
  const fullAddress = [c.address, c.city, c.state, c.postalCode, country].filter(Boolean).join(', ');
  const people: [MessageKey, string][] = [
    ['Lead creator', personLabel(c.createdBy)],
    ['Lead owner', personLabel(c.ownerPerson) || c.owner?.name || ''],
    ['Assigned manager', personLabel(c.manager)],
  ];
  return (
    <section aria-labelledby="company-name" className="relative mb-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div aria-hidden className="absolute inset-x-0 top-0 h-48 bg-gradient-to-r from-primary/25 via-accent/15 to-primary/5 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href="/app/companies" className="inline-flex min-h-6 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t('Companies')}
          </Link>
          {actions}
        </div>
        <div className="flex flex-wrap items-start gap-4 sm:gap-5">
          <CompanyLogoEditor company={c} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {c.leadNumber && <span className="rounded-full bg-primary px-2.5 py-0.5 font-mono text-xs font-semibold text-primary-foreground">{c.leadNumber}</span>}
              <StatusChip status={c.status} className="px-2.5 text-xs" />
              {c.statusChangedAt && <span className="text-xs text-muted-foreground">{t('Since {date}', { date: formatDate(c.statusChangedAt) })}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <h1 id="company-name" className="break-words text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
                {c.name}
              </h1>
              <PageHelp />
            </div>
            {(place || c.headquarters) && (
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-medium">
                  {/* The country is written in the line, and the logo badge already names it for screen readers. */}
                  {c.country && <CountryFlag code={c.country} decorative className="text-lg" />}
                  <span>{place || c.headquarters}</span>
                  {(c.address || c.headquarters) && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{t('Headquarters')}</span>
                  )}
                </p>
                {c.address && (
                  <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span className="break-words">{fullAddress}</span>
                  </p>
                )}
              </div>
            )}
            {facts.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 pt-1" aria-label={t('Company facts')}>
                {facts.map((f) => (
                  <li key={f} className="rounded-full border border-border bg-background/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {contact.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t('Contact details')}>
            {contact.map((x) => (
              <li key={x.href}>
                <a
                  href={x.href}
                  {...(x.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 text-sm text-primary hover:border-primary/50 hover:bg-primary/5"
                >
                  <x.icon aria-hidden className="size-4 shrink-0" />
                  <span className="sr-only">{t(x.name)}: </span>
                  <span className="truncate">{x.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
          <SocialIconRow company={c} />
        </div>
        <dl className="grid gap-2 sm:grid-cols-3">
          {people.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border bg-background/60 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{t(label)}</dt>
              <dd className="truncate text-sm font-semibold">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4" role="toolbar" aria-label={t('Quick actions')}>
          {QUICK_ACTIONS.filter((a) => quick.has(a.action)).map((a) => (
            <Button key={a.action} size="sm" variant="outline" className="bg-surface" onClick={() => quick.run(a.action)}>
              <a.icon aria-hidden /> {t(a.label)}
            </Button>
          ))}
          {c.primaryEmail && (
            <Button asChild size="sm" variant="outline" className="bg-surface">
              <a href={`mailto:${c.primaryEmail}`}>
                <Send aria-hidden /> {t('Send email')}
              </a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

const TONES = {
  primary: 'bg-primary/10 text-primary',
  accent: 'bg-accent/10 text-accent',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  critical: 'bg-critical/10 text-critical',
  info: 'bg-info/10 text-info',
} as const;

/** The twelve company KPIs (section 7.2), all counted from CRM records. */
export function CompanyKpis({ companyId }: { companyId: string }) {
  const t = useT();
  const d = useCompanyDashboard(companyId);
  const rfqs = useHasFeature('rfqs');
  const k = d.data?.kpis;
  const tiles: { label: MessageKey; value: React.ReactNode; icon: typeof Users; tone: keyof typeof TONES; note?: string | null; href?: string; rfq?: boolean }[] = [
    { label: 'Employees added', value: k?.employees, icon: Users, tone: 'primary', href: '#company-employees' },
    { label: 'Employees contacted', value: k?.employeesContacted, icon: UsersRound, tone: 'info', href: '#company-employees' },
    { label: 'Emails sent', value: k?.emailsSent, icon: Mail, tone: 'primary', href: '#company-interactions' },
    { label: 'Email responses', value: k?.responsesReceived, icon: MailOpen, tone: 'success', href: '#company-interactions', note: d.data?.syncedEmails.received ? t('{count} synced', { count: d.data.syncedEmails.received }) : null },
    { label: 'Calls made', value: k?.calls, icon: PhoneCall, tone: 'accent', href: '#company-interactions' },
    { label: 'Meetings', value: k?.meetings, icon: CalendarDays, tone: 'accent', href: '#company-interactions' },
    { label: 'Follow-ups pending', value: k?.followUpsPending, icon: ClipboardList, tone: k?.followUpsOverdue ? 'critical' : 'warning', href: '#company-follow-ups', note: k?.followUpsOverdue ? t('{count} overdue', { count: k.followUpsOverdue }) : null },
    { label: 'RFQs received', value: k?.rfqsReceived, icon: FileSignature, tone: 'info', href: '#company-rfqs', rfq: true },
    { label: 'RFQs submitted', value: k?.rfqsSubmitted, icon: Send, tone: 'primary', href: '#company-rfqs', rfq: true },
    { label: 'RFQs won', value: k?.rfqsWon, icon: Trophy, tone: 'success', href: '#company-rfqs', rfq: true },
    { label: 'RFQs lost', value: k?.rfqsLost, icon: FileX2, tone: 'critical', href: '#company-rfqs', rfq: true },
    { label: 'Business generated', value: k ? formatMoneyList(k.businessGenerated, t.formatLocale) : undefined, icon: Wallet, tone: 'success' },
  ];
  return (
    <section aria-labelledby="company-kpis" className="mb-4">
      <h2 id="company-kpis" className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {t('Company performance')}
        <InfoTip topic="crm.companyKpis" />
      </h2>
      {d.error ? (
        <p role="alert" className="text-sm text-critical">
          {d.error.message}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {tiles
            .filter((x) => rfqs || !x.rfq)
            .map((x) => {
              const body = (
                <>
                  <span className={cn('flex size-9 items-center justify-center rounded-lg', TONES[x.tone])}>
                    <x.icon aria-hidden className="size-4.5" />
                  </span>
                  <span className="mt-2 block text-xs text-muted-foreground">{t(x.label)}</span>
                  <span className="mt-0.5 block break-words text-2xl font-bold tabular-nums leading-tight">{d.isPending ? <Skeleton className="h-7 w-10" /> : (x.value ?? 0)}</span>
                  {x.note && <span className="block text-xs font-medium text-critical">{x.note}</span>}
                </>
              );
              return (
                <li key={x.label} className="relative rounded-xl border border-border bg-surface p-3 shadow-sm transition hover:border-primary/40 hover:shadow">
                  {x.href ? (
                    <a href={x.href} className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${t(x.label)}: ${typeof x.value === 'number' ? x.value : (x.value ?? 0)}`}>
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

/** Company-wide business information (section 7.4). */
export function CompanyBusiness({ companyId }: { companyId: string }) {
  const t = useT();
  const d = useCompanyDashboard(companyId);
  const rfqs = useHasFeature('rfqs');
  if (d.isPending) return <Skeleton className="h-40" />;
  if (!d.data) return null;
  const { business: b, kpis: k, latestUpdate: last, nextAction: next } = d.data;
  const rows: [MessageKey, React.ReactNode, boolean?][] = [
    ['Business opportunities', b.opportunities],
    ['Open opportunities', b.open],
    ['Won opportunities', b.won],
    ['Lost opportunities', b.lost],
    ['RFQs received', k.rfqsReceived, true],
    ['RFQ quotations submitted', k.rfqsSubmitted, true],
    ['Total quoted value', formatMoneyList(b.quotedValue, t.formatLocale), true],
    ['Total won revenue', formatMoneyList(b.wonRevenue, t.formatLocale)],
    ['Outstanding deal value', formatMoneyList(b.outstanding, t.formatLocale)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Handshake aria-hidden className="size-4" /> {t('Business overview')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {rows
            .filter(([, , rfq]) => rfqs || !rfq)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{t(label)}</dt>
                <dd className="font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">{t('Latest operational update')}</p>
            {last ? (
              <>
                <p className="mt-1 font-medium">{last.subject}</p>
                <p className="text-xs text-muted-foreground">
                  {[last.kind === 'EMAIL_SYNCED' ? t('Synced from mailbox') : last.kind in INTERACTION_LABEL ? t(INTERACTION_LABEL[last.kind as keyof typeof INTERACTION_LABEL]) : null, formatDateTime(last.at), last.by].filter(Boolean).join(' · ')}
                </p>
              </>
            ) : (
              <p className="mt-1 text-muted-foreground">{t('Nothing logged yet.')}</p>
            )}
          </div>
          <div className={cn('rounded-xl border p-3 text-sm', next && new Date(next.at).getTime() < Date.now() ? 'border-critical/50 bg-critical/5' : 'border-primary/30 bg-primary/5')}>
            <p className="text-xs font-medium text-muted-foreground">{t('Next scheduled action')}</p>
            {next ? (
              <>
                <p className="mt-1 font-medium">{next.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[next.kind === 'RFQ_DEADLINE' ? t('RFQ submission deadline') : t('Follow-up'), formatDateTime(next.at)].join(' · ')}
                </p>
              </>
            ) : (
              <p className="mt-1 text-muted-foreground">{t('Nothing scheduled.')}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = 'name' | 'status' | 'emailsSent' | 'responsesReceived' | 'lastUpdateAt' | 'nextFollowUpAt';

/** The employee directory (section 7.3): every employee with their numbers, sortable and filterable. */
/**
 * The company's employees / POCs with everything to manage them in place (ADR 0066): add a new one, add an existing
 * contact, edit, or take one off the company. Each is a contact record; nothing here deletes one.
 */
export function CompanyEmployeeDirectory({ company, compact = false }: { company: CompanyRow; compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan('contacts:write') && !company.restricted;
  const rows = useCompanyEmployees(company.id);
  const [adding, setAdding] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const unlink = async (id: string) => {
    setRemoveError(null);
    try {
      await api(`/contacts/${id}`, { method: 'PATCH', json: { companyId: null } });
      setRemoving(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ['company-employees'] }), qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['company-dashboard'] }), qc.invalidateQueries({ queryKey: ['companies'] })]);
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  useCompanyAction('addEmployee', canWrite ? () => setAdding(true) : null);
  const statuses = [...new Map((rows.data ?? []).filter((r) => r.status).map((r) => [r.status!.id, r.status!])).values()];
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (rows.data ?? []).filter(
      (r) => (!status || r.status?.id === status) && (!needle || [r.name, r.jobTitle, r.email, r.phone, r.owner?.name].some((x) => x?.toLowerCase().includes(needle))),
    );
    const val = (r: CompanyEmployeeRow): string | number => (sort.key === 'name' ? r.name.toLowerCase() : sort.key === 'status' ? (r.status?.name ?? '').toLowerCase() : (r[sort.key] ?? (sort.desc ? '' : '￿')));
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
    });
  }, [rows.data, q, status, sort]);
  const header = (key: SortKey, label: MessageKey, className?: string) => {
    const active = sort.key === key;
    const Icon = sort.desc ? ArrowDown : ArrowUp;
    return (
      <th scope="col" aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={cn('px-2 py-2 text-start font-medium', className)}>
        <button type="button" className="inline-flex min-h-6 items-center gap-1 hover:text-foreground" onClick={() => setSort({ key, desc: active ? !sort.desc : key !== 'name' && key !== 'status' })}>
          {t(label)}
          {active && <Icon aria-hidden className="size-3" />}
        </button>
      </th>
    );
  };
  return (
    <Card id="company-employees">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Employees / POCs')} {rows.data ? <span className="text-muted-foreground">({rows.data.length})</span> : null}
          <InfoTip topic="crm.employees" />
        </CardTitle>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
              <Link2 aria-hidden /> {t('Add an existing contact')}
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> {t('Add employee / POC')}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!!rows.data?.length && (
          <div className="flex flex-wrap gap-2">
            <Input aria-label={t('Search employees')} placeholder={t('Search employees')} className="h-9 w-56" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label={t('Employee status')} className="h-9 rounded-md border border-input bg-surface px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('All statuses')}</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {t.maybe(s.name)}
                </option>
              ))}
            </select>
          </div>
        )}
        {rows.isPending ? (
          <Skeleton className="h-16" />
        ) : !rows.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('No employees at this company yet.')}</p>
        ) : (
          <div className="relative -mx-2 overflow-x-auto">
            <table className={cn('w-full text-sm', compact ? 'min-w-[760px]' : 'min-w-[960px]')} aria-label={t('Employees / POCs')}>
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  {header('name', 'Employee')}
                  {header('status', 'Status')}
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t('Contact')}
                  </th>
                  {header('emailsSent', 'Emails sent', 'text-end')}
                  {header('responsesReceived', 'Responses', 'text-end')}
                  {header('lastUpdateAt', 'Last update')}
                  {header('nextFollowUpAt', 'Next follow-up')}
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t('Assigned executive')}
                  </th>
                  {!compact && (
                    <th scope="col" className="px-2 py-2 text-start font-medium">
                      {t('Remarks')}
                    </th>
                  )}
                  {canWrite && (
                    <th scope="col" className="px-2 py-2 text-end font-medium">
                      <span className="sr-only">{t('Actions')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-muted/40">
                    <td className="px-2 py-2">
                      <Link href={`/app/contacts/${r.id}`} className="inline-flex min-h-6 items-center font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                      {r.jobTitle && <p className="text-xs text-muted-foreground">{r.jobTitle}</p>}
                    </td>
                    <td className="px-2 py-2">
                      <StatusChip status={r.status} />
                    </td>
                    <td className="space-y-0.5 px-2 py-2 text-xs">
                      {r.email && (
                        <a className="flex min-h-6 items-center gap-1 break-all text-primary hover:underline" href={`mailto:${r.email}`}>
                          <Mail aria-hidden className="size-3.5 shrink-0" /> {r.email}
                        </a>
                      )}
                      {r.phone && (
                        <a className="flex min-h-6 items-center gap-1 hover:underline" href={`tel:${r.phone}`}>
                          <Phone aria-hidden className="size-3.5 shrink-0" /> {r.phone}
                        </a>
                      )}
                      {r.linkedinUrl && (
                        <a className="flex min-h-6 items-center gap-1 text-primary hover:underline" href={r.linkedinUrl} target="_blank" rel="noopener noreferrer">
                          <Linkedin aria-hidden className="size-3.5 shrink-0" /> {t('LinkedIn')}
                        </a>
                      )}
                      {!r.details && <span className="text-muted-foreground">{t('Details hidden')}</span>}
                    </td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.emailsSent}</td>
                    <td className="px-2 py-2 text-end tabular-nums">{r.responsesReceived}</td>
                    <td className="px-2 py-2 text-xs">{formatDate(r.lastUpdateAt)}</td>
                    <td className={cn('px-2 py-2 text-xs', r.nextFollowUpAt && new Date(r.nextFollowUpAt).getTime() < Date.now() && 'font-semibold text-critical')}>{formatDate(r.nextFollowUpAt)}</td>
                    <td className="px-2 py-2 text-xs">{personLabel(r.owner) || '—'}</td>
                    {!compact && (
                      <td className="max-w-[14rem] px-2 py-2 text-xs text-muted-foreground">
                        <span className="line-clamp-2">{r.remarks || '—'}</span>
                      </td>
                    )}
                    {canWrite && (
                      <td className="whitespace-nowrap px-2 py-1 text-end">
                        {removing === r.id ? (
                          <span className="inline-flex items-center gap-1">
                            <Button size="sm" variant="outline" onClick={() => void unlink(r.id)}>
                              {t('Remove from {company}', { company: company.name })}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                              {t('Cancel')}
                            </Button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Button size="sm" variant="ghost" disabled={!r.details} aria-label={t('Edit {name}', { name: r.name })} onClick={() => setEditId(r.id)}>
                              <Pencil aria-hidden />
                            </Button>
                            <Button size="sm" variant="ghost" aria-label={t('Remove {name} from this company', { name: r.name })} onClick={() => setRemoving(r.id)}>
                              <UserMinus aria-hidden />
                            </Button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <p className="px-2 py-3 text-sm text-muted-foreground">{t('No employees match these filters.')}</p>}
          </div>
        )}
      </CardContent>
      {removeError && (
        <p role="alert" className="px-6 pb-4 text-sm text-critical">
          {removeError}
        </p>
      )}
      <AddEmployeeDialog company={company} open={adding} onOpenChange={setAdding} />
      <AddEmployeeDialog company={company} open={!!editId} contactId={editId} onOpenChange={(o) => !o && setEditId(null)} />
      <LinkContactDialog company={company} open={linking} onOpenChange={setLinking} />
    </Card>
  );
}

