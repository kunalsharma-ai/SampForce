'use client';

import { Card, cn } from '@dealflow/ui';
import {
  type ClientSubscriptionState,
  type ConsoleSubscriptionRow,
  type ConsoleSubscriptionsSummary,
  SUBSCRIPTION_STATE_HINT,
  SUBSCRIPTION_STATE_LABEL,
  SUBSCRIPTION_STATES,
} from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Ban, CirclePlay, FlaskConical, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConsoleDenied, ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMinor } from '@/lib/billing';
import { price, selectClass, SubscriptionStateBadge } from '../console-ui';
import { can, useOperator } from '../operator-shell';

const PERIODS = [7, 30, 90, 365] as const;

const STATE_ACCENT: Record<ClientSubscriptionState, string> = {
  ACTIVE: 'before:bg-success',
  TRIAL: 'before:bg-primary',
  PENDING: 'before:bg-warning',
  EXPIRED: 'before:bg-muted-foreground',
  SUSPENDED: 'before:bg-critical',
  CANCELLED: 'before:bg-muted-foreground',
  PAYMENT_FAILED: 'before:bg-critical',
};

/**
 * Subscriptions & billing (control center K4): every client's subscription by state, what moved over the chosen
 * period, the agreed monthly value, and the four lists an account manager works through.
 */
export default function SubscriptionsPage() {
  const me = useOperator();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const q = useQuery({
    enabled: !!me.data && can(me.data, 'clients.view'),
    queryKey: ['operator', 'subscriptions', days],
    queryFn: () => api<ConsoleSubscriptionsSummary>(`/operator/subscriptions/summary?days=${days}`),
  });
  if (!me.data) return <ConsoleLoading label="Loading" />;
  if (!can(me.data, 'clients.view')) return <ConsoleDenied what="subscriptions" />;
  const s = q.data;
  const total = s ? SUBSCRIPTION_STATES.reduce((a, k) => a + s.states[k], 0) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions & billing"
        description="Every client’s subscription by state, what changed, the agreed monthly value, and what needs action. Figures come from the clients’ subscriptions and their history."
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Changes over</span>
            <select aria-label="Period" className={cn(selectClass, 'w-36')} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
              {PERIODS.map((d) => (
                <option key={d} value={d}>
                  {d === 365 ? 'the last year' : `the last ${d} days`}
                </option>
              ))}
            </select>
          </label>
        }
      />
      {q.error && <ErrorText error={q.error} />}
      {!s ? (
        <ConsoleLoading label="Loading subscriptions" />
      ) : (
        <>
          <section aria-labelledby="states-h">
            <h2 id="states-h" className="mb-3 text-sm font-medium text-muted-foreground">
              {total} {total === 1 ? 'client' : 'clients'} with a subscription
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7" data-subscription-states>
              {SUBSCRIPTION_STATES.map((k) => (
                <Link
                  key={k}
                  href={`/operator/clients?subscription=${k}`}
                  title={SUBSCRIPTION_STATE_HINT[k]}
                  data-state-count={k}
                  className={cn(
                    'relative overflow-hidden rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40',
                    "before:absolute before:inset-y-0 before:start-0 before:w-1 before:content-['']",
                    STATE_ACCENT[k],
                  )}
                >
                  <span className="block text-xs font-medium text-muted-foreground">{SUBSCRIPTION_STATE_LABEL[k]}</span>
                  <span className="mt-1 block text-2xl font-semibold tabular-nums">{s.states[k]}</span>
                </Link>
              ))}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2" aria-labelledby="moves-h" data-subscription-movements>
              <h2 id="moves-h" className="font-medium">
                Changes {days === 365 ? 'over the last year' : `over the last ${days} days`}
              </h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Move icon={Sparkles} label="New subscriptions" value={s.movements.started} tone="text-primary" />
                <Move icon={ArrowUpRight} label="Upgrades" value={s.movements.upgraded} tone="text-success" />
                <Move icon={ArrowDownRight} label="Downgrades" value={s.movements.downgraded} tone="text-warning" />
                <Move icon={RefreshCw} label="Renewals" value={s.movements.renewed} tone="text-success" />
                <Move icon={FlaskConical} label="Trials started" value={s.movements.trialsStarted} tone="text-accent" />
                <Move icon={Ban} label="Cancellations" value={s.movements.cancelled} tone="text-critical" />
                <Move icon={CirclePlay} label="Reactivations" value={s.movements.reactivated} tone="text-success" />
                <Move icon={TriangleAlert} label="Failed payments" value={s.movements.paymentFailed} tone="text-critical" />
              </dl>
            </Card>
            <Card className="p-5" aria-labelledby="value-h" data-monthly-value>
              <h2 id="value-h" className="font-medium">
                Agreed value per month
              </h2>
              {s.monthlyValue === null ? (
                <p className="mt-3 text-sm text-muted-foreground">Your role does not include billing figures.</p>
              ) : s.monthlyValue.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No running subscription has an agreed price yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {s.monthlyValue.map((v) => (
                    <li key={v.currency} className="flex items-baseline justify-between gap-2" data-value-currency={v.currency}>
                      <span className="text-2xl font-semibold tabular-nums">{formatMinor(v.cents, v.currency)}</span>
                      <span className="text-xs text-muted-foreground">
                        {v.clients} {v.clients === 1 ? 'client' : 'clients'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Active, pending and failed-payment subscriptions; a yearly price counts as a twelfth. Trials are free and not counted.
                {s.unpriced > 0 && ` ${s.unpriced} running ${s.unpriced === 1 ? 'subscription has' : 'subscriptions have'} no agreed price.`}
              </p>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <WorkList id="trials" title="Trials ending in 14 days" dateLabel="Trial ends" rows={s.trialsEnding} empty="No trial ends in the next 14 days." />
            <WorkList id="renewals" title="Renewals due in 30 days" dateLabel="Renews" rows={s.renewalsDue} empty="Nothing renews in the next 30 days." />
            <WorkList id="payments" title="Payment problems" dateLabel="Term ends" rows={s.paymentProblems} empty="No pending or failed payments." />
            <WorkList id="cancelling" title="Cancelling at the end of the term" dateLabel="Ends" rows={s.cancelling} empty="Nobody is set to cancel." />
          </div>
        </>
      )}
    </div>
  );
}

function Move({ icon: Icon, label, value, tone }: { icon: typeof Sparkles; label: string; value: number; tone: string }) {
  return (
    <div data-movement={label}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn('size-3.5', tone)} aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function WorkList({ id, title, dateLabel, rows, empty }: { id: string; title: string; dateLabel: string; rows: ConsoleSubscriptionRow[]; empty: string }) {
  return (
    <Card className="p-5" aria-labelledby={`${id}-h`} data-work-list={id}>
      <h2 id={`${id}-h`} className="font-medium">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                  Client
                </th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                  Plan
                </th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                  State
                </th>
                <th scope="col" className="py-1.5 pe-3 text-start font-medium">
                  {dateLabel}
                </th>
                <th scope="col" className="py-1.5 text-end font-medium">
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border" data-work-row={r.id}>
                  <td className="py-2 pe-3">
                    <Link href={`/operator/clients/${r.id}?tab=subscription`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {r.name}
                    </Link>
                    {r.customerId && <span className="block text-xs text-muted-foreground">{r.customerId}</span>}
                  </td>
                  <td className="py-2 pe-3">{r.planName.replace('SampForce ', '')}</td>
                  <td className="py-2 pe-3">
                    <SubscriptionStateBadge state={r.state} />
                  </td>
                  <td className="whitespace-nowrap py-2 pe-3">{r.date ? formatDate(r.date) : '—'}</td>
                  <td className="whitespace-nowrap py-2 text-end tabular-nums">{price(r.priceCents, r.currency, r.billingFrequency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
