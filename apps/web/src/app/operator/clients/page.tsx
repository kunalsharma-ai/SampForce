'use client';

import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { type ClientState, type ConsoleClientCreated, type ConsoleClientRow, type ConsolePlanRow, type OperatorOpenInvoice, PAYMENT_STATUS_LABEL, PAYMENT_STATUSES, type PaymentStatus, PLAN_CATALOG } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMinor } from '@/lib/billing';
import { PaymentBadge, price, selectClass, StateBadge, toCents, toLimit } from '../console-ui';
import { useOperator } from '../operator-shell';

/** Client organisations (ADR 0071): each has one Super Workspace, a subscription and its workspace limits. */
export default function ConsoleClientsPage() {
  const me = useOperator();
  const [search, setSearch] = useState('');
  const [state, setState] = useState<ClientState | 'ALL'>('ALL');
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    enabled: !!me.data,
    queryKey: ['operator', 'clients', search],
    queryFn: () => api<ConsoleClientRow[]>(`/operator/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });
  if (!me.data) return <Skeleton className="h-64" />;
  const rows = (list.data ?? []).filter((r) => state === 'ALL' || r.state === state);
  return (
    <>
      <PageHeader
        title="Clients"
        description="Client organisations, their plans, terms and workspace usage. CRM records are never shown here."
        actions={
          me.data.role === 'ADMIN' ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              New client
            </Button>
          ) : undefined
        }
      />
      <AwaitingPayment />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="op-search" className="sr-only">
            Search clients
          </label>
          <Input id="op-search" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </div>
        <div>
          <label htmlFor="op-state" className="sr-only">
            Status
          </label>
          <select id="op-state" className={`${selectClass} w-44`} value={state} onChange={(e) => setState(e.target.value as ClientState | 'ALL')}>
            <option value="ALL">Every status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="DEACTIVATED">Deactivated</option>
          </select>
        </div>
      </div>
      <ErrorText error={list.error} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm" data-console-clients="">
          <caption className="sr-only">Clients</caption>
          <thead className="text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="p-3 text-start font-medium">Client</th>
              <th scope="col" className="p-3 text-start font-medium">Plan</th>
              <th scope="col" className="p-3 text-start font-medium">Price</th>
              <th scope="col" className="p-3 text-start font-medium">Payment</th>
              <th scope="col" className="p-3 text-start font-medium">Renews</th>
              <th scope="col" className="p-3 text-end font-medium">Managers</th>
              <th scope="col" className="p-3 text-end font-medium">Executives</th>
              <th scope="col" className="p-3 text-end font-medium">People</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = c.subscription;
              return (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3">
                    <Link href={`/operator/clients/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                    <span className="ms-2">
                      {c.closure ? <Badge tone="critical">Closing</Badge> : <StateBadge state={c.state} />}
                    </span>
                    {c.closure && <span className="ms-2 text-xs text-muted-foreground" data-erased-on>erased on {formatDate(c.closure.eraseAfter)}</span>}
                    {c.awaitingAdministrator && <span className="ms-2 text-xs text-muted-foreground">administrator not joined</span>}
                  </td>
                  <td className="p-3">{s?.planName.replace('SampForce ', '') ?? '—'}</td>
                  <td className="p-3 tabular">{s ? price(s.priceCents, s.currency, s.billingFrequency) : '—'}</td>
                  <td className="p-3">
                    <PaymentBadge status={s?.paymentStatus ?? null} />
                  </td>
                  <td className="p-3 tabular">{s?.renewsOn ? formatDate(s.renewsOn) : '—'}</td>
                  <td className="p-3 text-end tabular">{s ? `${c.usage.managers} / ${s.limits.managers ?? '∞'}` : c.usage.managers}</td>
                  <td className="p-3 text-end tabular">{s ? `${c.usage.executives} / ${s.limits.executives ?? '∞'}` : c.usage.executives}</td>
                  <td className="p-3 text-end tabular">{c.people}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.isPending && <Skeleton className="m-3 h-24" />}
        {list.data && rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No clients match.</p>}
      </Card>
      {creating && <NewClientDialog onClose={() => setCreating(false)} />}
    </>
  );
}

/** Offline invoices clients have requested and not yet paid. Payments are recorded on the client's billing page. */
function AwaitingPayment() {
  const open = useQuery({ queryKey: ['operator', 'invoices', 'open'], queryFn: () => api<OperatorOpenInvoice[]>('/operator/invoices/open'), staleTime: 0, refetchOnMount: 'always' });
  if (!open.data?.length) return <ErrorText error={open.error} />;
  return (
    <Card className="mb-6 p-4">
      <h2 className="text-sm font-medium">Waiting for payment ({open.data.length})</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {open.data.map((i) => (
          <li key={i.id} className="flex flex-wrap gap-x-3">
            <Link href={`/operator/tenants/${i.tenant.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
              {i.tenant.name}
            </Link>
            <span>{i.number}</span>
            <span className="text-muted-foreground">
              {PLAN_CATALOG.find((p) => p.code === i.planCode)?.name ?? i.planCode} · {i.seats} seats · {i.interval === 'YEAR' ? 'annual' : 'monthly'} · issued {formatDate(i.issuedAt)}
            </span>
            <span className="tabular">{formatMinor(i.totalCents, i.currency)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewClientDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const plans = useQuery({ queryKey: ['operator', 'console-plans'], queryFn: () => api<ConsolePlanRow[]>('/operator/console-plans') });
  const offered = (plans.data ?? []).filter((p) => p.terms.available);
  const [f, setF] = useState({
    org: '', adminName: '', adminEmail: '', designation: 'Client Administrator', planCode: '', seats: '10', startsOn: new Date().toISOString().slice(0, 10), months: '',
    price: '', currency: '', paymentStatus: 'PENDING' as PaymentStatus, managers: '', executives: '', superExecutives: true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const plan = offered.find((p) => p.code === f.planCode) ?? offered[0];
  const [created, setCreated] = useState<ConsoleClientCreated | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<ConsoleClientCreated>('/operator/clients', {
        method: 'POST',
        json: {
          organisation: { name: f.org },
          administrator: { name: f.adminName, email: f.adminEmail, ...(f.designation.trim() ? { designation: f.designation } : {}) },
          planCode: plan?.code ?? '',
          seats: Number(f.seats) || 1,
          startsOn: f.startsOn,
          ...(f.months ? { durationMonths: Number(f.months) } : {}),
          ...(f.price.trim() ? { priceCents: toCents(f.price) } : {}),
          ...(f.currency.trim() ? { currency: f.currency } : {}),
          paymentStatus: f.paymentStatus,
          ...(f.managers.trim() ? { maxManagerWorkspaces: toLimit(f.managers) } : {}),
          ...(f.executives.trim() ? { maxExecutiveWorkspaces: toLimit(f.executives) } : {}),
          superCanCreateExecutives: f.superExecutives,
          reason: 'New client',
        },
      }),
    onSuccess: (r) => {
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['operator', 'overview'] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{created ? 'Client created' : 'New client organisation'}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {created
            ? 'Send this link to the administrator. It works once and for seven days; you can send a new one from the client’s page.'
            : 'Creates the organisation, its Super Workspace and subscription, and an invitation for the administrator, who joins as the Super Workspace’s owner.'}
        </DialogDescription>
        {created ? (
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={created.inviteUrl} aria-label="Administrator invitation link" />
              <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(created.inviteUrl)}>
                <Copy className="size-4" aria-hidden />
                Copy
              </Button>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => router.push(`/operator/clients/${created.client.id}`)}>Open client</Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Organisation and administrator</legend>
              <Field id="nc-org" label="Organisation name" className="sm:col-span-2">
                <Input id="nc-org" required minLength={2} value={f.org} onChange={set('org')} />
              </Field>
              <Field id="nc-admin" label="Administrator’s name">
                <Input id="nc-admin" required value={f.adminName} onChange={set('adminName')} />
              </Field>
              <Field id="nc-email" label="Administrator’s email">
                <Input id="nc-email" type="email" required value={f.adminEmail} onChange={set('adminEmail')} />
              </Field>
              <Field id="nc-designation" label="Administrator’s designation" hint="Shown in their profile. It grants nothing by itself." className="sm:col-span-2">
                <Input id="nc-designation" value={f.designation} onChange={set('designation')} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-2 text-sm font-semibold">Subscription</legend>
              <Field id="nc-plan" label="Plan" className="sm:col-span-2">
                <select id="nc-plan" className={selectClass} value={plan?.code ?? ''} onChange={set('planCode')}>
                  {offered.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name.replace('SampForce ', '')} · {p.features.length} features · {price(p.terms.priceCents, p.terms.currency, p.terms.billingFrequency)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="nc-seats" label="Seats">
                <Input id="nc-seats" type="number" min={1} required value={f.seats} onChange={set('seats')} />
              </Field>
              <Field id="nc-start" label="Starts on">
                <Input id="nc-start" type="date" required value={f.startsOn} onChange={set('startsOn')} />
              </Field>
              <Field id="nc-months" label="Term in months" hint={plan ? `Plan: ${plan.terms.durationMonths}` : undefined}>
                <Input id="nc-months" type="number" min={1} max={120} value={f.months} onChange={set('months')} placeholder={plan ? String(plan.terms.durationMonths) : ''} />
              </Field>
              <Field id="nc-payment" label="Payment">
                <select id="nc-payment" className={selectClass} value={f.paymentStatus} onChange={set('paymentStatus')}>
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PAYMENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="nc-price" label="Agreed price per period" hint={plan ? `Plan: ${price(plan.terms.priceCents, plan.terms.currency)}` : undefined}>
                <Input id="nc-price" inputMode="decimal" value={f.price} onChange={set('price')} placeholder="Plan price" />
              </Field>
              <Field id="nc-currency" label="Currency">
                <Input id="nc-currency" maxLength={3} value={f.currency} onChange={set('currency')} placeholder={plan?.terms.currency ?? 'USD'} />
              </Field>
            </fieldset>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-semibold">Workspace limits and authority</legend>
              <Field id="nc-managers" label="Manager Workspaces" hint={`Empty: the plan’s limit (${plan?.limits.maxManagerWorkspaces ?? 'none'})`}>
                <Input id="nc-managers" type="number" min={0} value={f.managers} onChange={set('managers')} />
              </Field>
              <Field id="nc-executives" label="Executive Workspaces" hint={`Empty: the plan’s limit (${plan?.limits.maxExecutiveWorkspaces ?? 'none'})`}>
                <Input id="nc-executives" type="number" min={0} value={f.executives} onChange={set('executives')} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={f.superExecutives} onChange={(e) => setF({ ...f, superExecutives: e.target.checked })} />
                The Super Workspace may create Executive Workspaces itself
              </label>
            </fieldset>
            <ErrorText error={create.error ?? plans.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !plan}>
                Create client
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
