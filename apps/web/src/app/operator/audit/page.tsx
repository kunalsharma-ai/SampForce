'use client';

import { Button, Card, Input, Skeleton } from '@dealflow/ui';
import type { ConsoleClientRow, PlatformAuditRow } from '@dealflow/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';
import { fmtLocale } from '@/lib/i18n/locale';

const PAGE = 100;

/** A short line for each change an entry lists, or its other details. */
function details(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Array.isArray(m.changes)) for (const c of m.changes) if (typeof c === 'string') out.push(c);
  if (typeof m.reason === 'string' && m.reason) out.push(`Reason: ${m.reason}`);
  const rest = Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'changes' && k !== 'reason'));
  if (Object.keys(rest).length) out.push(JSON.stringify(rest));
  return out;
}

/**
 * The platform log (ADR 0071, part 7): every operator sign-in, look and change across SampForce, newest first, with
 * the client each entry is about. It is append-only; filters only narrow what is shown.
 */
export default function OperatorAudit() {
  const me = useOperator();
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const clients = useQuery({ enabled: !!me.data, queryKey: ['operator', 'clients', 'all'], queryFn: () => api<ConsoleClientRow[]>('/operator/clients') });
  const log = useInfiniteQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'audit', tenantId, action.trim()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (tenantId) p.set('tenantId', tenantId);
      if (action.trim()) p.set('action', action.trim());
      if (pageParam) p.set('before', pageParam);
      return api<PlatformAuditRow[]>(`/operator/audit-log?${p}`);
    },
    getNextPageParam: (last) => (last.length === PAGE ? (last.at(-1)?.createdAt ?? null) : null),
  });
  if (!me.data) return <Skeleton className="h-64" />;
  const rows = log.data?.pages.flat() ?? [];
  return (
    <>
      <PageHeader title="Platform audit log" description="Every operator sign-in, view and change across SampForce, newest first, with the client it concerns. The application cannot edit or delete these entries." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-2xl" role="group" aria-label="Filter the platform audit log">
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-client" className="block font-medium">Client</label>
          <Select id="audit-client" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">All clients and the platform</option>
            {clients.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="audit-action" className="block font-medium">Action contains</label>
          <Input id="audit-action" value={action} placeholder="subscription, plan., support_ticket" onChange={(e) => setAction(e.target.value)} />
        </div>
      </div>
      <Card className="overflow-x-auto" data-platform-audit>
        {log.isPending ? (
          <Skeleton className="h-64" />
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nothing recorded matches these filters.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Platform audit log</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 text-start font-medium">When</th>
                <th scope="col" className="p-3 text-start font-medium">Operator</th>
                <th scope="col" className="p-3 text-start font-medium">Action</th>
                <th scope="col" className="p-3 text-start font-medium">Client</th>
                <th scope="col" className="p-3 text-start font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top" data-platform-entry={r.action}>
                  <td className="p-3 text-muted-foreground">
                    <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString(fmtLocale())}</time>
                  </td>
                  <td className="p-3">{r.operator?.email ?? 'SampForce (automatic)'}</td>
                  <td className="p-3 font-mono text-xs">{r.action}</td>
                  <td className="p-3" data-platform-client>{r.client ? (r.client.name ?? 'Deleted client') : '—'}</td>
                  <td className="p-3 text-xs text-muted-foreground">
                    <ul className="space-y-0.5">
                      {details(r.metadata).map((d, i) => (
                        <li key={i} className="break-all">{d}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {log.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>
          {log.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  );
}
