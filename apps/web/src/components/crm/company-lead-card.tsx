'use client';

import type { CompanyRow, PersonRef } from '@dealflow/types';
import { Card, CardContent, CardHeader, CardTitle, cn } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InfoTip } from '@/components/info-tip';
import { api } from '@/lib/api';
import { useCrmStatuses } from '@/lib/company-crm';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { focusSection, useCompanyAction } from './company-actions';
import { DetailList } from './record-detail';
import { STAGE_CHIP, STAGE_DOT, stageStyle } from './stage-chip';
import { CountryFlag, StatusChip } from './status-chip';

/** The lead side of a company: its number, status (changed here), place and last change. The people are on the ownership card. */
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
  useCompanyAction('changeStatus', canWrite ? () => focusSection('company-lead', 'select') : null);

  return (
    <Card id="company-lead">
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

/**
 * The lead status, in the middle of the company page (Kunal, redesign): the current status large, how long it has
 * been there, and every status as a coloured button so changing it is one click. The select stays for keyboards and
 * long lists.
 */
export function CompanyStatusBar({ company: c }: { company: CompanyRow }) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan('companies:write');
  const statuses = useCrmStatuses('COMPANY');
  const change = useMutation({
    mutationFn: (statusId: string) => api<CompanyRow>(`/companies/${c.id}`, { method: 'PATCH', json: { statusId } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['companies'] }), qc.invalidateQueries({ queryKey: ['timeline'] })]),
  });
  const choices = statuses.data?.filter((s) => !s.archived || s.id === c.status?.id) ?? [];
  useCompanyAction('changeStatus', canWrite ? () => focusSection('company-lead', 'select') : null);
  return (
    <section id="company-lead" aria-labelledby="company-lead-title" className="sf-status-bar mx-auto max-w-4xl text-center">
      <h2 id="company-lead-title" className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t('Lead status')}
        <InfoTip topic="crm.companyLead" />
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <StatusChip status={c.status} className="px-4 py-1 text-base font-semibold shadow-sm" />
        {c.statusChangedAt && <span className="text-sm text-muted-foreground">{t('Since {date}', { date: formatDate(c.statusChangedAt) })}</span>}
      </div>
      {canWrite && (
        <>
          <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label={t('Statuses')} data-status-buttons="">
            {choices
              .filter((s) => !s.archived)
              .map((s) => {
                const current = s.id === c.status?.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      aria-pressed={current}
                      disabled={change.isPending || current}
                      onClick={() => change.mutate(s.id)}
                      style={stageStyle(s.color)}
                      className={cn(
                        'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-transform hover:-translate-y-0.5 disabled:cursor-default disabled:hover:translate-y-0',
                        STAGE_CHIP,
                        current && 'ring-2 ring-[var(--st-dot)] ring-offset-2 ring-offset-surface dark:ring-[var(--st-dot-d)]',
                      )}
                    >
                      <span aria-hidden className={cn('size-2 rounded-full', STAGE_DOT)} />
                      {t.maybe(s.name)}
                    </button>
                  </li>
                );
              })}
          </ul>
          <label className="mx-auto mt-3 flex max-w-xs items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t('Or pick')}</span>
            <select
              aria-label={t('Change status')}
              value={c.status?.id ?? ''}
              disabled={change.isPending || statuses.isPending}
              onChange={(e) => e.target.value && change.mutate(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm text-foreground"
            >
              {!c.status && <option value="">{t('No status')}</option>}
              {choices.map((s) => (
                <option key={s.id} value={s.id} disabled={s.archived}>
                  {t.maybe(s.name)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {change.error && (
        <p role="alert" className="mt-2 text-xs text-critical">
          {change.error.message}
        </p>
      )}
    </section>
  );
}
