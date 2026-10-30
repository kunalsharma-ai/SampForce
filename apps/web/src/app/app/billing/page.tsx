'use client';

import { Badge, Card, CardDescription, CardHeader, CardTitle, cn } from '@dealflow/ui';
import { PLAN_CATALOG, PLAN_ENTITLEMENTS } from '@dealflow/types';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/lib/session';

const usd = (n: number) => `$${n}`;

export default function BillingPage() {
  const { data } = useSession();
  const current = data?.tenant.plan ?? 'free';

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Billing"
        description="Your current plan. Checkout, invoices, seat changes and usage metering ship in Phase 6 (SaaS Commercialization)."
      />
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            {PLAN_CATALOG.find((p) => p.code === current)?.name} · up to {PLAN_ENTITLEMENTS[current as keyof typeof PLAN_ENTITLEMENTS]?.maxUsers ?? 'unlimited'} users
          </CardDescription>
        </CardHeader>
      </Card>
      <section aria-labelledby="rate-card">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="rate-card" className="text-lg font-semibold">
            Rate card
          </h2>
          <Badge tone="warning">Proposed launch pricing, not yet on sale</Badge>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_CATALOG.map((p) => {
            const ent = PLAN_ENTITLEMENTS[p.code];
            return (
              <li key={p.code}>
                <Card className={cn('h-full p-4', p.code === current && 'border-primary ring-1 ring-primary/40')}>
                  <p className="text-sm font-medium">{p.name.replace('DealFlow ', '')}</p>
                  <p className="mt-2 text-2xl font-semibold tabular">
                    {p.monthly === null ? 'Custom' : usd(p.monthly)}
                    {p.monthly ? <span className="text-xs font-normal text-muted-foreground"> /user/mo</span> : null}
                  </p>
                  {p.annualMonthly ? (
                    <p className="text-xs text-muted-foreground">{usd(p.annualMonthly)} /user/mo billed annually</p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">{p.audience}</p>
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <li>{ent.maxPipelines ?? 'Unlimited'} pipelines</li>
                    <li>{ent.monthlyAiCredits.toLocaleString()} AI credits / user / month</li>
                    <li>{ent.automationRunsPerMonth.toLocaleString()} automation runs / month</li>
                    <li>{ent.apiAccess ? 'API access' : 'No API access'}</li>
                  </ul>
                  {p.code === current && <Badge tone="primary" className="mt-3">Current plan</Badge>}
                </Card>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Prices in USD, excluding taxes. AI, SMS, telephony and email delivery beyond the allowance use transparent add-on credits.</p>
      </section>
    </div>
  );
}
