'use client';

import type { ContactRow } from '@dealflow/types';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { InfoTip } from '@/components/info-tip';
import { api } from '@/lib/api';
import { useCrmStatuses } from '@/lib/company-crm';
import { personLabel, useEmployeeStats } from '@/lib/company-leads';
import { formatDate } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { DetailList } from './record-detail';
import { CountryFlag, StatusChip } from './status-chip';

/** The employee's relationship with the team at a glance (section 3.2 of the specification). */
export function EmployeeRelationship({ contact: c }: { contact: ContactRow }) {
  const t = useT();
  const stats = useEmployeeStats(c.id);
  const qc = useQueryClient();
  const canWrite = useCan('contacts:write');
  const statuses = useCrmStatuses('EMPLOYEE');
  const change = useMutation({
    mutationFn: (statusId: string) => api<ContactRow>(`/contacts/${c.id}`, { method: 'PATCH', json: { statusId } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['contacts'] }), qc.invalidateQueries({ queryKey: ['company-employees'] })]),
  });
  const tiles: [MessageKey, number | undefined][] = [
    ['Emails sent', stats.data?.emailsSent],
    ['Responses received', stats.data?.responsesReceived],
    ['Calls made', stats.data?.calls],
    ['Meetings', stats.data?.meetings],
    ['Follow-ups pending', stats.data?.followUpsPending],
  ];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Relationship')}
          <InfoTip topic="crm.employeeRelationship" />
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status} />
          {canWrite && (
            <select
              aria-label={t('Change employee status')}
              value={c.status?.id ?? ''}
              disabled={change.isPending}
              onChange={(e) => e.target.value && change.mutate(e.target.value)}
              className="h-8 rounded-md border border-input bg-surface px-2 text-sm"
            >
              {!c.status && <option value="">{t('No status')}</option>}
              {statuses.data
                ?.filter((s) => !s.archived || s.id === c.status?.id)
                .map((s) => (
                  <option key={s.id} value={s.id} disabled={s.archived}>
                    {t.maybe(s.name)}
                  </option>
                ))}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map(([label, n]) => (
            <div key={label} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t(label)}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{stats.isPending ? <Skeleton className="h-7 w-8" /> : (n ?? 0)}</dd>
            </div>
          ))}
        </dl>
        {change.error && (
          <p role="alert" className="text-sm text-critical">
            {change.error.message}
          </p>
        )}
        <DetailList
          items={[
            ['Last interaction', stats.data?.lastInteractionAt ? formatDate(stats.data.lastInteractionAt) : null],
            ['Latest update', stats.data?.latestUpdate ? `${stats.data.latestUpdate.subject} (${formatDate(stats.data.latestUpdate.at)})` : null],
            ['Next follow-up', stats.data?.nextFollowUpAt ? formatDate(stats.data.nextFollowUpAt) : null],
            ['Assigned sales executive', personLabel(c.ownerPerson) || c.owner?.name],
          ]}
        />
      </CardContent>
    </Card>
  );
}

/** Employee details from the "Add employee / POC" form, with the parent company. */
export function EmployeeDetails({ contact: c }: { contact: ContactRow }) {
  const t = useT();
  const points = (list: { value: string; primary?: boolean }[], scheme: 'mailto' | 'tel') =>
    list.length ? (
      <ul className="space-y-1">
        {list.map((p) => (
          <li key={p.value}>
            <a className="inline-flex min-h-6 items-center break-all text-primary hover:underline" href={`${scheme}:${p.value}`}>
              {p.value}
            </a>
            {p.primary && list.length > 1 && <span className="ms-1 text-xs text-muted-foreground">({t('primary')})</span>}
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <DetailList
      items={[
        ['Company', c.company && <Link className="text-primary hover:underline" href={`/app/companies/${c.company.id}`}>{c.company.name}</Link>],
        ['Designation', c.jobTitle],
        ['Department', c.department],
        ['Email', points(c.emails.length ? c.emails : c.email ? [{ value: c.email, primary: true }] : [], 'mailto')],
        ['Phone', points(c.phones.length ? c.phones : c.phone ? [{ value: c.phone, primary: true }] : [], 'tel')],
        ['LinkedIn', c.linkedinUrl && <a className="inline-flex min-h-6 items-center break-all text-primary hover:underline" href={c.linkedinUrl} target="_blank" rel="noopener noreferrer">{c.linkedinUrl.replace(/^https?:\/\/(www\.)?/, '')}</a>],
        ['Location', c.country ? <span className="inline-flex flex-wrap items-center gap-1.5"><CountryFlag code={c.country} withName />{(c.city || c.state) && <span className="text-muted-foreground">· {[c.city, c.state].filter(Boolean).join(', ')}</span>}</span> : [c.city, c.state].filter(Boolean).join(', ') || null],
        ['Employee remarks', c.remarks && <span className="whitespace-pre-line">{c.remarks}</span>],
        ['Created by', personLabel(c.createdBy) || null],
      ]}
    />
  );
}
