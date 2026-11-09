'use client';

import { cn } from '@dealflow/ui';
import { FEATURE_GROUPS, FEATURES, type PublicPricing } from '@dealflow/types';
import { Check, Minus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';

export function PricingTable({ pricing }: { pricing: PublicPricing }) {
  const t = useT();
  const [annual, setAnnual] = useState(true);
  return (
    <>
      <div role="radiogroup" aria-label={t('Billing interval')} className="mt-8 inline-flex rounded-lg border border-border bg-muted/40 p-1">
        {[
          { v: false, label: t('Monthly') },
          { v: true, label: t('Annual') },
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
              <h2 className="font-medium">{p.name.replace('SampForce ', '')}</h2>
              <p className="text-xs text-muted-foreground">{t.maybe(p.audience)}</p>
              <p className="mt-4 text-3xl font-semibold tabular">
                {price === null ? t('Custom') : `$${price}`}
                {price ? <span className="text-sm font-normal text-muted-foreground"> {t('/user/mo')}</span> : null}
              </p>
              <p className="h-4 text-xs text-muted-foreground">{price && annual ? t('billed annually · {price} monthly', { price: `$${p.monthly}` }) : ''}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                {[
                  e.maxUsers ? t.plural('count.upToUsers', e.maxUsers) : t('Choose your number of seats'),
                  e.maxPipelines ? t.plural('count.pipelines', e.maxPipelines) : t('Unlimited pipelines'),
                  t('{n} AI credits per user per month', { n: e.monthlyAiCredits.toLocaleString(fmtLocale()) }),
                  t('{n} automation runs per month', { n: e.automationRunsPerMonth.toLocaleString(fmtLocale()) }),
                  t('{n} of {total} features', { n: e.features.length, total: FEATURES.length }),
                  e.features.includes('custom_roles') ? t('Custom roles and permissions') : t('Standard roles'),
                  ...(e.features.includes('sso_scim') ? [t('Single sign-on (OpenID Connect) and SCIM')] : []),
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
                    <a href={`mailto:${pricing.salesContact}?subject=${encodeURIComponent('SampForce Enterprise Plus')}`} className="block rounded-md border border-border px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                      {t('Contact sales')}
                    </a>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">{t('Quoted individually')}</p>
                  )
                ) : (
                  <Link href="/signup" className={cn('block rounded-md px-3 py-2 text-center text-sm font-medium', p.code === 'growth' ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-border hover:bg-muted')}>
                    {p.code === 'free' ? t('Start free') : pricing.published ? t('Get started') : t('Start on Free')}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">{t('Prices in {currency}, excluding taxes.', { currency: pricing.currency })}</p>
      <FeatureComparison pricing={pricing} />
    </>
  );
}

/** Which plan includes which feature, read from the live plan catalogue (the platform admin can change it, ADR 0057). */
function FeatureComparison({ pricing }: { pricing: PublicPricing }) {
  const t = useT();
  return (
    <section aria-labelledby="compare-features" className="mt-12">
      <h2 id="compare-features" className="text-lg font-semibold">
        {t('Compare features')}
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm" data-pricing-features="">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-start">
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('Feature')}
              </th>
              {pricing.plans.map((p) => (
                <th key={p.code} scope="col" className="px-3 py-2 text-center font-medium">
                  {p.name.replace('SampForce ', '')}
                </th>
              ))}
            </tr>
          </thead>
          {FEATURE_GROUPS.map((group) => (
            <tbody key={group}>
              <tr>
                <th colSpan={pricing.plans.length + 1} scope="colgroup" className="bg-muted/20 px-3 py-1.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t.maybe(group)}
                </th>
              </tr>
              {FEATURES.filter((f) => f.group === group).map((f) => (
                <tr key={f.key} className="border-t border-border/60">
                  <th scope="row" className="px-3 py-1.5 text-start font-normal">
                    {t.maybe(f.label)}
                  </th>
                  {pricing.plans.map((p) => (
                    <td key={p.code} className="px-3 py-1.5 text-center">
                      {p.entitlements.features.includes(f.key) ? (
                        <Check className="mx-auto size-4 text-primary" aria-label={t('Included')} />
                      ) : (
                        <Minus className="mx-auto size-4 text-muted-foreground/60" aria-label={t('Not included')} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
