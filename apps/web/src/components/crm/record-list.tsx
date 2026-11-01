'use client';

import { Badge, Button } from '@dealflow/ui';
import type { CompanyRow, ContactRow, DealRow, LeadRow } from '@dealflow/types';
import { Download, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { type CrmEntity, DEAL_STATUS_TONE, ENTITY_LABEL, formatDate, formatMoney, LEAD_STATUS_TONE, titleCase, useMembers, useRecordList } from '@/lib/crm';
import { downloadFile } from '@/lib/api';
import { useCan } from '@/lib/session';
import { DataTable } from '@/components/data-table/data-table';
import { type TableColumn, useTableView } from '@/components/data-table/use-table-view';
import { type MessageKey, Tr, useT } from '@/lib/i18n';

import { RecordFormDialog } from './record-form';
import { Select } from './select';
import { PriorityBadge, RiskIndicator } from '@/components/deals/deal-badges';

/** Column headers are catalogue phrases; the table translates them when it renders. */
const h = (key: MessageKey): string => key;

const owner = <T extends { owner: { name: string } | null }>(): TableColumn<T> => ({ id: 'owner', header: h('Owner'), cell: (r) => r.owner?.name ?? '—', text: (r) => r.owner?.name ?? null, size: 150 });
const created = <T extends { createdAt: string }>(): TableColumn<T> => ({ id: 'createdAt', header: h('Created'), sortKey: 'createdAt', cell: (r) => formatDate(r.createdAt), size: 130 });
const updated = <T extends { updatedAt?: string }>(): TableColumn<T> => ({ id: 'updatedAt', header: h('Updated'), sortKey: 'updatedAt', cell: (r) => (r.updatedAt ? formatDate(r.updatedAt) : '—'), size: 130, defaultHidden: true });

const COLUMNS = {
  leads: [
    { id: 'fullName', header: h('Name'), sortKey: 'fullName', cell: (r) => r.fullName, text: (r) => r.fullName, size: 200 },
    { id: 'company', header: h('Company'), sortKey: 'companyName', cell: (r) => r.companyName ?? '—', text: (r) => r.companyName, size: 180 },
    { id: 'email', header: h('Email'), cell: (r) => r.email ?? '—', text: (r) => r.email, size: 220 },
    { id: 'status', header: h('Status'), sortKey: 'status', cell: (r) => <Badge tone={LEAD_STATUS_TONE[r.status]}><Tr text={titleCase(r.status)} /></Badge>, size: 130 },
    { id: 'value', header: h('Est. value'), sortKey: 'estimatedValue', cell: (r) => formatMoney(r.estimatedValue, r.currency ?? 'USD'), align: 'right', size: 130 },
    owner<LeadRow>(),
    created<LeadRow>(),
    updated<LeadRow>(),
  ] satisfies TableColumn<LeadRow>[],
  contacts: [
    { id: 'name', header: h('Name'), sortKey: 'firstName', cell: (r) => r.fullName, text: (r) => r.fullName, size: 200 },
    { id: 'title', header: h('Job title'), sortKey: 'jobTitle', cell: (r) => r.jobTitle ?? '—', text: (r) => r.jobTitle, size: 180 },
    { id: 'company', header: h('Company'), cell: (r) => r.company?.name ?? '—', text: (r) => r.company?.name ?? null, size: 180 },
    { id: 'email', header: h('Email'), sortKey: 'email', cell: (r) => r.email ?? '—', text: (r) => r.email, size: 220 },
    { id: 'phone', header: h('Phone'), cell: (r) => r.phone ?? '—', text: (r) => r.phone, size: 150 },
    owner<ContactRow>(),
    created<ContactRow>(),
    updated<ContactRow>(),
  ] satisfies TableColumn<ContactRow>[],
  companies: [
    { id: 'name', header: h('Name'), sortKey: 'name', cell: (r) => r.name, text: (r) => r.name, size: 200 },
    { id: 'domain', header: h('Domain'), sortKey: 'domain', cell: (r) => r.domain ?? '—', text: (r) => r.domain, size: 170 },
    { id: 'industry', header: h('Industry'), sortKey: 'industry', cell: (r) => r.industry ?? '—', text: (r) => r.industry, size: 160 },
    { id: 'contacts', header: h('Contacts'), cell: (r) => r.contactCount, align: 'right', size: 110 },
    { id: 'deals', header: h('Open deals'), cell: (r) => r.openDealCount, align: 'right', size: 110 },
    owner<CompanyRow>(),
    created<CompanyRow>(),
    updated<CompanyRow>(),
  ] satisfies TableColumn<CompanyRow>[],
  deals: [
    { id: 'name', header: h('Deal'), sortKey: 'name', cell: (r) => r.name, text: (r) => r.name, size: 220 },
    { id: 'amount', header: h('Amount'), sortKey: 'amount', cell: (r) => formatMoney(r.amount, r.currency), align: 'right', size: 130 },
    { id: 'stage', header: h('Stage'), cell: (r) => r.stage.name, size: 150 },
    { id: 'status', header: h('Status'), sortKey: 'status', cell: (r) => <Badge tone={DEAL_STATUS_TONE[r.status]}><Tr text={titleCase(r.status)} /></Badge>, size: 110 },
    { id: 'company', header: h('Company'), cell: (r) => r.company?.name ?? '—', text: (r) => r.company?.name ?? null, size: 180 },
    { id: 'close', header: h('Expected close'), sortKey: 'expectedCloseDate', cell: (r) => formatDate(r.expectedCloseDate), size: 140 },
    { id: 'priority', header: h('Priority'), sortKey: 'priority', cell: (r) => (r.priority ? <PriorityBadge priority={r.priority} /> : '—'), text: (r) => (r.priority ? titleCase(r.priority) : null), size: 120 },
    { id: 'health', header: h('Health'), cell: (r) => <RiskIndicator health={r.health} />, size: 140, defaultHidden: true },
    owner<DealRow>(),
    created<DealRow>(),
    updated<DealRow>(),
  ] satisfies TableColumn<DealRow>[],
};

const DEFAULT_SORT = [{ id: 'createdAt', desc: true }];

const BULK_LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'].map((s) => ({ value: s, label: titleCase(s) }));

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
  const t = useT();
  const view = useTableView<{ id: string }>(entity, COLUMNS[entity] as unknown as TableColumn<{ id: string }>[], DEFAULT_SORT);
  const members = useMembers();
  const status = view.config.filters.status ?? '';
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canWrite = useCan(`${entity}:write` as 'leads:write');
  const canExport = useCan('data:export');
  const list = useRecordList<{ id: string }>(entity, { ...view.params, status: fixedStatus ?? view.params.status }, !hideTable);
  const label = ENTITY_LABEL[entity];
  const filters = fixedStatus ? undefined : STATUS_FILTERS[entity];
  const importable = entity !== 'deals';

  return (
    <div>
      <PageHeader
        title={t.maybe(title ?? label.many)}
        description={t.maybe(description)}
        actions={
          <div className="flex flex-wrap gap-2">
            {headerExtra}
            {canWrite && importable && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/settings/import?entity=${entity}`}>
                  <Upload aria-hidden /> {t('Import')}
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
                <Download aria-hidden /> {exporting ? t('Exporting…') : t('Export CSV')}
              </Button>
            )}
            {canWrite && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden /> {t.maybe(`New ${label.one.toLowerCase()}`)}
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
      {!hideTable && (
        <DataTable
          caption={t.maybe(title ?? label.many)}
          view={view}
          noun={label}
          data={list.data}
          loading={list.isPending}
          error={list.error}
          href={(r) => `/app/${entity}/${r.id}`}
          bulk={canWrite ? { statuses: entity === 'leads' ? BULK_LEAD_STATUSES : undefined } : undefined}
          filters={
            <>
              {filters && (
                <>
                  <label htmlFor={`${entity}-status`} className="sr-only">
                    {t('Filter by status')}
                  </label>
                  <Select id={`${entity}-status`} className="h-control min-w-0 flex-1 sm:w-40 sm:flex-none" value={status} onChange={(e) => view.setFilter({ status: e.target.value || undefined })}>
                    <option value="">{t('All statuses')}</option>
                    {filters.map((f) => (
                      <option key={f.value} value={f.value}>
                        {t.maybe(f.label)}
                      </option>
                    ))}
                  </Select>
                </>
              )}
              <label htmlFor={`${entity}-owner`} className="sr-only">
                {t('Filter by owner')}
              </label>
              <Select id={`${entity}-owner`} className="h-control min-w-0 flex-1 sm:w-40 sm:flex-none" value={view.config.filters.ownerId ?? ''} onChange={(e) => view.setFilter({ ownerId: e.target.value || undefined })}>
                <option value="">{t('Any owner')}</option>
                <option value="me">{t('Owned by me')}</option>
                {members.data
                  ?.filter((m) => m.status === 'ACTIVE')
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </>
          }
          empty={
            view.config.q || status || view.config.filters.ownerId ? (
              t('No records match these filters.')
            ) : (
              <span>
                {t.maybe(`No ${label.many.toLowerCase()} yet.`)}{' '}
                {canWrite && (
                  <button type="button" className="text-primary underline underline-offset-4" onClick={() => setCreating(true)}>
                    {t('Create the first one')}
                  </button>
                )}
              </span>
            )
          }
        />
      )}
      <RecordFormDialog entity={entity} open={creating} onOpenChange={setCreating} onSaved={(row) => router.push(`/app/${entity}/${row.id}`)} />
    </div>
  );
}
