'use client';

import { HELP_CATEGORY_BY_ID, type HelpCategoryId, helpText } from '@dealflow/help';
import {
  SUPPORT_REPORT_DAYS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  type SupportReport,
} from '@dealflow/types';
import { Card, Skeleton } from '@dealflow/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePriorityLabel, useStatusLabel } from './help-ui';

/** Support reports in the Console (ADR 0073): volume, topics, clients, who handles queries and how fast. */
export function SupportReportView() {
  const t = useT();
  const statusLabel = useStatusLabel();
  const priorityLabel = usePriorityLabel();
  const [days, setDays] = useState<(typeof SUPPORT_REPORT_DAYS)[number]>(30);
  const report = useQuery({
    queryKey: ['operator', 'support', 'report', days],
    queryFn: () => api<SupportReport>(`/operator/support/tickets/report?days=${days}`),
  });
  const r = report.data;
  const topic = (id: string) =>
    id === 'other'
      ? t('Other')
      : HELP_CATEGORY_BY_ID[id as HelpCategoryId]
        ? helpText(HELP_CATEGORY_BY_ID[id as HelpCategoryId].title, t.language)
        : id;
  const span = (h: number) => (h < 1 ? t('{minutes} min', { minutes: Math.max(1, Math.round(h * 60)) }) : t('{hours} h', { hours: Math.round(h * 10) / 10 }));
  const hours = (h: { average: number | null; median: number | null }) =>
    h.average === null ? t('Nothing to measure yet') : t('{average} on average, {median} median', { average: span(h.average), median: span(h.median ?? h.average) });

  return (
    <div className="space-y-4" data-support-report>
      <div
        role="tablist"
        aria-label={t('Report period')}
        className="flex w-fit flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
      >
        {SUPPORT_REPORT_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={days === d}
            onClick={() => setDays(d)}
            className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
            data-report-days={d}
          >
            {t('Last {days} days', { days: d })}
          </button>
        ))}
      </div>
      {!r ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('Queries raised')} value={String(r.raised)} attr="raised" />
            <Stat label={t('Waiting for support')} value={String(r.open)} attr="open" />
            <Stat
              label={t('Time to first answer')}
              value={hours(r.firstAnswerHours)}
              attr="first-answer"
              small
            />
            <Stat
              label={t('Time to resolve')}
              value={hours(r.resolutionHours)}
              attr="resolution"
              small
            />
          </div>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">{t('Queries raised per day')}</h3>
            <Trend perDay={r.perDay} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Bars
              title={t('By status')}
              rows={SUPPORT_TICKET_STATUSES.map((s) => ({
                key: s,
                label: statusLabel(s),
                count: r.byStatus[s],
              }))}
              attr="status"
            />
            <Bars
              title={t('By priority')}
              rows={SUPPORT_TICKET_PRIORITIES.map((p) => ({
                key: p,
                label: priorityLabel(p),
                count: r.byPriority[p],
              }))}
              attr="priority"
            />
            <Bars
              title={t('By topic')}
              rows={r.byCategory.map((c) => ({
                key: c.category,
                label: topic(c.category),
                count: c.count,
              }))}
              attr="topic"
            />
            <Bars
              title={t('Clients raising the most')}
              rows={r.byClient.map((c) => ({ key: c.tenantId, label: c.name, count: c.count }))}
              attr="client"
            />
            <Bars
              title={t('By support person')}
              rows={r.byOperator.map((o) => ({
                key: o.operatorId ?? 'none',
                label: o.operatorId ? o.name : t('Unassigned'),
                count: o.assigned,
                note: t('{resolved} resolved', { resolved: o.resolved }),
              }))}
              attr="operator"
            />
            <Bars
              title={t('Where they came from')}
              rows={r.bySource.map((s) => ({
                key: s.source,
                label: s.source === 'mobile' ? t('Mobile app') : t('Web'),
                count: s.count,
              }))}
              attr="source"
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  attr,
  small,
}: {
  label: string;
  value: string;
  attr: string;
  small?: boolean;
}) {
  return (
    <Card className="p-4" data-report-stat={attr}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={
          small ? 'mt-2 text-sm font-semibold' : 'mt-1 text-3xl font-semibold tabular-nums'
        }
      >
        {value}
      </p>
    </Card>
  );
}

function Bars({
  title,
  rows,
  attr,
}: {
  title: string;
  rows: { key: string; label: string; count: number; note?: string }[];
  attr: string;
}) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card className="p-4" data-report-group={attr}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No queries in this period.')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.key}
              className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm"
              data-report-row={r.key}
            >
              <span className="truncate">{r.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
              </span>
              <span className="tabular-nums">
                {r.count}
                {r.note && <span className="ms-2 text-xs text-muted-foreground">{r.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Trend({ perDay }: { perDay: SupportReport['perDay'] }) {
  const max = Math.max(1, ...perDay.map((d) => d.count));
  return (
    <ol className="flex h-28 items-end gap-px" data-report-trend>
      {perDay.map((d) => (
        <li key={d.date} className="flex h-full flex-1 items-end" title={`${d.date}: ${d.count}`}>
          <span className="sr-only">{`${d.date}: ${d.count}`}</span>
          <span
            className="block w-full rounded-t bg-primary/80"
            style={{
              height: `${Math.max(d.count ? 6 : 1, (d.count / max) * 100)}%`,
              opacity: d.count ? 1 : 0.25,
            }}
            aria-hidden
          />
        </li>
      ))}
    </ol>
  );
}
