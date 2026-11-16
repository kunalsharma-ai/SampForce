'use client';

import { RFQ_STATUSES, type RfqRow, type RfqStatus } from '@dealflow/types';
import { Card, CardContent, cn, Input, Skeleton } from '@dealflow/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { RfqDialog, RfqItem } from '@/components/crm/rfqs';
import { RFQ_STATUS_LABEL } from '@/components/crm/work-labels';
import { formatMoneyList, useRfq, useRfqReport, useRfqs } from '@/lib/company-work';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const REPORTS: { by: 'company' | 'employee' | 'owner'; label: MessageKey }[] = [
  { by: 'company', label: 'By company' },
  { by: 'employee', label: 'By client employee' },
  { by: 'owner', label: 'By executive' },
];

/** The RFQ register with filters, and RFQ reports by company, client employee and executive. */
export function RfqsWorkspace() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const canWrite = useCan('companies:write');
  const [tab, setTab] = React.useState<'list' | 'company' | 'employee' | 'owner'>('list');
  const [status, setStatus] = React.useState<RfqStatus | ''>('');
  const [open, setOpen] = React.useState<'' | 'true' | 'false'>('');
  const [q, setQ] = React.useState('');
  const list = useRfqs({ status, open, q: q.trim() || undefined }, tab === 'list');
  const report = useRfqReport(tab === 'list' ? 'company' : tab, tab !== 'list');
  // ?open=<id> opens one RFQ, as links from interactions and notifications do.
  const openId = params.get('open');
  const linked = useRfq(openId);
  const [editing, setEditing] = React.useState<RfqRow | null>(null);
  React.useEffect(() => {
    if (linked.data) setEditing(linked.data);
  }, [linked.data]);
  const close = (o: boolean) => {
    if (o) return;
    setEditing(null);
    if (openId) router.replace('/app/rfqs');
  };
  const tabs: { id: typeof tab; label: MessageKey }[] = [{ id: 'list', label: 'All RFQs' }, ...REPORTS.map((r) => ({ id: r.by, label: r.label }))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('RFQ views')}>
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={cn('h-9 rounded-full border px-4 text-sm font-medium', tab === x.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted')}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {tab === 'list' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Input aria-label={t('Search RFQs')} placeholder={t('Search by number or project')} className="h-9 w-64" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label={t('RFQ status')} className="h-9 rounded-md border border-input bg-surface px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as RfqStatus | '')}>
              <option value="">{t('All statuses')}</option>
              {RFQ_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(RFQ_STATUS_LABEL[s])}
                </option>
              ))}
            </select>
            <select aria-label={t('Open or closed')} className="h-9 rounded-md border border-input bg-surface px-2 text-sm" value={open} onChange={(e) => setOpen(e.target.value as '' | 'true' | 'false')}>
              <option value="">{t('Open and closed')}</option>
              <option value="true">{t('Open only')}</option>
              <option value="false">{t('Closed only')}</option>
            </select>
          </div>
          {list.isPending ? (
            <Skeleton className="h-40" />
          ) : list.error ? (
            <p role="alert" className="text-sm text-critical">
              {list.error.message}
            </p>
          ) : !list.data?.items.length ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('No RFQs yet. Add one from a company page.')}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('{count} RFQs', { count: list.data.total })}</p>
              <ul className="space-y-2">
                {list.data.items.map((r) => (
                  <RfqItem key={r.id} r={r} onEdit={canWrite ? setEditing : undefined} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            {report.isPending ? (
              <Skeleton className="m-4 h-32" />
            ) : !report.data?.length ? (
              <p className="p-6 text-sm text-muted-foreground">{t('No RFQs yet. Add one from a company page.')}</p>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-border text-xs text-muted-foreground">
                  <tr>
                    {(['Name', 'Received', 'Submitted', 'Won', 'Lost', 'Open', 'Quoted value', 'Won value'] as const).map((h, i) => (
                      <th key={h} scope="col" className={cn('px-3 py-2 font-medium', i ? 'text-end' : 'text-start')}>
                        {t(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.data.map((r) => (
                    <tr key={r.key ?? 'none'}>
                      <td className="px-3 py-2 font-medium">{r.label || t('Not set')}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.received}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.submitted}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-success">{r.won}</td>
                      <td className="px-3 py-2 text-end tabular-nums text-critical">{r.lost}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{r.open}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatMoneyList(r.quoted, t.formatLocale)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{formatMoneyList(r.wonValue, t.formatLocale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
      {editing && <RfqDialog company={{ id: editing.company.id, name: editing.company.name }} rfq={editing} open={!!editing} onOpenChange={close} />}
    </div>
  );
}
