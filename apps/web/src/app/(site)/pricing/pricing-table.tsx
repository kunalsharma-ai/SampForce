'use client';

import { cn } from '@dealflow/ui';
import type { PublicPricing } from '@dealflow/types';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

export function PricingTable({ pricing }: { pricing: PublicPricing }) {
  const [annual, setAnnual] = useState(true);
  return (
    <>
      <div role="radiogroup" aria-label="Billing interval" className="mt-8 inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {[
          { v: false, label: 'Monthly' },
          { v: true, label: 'Annual' },
        ].map((o) => (
          <button key={o.label} type="button" role="radio" aria-checked={annual === o.v} onClick={() => setAnnual(o.v)} className={cn('rounded-md px-4 py-1.5 text-sm', annual === o.v ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
            {o.label}
          </button>
        ))}
      </div>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {pricing.plans.map((p) => {
          const price = annual ? p.annualMonthly : p.monthly;
          const e = p.entitlements;
          const sales = !p.selfServe && p.code !== 'free';
          return (
            <li key={p.code} className="flex flex-col rounded-xl border border-border bg-surface/60 p-5">
              <h2 className="font-medium">{p.name.replace('DealFlow ', '')}</h2>
              <p className="text-xs text-muted-foreground">{p.audience}</p>
              <p className="mt-4 text-3xl font-semibold tabular">
                {price === null ? 'Custom' : `$${price}`}
                {price ? <span className="text-sm font-normal text-muted-foreground"> /user/mo</span> : null}
              </p>
              <p className="h-4 text-xs text-muted-foreground">{price && annual ? `billed annually · $${p.monthly} monthly` : ''}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {[
                  e.maxUsers ? `Up to ${e.maxUsers} users` : 'Choose your number of seats',
                  `${e.maxPipelines ?? 'Unlimited'} pipeline${e.maxPipelines === 1 ? '' : 's'}`,
                  `${e.monthlyAiCredits.toLocaleString()} AI credits per user per month`,
                  `${e.automationRunsPerMonth.toLocaleString()} automation runs per month`,
                  e.customRoles ? 'Custom roles and permissions' : 'Standard roles',
                  'Single sign-on (OpenID Connect) and SCIM',
                ].map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {sales ? (
                  pricing.salesContact ? (
                    <a href={`mailto:${pricing.salesContact}?subject=${encodeURIComponent('DealFlow Enterprise Plus')}`} className="block rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                      Contact sales
                    </a>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">Quoted individually</p>
                  )
                ) : (
                  <Link href="/signup" className={cn('block rounded-md px-3 py-2 text-center text-sm font-medium', p.code === 'growth' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border hover:bg-muted')}>
                    {p.code === 'free' ? 'Start free' : pricing.published ? 'Get started' : 'Start on Free'}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Prices in {pricing.currency}, excluding taxes.</p>
    </>
  );
}
