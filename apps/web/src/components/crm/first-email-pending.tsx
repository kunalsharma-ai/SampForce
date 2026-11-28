'use client';

import {
  type FirstEmailPeriod,
  type FirstEmailRow,
  type FirstEmailStatus,
  type InitialEmailSource,
} from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  Clock3,
  Hourglass,
  MailCheck,
  MailQuestion,
  MailWarning,
  PenLine,
  Search,
  Send,
  Sparkles,
  UserRound,
  UserRoundX,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { ComposeDialog } from '@/app/app/communication/mailbox';
import { InfoTip } from '@/components/info-tip';
import { formatDate, useMembers } from '@/lib/crm';
import { useFirstEmails, useMarkInitialEmail } from '@/lib/follow-up-cadence';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { FOLLOW_UP_TYPE_LABEL } from './work-labels';
import './first-email-pending.css';

type Scope = 'mine' | 'team' | 'all';

/** The four kinds of contact here, each with its own colour and icon. */
const STATUS: Record<
  FirstEmailStatus,
  { label: MessageKey; icon: typeof MailQuestion; tone: string }
> = {
  PENDING: {
    label: 'First email pending',
    icon: MailQuestion,
    tone: 'amber',
  },
  NO_EMAIL: {
    label: 'Needs an email address',
    icon: UserRoundX,
    tone: 'rose',
  },
  INVALID_EMAIL: {
    label: 'Email address bounced',
    icon: MailWarning,
    tone: 'red',
  },
  SENT: {
    label: 'Sent, waiting',
    icon: Hourglass,
    tone: 'sky',
  },
};
const ORDER: FirstEmailStatus[] = ['PENDING', 'NO_EMAIL', 'INVALID_EMAIL', 'SENT'];

const PERIODS: { value: FirstEmailPeriod; label: MessageKey }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'Any time' },
];

const SOURCE: Record<InitialEmailSource, MessageKey> = {
  SENT: 'Sent from SampForce',
  MAILBOX: 'Seen in the mailbox',
  LOGGED: 'Logged by hand',
  MANUAL: 'Marked as sent',
};

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * First Email Pending (ADR 0096): every new contact whose first email has not gone out, however they were created,
 * with filters by creation date, employee, company and status. When the first email is confirmed as sent the contact
 * waits here ("Sent, waiting") until the follow-up period passes; then follow-up 1 is created and it moves into
 * Follow-ups.
 */
export function FirstEmailPending({ scope }: { scope: Scope }) {
  const t = useT();
  const [status, setStatus] = React.useState<FirstEmailStatus | null>(null);
  const [period, setPeriod] = React.useState<FirstEmailPeriod>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [ownerId, setOwnerId] = React.useState('');
  const [company, setCompany] = React.useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = React.useState('');
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const tz = React.useMemo(browserZone, []);
  const list = useFirstEmails({
    scope,
    status: status ?? undefined,
    period,
    from: from || undefined,
    to: to || undefined,
    ownerId: ownerId || undefined,
    companyId: company?.id,
    q: q || undefined,
    tz,
  });
  const members = useMembers();
  const owners = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const p of members.data ?? []) if (p.status === 'ACTIVE') m.set(p.userId, p.name);
    for (const r of list.data?.rows ?? []) if (r.owner) m.set(r.owner.id, r.owner.name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members.data, list.data]);
  const counts = list.data?.counts;
  const pending = counts ? counts.PENDING + counts.NO_EMAIL + counts.INVALID_EMAIL : null;
  const filtered = period !== 'all' || !!from || !!to || !!ownerId || !!company || !!q;

  return (
    <section className="space-y-4" data-first-email aria-labelledby="first-email-title">
      <div className="fe-hero relative overflow-hidden rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="fe-medallion grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-md"
              aria-hidden
            >
              <Send className="size-6" />
            </span>
            <div className="min-w-0">
              <h2 id="first-email-title" className="flex items-center gap-2 text-lg font-semibold">
                {t('First email pending')}
                <InfoTip topic="followUps.firstEmail" />
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  'New contacts who have not had their first email yet. Once it is sent, they move into Follow-ups when the follow-up period passes with no answer.',
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <span
              className="fe-total inline-flex items-baseline gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
              data-first-email-total
            >
              <span className="text-2xl font-bold tabular-nums">{pending ?? '…'}</span>
              {t(filtered ? 'pending for these filters' : 'first emails pending')}
            </span>
            {counts && counts.createdToday > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success"
                data-created-today
              >
                <Sparkles aria-hidden className="size-3.5" />
                {t('{n} new today', { n: counts.createdToday })}
              </span>
            )}
          </div>
        </div>
        <div
          className="relative mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
          role="radiogroup"
          aria-label={t('First email status')}
        >
          {ORDER.map((s) => {
            const meta = STATUS[s];
            const Icon = meta.icon;
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                data-tone={meta.tone}
                data-status={s}
                onClick={() => setStatus(active ? null : s)}
                className={cn(
                  'fe-tile flex min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition',
                  active ? 'fe-tile-active' : 'border-border bg-surface/80 hover:-translate-y-0.5',
                )}
              >
                <span
                  className="fe-tile-icon grid size-10 shrink-0 place-items-center rounded-xl"
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xl font-bold leading-tight tabular-nums">
                    {counts ? counts[s] : '…'}
                  </span>
                  <span className="block truncate text-xs font-medium">{t(meta.label)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-3 sm:p-4">
        <div
          className="flex flex-wrap items-center gap-2"
          role="radiogroup"
          aria-label={t('Created')}
        >
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-medium',
                period === p.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted',
              )}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="relative block min-w-0">
            <span className="sr-only">{t('Search contacts or companies')}</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Search contacts or companies')}
              className="h-9 w-full rounded-lg border border-border bg-background ps-8 pe-2 text-sm"
            />
          </label>
          <label className="block min-w-0">
            <span className="sr-only">{t('Assigned employee')}</span>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
            >
              <option value="">{t('Every employee')}</option>
              {owners.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t('Created from')}</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t('to')}</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>
        </div>
        {(company || filtered) && (
          <div className="flex flex-wrap items-center gap-2">
            {company && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <Building2 aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{company.name}</span>
                <button
                  type="button"
                  onClick={() => setCompany(null)}
                  className="grid size-5 place-items-center rounded-full hover:bg-primary/15"
                  aria-label={t('Remove the company filter')}
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => {
                setPeriod('all');
                setFrom('');
                setTo('');
                setOwnerId('');
                setCompany(null);
                setSearch('');
              }}
            >
              {t('Clear filters')}
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite">
        {list.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : list.error ? (
          <p role="alert" className="text-sm text-critical">
            {list.error.message}
          </p>
        ) : !list.data.rows.length ? (
          <div className="fe-empty rounded-2xl border border-dashed border-border p-8 text-center">
            <MailCheck aria-hidden className="mx-auto size-10 text-success" />
            <p className="mt-2 font-semibold">
              {t(
                status === 'SENT'
                  ? 'Nobody is waiting for follow-up 1.'
                  : 'Every first email has gone out.',
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {t('New contacts show up here as soon as they are created.')}
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-2" data-first-email-list>
              {list.data.rows.map((r, i) => (
                <FirstEmailItem key={r.contactId} r={r} index={i} onCompany={setCompany} />
              ))}
            </ul>
            {list.data.total > list.data.rows.length && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {t('Showing the newest {shown} of {total}. Narrow the filters to see the rest.', {
                  shown: list.data.rows.length,
                  total: list.data.total,
                })}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/** One contact: who, where, what is missing and what to do next. */
function FirstEmailItem({
  r,
  index,
  onCompany,
}: {
  r: FirstEmailRow;
  index: number;
  onCompany: (c: { id: string; name: string }) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan('contacts:write');
  const canSend = useCan('activities:write');
  const [compose, setCompose] = React.useState(false);
  const [confirmMark, setConfirmMark] = React.useState(false);
  const mark = useMarkInitialEmail(r.contactId, r.company?.id);
  const meta = STATUS[r.status];
  const Icon = meta.icon;
  const today = new Date().toDateString() === new Date(r.createdAt).toDateString();
  return (
    <li
      className="fe-row rounded-2xl border border-border bg-surface p-3 sm:p-4"
      data-tone={meta.tone}
      data-contact={r.contactId}
      data-row-status={r.status}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="fe-avatar grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold"
            aria-hidden
          >
            {initials(r.name) || '?'}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Link
                href={`/app/contacts/${r.contactId}`}
                className="truncate font-semibold hover:underline"
              >
                {r.name}
              </Link>
              {today && (
                <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                  {t('New today')}
                </span>
              )}
            </p>
            {r.designation && (
              <p className="truncate text-xs text-muted-foreground">{r.designation}</p>
            )}
            {r.company && (
              <p className="flex min-w-0 items-center gap-1 text-xs">
                <Building2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <Link href={`/app/companies/${r.company.id}`} className="truncate hover:underline">
                  {r.company.name}
                </Link>
                <button
                  type="button"
                  onClick={() => onCompany(r.company!)}
                  className="shrink-0 rounded px-1 text-[11px] font-medium text-primary hover:underline"
                >
                  {t('Only this company')}
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-1.5">
          <span className="fe-chip inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{t(meta.label)}</span>
          </span>
          <p className="truncate text-sm">
            {r.email ?? <span className="text-muted-foreground">{t('No email address')}</span>}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <dt className="flex items-center gap-1">
              <CalendarDays aria-hidden className="size-3.5" />
              {t('Created')}
            </dt>
            <dd className="truncate">{formatDate(r.createdAt)}</dd>
            <dt className="flex items-center gap-1">
              <UserRound aria-hidden className="size-3.5" />
              {t('Assigned to')}
            </dt>
            <dd className="truncate">{r.owner?.name ?? t('Unassigned')}</dd>
            <dt className="flex items-center gap-1">
              <Clock3 aria-hidden className="size-3.5" />
              {t('Last activity')}
            </dt>
            <dd className="truncate">
              {r.lastActivityAt ? relativeTime(r.lastActivityAt) : t('None yet')}
            </dd>
            {r.status === 'SENT' && r.sentAt && (
              <>
                <dt className="flex items-center gap-1">
                  <MailCheck aria-hidden className="size-3.5" />
                  {t('First email')}
                </dt>
                <dd className="truncate">
                  {formatDate(r.sentAt)}
                  {r.sentSource ? ` · ${t(SOURCE[r.sentSource])}` : ''}
                </dd>
              </>
            )}
            <dt className="flex items-center gap-1">
              <Hourglass aria-hidden className="size-3.5" />
              {t('Next follow-up')}
            </dt>
            <dd className="truncate" data-next-follow-up>
              {r.nextFollowUpAt
                ? r.status === 'SENT'
                  ? t('{type} on {date}', {
                      type: t(FOLLOW_UP_TYPE_LABEL[r.cadence.channel]),
                      date: formatDate(r.nextFollowUpAt),
                    })
                  : formatDate(r.nextFollowUpAt)
                : t('{days} days after the first email', { days: r.cadence.firstFollowUpDays })}
            </dd>
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch">
          {r.status === 'PENDING' && canSend && (
            <button
              type="button"
              onClick={() => setCompose(true)}
              className="fe-primary inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white"
            >
              <Send aria-hidden className="size-4" />
              {t('Send first email')}
            </button>
          )}
          {(r.status === 'NO_EMAIL' || r.status === 'INVALID_EMAIL') && (
            <Link
              href={`/app/contacts/${r.contactId}`}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              <PenLine aria-hidden className="size-4" />
              {t(r.status === 'NO_EMAIL' ? 'Add an email address' : 'Check the address')}
            </Link>
          )}
          {r.status !== 'SENT' && r.status !== 'NO_EMAIL' && canWrite && !confirmMark && (
            <button
              type="button"
              onClick={() => setConfirmMark(true)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/10"
            >
              <MailCheck aria-hidden className="size-4" />
              {t('Sent outside SampForce?')}
            </button>
          )}
          {confirmMark && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-2 text-xs"
              role="group"
              aria-label={t('Mark initial email as sent')}
            >
              <span>{t('Mark the first email as sent today?')}</span>
              <button
                type="button"
                disabled={mark.isPending}
                onClick={() => mark.mutate({}, { onSuccess: () => setConfirmMark(false) })}
                className="h-7 rounded-md bg-primary px-2 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {t('Mark as sent')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmMark(false)}
                className="h-7 rounded-md px-2 font-medium hover:bg-background"
              >
                {t('Cancel')}
              </button>
            </div>
          )}
          {mark.error && (
            <p role="alert" className="text-xs text-critical">
              {mark.error.message}
            </p>
          )}
        </div>
      </div>
      {compose && (
        <ComposeDialog
          open={compose}
          onOpenChange={(o) => {
            setCompose(o);
            if (!o) {
              void qc.invalidateQueries({ queryKey: ['first-email'] });
              void qc.invalidateQueries({ queryKey: ['follow-ups'] });
            }
          }}
          to={r.email ?? ''}
          contactId={r.contactId}
        />
      )}
    </li>
  );
}
