import { Bot, FileSignature, GitBranch, HeartHandshake, KanbanSquare, LineChart, Megaphone, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tr } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'SampForce by Sampledge: the AI-native sales CRM',
  description: 'Leads, deals, automation, quotes, contracts and revenue analytics in one workspace, with AI that explains itself and asks before it acts.',
};

/** Only modules that exist in the product today. No customer logos, ratings or usage numbers: there are none to show yet. */
const FEATURES = [
  { icon: KanbanSquare, title: 'Core CRM', body: 'Leads, contacts, companies and deals with Kanban pipelines, custom fields, CSV import and export, and search.' },
  { icon: GitBranch, title: 'Automation Studio', body: 'Workflows with conditions, delays and approval steps, a simulator to test them first, and signed webhooks.' },
  { icon: Bot, title: 'Revenue Copilot', body: 'AI assistance for lead qualification, deal risk and drafting, with the reasoning shown and a person approving anything that leaves SampForce.' },
  { icon: FileSignature, title: 'Quotes and contracts', body: 'Product catalogue, price books, tax rates, discount approvals, versioned quotes and contract renewals.' },
  { icon: Megaphone, title: 'Marketing', body: 'Consent-aware segments, hosted lead forms you can embed, and campaign attribution to leads and won deals.' },
  { icon: LineChart, title: 'Revenue intelligence', body: 'Forecasts with scenarios, targets, win rates and revenue by source, computed from your own records.' },
  { icon: HeartHandshake, title: 'Customer success', body: 'Rule-based health scores with the reasons listed, escalations and renewal reminders.' },
  { icon: ShieldCheck, title: 'Built for teams', body: 'Roles and permissions, an append-only audit log, and workspace isolation enforced in the database.' },
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-20 sm:px-6">
        <p className="text-sm font-medium text-primary"><Tr text="SampForce by Sampledge" /></p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          <Tr text="Close smarter. Grow faster." /> <span className="text-gradient"><Tr text="Sell. Close. Grow." /></span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          <Tr text="One workspace for leads, deals, automation, quotes and revenue analytics. The AI shows its reasoning, stays inside each person’s permissions, and asks before it acts." />
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Tr text="Start free" />
          </Link>
          <Link href="/pricing" className="rounded-md border border-border px-5 py-2.5 text-sm font-medium hover:bg-muted">
            <Tr text="See pricing" />
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted-foreground"><Tr text="The Free plan covers 2 users with no card required." /></p>
      </section>

      <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 id="features" className="text-2xl font-semibold tracking-tight">
          <Tr text="What is in the box" />
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-xl border border-border bg-surface/60 p-5">
              <f.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 font-medium"><Tr text={f.title} /></h3>
              <p className="mt-1 text-sm text-muted-foreground"><Tr text={f.body} /></p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">
          <Tr text="AI features draw on each plan’s monthly AI credit allowance. When it is used up they pause until the next month; nothing is charged automatically." />
        </p>
      </section>
    </>
  );
}
