import type { Metadata } from 'next';
import { AiSteps, CapabilityMarquee, FeatureBento, FlowBoard } from '@/components/site/landing-sections';
import { LandingFinale } from '@/components/site/landing-finale';
import { LandingHero } from '@/components/site/landing-hero';
import { Tr } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'SampForce by Sampledge: the AI-native sales CRM',
  description: 'Leads, deals, automation, quotes, contracts and revenue analytics in one workspace, with AI that explains itself and asks before it acts.',
};

function SectionHead({ id, kicker, title, body }: { id: string; kicker: string; title: string; body: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-primary">
        <Tr text={kicker} />
      </p>
      <h2 id={id} className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
        <Tr text={title} />
      </h2>
      <p className="mt-3 text-muted-foreground">
        <Tr text={body} />
      </p>
    </div>
  );
}

/**
 * The public home page (ADR 0078): a living sky, the revenue orbit, a pipeline that moves on its own, and the modules
 * that exist today. No customer logos, ratings or usage numbers: there are none to show yet.
 */
export default function LandingPage() {
  return (
    <>
      <LandingHero />
      <CapabilityMarquee />

      <section id="flow" aria-labelledby="flow-title" className="mx-auto max-w-6xl scroll-mt-28 px-4 py-20 sm:px-6">
        <SectionHead id="flow-title" kicker="How it works" title="Watch a deal move" body="Deals glide from lead to won while Copilot points out the next step and waits for your yes." />
        <FlowBoard />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          <Tr text="Sample deals, for illustration." />
        </p>
      </section>

      <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-28 px-4 pb-20 sm:px-6">
        <SectionHead id="features-title" kicker="Product" title="What is in the box" body="Eight modules that work as one, from the first lead to the renewal." />
        <FeatureBento />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Tr text="AI features draw on each plan’s monthly AI credit allowance. When it is used up they pause until the next month; nothing is charged automatically." />
        </p>
      </section>

      <section aria-labelledby="ai-title" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <SectionHead id="ai-title" kicker="AI that asks first" title="Helpful, never pushy" body="The AI shows its reasoning, stays inside each person’s permissions, and asks before it acts." />
        <AiSteps />
      </section>

      <LandingFinale />
    </>
  );
}
