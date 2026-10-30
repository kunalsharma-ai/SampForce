'use client';

import { Badge, Card, Input, Skeleton } from '@dealflow/ui';
import type { OperatorTenantRow } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, SUBSCRIPTION_STATUS } from '@/lib/billing';
import { useOperator } from './operator-shell';

export default function OperatorTenants() {
  const me = useOperator();
  const [search, setSearch] = useState('');
  const list = useQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'tenants', search],
    queryFn: () => api<OperatorTenantRow[]>(`/operator/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });
  if (!me.data) return <Skeleton className="h-64" />;
  return (
    <>
      <PageHeader title="Workspaces" description="Plan, seats and member counts. CRM records are never shown here; member lists and workspace audit logs only appear while a workspace grants support access." />
      <label htmlFor="op-search" className="sr-only">
        Search workspaces
      </label>
      <Input id="op-search" placeholder="Search by name or slug" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-sm" />
      <ErrorText error={list.error} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Workspaces</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="p-3 font-medium">Workspace</th>
              <th scope="col" className="p-3 font-medium">Plan</th>
              <th scope="col" className="p-3 font-medium">Billing</th>
              <th scope="col" className="p-3 text-right font-medium">Members / seats</th>
              <th scope="col" className="p-3 font-medium">Created</th>
              <th scope="col" className="p-3 font-medium">Support access</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="p-3">
                  <Link href={`/operator/tenants/${t.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {t.name}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{t.slug}</span>
                  {t.isDemo && <Badge className="ml-2">Demo</Badge>}
                  {t.status !== 'ACTIVE' && <Badge tone="critical" className="ml-2">{t.status === 'SUSPENDED' ? 'Suspended' : 'Pending deletion'}</Badge>}
                </td>
                <td className="p-3">{t.subscription?.planCode ?? 'free'}</td>
                <td className="p-3">
                  {t.subscription && <Badge tone={SUBSCRIPTION_STATUS[t.subscription.status].tone}>{SUBSCRIPTION_STATUS[t.subscription.status].label}</Badge>}
                  <span className="ml-2 text-xs text-muted-foreground">{t.subscription?.provider === 'NONE' ? 'manual' : t.subscription?.provider.toLowerCase()}</span>
                </td>
                <td className="p-3 text-right tabular">
                  {t.members} / {t.subscription?.planCode === 'free' ? 2 : (t.subscription?.seats ?? 1)}
                </td>
                <td className="p-3 text-muted-foreground">{formatDate(t.createdAt)}</td>
                <td className="p-3 text-muted-foreground">{t.supportAccessUntil ? `until ${new Date(t.supportAccessUntil).toLocaleString()}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">No workspaces match.</p>}
      </Card>
    </>
  );
}
