'use client';

import { Badge, Card, Skeleton } from '@dealflow/ui';
import type { OperatorMobileOverview } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { MOBILE_STATUS, PLATFORM_LABEL } from '@/lib/mobile';
import { useOperator } from '../operator-shell';

/** Console Admin: Mobile Application Management (ADR 0072). Requests first, then organisations using the app. */
export default function OperatorMobilePage() {
  const me = useOperator();
  const q = useQuery({ enabled: !!me.data, queryKey: ['operator', 'mobile'], queryFn: () => api<OperatorMobileOverview>('/operator/mobile') });
  if (!me.data || q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  const stats = [
    { label: 'Organisations using the app', value: d.totals.live },
    { label: 'Waiting for a decision', value: d.totals.requested },
    { label: 'Suspended', value: d.totals.suspended },
    { label: 'Phones signed in', value: d.totals.devices },
    { label: 'iPhone', value: d.totals.ios },
    { label: 'Android', value: d.totals.android },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Mobile app" description="Approve, suspend or withdraw each client organisation’s access to the SampForce iPhone and Android app. Mobile access is separate from web access: switching it off signs phones out and changes nothing else." />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular">{s.value}</dd>
          </Card>
        ))}
      </dl>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Mobile access by organisation</caption>
          <thead className="text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="p-3 font-medium">Organisation</th>
              <th scope="col" className="p-3 font-medium">Mobile access</th>
              <th scope="col" className="p-3 font-medium">Plan</th>
              <th scope="col" className="p-3 font-medium">Switched on</th>
              <th scope="col" className="p-3 text-end font-medium">Phones</th>
              <th scope="col" className="p-3 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.tenantId} className="border-t border-border align-top">
                <td className="p-3">
                  <Link href={`/operator/mobile/${r.tenantId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {r.name}
                  </Link>
                  {r.requestMessage && <p className="mt-1 max-w-sm text-xs text-muted-foreground">“{r.requestMessage}”</p>}
                </td>
                <td className="p-3">
                  <Badge tone={MOBILE_STATUS[r.status].tone}>{MOBILE_STATUS[r.status].label}</Badge>
                  {r.live && <Badge tone="success" className="ms-2">In use</Badge>}
                  {r.requestedAt && <span className="ms-2 text-xs text-muted-foreground">{formatDate(r.requestedAt)}</span>}
                </td>
                <td className="p-3">
                  {r.planCode ?? 'free'}
                  {!r.inPlan && <span className="ms-2 text-xs text-warning">not in plan</span>}
                </td>
                <td className="p-3">{r.activated ? 'Yes' : 'No'}</td>
                <td className="p-3 text-end tabular">
                  {r.devices.active}
                  {r.devices.active > 0 && <span className="ms-1 text-xs text-muted-foreground">({r.devices.ios} iPhone · {r.devices.android} Android)</span>}
                </td>
                <td className="p-3 text-muted-foreground">{r.lastSeenAt ? formatDate(r.lastSeenAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="size-4" aria-hidden /> App versions in use
        </h2>
        {d.versions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No phones are signed in yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {d.versions.map((v) => (
              <li key={`${v.platform}-${v.appVersion}`}>
                {PLATFORM_LABEL[v.platform]} {v.appVersion} <span className="text-muted-foreground">· {v.devices} phone{v.devices === 1 ? '' : 's'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
