import { PLAN_CATALOG, PLAN_ENTITLEMENTS, type PublicPricing } from '@dealflow/types';
import type { Metadata } from 'next';
import { PricingTable } from './pricing-table';

export const metadata: Metadata = { title: 'Pricing', description: 'DealFlow plans: per-user pricing with monthly or annual billing, and a Free plan for 2 users.' };
export const revalidate = 300;

/** Falls back to the built-in catalogue (marked unpublished) when the API is unreachable at build or render time. */
async function load(): Promise<PublicPricing> {
  try {
    const res = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/api/v1/public/pricing`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    if (res.ok) return (await res.json()) as PublicPricing;
  } catch {
    // Fall through to the static catalogue.
  }
  return {
    published: false, currency: 'USD', trialDays: 14, graceDays: 14, salesContact: null,
    plans: PLAN_CATALOG.map((p) => ({ ...p, entitlements: PLAN_ENTITLEMENTS[p.code], selfServe: p.code !== 'free' && p.code !== 'enterprise_plus', buyOnline: false })),
  };
}

export default async function PricingPage() {
  const pricing = await load();
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">Per user, per month. Pay monthly, or annually for a lower rate. Start on Free and upgrade when the team grows.</p>
      {!pricing.published && (
        <p role="note" className="mt-6 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          <strong className="font-medium">Launch pricing preview.</strong> These are the proposed launch prices and allowances. They are not on sale yet and may change before launch.
        </p>
      )}
      <PricingTable pricing={pricing} />
      <section aria-labelledby="faq" className="mt-16 max-w-3xl">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          Questions
        </h2>
        <dl className="mt-6 space-y-6 text-sm">
          <div>
            <dt className="font-medium">What counts as a user?</dt>
            <dd className="mt-1 text-muted-foreground">Every active member of the workspace and every pending invitation uses a seat. On paid plans you choose the number of seats; Free includes 2.</dd>
          </div>
          <div>
            <dt className="font-medium">Is there a trial?</dt>
            <dd className="mt-1 text-muted-foreground">Each workspace can try a paid plan once for {pricing.trialDays} days without a card. When the trial ends the workspace returns to Free and keeps all its data.</dd>
          </div>
          <div>
            <dt className="font-medium">What happens when an allowance runs out?</dt>
            <dd className="mt-1 text-muted-foreground">AI credits and automation runs reset monthly. When one is used up, that feature pauses until the next month or an upgrade. DealFlow does not charge for overage automatically.</dd>
          </div>
          <div>
            <dt className="font-medium">What if a payment fails?</dt>
            <dd className="mt-1 text-muted-foreground">Paid features stay on for {pricing.graceDays} days while the payment method is updated. After that, Free plan limits apply until the invoice is paid. No data is deleted.</dd>
          </div>
          <div>
            <dt className="font-medium">How do I pay?</dt>
            <dd className="mt-1 text-muted-foreground">On the payment provider’s secure checkout page. DealFlow stores the provider’s references, never card numbers. Prices exclude taxes, which are added at checkout where they apply.</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
