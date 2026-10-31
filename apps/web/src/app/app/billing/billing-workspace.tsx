'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Skeleton } from '@dealflow/ui';
import { type BillingOverview, type BillingProviderKey, type CatalogPlan, type Interval, type InvoiceRow, offlineInvoiceCents, PLAN_CATALOG, type SelfServePlan, type UsageMeter } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMinor, INVOICE_STATUS, SUBSCRIPTION_STATUS, useBilling, useInvoices } from '@/lib/billing';
import { useCan } from '@/lib/session';

const usd = (n: number) => `$${n}`;
const PROVIDER_LABEL: Record<BillingProviderKey | 'OFFLINE', string> = { STRIPE: 'Stripe', RAZORPAY: 'Razorpay', OFFLINE: 'Paid by invoice' };
const planName = (code: string | null) => PLAN_CATALOG.find((p) => p.code === code)?.name ?? code ?? '';

export function BillingWorkspace() {
  const billing = useBilling();
  const canManage = useCan('billing:manage');
  const params = useSearchParams();
  const checkout = params.get('checkout');

  if (billing.isPending) return <Skeleton className="h-96" />;
  if (billing.error) return <ErrorText error={billing.error} />;
  const b = billing.data;

  return (
    <div className="space-y-6">
      {checkout === 'success' && (
        <Card role="status" className="border-success/40 p-4 text-sm">
          Thanks. The payment provider has your order; this page shows the new plan as soon as the provider confirms the payment to DealFlow, usually within a minute.
        </Card>
      )}
      {checkout === 'canceled' && <Card role="status" className="p-4 text-sm text-muted-foreground">Checkout was canceled. Nothing was charged.</Card>}
      <StatusBanner b={b} />
      {b.offline.openInvoice && <OpenInvoice b={b} inv={b.offline.openInvoice} canManage={canManage} />}
      <CurrentPlan b={b} canManage={canManage} />
      <Usage b={b} />
      <Plans b={b} canManage={canManage} />
      <Invoices />
    </div>
  );
}

function StatusBanner({ b }: { b: BillingOverview }) {
  if (b.restricted) {
    return (
      <Card role="alert" className="border-critical/50 p-4 text-sm">
        <p className="font-medium text-critical">Paid features are paused</p>
        <p className="mt-1 text-muted-foreground">
          The {b.plan.name} subscription is {b.status === 'UNPAID' ? 'unpaid' : 'canceled'}, so Free plan limits apply. All your data is kept.{' '}
          {b.provider === 'OFFLINE' ? 'Request an invoice below and pay it to restore the plan.' : b.portalAvailable ? 'Update the payment method under Manage billing to restore the plan.' : 'Settle the payment with the provider to restore the plan.'}
        </p>
      </Card>
    );
  }
  if (b.status === 'PAST_DUE' && b.provider === 'OFFLINE') {
    return (
      <Card role="alert" className="border-warning/50 p-4 text-sm">
        <p className="font-medium text-warning">Renewal due</p>
        <p className="mt-1 text-muted-foreground">The paid period ended on {formatDate(b.currentPeriodEnd)}. Paid features stay on until {formatDate(b.graceEndsAt)}; request the renewal invoice below and pay it before then.</p>
      </Card>
    );
  }
  if (b.status === 'PAST_DUE') {
    return (
      <Card role="alert" className="border-warning/50 p-4 text-sm">
        <p className="font-medium text-warning">A payment failed</p>
        <p className="mt-1 text-muted-foreground">Paid features stay on until {formatDate(b.graceEndsAt)}. Update the payment method before then to avoid falling back to Free limits.</p>
      </Card>
    );
  }
  if (b.status === 'TRIALING') {
    return (
      <Card role="status" className="border-accent/40 p-4 text-sm">
        You are trying {b.plan.name} until {formatDate(b.trialEndsAt)}. Afterwards the workspace returns to Free unless you choose a plan. No card is needed for the trial and nothing is deleted when it ends.
      </Card>
    );
  }
  if (b.cancelAtPeriodEnd) {
    return <Card role="status" className="p-4 text-sm">The subscription ends on {formatDate(b.currentPeriodEnd)}. The workspace then moves to Free with all data kept.</Card>;
  }
  return null;
}

function OpenInvoice({ b, inv, canManage }: { b: BillingOverview; inv: InvoiceRow; canManage: boolean }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api(`/billing/invoice-requests/${inv.id}/cancel`, { method: 'POST', json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }),
  });
  return (
    <Card aria-labelledby="open-invoice-heading">
      <CardHeader>
        <CardTitle id="open-invoice-heading" className="flex flex-wrap items-center gap-2">
          Invoice {inv.number} <Badge tone="warning">Waiting for payment</Badge>
        </CardTitle>
        <CardDescription>
          {planName(inv.planCode)} · {inv.seats} seat{inv.seats === 1 ? '' : 's'} · {inv.interval === 'YEAR' ? '12 months' : '1 month'} · issued {formatDate(inv.issuedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-2xl font-semibold tabular">{formatMinor(inv.totalCents, inv.currency)}</span> <span className="text-muted-foreground">excluding taxes</span>
        </p>
        {b.offline.instructions ? (
          <div>
            <p className="font-medium">How to pay</p>
            <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-muted/30 p-3">{b.offline.instructions}</p>
            <p className="mt-1 text-xs text-muted-foreground">Quote {inv.number} with the payment.</p>
          </div>
        ) : (
          <p className="text-muted-foreground">The DealFlow team will send payment details for this invoice. Quote {inv.number} with the payment.</p>
        )}
        <p className="text-muted-foreground">The plan starts as soon as the DealFlow team confirms the payment has arrived. You will get a notification.</p>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            Cancel this invoice
          </Button>
        )}
        <ErrorText error={cancel.error} />
      </CardContent>
    </Card>
  );
}

function useBillingAction<T extends object | void>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: T) => api<{ url?: string; appliesAt?: 'now' | 'cycle_end' }>(path, { method: 'POST', json: json ?? {} }),
    onSuccess: (res) => {
      if (res?.url) window.location.assign(res.url);
      else void qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });
}

function CurrentPlan({ b, canManage }: { b: BillingOverview; canManage: boolean }) {
  const status = SUBSCRIPTION_STATUS[b.status];
  const portal = useBillingAction<void>('/billing/portal');
  const cancel = useBillingAction<void>(b.cancelAtPeriodEnd ? '/billing/resume' : '/billing/cancel');
  const seats = useBillingAction<{ seats: number }>('/billing/seats');
  const [seatCount, setSeatCount] = useState(String(b.seats));
  const paid = b.provider !== 'NONE' && b.plan.code !== 'free' && b.status !== 'TRIALING';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {b.plan.name}
          <Badge tone={status.tone}>{status.label}</Badge>
          {b.provider !== 'NONE' && <Badge>{PROVIDER_LABEL[b.provider]}</Badge>}
        </CardTitle>
        <CardDescription>
          {b.plan.code === 'free'
            ? 'Free for up to 2 users.'
            : b.provider === 'OFFLINE'
              ? `${b.seats} seat${b.seats === 1 ? '' : 's'} · ${b.interval === 'YEAR' ? 'annual' : 'monthly'} · paid until ${formatDate(b.currentPeriodEnd)}`
              : `${b.seats} seat${b.seats === 1 ? '' : 's'} · billed ${b.interval === 'YEAR' ? 'annually' : 'monthly'}${b.currentPeriodEnd && b.status !== 'TRIALING' ? ` · current period ends ${formatDate(b.currentPeriodEnd)}` : ''}`}
          {b.provider === 'NONE' && b.plan.code !== 'free' && b.status === 'ACTIVE' && ' · managed by the DealFlow team'}
        </CardDescription>
      </CardHeader>
      {canManage && paid && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {b.portalAvailable && (
              <Button variant="outline" onClick={() => portal.mutate()} disabled={portal.isPending}>
                <ExternalLink aria-hidden /> Manage billing
              </Button>
            )}
            <Button variant={b.cancelAtPeriodEnd ? 'default' : 'ghost'} onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              {b.cancelAtPeriodEnd ? 'Keep subscription' : 'Cancel at period end'}
            </Button>
          </div>
          {b.provider === 'OFFLINE' ? (
            <p className="text-sm text-muted-foreground">To change seats or plan, or to renew, request an invoice below. A renewal for the same plan and seats starts when the current period ends.</p>
          ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              seats.mutate({ seats: Number(seatCount) });
            }}
          >
            <Field id="seat-count" label="Seats" hint={`${b.usage.members.used} members and ${b.usage.pendingInvitations} pending invitations use seats.`}>
              <Input id="seat-count" type="number" min={1} max={1000} value={seatCount} onChange={(e) => setSeatCount(e.target.value)} className="w-28" />
            </Field>
            <Button type="submit" variant="outline" disabled={seats.isPending || Number(seatCount) === b.seats}>
              Update seats
            </Button>
          </form>
          )}
          {seats.data?.appliesAt === 'cycle_end' && <p role="status" className="text-sm text-muted-foreground">The seat change is scheduled with Razorpay and applies from the next billing cycle.</p>}
          {seats.data?.appliesAt === 'now' && <p role="status" className="text-sm text-muted-foreground">Seats updated. Stripe prorates the difference on the next invoice.</p>}
          <ErrorText error={portal.error ?? cancel.error ?? seats.error} />
        </CardContent>
      )}
    </Card>
  );
}

function Meter({ label, m, unit }: { label: string; m: UsageMeter; unit?: string }) {
  const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular">
        {m.used.toLocaleString()}
        <span className="text-sm font-normal text-muted-foreground"> / {m.limit === null ? 'no limit' : `${m.limit.toLocaleString()}${unit ?? ''}`}</span>
      </p>
      {m.limit !== null && (
        <div className="mt-2 h-1.5 rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-critical' : pct >= 75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function Usage({ b }: { b: BillingOverview }) {
  return (
    <section aria-labelledby="usage-heading">
      <h2 id="usage-heading" className="mb-3 text-lg font-semibold">
        Usage this month
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Meter label="Seats in use" m={{ used: b.usage.members.used + b.usage.pendingInvitations, limit: b.usage.members.limit }} />
        <Meter label="Pipelines" m={b.usage.pipelines} />
        <Meter label="AI credits" m={b.usage.aiCredits} />
        <Meter label="Automation runs" m={b.usage.automationRuns} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">AI credits scale with active members and reset on the 1st (UTC). When an allowance is used up, that feature pauses until the next month or an upgrade; nothing is billed automatically for overage.</p>
    </section>
  );
}

function Plans({ b, canManage }: { b: BillingOverview; canManage: boolean }) {
  const [interval, setInterval] = useState<Interval>(b.interval);
  const configured = (Object.keys(b.providers) as BillingProviderKey[]).filter((k) => b.providers[k]);
  const [provider, setProvider] = useState<BillingProviderKey | ''>(b.provider !== 'NONE' && b.provider !== 'OFFLINE' ? b.provider : (configured[0] ?? ''));
  const [seats, setSeats] = useState(String(Math.max(b.usage.members.used, b.seats)));
  const checkout = useBillingAction<{ provider: BillingProviderKey; planCode: string; interval: Interval; seats: number }>('/billing/checkout');
  const change = useBillingAction<{ planCode: string; interval: Interval }>('/billing/plan');
  const trial = useBillingAction<{ planCode: string }>('/billing/trial');
  const invoice = useBillingAction<{ planCode: SelfServePlan; interval: Interval; seats: number }>('/billing/invoice-requests');
  const hasPaid = b.provider !== 'NONE' && b.provider !== 'OFFLINE' && b.plan.code !== 'free' && ['ACTIVE', 'PAST_DUE'].includes(b.status);
  const managed = b.provider === 'NONE' && b.plan.code !== 'free' && b.status === 'ACTIVE';
  // With online checkout off, every plan is paid offline against an invoice.
  const offline = configured.length === 0 && !hasPaid;
  const err = checkout.error ?? change.error ?? trial.error ?? invoice.error;

  return (
    <section aria-labelledby="plans-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="plans-heading" className="text-lg font-semibold">
          Plans
        </h2>
        {!b.pricingPublished && <Badge tone="warning">Proposed launch pricing</Badge>}
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
            {(['MONTH', 'YEAR'] as const).map((i) => (
              <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cn('rounded-md px-3 py-1 text-sm', interval === i ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {i === 'MONTH' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
          {canManage && !hasPaid && configured.length > 1 && (
            <Field id="pay-provider" label="Pay with">
              <Select id="pay-provider" value={provider} onChange={(e) => setProvider(e.target.value as BillingProviderKey)}>
                {configured.map((k) => (
                  <option key={k} value={k}>
                    {PROVIDER_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {canManage && !hasPaid && (configured.length > 0 || offline) && (
            <Field id="buy-seats" label="Seats">
              <Input id="buy-seats" type="number" min={1} max={1000} value={seats} onChange={(e) => setSeats(e.target.value)} className="w-24" />
            </Field>
          )}
        </div>
      </div>
      {offline && canManage && (
        <p className="mb-3 rounded-md border border-border p-3 text-sm text-muted-foreground">
          Plans are paid by bank transfer. Choose a plan, interval and seats to get an invoice; the plan starts when the DealFlow team confirms your payment.{b.trialAvailable ? ' You can also try a plan free first.' : ''}
        </p>
      )}
      {managed && <p className="mb-3 text-sm text-muted-foreground">This workspace’s plan is managed by the DealFlow team. Contact them to change it.</p>}
      <ErrorText error={err} />
      {change.data?.appliesAt === 'cycle_end' && <p role="status" className="mb-3 text-sm text-muted-foreground">The plan change is scheduled with Razorpay and applies from the next billing cycle.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {b.catalog.map((p) => (
          <PlanCard
            key={p.code}
            p={p}
            b={b}
            interval={interval}
            action={
              !canManage || managed ? null : p.code === b.plan.code && (p.code === 'free' || interval === b.interval) && !(offline && p.code !== 'free') ? (
                <Badge tone="primary">Current plan</Badge>
              ) : p.code === 'free' ? null : !p.selfServe ? (
                b.salesContact ? (
                  <a className="text-sm text-primary underline-offset-2 hover:underline" href={`mailto:${b.salesContact}?subject=${encodeURIComponent('DealFlow Enterprise Plus')}`}>
                    Contact sales
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Sold by quote</span>
                )
              ) : offline ? (
                <div className="flex flex-wrap items-center gap-2">
                  {p.code === b.plan.code && <Badge tone="primary">Current plan</Badge>}
                  {b.offline.openInvoice ? (
                    <span className="text-xs text-muted-foreground">Invoice {b.offline.openInvoice.number} is open</span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={invoice.isPending || !(Number(seats) >= 1)}
                      onClick={() => invoice.mutate({ planCode: p.code as SelfServePlan, interval, seats: Number(seats) })}
                      aria-label={`${p.code === b.plan.code && b.provider === 'OFFLINE' ? 'Renew' : 'Request invoice for'} ${p.name.replace('DealFlow ', '')}${Number(seats) >= 1 ? `, ${formatMinor(offlineInvoiceCents(p.code as SelfServePlan, interval, Number(seats)), 'USD')}` : ''}`}
                    >
                      {p.code === b.plan.code && b.provider === 'OFFLINE' ? 'Renew' : 'Request invoice'}
                    </Button>
                  )}
                  {b.trialAvailable && (
                    <Button size="sm" variant="outline" disabled={trial.isPending} onClick={() => trial.mutate({ planCode: p.code })}>
                      Try free for {b.trialDays} days
                    </Button>
                  )}
                </div>
              ) : hasPaid ? (
                <Button size="sm" variant="outline" disabled={change.isPending || !provider || !p.checkout[provider][interval]} onClick={() => change.mutate({ planCode: p.code, interval })}>
                  Switch to {p.name.replace('DealFlow ', '')}
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {provider && p.checkout[provider][interval] && (
                    <Button size="sm" disabled={checkout.isPending} onClick={() => checkout.mutate({ provider, planCode: p.code, interval, seats: Number(seats) })}>
                      Choose
                    </Button>
                  )}
                  {b.trialAvailable && (
                    <Button size="sm" variant="outline" disabled={trial.isPending} onClick={() => trial.mutate({ planCode: p.code })}>
                      Try free for {b.trialDays} days
                    </Button>
                  )}
                  {provider && !p.checkout[provider][interval] && !b.trialAvailable && <span className="text-xs text-muted-foreground">Not available online yet</span>}
                </div>
              )
            }
          />
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {offline
          ? 'Prices in USD per user per month, before tax. Invoices are paid by bank transfer; DealFlow never asks for card numbers.'
          : 'Prices in USD per user per month, before tax. Payment, tax calculation and card details are handled on the provider’s secure page; DealFlow never sees card numbers. Promotion codes can be entered at Stripe checkout.'}
      </p>
    </section>
  );
}

function PlanCard({ p, b, interval, action }: { p: CatalogPlan; b: BillingOverview; interval: Interval; action: React.ReactNode }) {
  const price = interval === 'YEAR' ? p.annualMonthly : p.monthly;
  const ent = p.entitlements;
  return (
    <li>
      <Card className={cn('flex h-full flex-col p-4', p.code === b.plan.code && 'border-primary ring-1 ring-primary/40')}>
        <p className="text-sm font-medium">{p.name.replace('DealFlow ', '')}</p>
        <p className="mt-2 text-2xl font-semibold tabular">
          {price === null ? 'Custom' : usd(price)}
          {price ? <span className="text-xs font-normal text-muted-foreground"> /user/mo</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">{price && interval === 'YEAR' ? 'billed annually' : p.audience}</p>
        <ul className="mt-3 flex-1 space-y-1 text-xs text-muted-foreground">
          <li>{ent.maxUsers ? `Up to ${ent.maxUsers} users` : 'Per-seat'}</li>
          <li>{ent.maxPipelines ?? 'Unlimited'} pipeline{ent.maxPipelines === 1 ? '' : 's'}</li>
          <li>{ent.monthlyAiCredits.toLocaleString()} AI credits / user / month</li>
          <li>{ent.automationRunsPerMonth.toLocaleString()} automation runs / month</li>
          <li>{ent.customRoles ? 'Custom roles' : 'Standard roles'}</li>
        </ul>
        {action && <div className="mt-3">{action}</div>}
      </Card>
    </li>
  );
}

function Invoices() {
  const invoices = useInvoices();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoices</CardTitle>
        <CardDescription>Amounts exclude taxes. Links open the payment provider’s copy where there is one.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {invoices.isPending ? (
          <Skeleton className="h-16" />
        ) : !invoices.data?.length ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">Invoices</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">Invoice</th>
                <th scope="col" className="py-2 font-medium">Issued</th>
                <th scope="col" className="py-2 font-medium">Status</th>
                <th scope="col" className="py-2 text-right font-medium">Total</th>
                <th scope="col" className="py-2 font-medium"><span className="sr-only">Links</span></th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2.5">{i.number ?? `${PROVIDER_LABEL[i.provider]} payment`}</td>
                  <td className="py-2.5 text-muted-foreground">{formatDate(i.issuedAt)}</td>
                  <td className="py-2.5"><Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge></td>
                  <td className="py-2.5 text-right tabular">{formatMinor(i.totalCents, i.currency)}</td>
                  <td className="py-2.5 text-right">
                    {(i.hostedUrl ?? i.pdfUrl) && (
                      <a href={(i.hostedUrl ?? i.pdfUrl)!} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                        View<span className="sr-only"> invoice {i.number ?? ''}</span>
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
