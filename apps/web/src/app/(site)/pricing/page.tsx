import { PLAN_CATALOG, PLAN_ENTITLEMENTS, type PublicPricing } from '@dealflow/types';
import type { Metadata } from 'next';
import { PricingTable } from './pricing-table';
import { Tr } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Pricing', description: 'SampForce plans: per-user pricing with monthly or annual billing, and a Free plan for 2 users.' };
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
    published: false, currency: 'USD', trialDays: 14, graceDays: 14, salesContact: null, onlinePayments: false,
    plans: PLAN_CATALOG.map((p) => ({ ...p, entitlements: PLAN_ENTITLEMENTS[p.code], selfServe: p.code !== 'free' && p.code !== 'enterprise_plus', buyOnline: false })),
  };
}

export default async function PricingPage() {
  const pricing = await load();
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight"><Tr text="Pricing" /></h1>
      <p className="mt-3 max-w-2xl text-muted-foreground"><Tr text="Per user, per month. Pay monthly, or annually for a lower rate. Start on Free and upgrade when the team grows." /></p>
      {!pricing.published && (
        <p role="note" className="mt-6 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          <strong className="font-medium"><Tr text="Launch pricing preview." /></strong> <Tr text="These are the proposed launch prices and allowances. They are not on sale yet and may change before launch." />
        </p>
      )}
      <PricingTable pricing={pricing} />
      <section aria-labelledby="faq" className="mt-16 max-w-3xl">
        <h2 id="faq" className="text-2xl font-semibold tracking-tight">
          <Tr text="Questions" />
        </h2>
        <dl className="mt-6 space-y-6 text-sm">
          <div>
            <dt className="font-medium"><Tr text="What counts as a user?" /></dt>
            <dd className="mt-1 text-muted-foreground"><Tr text="Every active member of the workspace and every pending invitation uses a seat. On paid plans you choose the number of seats; Free includes 2." /></dd>
          </div>
          <div>
            <dt className="font-medium"><Tr text="Is there a trial?" /></dt>
            <dd className="mt-1 text-muted-foreground"><Tr text="Each workspace can try a paid plan once for {days} days without a card. When the trial ends the workspace returns to Free and keeps all its data." vars={{ days: pricing.trialDays }} /></dd>
          </div>
          <div>
            <dt className="font-medium"><Tr text="What happens when an allowance runs out?" /></dt>
            <dd className="mt-1 text-muted-foreground"><Tr text="AI credits and automation runs reset monthly. When one is used up, that feature pauses until the next month or an upgrade. SampForce does not charge for overage automatically." /></dd>
          </div>
          <div>
            <dt className="font-medium"><Tr text={pricing.onlinePayments ? 'What if a payment fails?' : 'What if a renewal is not paid in time?'} /></dt>
            <dd className="mt-1 text-muted-foreground">
              {pricing.onlinePayments
                ? <Tr text="Paid features stay on for {days} days while the payment method is updated. After that, Free plan limits apply until the invoice is paid. No data is deleted." vars={{ days: pricing.graceDays }} />
                : <Tr text="Paid features stay on for {days} days after the paid period ends. After that, Free plan limits apply until the renewal invoice is paid. No data is deleted." vars={{ days: pricing.graceDays }} />}
            </dd>
          </div>
          <div>
            <dt className="font-medium"><Tr text="Is single sign-on included?" /></dt>
            <dd className="mt-1 text-muted-foreground"><Tr text="Yes, on every plan, including Free. Connect an identity provider that supports OpenID Connect, and optionally add and remove people automatically with SCIM 2.0. People added this way use seats like anyone else." /></dd>
          </div>
          <div>
            <dt className="font-medium"><Tr text="How do I pay?" /></dt>
            <dd className="mt-1 text-muted-foreground">
              <Tr text={pricing.onlinePayments
                ? 'On the payment provider’s secure checkout page. SampForce stores the provider’s references, never card numbers. Prices exclude taxes, which are added at checkout where they apply.'
                : 'By bank transfer against an invoice. Choose a plan under Billing in your workspace to get an invoice with payment details; the plan starts as soon as the payment is confirmed. SampForce never asks for card numbers. Prices exclude taxes.'} />
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
