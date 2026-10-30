'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type OperatorTenantDetail, PLAN_CODES, type SubscriptionState } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMinor, INVOICE_STATUS, SUBSCRIPTION_STATUS } from '@/lib/billing';
import { useOperator } from '../../operator-shell';

const STATUSES: SubscriptionState[] = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'CANCELED'];

export default function OperatorTenantPage() {
  const { id } = useParams<{ id: string }>();
  const me = useOperator();
  const t = useQuery({ enabled: !!me.data, queryKey: ['operator', 'tenants', 'detail', id], queryFn: () => api<OperatorTenantDetail>(`/operator/tenants/${id}`) });
  if (!me.data || t.isPending) return <Skeleton className="h-96" />;
  if (t.error) return <ErrorText error={t.error} />;
  const d = t.data;
  const admin = me.data.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <Link href="/operator" className="text-sm text-primary underline-offset-2 hover:underline">
        ← All workspaces
      </Link>
      <PageHeader title={d.name} description={`${d.slug} · created ${formatDate(d.createdAt)} · ${d.members} active member${d.members === 1 ? '' : 's'}${d.isDemo ? ' · demo workspace' : ''}`} />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Subscription
            {d.subscription && <Badge tone={SUBSCRIPTION_STATUS[d.subscription.status].tone}>{SUBSCRIPTION_STATUS[d.subscription.status].label}</Badge>}
            {d.status !== 'ACTIVE' && <Badge tone="critical">{d.status}</Badge>}
          </CardTitle>
          <CardDescription>
            {d.subscription ? `${d.subscription.planCode} · ${d.subscription.seats} seats · ${d.subscription.provider === 'NONE' ? 'managed manually' : `billed through ${d.subscription.provider.toLowerCase()}`}` : 'No subscription row'}
            {d.subscription?.currentPeriodEnd && ` · period ends ${formatDate(d.subscription.currentPeriodEnd)}`}
          </CardDescription>
        </CardHeader>
        {admin && d.subscription && (
          <CardContent className="space-y-6">
            <PlanOverride d={d} />
            <Suspend d={d} />
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {d.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap gap-3">
                  <span>{i.number ?? i.provider.toLowerCase()}</span>
                  <span className="text-muted-foreground">{formatDate(i.issuedAt)}</span>
                  <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                  <span className="tabular">{formatMinor(i.totalCents, i.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Support view</CardTitle>
          <CardDescription>{d.support ? `Granted by the workspace until ${new Date(d.supportAccessUntil!).toLocaleString()}. This view is logged.` : 'The workspace has not granted support access. Ask an owner to turn it on under Administration.'}</CardDescription>
        </CardHeader>
        {d.support && (
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-medium">Members</h2>
              <ul className="space-y-1 text-sm">
                {d.support.members.map((m) => (
                  <li key={m.email}>
                    {m.name} <span className="text-muted-foreground">· {m.email} · {m.role}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Recent audit events</h2>
              <ul className="space-y-1 font-mono text-xs">
                {d.support.audit.map((a, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span> {a.action} <span className="text-muted-foreground">({a.actorType.toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function useOperatorAction(id: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: object) => api<OperatorTenantDetail>(`/operator/tenants/${id}/${path}`, { method: 'POST', json }),
    onSuccess: (d) => qc.setQueryData(['operator', 'tenants', 'detail', id], d),
  });
}

function PlanOverride({ d }: { d: OperatorTenantDetail }) {
  const s = d.subscription!;
  const [planCode, setPlan] = useState(s.planCode);
  const [seats, setSeats] = useState(String(s.seats));
  const [status, setStatus] = useState<SubscriptionState>(s.status);
  const [reason, setReason] = useState('');
  const save = useOperatorAction(d.id, 'plan');
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ planCode, seats: Number(seats), status, reason }, { onSuccess: () => setReason('') });
      }}
    >
      <h2 className="text-sm font-medium">Override plan</h2>
      {s.provider !== 'NONE' && <p className="text-xs text-warning">This workspace pays through {s.provider.toLowerCase()}. The provider’s next webhook will overwrite a manual change; change the subscription in the provider dashboard instead where possible.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="ov-plan" label="Plan">
          <Select id="ov-plan" value={planCode} onChange={(e) => setPlan(e.target.value)}>
            {PLAN_CODES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field id="ov-seats" label="Seats">
          <Input id="ov-seats" type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} className="w-24" />
        </Field>
        <Field id="ov-status" label="Status">
          <Select id="ov-status" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionState)}>
            {STATUSES.map((x) => (
              <option key={x} value={x}>
                {SUBSCRIPTION_STATUS[x].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ov-reason" label="Reason (recorded in both audit logs)" className="min-w-64 flex-1">
          <Input id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
        </Field>
        <Button type="submit" disabled={save.isPending || reason.trim().length < 5}>
          Apply
        </Button>
      </div>
      <ErrorText error={save.error} />
    </form>
  );
}

function Suspend({ d }: { d: OperatorTenantDetail }) {
  const [reason, setReason] = useState('');
  const act = useOperatorAction(d.id, 'status');
  const suspended = d.status === 'SUSPENDED';
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        act.mutate({ suspended: !suspended, reason }, { onSuccess: () => setReason('') });
      }}
    >
      <h2 className="text-sm font-medium">{suspended ? 'Reactivate workspace' : 'Suspend workspace'}</h2>
      <p className="text-xs text-muted-foreground">{suspended ? 'Members can sign in again immediately.' : 'Members are signed out of this workspace on their next request. No data is changed or deleted.'}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="st-reason" label="Reason" className="min-w-64 flex-1">
          <Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
        </Field>
        <Button type="submit" variant={suspended ? 'default' : 'destructive'} disabled={act.isPending || reason.trim().length < 5}>
          {suspended ? 'Reactivate' : 'Suspend'}
        </Button>
      </div>
      <ErrorText error={act.error} />
    </form>
  );
}
