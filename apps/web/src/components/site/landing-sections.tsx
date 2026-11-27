'use client';

import { cn } from '@dealflow/ui';
import { Bot, Check, FileSignature, GitBranch, HeartHandshake, KanbanSquare, LineChart, Megaphone, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import { LayoutGroup, motion, useInView, useReducedMotion } from 'motion/react';
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Tr, useT } from '@/lib/i18n';

/* ── Marquee ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Real capabilities only: these are all things SampForce does today. */
const CAPABILITIES_A = ['Kanban pipelines', 'Custom fields', 'CSV import and export', 'Signed webhooks', 'Approval steps', 'Workflow simulator', 'Versioned quotes', 'Price books', 'Contract renewals'];
const CAPABILITIES_B = ['Contact qualification', 'Deal risk', 'Forecast scenarios', 'Win rates', 'Health scores', 'Renewal reminders', 'Hosted contact forms', 'Append-only audit log', 'Roles and permissions'];

function MarqueeRow({ items, reverse, dur }: { items: string[]; reverse?: boolean; dur: string }) {
  const row = (hidden: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((x) => (
        <li key={x} className="flex items-center gap-6 pe-6 text-sm font-medium text-muted-foreground sm:text-base">
          <span className="whitespace-nowrap">
            <Tr text={x} />
          </span>
          <Sparkles className="sfx-sparkle size-4 text-accent" aria-hidden />
        </li>
      ))}
    </ul>
  );
  return (
    <div className="sfx-marquee overflow-hidden py-2">
      <div className="sfx-marquee-track" style={{ '--dur': dur, '--dir': reverse ? 'reverse' : 'normal' } as CSSProperties}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

export function CapabilityMarquee() {
  const t = useT();
  return (
    <section aria-label={t('What SampForce does')} className="relative border-y border-border/60 bg-surface/30 py-4 backdrop-blur-sm" data-site-marquee="">
      <MarqueeRow items={CAPABILITIES_A} dur="46s" />
      <MarqueeRow items={CAPABILITIES_B} dur="52s" reverse />
    </section>
  );
}

/* ── Flow board ───────────────────────────────────────────────────────────────────────────────────────────────── */

const STAGES = ['New', 'Qualified', 'Proposal', 'Won'] as const;

interface SampleDeal {
  id: string;
  name: string;
  value: number;
  stage: number;
}

const SAMPLE_DEALS: SampleDeal[] = [
  { id: 'a', name: 'Northwind renewal', value: 24000, stage: 0 },
  { id: 'b', name: 'Acme rollout', value: 58000, stage: 1 },
  { id: 'c', name: 'Globex pilot', value: 12500, stage: 2 },
  { id: 'd', name: 'Initech upgrade', value: 31000, stage: 3 },
  { id: 'e', name: 'Vandelay imports', value: 8700, stage: 0 },
  { id: 'f', name: 'Stark logistics', value: 44000, stage: 1 },
];

/** One step of the illustration: the next deal in turn moves a stage on; a won deal starts again as a new lead. */
export function advanceDeals(deals: SampleDeal[], tick: number): SampleDeal[] {
  const i = tick % deals.length;
  return deals.map((d, k) => (k === i ? { ...d, stage: d.stage >= STAGES.length - 1 ? 0 : d.stage + 1 } : d));
}

/**
 * "Watch a deal move": sample deals glide through the pipeline on their own, and Copilot suggests a next step on the
 * proposal. An illustration with made-up deals, labelled as such; it holds still for people who ask for less motion
 * and while it is off screen.
 */
export function FlowBoard() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-80px' });
  const reduce = useReducedMotion();
  const [deals, setDeals] = useState(SAMPLE_DEALS);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setTick((n) => n + 1), 1900);
    return () => clearInterval(id);
  }, [inView, reduce]);
  useEffect(() => {
    if (tick) setDeals((d) => advanceDeals(d, tick - 1));
  }, [tick]);
  const money = new Intl.NumberFormat(t.formatLocale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div ref={ref} className="relative" data-flow-board="" aria-hidden>
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STAGES.map((stage, s) => {
            const here = deals.filter((d) => d.stage === s);
            return (
              <div key={stage} className="sfx-lane min-h-[230px] rounded-2xl p-3">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {s === 3 ? <Trophy className="size-3.5 text-success" /> : <span className="size-2 rounded-full" style={{ background: `hsl(var(${['--sfx-amber', '--sfx-red', '--sfx-ember'][s]}))` }} />}
                    <Tr text={stage} />
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 tabular">{here.length}</span>
                </div>
                <div className="space-y-2">
                  {here.map((d) => (
                    <motion.div
                      key={d.id}
                      layoutId={`deal-${d.id}`}
                      layout
                      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                      className="sfx-deal rounded-xl p-3"
                      data-won={s === 3 || undefined}
                    >
                      <p className="truncate text-sm font-semibold" translate="no">
                        {d.name}
                      </p>
                      <p className="mt-0.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="tabular">{money.format(d.value)}</span>
                        {s === 3 && (
                          <span className="flex items-center gap-1 font-semibold text-success">
                            <Check className="size-3" /> <Tr text="Won" />
                          </span>
                        )}
                      </p>
                      {s === 2 && (
                        <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-2 rounded-lg bg-primary/10 p-2 text-[11px] leading-snug text-foreground">
                          <span className="mb-1 flex items-center gap-1 font-semibold text-primary">
                            <Bot className="size-3" /> Copilot <span className="sfx-typing ms-1 text-primary"><span /><span /><span /></span>
                          </span>
                          <Tr text="No reply in 9 days. Draft a follow-up for you to approve?" />
                        </motion.div>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
}

/* ── Feature bento ────────────────────────────────────────────────────────────────────────────────────────────── */

/** Only modules that exist in the product today. No customer logos, ratings or usage numbers: there are none to show yet. */
export const FEATURES = [
  { icon: KanbanSquare, title: 'Core CRM', body: 'Companies, contacts and deals with Kanban pipelines, custom fields, CSV import and export, and search.', span: 'lg:col-span-2' },
  { icon: Bot, title: 'Revenue Copilot', body: 'AI assistance for contact qualification, deal risk and drafting, with the reasoning shown and a person approving anything that leaves SampForce.', span: 'lg:col-span-2 lg:row-span-2' },
  { icon: GitBranch, title: 'Automation Studio', body: 'Workflows with conditions, delays and approval steps, a simulator to test them first, and signed webhooks.', span: '' },
  { icon: FileSignature, title: 'Quotes and contracts', body: 'Product catalogue, price books, tax rates, discount approvals, versioned quotes and contract renewals.', span: '' },
  { icon: Megaphone, title: 'Marketing', body: 'Consent-aware segments, hosted contact forms you can embed, and campaign attribution to contacts and won deals.', span: '' },
  { icon: LineChart, title: 'Revenue intelligence', body: 'Forecasts with scenarios, targets, win rates and revenue by source, computed from your own records.', span: 'lg:col-span-2' },
  { icon: HeartHandshake, title: 'Customer success', body: 'Rule-based health scores with the reasons listed, escalations and renewal reminders.', span: '' },
  { icon: ShieldCheck, title: 'Built for teams', body: 'Roles and permissions, an append-only audit log, and workspace isolation enforced in the database.', span: 'sm:col-span-2 lg:col-span-4' },
];

/** Moves the card's spotlight to the pointer and tilts the card a little towards it. */
function spotlight(e: ReactPointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty('--mx', `${x * 100}%`);
  el.style.setProperty('--my', `${y * 100}%`);
  el.style.setProperty('--rx', `${(0.5 - y) * 6}deg`);
  el.style.setProperty('--ry', `${(x - 0.5) * 6}deg`);
}
function resetSpot(e: ReactPointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}

export function FeatureBento() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-site-features="">
      {FEATURES.map((f, i) => (
        <motion.li
          key={f.title}
          initial={{ y: 28 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ type: 'spring', stiffness: 120, damping: 18, delay: (i % 4) * 0.07 }}
          className={cn('sfx-spot group rounded-3xl p-6', f.span)}
          onPointerMove={spotlight}
          onPointerLeave={resetSpot}
        >
          <span className="sfx-icon-tile grid size-11 place-items-center rounded-2xl">
            <f.icon className="sfx-icon-float size-5 text-primary" style={{ '--i': i } as CSSProperties} aria-hidden />
          </span>
          <h3 className="mt-4 text-lg font-semibold tracking-tight">
            <Tr text={f.title} />
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            <Tr text={f.body} />
          </p>
          {f.title === 'Revenue Copilot' && <CopilotPreview />}
        </motion.li>
      ))}
    </ul>
  );
}

/** The large Copilot card's own little scene: a suggestion, its reasons, and the person's approval. */
function CopilotPreview() {
  return (
    <div className="mt-5 space-y-2" aria-hidden>
      {[
        { who: 'ai', text: 'This deal may slip: the champion has not replied for 9 days.' },
        { who: 'ai', text: 'Why: last reply 9 days ago, close date in 12 days, no meeting booked.' },
        { who: 'you', text: 'Approved. Send the follow-up.' },
      ].map((m, i) => (
        <motion.div
          key={m.text}
          initial={{ opacity: 0, x: m.who === 'you' ? 16 : -16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 + i * 0.45, type: 'spring', stiffness: 140, damping: 16 }}
          className={cn('max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug', m.who === 'you' ? 'ms-auto bg-primary text-primary-foreground' : 'bg-muted text-foreground')}
        >
          <Tr text={m.text} />
        </motion.div>
      ))}
    </div>
  );
}

/* ── AI that asks first ───────────────────────────────────────────────────────────────────────────────────────── */

const STEPS = [
  { title: 'It suggests', body: 'Copilot spots the risk or the next step in your own records.' },
  { title: 'It explains', body: 'Every suggestion lists the reasons behind it, so you can check them.' },
  { title: 'It asks first', body: 'Nothing leaves SampForce until a person with permission approves it.' },
];

function Step({ i, title, body }: { i: number; title: string; body: string }) {
  const ref = useRef<HTMLLIElement>(null);
  const lit = useInView(ref, { once: true, margin: '-35% 0px -35% 0px' });
  return (
    <li ref={ref} className="sfx-step relative flex flex-col items-center text-center" data-lit={lit || undefined}>
      <span className="sfx-step-orb relative z-10 grid size-14 place-items-center rounded-full text-lg font-bold">{i + 1}</span>
      <h3 className="mt-4 text-lg font-semibold">
        <Tr text={title} />
      </h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        <Tr text={body} />
      </p>
    </li>
  );
}

export function AiSteps() {
  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="absolute inset-x-[16%] top-7 hidden h-0.5 origin-left rounded-full md:block rtl:origin-right"
        style={{ background: 'linear-gradient(90deg, hsl(var(--sfx-red)), hsl(var(--sfx-ember)), hsl(var(--sfx-amber)))' }}
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '-30%' }}
        transition={{ duration: 1.6, ease: [0.2, 0.9, 0.3, 1] }}
      />
      <ol className="grid gap-10 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Step key={s.title} i={i} {...s} />
        ))}
      </ol>
    </div>
  );
}
