'use client';

import { Badge, Button } from '@dealflow/ui';
import type { CompanyRow, ContactRow, DealRow, LeadRow } from '@dealflow/types';
import { Download, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { type CrmEntity, DEAL_STATUS_TONE, ENTITY_LABEL, formatDate, formatMoney, LEAD_STATUS_TONE, titleCase, useRecordList } from '@/lib/crm';
import { downloadFile } from '@/lib/api';
import { useCan } from '@/lib/session';
import { type Column, DataTable, useTableState } from './data-table';
import { RecordFormDialog } from './record-form';
import { Select } from './select';

const owner = <T extends { owner: { name: string } | null }>(): Column<T> => ({ key: 'owner', header: 'Owner', cell: (r) => r.owner?.name ?? '—' });
const created = <T extends { createdAt: string }>(): Column<T> => ({ key: 'createdAt', header: 'Created', sort: 'createdAt', cell: (r) => formatDate(r.createdAt) });

const COLUMNS = {
  leads: [
    { key: 'fullName', header: 'Name', sort: 'fullName', cell: (r) => r.fullName },
    { key: 'company', header: 'Company', sort: 'companyName', cell: (r) => r.companyName ?? '—' },
    { key: 'email', header: 'Email', cell: (r) => r.email ?? '—' },
    { key: 'status', header: 'Status', sort: 'status', cell: (r) => <Badge tone={LEAD_STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge> },
    { key: 'value', header: 'Est. value', sort: 'estimatedValue', cell: (r) => formatMoney(r.estimatedValue, r.currency ?? 'USD'), className: 'text-right tabular-nums' },
    owner<LeadRow>(),
    created<LeadRow>(),
  ] satisfies Column<LeadRow>[],
  contacts: [
    { key: 'name', header: 'Name', sort: 'firstName', cell: (r) => r.fullName },
    { key: 'title', header: 'Job title', cell: (r) => r.jobTitle ?? '—' },
    { key: 'company', header: 'Company', cell: (r) => r.company?.name ?? '—' },
    { key: 'email', header: 'Email', cell: (r) => r.email ?? '—' },
    { key: 'phone', header: 'Phone', cell: (r) => r.phone ?? '—' },
    owner<ContactRow>(),
    created<ContactRow>(),
  ] satisfies Column<ContactRow>[],
  companies: [
    { key: 'name', header: 'Name', sort: 'name', cell: (r) => r.name },
    { key: 'domain', header: 'Domain', cell: (r) => r.domain ?? '—' },
    { key: 'industry', header: 'Industry', sort: 'industry', cell: (r) => r.industry ?? '—' },
    { key: 'contacts', header: 'Contacts', cell: (r) => r.contactCount, className: 'text-right tabular-nums' },
    { key: 'deals', header: 'Open deals', cell: (r) => r.openDealCount, className: 'text-right tabular-nums' },
    owner<CompanyRow>(),
    created<CompanyRow>(),
  ] satisfies Column<CompanyRow>[],
  deals: [
    { key: 'name', header: 'Deal', sort: 'name', cell: (r) => r.name },
    { key: 'amount', header: 'Amount', sort: 'amount', cell: (r) => formatMoney(r.amount, r.currency), className: 'text-right tabular-nums' },
    { key: 'stage', header: 'Stage', cell: (r) => r.stage.name },
    { key: 'status', header: 'Status', cell: (r) => <Badge tone={DEAL_STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge> },
    { key: 'company', header: 'Company', cell: (r) => r.company?.name ?? '—' },
    { key: 'close', header: 'Expected close', sort: 'expectedCloseDate', cell: (r) => formatDate(r.expectedCloseDate) },
    owner<DealRow>(),
  ] satisfies Column<DealRow>[],
};

const STATUS_FILTERS: Partial<Record<CrmEntity, { value: string; label: string }[]>> = {
  leads: ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'].map((s) => ({ value: s, label: titleCase(s) })),
  deals: ['OPEN', 'WON', 'LOST'].map((s) => ({ value: s, label: titleCase(s) })),
};

interface Props {
  entity: CrmEntity;
  title?: string;
  description: string;
  /** Fixed status filter (e.g. the Accounts view of companies). */
  fixedStatus?: string;
  headerExtra?: React.ReactNode;
  /** Keeps the header (create, export) but hides the table, for alternative views such as the deals board. */
  hideTable?: boolean;
}

export function RecordList({ entity, title, description, fixedStatus, headerExtra, hideTable }: Props) {
  const router = useRouter();
  const t = useTableState('createdAt');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canWrite = useCan(`${entity}:write` as 'leads:write');
  const canExport = useCan('data:export');
  const list = useRecordList<{ id: string }>(entity, { ...t.params, status: fixedStatus ?? (status || undefined) }, !hideTable);
  const label = ENTITY_LABEL[entity];
  const filters = fixedStatus ? undefined : STATUS_FILTERS[entity];
  const importable = entity !== 'deals';

  return (
    <div>
      <PageHeader
        title={title ?? label.many}
        description={description}
        actions={
          <div className="flex flex-wrap gap-2">
            {headerExtra}
            {canWrite && importable && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/settings/import?entity=${entity}`}>
                  <Upload aria-hidden /> Import
                </Link>
              </Button>
            )}
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => {
                  setExporting(true);
                  setExportError(null);
                  downloadFile(`/exports/${entity}`, `dealflow-${entity}.csv`)
                    .catch((e: Error) => setExportError(e.message))
                    .finally(() => setExporting(false));
                }}
              >
                <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            )}
            {canWrite && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden /> New {label.one.toLowerCase()}
              </Button>
            )}
          </div>
        }
      />
      {exportError && (
        <p role="alert" className="mb-3 text-sm text-critical">
          {exportError}
        </p>
      )}
      {!hideTable && <DataTable
        caption={title ?? label.many}
        columns={COLUMNS[entity] as unknown as Column<{ id: string }>[]}
        data={list.data}
        loading={list.isPending}
        error={list.error}
        href={(r) => `/app/${entity}/${r.id}`}
        search={t.q}
        onSearch={t.onSearch}
        sort={t.sort}
        onSort={t.onSort}
        page={t.page}
        onPage={t.onPage}
        toolbar={
          filters && (
            <>
              <label htmlFor={`${entity}-status`} className="sr-only">
                Filter by status
              </label>
              <Select
                id={`${entity}-status`}
                className="h-10 w-40"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  t.onPage(1);
                }}
              >
                <option value="">All statuses</option>
                {filters.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </>
          )
        }
        empty={
          t.q || status ? (
            'No records match these filters.'
          ) : (
            <span>
              No {label.many.toLowerCase()} yet.{' '}
              {canWrite && (
                <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setCreating(true)}>
                  Create the first one
                </button>
              )}
            </span>
          )
        }
      />}
      <RecordFormDialog entity={entity} open={creating} onOpenChange={setCreating} onSaved={(row) => router.push(`/app/${entity}/${row.id}`)} />
    </div>
  );
}
