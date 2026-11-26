'use client';

import type { EmployeeActivityRow, EmployeeStageRow } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { AlarmClock, BadgeCheck, CalendarClock, History, Mail, MessagesSquare, Phone, Send, Sparkles, Trophy, UserRoundX, CircleSlash, type LucideIcon, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { personLabel } from '@/lib/company-leads';
import { formatDate } from '@/lib/crm';
import { useChangeStage, useEmployeeActivity, useEmployeeCommunication, useEmployeeStages, useMarkContributor } from '@/lib/employee-stages';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { CommunicationTimeline } from './communication-timeline';
import { ContributorBadge, StageChip, StagePicker, StageSpread, stageStyle, STAGE_DOT } from './stage-chip';

/*
 * The company's employees by RFQ activity and communication stage (ADR 0080, Part 7): who shares RFQs, who needs a
 * follow-up, who is in discussion. Every number comes from recorded RFQs, interactions, follow-ups and transfers.
 */

type FilterKey = 'all' | 'contributors' | 'active' | 'awaiting' | 'overdue' | 'discussion' | 'won' | 'lost' | 'none';
type SortKey = 'rfqs' | 'lastRfq' | 'nextFollowUp' | 'lastActivity' | 'name' | 'stage';

const FILTERS: { key: Exclude<FilterKey, 'all'>; label: MessageKey; icon: LucideIcon; test: (r: EmployeeActivityRow) => boolean; tone: string }[] = [
  { key: 'contributors', label: 'RFQ contributors', icon: BadgeCheck, test: (r) => r.contributor !== 'NONE', tone: 'text-sky-700 dark:text-sky-300' },
  { key: 'active', label: 'Active contributors', icon: Sparkles, test: (r) => r.contributor === 'ACTIVE', tone: 'text-amber-700 dark:text-amber-300' },
  { key: 'awaiting', label: 'Awaiting follow-up', icon: CalendarClock, test: (r) => !!r.nextFollowUpAt, tone: 'text-primary' },
  { key: 'overdue', label: 'Overdue follow-ups', icon: AlarmClock, test: (r) => r.followUpsOverdue > 0, tone: 'text-critical' },
  { key: 'discussion', label: 'In discussion', icon: MessagesSquare, test: (r) => !!r.stage && ['DISCUSSION', 'CALL', 'NEGOTIATION'].includes(r.stage.phase), tone: 'text-orange-700 dark:text-orange-300' },
  { key: 'won', label: 'Won RFQs', icon: Trophy, test: (r) => r.rfqsWon > 0 || r.stage?.phase === 'WON', tone: 'text-success' },
  { key: 'lost', label: 'Rejected or lost', icon: CircleSlash, test: (r) => r.rfqsLostOrRejected > 0 || r.stage?.phase === 'LOST', tone: 'text-red-700 dark:text-red-300' },
  { key: 'none', label: 'No RFQ yet', icon: UserRoundX, test: (r) => r.contributor === 'NONE', tone: 'text-muted-foreground' },
];

const SORTS: { key: SortKey; label: MessageKey }[] = [
  { key: 'rfqs', label: 'Most RFQs' },
  { key: 'lastRfq', label: 'Latest RFQ' },
  { key: 'nextFollowUp', label: 'Next follow-up' },
  { key: 'lastActivity', label: 'Last activity' },
  { key: 'stage', label: 'Stage' },
  { key: 'name', label: 'Name' },
];

const CONTRIBUTOR_RANK = { ACTIVE: 0, CONTRIBUTOR: 1, NONE: 2 } as const;

export function EmployeeActivitySection({ companyId, companyName, restricted = false }: { companyId: string; companyName: string; restricted?: boolean }) {
  const t = useT();
  const data = useEmployeeActivity(companyId);
  const canWrite = useCan('contacts:write') && !restricted;
  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [stageFilter, setStageFilter] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortKey>('rfqs');
  const [q, setQ] = React.useState('');
  const [historyOf, setHistoryOf] = React.useState<string | null>(null);
  const rows = data.data?.rows ?? [];
  const stages = data.data?.stages ?? [];
  const position = new Map(stages.map((s) => [s.id, s.position]));
  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter);
    const time = (v: string | null, empty: number) => (v ? new Date(v).getTime() : empty);
    return rows
      .filter((r) => (!f || f.test(r)) && (!stageFilter || r.stage?.id === stageFilter) && (!needle || [r.name, r.jobTitle, r.email, r.owner?.name].some((x) => x?.toLowerCase().includes(needle))))
      .sort((a, b) => {
        switch (sort) {
          case 'rfqs':
            return CONTRIBUTOR_RANK[a.contributor] - CONTRIBUTOR_RANK[b.contributor] || b.rfqCount - a.rfqCount || a.name.localeCompare(b.name);
          case 'lastRfq':
            return time(b.lastRfqAt, 0) - time(a.lastRfqAt, 0);
          case 'nextFollowUp':
            return time(a.nextFollowUpAt, Infinity) - time(b.nextFollowUpAt, Infinity);
          case 'lastActivity':
            return time(b.lastActivityAt, 0) - time(a.lastActivityAt, 0);
          case 'stage':
            return (position.get(a.stage?.id ?? '') ?? 999) - (position.get(b.stage?.id ?? '') ?? 999);
          default:
            return a.name.localeCompare(b.name);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, stageFilter, sort, q]);
  const counts = new Map<string, number>();
  for (const r of rows) if (r.stage) counts.set(r.stage.id, (counts.get(r.stage.id) ?? 0) + 1);

  return (
    <Card id="employee-activity" className="overflow-hidden">
      <CardHeader className="space-y-1 border-b border-border bg-gradient-to-r from-primary/[0.06] via-transparent to-transparent">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {t('Employee RFQ activity')}
          {data.data && <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('Who shares RFQs with us, where each conversation stands, and who needs a follow-up.')}</p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {data.isPending ? (
          <Skeleton className="h-40" />
        ) : data.error ? (
          <p role="alert" className="text-sm text-critical">{data.error.message}</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">{t('No employees at this company yet.')}</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('Filter employees')}>
              {FILTERS.map((f) => {
                const n = rows.filter(f.test).length;
                const on = filter === f.key;
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(on ? 'all' : f.key)}
                      className={cn(
                        'flex h-full w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        on ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-surface hover:border-primary/40 hover:bg-muted/40',
                      )}
                    >
                      <f.icon aria-hidden className={cn('size-4 shrink-0', f.tone)} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-semibold leading-tight tabular-nums">{n}</span>
                        <span className="block truncate text-xs text-muted-foreground" title={t(f.label)}>
                          {t(f.label)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <StageSpread stages={stages} counts={counts} active={stageFilter} onPick={setStageFilter} />
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={t('Search employees')} placeholder={t('Search employees')} className="h-9 w-full sm:w-56" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {t('Sort by')}
                <select className="h-9 rounded-md border border-input bg-surface px-2 text-sm text-foreground" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {t(s.label)}
                    </option>
                  ))}
                </select>
              </label>
              {(filter !== 'all' || stageFilter || q) && (
                <Button size="sm" variant="ghost" onClick={() => { setFilter('all'); setStageFilter(null); setQ(''); }}>
                  {t('Clear filters')}
                </Button>
              )}
              <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
                {t('{shown} of {total} employees', { shown: String(list.length), total: String(rows.length) })}
              </span>
            </div>
            <div role="table" aria-label={t('Employee RFQ activity')} className="divide-y divide-border rounded-xl border border-border">
              <div role="row" className="hidden bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground 2xl:grid 2xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_auto] 2xl:gap-3">
                <span role="columnheader">{t('Employee')}</span>
                <span role="columnheader">{t('RFQ activity')}</span>
                <span role="columnheader">{t('Current stage')}</span>
                <span role="columnheader">{t('Follow-up')}</span>
                <span role="columnheader" className="sr-only">{t('Actions')}</span>
              </div>
              {list.map((r) => (
                <EmployeeLine key={r.id} row={r} stages={stages} canWrite={canWrite} onHistory={() => setHistoryOf(r.id)} />
              ))}
              {!list.length && <p className="px-3 py-4 text-sm text-muted-foreground">{t('No employees match these filters.')}</p>}
            </div>
            <p className="text-xs text-muted-foreground">{t('Active RFQ Contributor: shared an RFQ in the last {days} days.', { days: String(data.data?.activeDays ?? 90) })}</p>
          </>
        )}
      </CardContent>
      <EmployeeHistorySheet contactId={historyOf} companyName={companyName} onClose={() => setHistoryOf(null)} />
    </Card>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function EmployeeLine({ row: r, stages, canWrite, onHistory }: { row: EmployeeActivityRow; stages: EmployeeStageRow[]; canWrite: boolean; onHistory: () => void }) {
  const t = useT();
  const change = useChangeStage();
  const mark = useMarkContributor();
  const [flash, setFlash] = React.useState(false);
  const overdue = r.followUpsOverdue > 0;
  const editable = canWrite && r.details;
  return (
    <div role="row" className={cn('grid grid-cols-1 gap-3 px-3 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-2 2xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1.3fr)_auto] 2xl:items-center', r.contributor === 'ACTIVE' && 'bg-amber-50/40 dark:bg-amber-400/[0.04]')} data-employee={r.id}>
      <div role="cell" className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          style={r.stage ? stageStyle(r.stage.color) : undefined}
          className={cn(
            'relative flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            r.contributor === 'ACTIVE' ? 'bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950' : r.contributor === 'CONTRIBUTOR' ? 'bg-sky-100 text-sky-900 dark:bg-sky-400/20 dark:text-sky-100' : 'bg-muted text-muted-foreground',
          )}
        >
          {initials(r.name)}
          {r.stage && <span className={cn('absolute -bottom-0.5 -end-0.5 size-3.5 rounded-full border-2 border-surface', STAGE_DOT)} />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/app/contacts/${r.id}`} className="min-w-0 truncate font-medium text-primary hover:underline" title={r.name}>
              {r.name}
            </Link>
            <ContributorBadge status={r.contributor} />
          </div>
          {r.jobTitle && <p className="truncate text-xs text-muted-foreground" title={r.jobTitle}>{r.jobTitle}</p>}
          <div className="flex min-w-0 flex-col gap-0.5 text-xs">
            {r.email && (
              <a href={`mailto:${r.email}`} className="inline-flex min-h-6 min-w-0 items-center gap-1 text-primary hover:underline" title={r.email}>
                <Mail aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{r.email}</span>
              </a>
            )}
            {r.phone && (
              <a href={`tel:${r.phone}`} className="inline-flex min-h-6 items-center gap-1 hover:underline">
                <Phone aria-hidden className="size-3.5 shrink-0" /> {r.phone}
              </a>
            )}
            {!r.details && <span className="text-muted-foreground">{t('Details hidden')}</span>}
          </div>
          {editable && (r.contributor === 'NONE' || r.marked) && (
            <button
              type="button"
              disabled={mark.isPending}
              onClick={() => mark.mutate({ contactId: r.id, marked: !r.marked })}
              className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60"
            >
              <BadgeCheck aria-hidden className="size-3.5" />
              {r.marked ? t('Remove the RFQ contributor mark') : t('Mark as RFQ contributor')}
            </button>
          )}
        </div>
      </div>
      <div role="cell" className="space-y-0.5 text-sm">
        <p>
          <span className="text-xl font-semibold tabular-nums">{r.rfqCount}</span> <span className="text-xs text-muted-foreground">{r.rfqCount === 1 ? t('RFQ') : t('RFQs')}</span>
        </p>
        <p className="text-xs text-muted-foreground">{r.lastRfqAt ? t('Last {date}', { date: formatDate(r.lastRfqAt) }) : t('None received')}</p>
        {(r.rfqsWon > 0 || r.rfqsLostOrRejected > 0 || r.sentToSampbidx > 0) && (
          <p className="flex flex-wrap gap-x-2 text-xs">
            {r.rfqsWon > 0 && <span className="font-medium text-success">{t('{n} won', { n: String(r.rfqsWon) })}</span>}
            {r.rfqsLostOrRejected > 0 && <span className="font-medium text-critical">{t('{n} lost', { n: String(r.rfqsLostOrRejected) })}</span>}
            {r.sentToSampbidx > 0 && (
              <span className="inline-flex items-center gap-0.5 font-medium text-teal-700 dark:text-teal-300">
                <Send aria-hidden className="size-3" /> {t('{n} in SampBidx', { n: String(r.sentToSampbidx) })}
              </span>
            )}
          </p>
        )}
      </div>
      <div role="cell" className="min-w-0 space-y-1">
        {editable ? (
          <StagePicker
            stages={stages}
            current={r.stage}
            label={t('Change the communication stage of {name}', { name: r.name })}
            disabled={change.isPending}
            onPick={(stageId, note) =>
              change.mutate(
                { contactId: r.id, stageId, note },
                {
                  onSuccess: () => {
                    setFlash(true);
                    window.setTimeout(() => setFlash(false), 1200);
                  },
                },
              )
            }
          />
        ) : (
          <StageChip stage={r.stage} />
        )}
        {r.stageChangedAt && <p className="text-xs text-muted-foreground">{t('Since {date}', { date: formatDate(r.stageChangedAt) })}</p>}
        {flash && (
          <p role="status" className="text-xs font-medium text-success duration-300 animate-in fade-in slide-in-from-top-1">
            {t('Stage updated')}
          </p>
        )}
        {change.error && <p role="alert" className="text-xs text-critical">{change.error.message}</p>}
        {mark.error && <p role="alert" className="text-xs text-critical">{mark.error.message}</p>}
      </div>
      <div role="cell" className="space-y-0.5 text-xs">
        <p className={cn('flex items-center gap-1', overdue ? 'font-semibold text-critical' : r.nextFollowUpAt ? 'text-foreground' : 'text-muted-foreground')}>
          {overdue ? <AlarmClock aria-hidden className="size-3.5 shrink-0" /> : <CalendarClock aria-hidden className="size-3.5 shrink-0" />}
          {r.nextFollowUpAt ? t('Next {date}', { date: formatDate(r.nextFollowUpAt) }) : t('No follow-up planned')}
        </p>
        {overdue && <p className="font-medium text-critical">{t('{n} overdue', { n: String(r.followUpsOverdue) })}</p>}
        <p className="text-muted-foreground">{t('Last activity {date}', { date: formatDate(r.lastActivityAt) })}</p>
        {r.owner && (
          <p className="truncate text-muted-foreground" title={personLabel(r.owner)}>
            {t('Assigned to {name}', { name: r.owner.name })}
          </p>
        )}
      </div>
      <div role="cell" className="flex items-center gap-1 sm:col-span-2 2xl:col-span-1 2xl:justify-end">
        <Button size="sm" variant="outline" onClick={onHistory} aria-label={t('History of {name}', { name: r.name })}>
          <History aria-hidden /> {t('History')}
        </Button>
      </div>
    </div>
  );
}

/** One employee's full communication history in a side panel. */
export function EmployeeHistorySheet({ contactId, companyName, onClose }: { contactId: string | null; companyName: string; onClose: () => void }) {
  const t = useT();
  const h = useEmployeeCommunication(contactId);
  const e = h.data?.employee;
  return (
    <Dialog open={!!contactId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex w-full max-w-lg flex-col gap-0 p-0 sm:max-w-lg">
        <div className="space-y-2 border-b border-border p-5 pe-12">
          <DialogTitle className="break-words text-lg font-semibold">{e?.name ?? t('Communication history')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{[e?.jobTitle, companyName].filter(Boolean).join(' · ')}</DialogDescription>
          {e && (
            <div className="flex flex-wrap items-center gap-2">
              <StageChip stage={e.stage} size="lg" />
              <ContributorBadge status={e.contributor} />
            </div>
          )}
          {e && (
            <dl className="grid grid-cols-3 gap-2 pt-1 text-center">
              {(
                [
                  ['RFQs', e.rfqCount],
                  ['Follow-ups done', e.followUpsCompleted],
                  ['In SampBidx', e.sentToSampbidx],
                ] as [MessageKey, number][]
              ).map(([label, n]) => (
                <div key={label} className="rounded-lg border border-border bg-surface px-2 py-1.5">
                  <dt className="truncate text-[11px] text-muted-foreground">{t(label)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
          )}
          {contactId && (
            <Link href={`/app/contacts/${contactId}`} className="inline-flex min-h-6 items-center gap-1 text-sm text-primary hover:underline">
              <ExternalLink aria-hidden className="size-3.5" /> {t('Open employee')}
            </Link>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <CommunicationTimeline events={h.data?.events} pending={h.isPending} error={h.error} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** On the employee's own page: the stage (changeable), the contributor mark, and the full history. */
export function EmployeeCommunicationCard({ contactId, restricted = false }: { contactId: string; restricted?: boolean }) {
  const t = useT();
  const h = useEmployeeCommunication(contactId);
  const stages = useEmployeeStages();
  const change = useChangeStage();
  const mark = useMarkContributor();
  const canWrite = useCan('contacts:write') && !restricted;
  const e = h.data?.employee;
  const editable = canWrite && !!e?.details;
  return (
    <Card id="communication-stage">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('Communication stage and history')}</CardTitle>
        {e && (
          <div className="flex flex-wrap items-center gap-2">
            {editable && stages.data ? (
              <StagePicker stages={stages.data} current={e.stage} label={t('Change the communication stage of {name}', { name: e.name })} disabled={change.isPending} onPick={(stageId, note) => change.mutate({ contactId, stageId, note })} />
            ) : (
              <StageChip stage={e.stage} />
            )}
            <ContributorBadge status={e.contributor} />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {e && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['RFQs shared', String(e.rfqCount)],
                ['Last RFQ received', formatDate(e.lastRfqAt)],
                ['Next follow-up', formatDate(e.nextFollowUpAt)],
                ['Last communication', formatDate(e.lastActivityAt)],
              ] as [MessageKey, string][]
            ).map(([label, v]) => (
              <div key={label} className="rounded-lg border border-border p-2.5">
                <dt className="truncate text-xs text-muted-foreground">{t(label)}</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {editable && e && (e.contributor === 'NONE' || e.marked) && (
          <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate({ contactId, marked: !e.marked })}>
            <BadgeCheck aria-hidden /> {e.marked ? t('Remove the RFQ contributor mark') : t('Mark as RFQ contributor')}
          </Button>
        )}
        {(change.error || mark.error) && <p role="alert" className="text-sm text-critical">{(change.error ?? mark.error)!.message}</p>}
        <CommunicationTimeline events={h.data?.events} pending={h.isPending} error={h.error} />
      </CardContent>
    </Card>
  );
}
