'use client';

import { Badge, Card, Skeleton } from '@dealflow/ui';
import type { ConsoleOverview } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CalendarClock, CreditCard, Layers, Users } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMinor } from '@/lib/billing';
import { useOperator } from './operator-shell';

/**
 * The Console Admin's dashboard (ADR 0071): platform figures across client organisations. It never lists individual
 * sales people or records, and it has no recent-activity feed: the audit log is its own page.
 */
export default function ConsoleOverviewPage() {
  const me = useOperator();
  const o = useQuery({ enabled: !!me.data, queryKey: ['operator', 'overview'], queryFn: () => api<ConsoleOverview>('/operator/overview') });
  if (!me.data || o.isPending) return <Skeleton className="h-96" />;
  if (o.error) return <ErrorText error={o.error} />;
  const d = o.data;
  const money = (rows: { currency: string; cents: number }[]) => (rows.length ? rows.map((r) => formatMinor(r.cents, r.currency)).join(' · ') : '—');

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Your clients, subscriptions and workspaces across the platform. Open a client to change its plan, limits or authority." />
      <section aria-label="Platform figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Building2} label="Client organisations" value={d.clients.total} detail={`${d.clients.active} active · ${d.clients.suspended} suspended · ${d.clients.deactivated} deactivated`} href="/operator/clients" />
        <Tile icon={Layers} label="Super Workspaces" value={d.superWorkspaces} detail="One for each client" />
        <Tile icon={CreditCard} label="Active subscriptions" value={d.subscriptions.active} detail={`${d.subscriptions.trialing} on trial · ${d.subscriptions.inactive} inactive`} />
        <Tile icon={Users} label="Manager / Executive Workspaces" value={`${d.workspaces.managers} / ${d.workspaces.executives}`} detail="Across all clients" />
      </section>
      <section aria-label="Revenue" className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm text-muted-foreground">Subscription revenue per month</h2>
          <p className="mt-1 text-2xl font-semibold tabular" data-overview="mrr">{money(d.monthlyRecurring)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Agreed prices of active subscriptions, annual ones divided by twelve.</p>
        </Card>
        <Card className="p-4">
          <h2 className="text-sm text-muted-foreground">Outstanding payments</h2>
          <p className="mt-1 text-2xl font-semibold tabular" data-overview="outstanding">{money(d.outstanding)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.outstanding.reduce((a, r) => a + r.clients, 0)} client{d.outstanding.reduce((a, r) => a + r.clients, 0) === 1 ? '' : 's'}: open invoices and subscriptions marked pending or overdue.
          </p>
        </Card>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-medium">Plans sold</h2>
          {d.plansSold.length ? (
            <div className="mt-3 h-56" role="img" aria-label={`Clients per plan: ${d.plansSold.map((p) => `${p.name} ${p.clients}`).join(', ')}`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.plansSold.map((p) => ({ name: p.name.replace('SampForce ', ''), clients: p.clients }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Bar dataKey="clients" name="Clients" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No active subscriptions yet.</p>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
            Renewals in the next 30 days
          </h2>
          {d.renewals.length ? (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Renewals in the next 30 days</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 text-start font-medium">Client</th>
                  <th scope="col" className="py-1 text-start font-medium">Plan</th>
                  <th scope="col" className="py-1 text-start font-medium">Renews</th>
                </tr>
              </thead>
              <tbody>
                {d.renewals.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1.5">
                      <Link href={`/operator/clients/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{r.name}</Link>
                    </td>
                    <td className="py-1.5">{r.planName}</td>
                    <td className="py-1.5 tabular">
                      {formatDate(r.renewsOn)} {!r.autoRenew && <Badge tone="warning">Manual</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Nothing renews in the next 30 days.</p>
          )}
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          Clients that need you
        </h2>
        {d.needsAttention.length ? (
          <ul className="mt-3 divide-y divide-border text-sm" data-overview="attention">
            {d.needsAttention.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/operator/clients/${a.id}`} className="font-medium text-primary underline-offset-2 hover:underline">{a.name}</Link>
                <span className="text-muted-foreground">{a.why}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Every client is in good standing.</p>
        )}
      </Card>
    </div>
  );
}

function Tile({ icon: Icon, label, value, detail, href }: { icon: typeof Building2; label: string; value: number | string; detail: string; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
