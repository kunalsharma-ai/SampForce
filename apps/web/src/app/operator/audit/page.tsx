'use client';

import { Card, Skeleton } from '@dealflow/ui';
import type { PlatformAuditRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';
import { fmtLocale } from '@/lib/i18n/locale';

export default function OperatorAudit() {
  const me = useOperator();
  const log = useQuery({ enabled: !!me.data, queryKey: ['operator', 'audit'], queryFn: () => api<PlatformAuditRow[]>('/operator/audit-log') });
  if (!me.data || log.isPending) return <Skeleton className="h-64" />;
  return (
    <>
      <PageHeader title="Operator log" description="Every operator sign-in, view and change, newest first. The application cannot edit or delete these entries." />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Operator log</caption>
          <thead className="text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="p-3 font-medium">When</th>
              <th scope="col" className="p-3 font-medium">Operator</th>
              <th scope="col" className="p-3 font-medium">Action</th>
              <th scope="col" className="p-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {log.data?.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-3 text-muted-foreground">{new Date(r.createdAt).toLocaleString(fmtLocale())}</td>
                <td className="p-3">{r.operator?.email ?? '—'}</td>
                <td className="p-3 font-mono text-xs">{r.action}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">{Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
