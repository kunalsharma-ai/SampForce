'use client';

import type { CompanyRow, PersonRef } from '@dealflow/types';
import { Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InfoTip } from '@/components/info-tip';
import { api } from '@/lib/api';
import { useCrmStatuses } from '@/lib/company-crm';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { DetailList } from './record-detail';
import { CountryFlag, StatusChip } from './status-chip';

/** The lead side of a company: its number, status (changed here), and the people around it (ADR 0060). */
export function CompanyLeadCard({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan('companies:write');
  const statuses = useCrmStatuses('COMPANY');
  const change = useMutation({
    mutationFn: (statusId: string) => api<CompanyRow>(`/companies/${c.id}`, { method: 'PATCH', json: { statusId } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['companies'] }), qc.invalidateQueries({ queryKey: ['timeline'] })]),
  });
  const person = (p: PersonRef | null | undefined) =>
    p ? (
      <span>
        {p.name}
        {p.designation && <span className="text-muted-foreground"> · {t.maybe(p.designation)}</span>}
      </span>
    ) : null;
  const choices = statuses.data?.filter((s) => !s.archived || s.id === c.status?.id) ?? [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Lead')}
          <InfoTip topic="crm.companyLead" />
        </CardTitle>
        <span className="font-mono text-sm font-semibold" aria-label={t('Lead number')}>
          {c.leadNumber ?? '—'}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={c.status} className="text-sm" />
            {c.statusChangedAt && <span className="text-xs text-muted-foreground">{t('Since {date}', { date: formatDate(c.statusChangedAt) })}</span>}
          </div>
          {canWrite && (
            <select
              aria-label={t('Change status')}
              value={c.status?.id ?? ''}
              disabled={change.isPending || statuses.isPending}
              onChange={(e) => e.target.value && change.mutate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm"
            >
              {!c.status && <option value="">{t('No status')}</option>}
              {choices.map((s) => (
                <option key={s.id} value={s.id} disabled={s.archived}>
                  {t.maybe(s.name)}
                </option>
              ))}
            </select>
          )}
          {change.error && (
            <p role="alert" className="text-xs text-critical">
              {change.error.message}
            </p>
          )}
        </div>
        <DetailList
          items={[
            ['Created by', person(c.createdBy)],
            ['Lead owner', person(c.ownerPerson) ?? c.owner?.name],
            ['Manager', person(c.manager)],
            ['Location', c.country ? <span className="inline-flex flex-wrap items-center gap-1.5"><CountryFlag code={c.country} withName />{(c.city || c.state) && <span className="text-muted-foreground">· {[c.city, c.state].filter(Boolean).join(', ')}</span>}</span> : null],
            ['Last updated by', person(c.updatedBy)],
            ['Updated', formatDate(c.updatedAt)],
          ]}
        />
        {c.restricted && <p className="text-xs text-muted-foreground">{t('Your role shows names and statuses only for records others own.')}</p>}
      </CardContent>
    </Card>
  );
}
