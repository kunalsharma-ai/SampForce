'use client';

import { allGuides } from '@dealflow/help';
import { cheapestPlanWith, FEATURE_BY_KEY, FEATURES, type PlanCode } from '@dealflow/types';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { ArrowRight, Check, Compass, Crown, Layers3, Minus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useLivePlans } from '@/components/shell/feature-locked';
import { countHelpView, type HelpView, type ViewBrief } from '@/lib/help-content';
import { type Translator, useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { ArticleBody, FeedbackBar, UpdatedOn, VideoLink } from './article';
import { ToneIcon } from './help-ui';

const planName = (name: string) => name.replace('SampForce ', '');

/**
 * Explore SampForce (ADR 0073): a brief for every part of the product, the plans on offer from the live catalogue,
 * and the facilities around them. Each brief says how much of it the reader's plan includes; the Console can rewrite,
 * hide or add briefs (articles of kind FEATURE).
 */
export function ExploreSampForce({
  view,
  audience,
  currentPlan,
  billingHref,
  onOpenGuide,
}: {
  view: HelpView;
  audience: 'workspace' | 'console';
  currentPlan: string | null;
  billingHref: string | null;
  /** Opens a feature guide; left out where the guides are not the reader's (the Console). */
  onOpenGuide?: (pageId: string) => void;
}) {
  const t = useT();
  const [opened, setOpened] = useState<ViewBrief | null>(null);
  const features = view.briefs.filter((b) => b.kind === 'feature');
  const facilities = view.briefs.filter((b) => b.kind === 'facility');
  const open = (b: ViewBrief) => {
    setOpened(b);
    if (audience === 'workspace') countHelpView(b.key);
  };
  if (!view.briefs.length) return null;
  return (
    <section id="explore" aria-labelledby="help-explore" className="scroll-mt-20 space-y-8" data-help-explore>
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent/10 via-background to-primary/10 p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -start-20 -top-20 size-64 rounded-full bg-accent/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Compass className="size-3.5" aria-hidden /> {t('Explore SampForce')}
            </span>
            <h2 id="help-explore" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('Everything SampForce does for your team')}
            </h2>
            <p className="mt-2 text-muted-foreground">
              {t('Every feature, the plans on offer and the facilities that come with them. Open any one to see what it does and whether your plan includes it.')}
            </p>
          </div>
          <dl className="flex gap-6 text-center">
            <Figure value={features.length} label={t('Product areas')} />
            <Figure value={FEATURES.length} label={t('Features')} />
            <Figure value={facilities.length} label={t('Facilities')} />
          </dl>
        </div>
      </div>

      {features.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <Layers3 className="size-5 text-primary" aria-hidden /> {t('Features')}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {features.map((b) => (
              <li key={b.key}>
                <BriefCard brief={b} t={t} audience={audience} onOpen={() => open(b)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <Plans t={t} currentPlan={currentPlan} billingHref={billingHref} audience={audience} />

      {facilities.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="size-5 text-primary" aria-hidden /> {t('Facilities')}
          </h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {facilities.map((b) => (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => open(b)}
                  data-help-brief={b.id}
                  className="group flex h-full w-full flex-col rounded-2xl border border-border bg-card p-5 text-start transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span className="flex items-center gap-3">
                    <ToneIcon icon={b.icon} tone={b.tone} />
                    <span className="min-w-0">
                      <span className="block font-semibold">{b.title}</span>
                      {b.tagline && <span className="block text-sm text-muted-foreground">{b.tagline}</span>}
                    </span>
                  </span>
                  {b.highlights.length > 0 && (
                    <ul className="mt-4 space-y-1.5 text-sm">
                      {b.highlights.map((h) => (
                        <li key={h} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BriefDialog
        brief={opened}
        onClose={() => setOpened(null)}
        audience={audience}
        myFeedback={view.myFeedback}
        guideIds={new Set(view.guides.map((g) => g.id))}
        onOpenGuide={
          onOpenGuide
            ? (id) => {
                setOpened(null);
                onOpenGuide(id);
              }
            : undefined
        }
      />
    </section>
  );
}

/** Parts of SampForce that match a search, above the answers and guides. */
export function BriefResults({
  briefs,
  view,
  audience,
  onOpenGuide,
}: {
  briefs: ViewBrief[];
  view: HelpView;
  audience: 'workspace' | 'console';
  onOpenGuide?: (pageId: string) => void;
}) {
  const t = useT();
  const [opened, setOpened] = useState<ViewBrief | null>(null);
  if (!briefs.length) return null;
  return (
    <section aria-labelledby="help-brief-results" data-help-brief-results>
      <h3 id="help-brief-results" className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Compass className="size-4" aria-hidden /> {t('Explore SampForce')}
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {briefs.slice(0, 6).map((b) => (
          <li key={b.key}>
            <BriefCard
              brief={b}
              t={t}
              audience={audience}
              onOpen={() => {
                setOpened(b);
                if (audience === 'workspace') countHelpView(b.key);
              }}
            />
          </li>
        ))}
      </ul>
      <BriefDialog
        brief={opened}
        onClose={() => setOpened(null)}
        audience={audience}
        myFeedback={view.myFeedback}
        guideIds={new Set(view.guides.map((g) => g.id))}
        onOpenGuide={
          onOpenGuide
            ? (id) => {
                setOpened(null);
                onOpenGuide(id);
              }
            : undefined
        }
      />
    </section>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-3xl font-semibold tabular-nums text-primary">{value}</dd>
      <dd aria-hidden className="text-xs font-medium text-muted-foreground">
        {label}
      </dd>
    </div>
  );
}

/** "Included", "Partly included" or "Not in your plan", only for workspaces: the Console sees every part. */
export function AvailabilityBadge({ brief, t }: { brief: ViewBrief; t: Translator }) {
  if (brief.availability === 'included')
    return (
      <Badge tone="success" data-brief-availability="included">
        {t('In your plan')}
      </Badge>
    );
  if (brief.availability === 'partial')
    return (
      <Badge tone="primary" data-brief-availability="partial">
        {t('Partly in your plan')}
      </Badge>
    );
  return (
    <Badge tone="neutral" data-brief-availability="not-included">
      {t('Not in your plan')}
    </Badge>
  );
}

function BriefCard({
  brief,
  t,
  audience,
  onOpen,
}: {
  brief: ViewBrief;
  t: Translator;
  audience: 'workspace' | 'console';
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-help-brief={brief.id}
      className="group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 text-start transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -end-10 -top-10 size-28 rounded-full opacity-60 blur-2xl transition group-hover:opacity-100"
        style={{ background: `hsl(var(--chart-${brief.tone}) / 0.18)` }}
      />
      <span className="relative flex items-start justify-between gap-3">
        <ToneIcon icon={brief.icon} tone={brief.tone} size="lg" />
        {audience === 'workspace' && brief.features.length > 0 && <AvailabilityBadge brief={brief} t={t} />}
      </span>
      <span className="relative mt-4 block text-base font-semibold">{brief.title}</span>
      {brief.tagline && <span className="relative mt-0.5 block text-sm font-medium text-primary">{brief.tagline}</span>}
      <span className="relative mt-2 line-clamp-3 text-sm text-muted-foreground">{brief.summary}</span>
      <span className="relative mt-auto inline-flex items-center gap-1 pt-4 text-xs font-semibold text-primary">
        {t('Learn more')}
        <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5 rtl:rotate-180 motion-reduce:transition-none" aria-hidden />
      </span>
    </button>
  );
}

/** A brief opened: what it does, its highlights, which of its features the plan includes, and where to go next. */
function BriefDialog({
  brief,
  onClose,
  audience,
  myFeedback,
  guideIds,
  onOpenGuide,
}: {
  brief: ViewBrief | null;
  onClose: () => void;
  audience: 'workspace' | 'console';
  myFeedback: Record<string, boolean>;
  /** The guides the reader can open. */
  guideIds: Set<string>;
  onOpenGuide?: (pageId: string) => void;
}) {
  const t = useT();
  const plans = useLivePlans();
  const lists = plans.data ? Object.fromEntries(plans.data.plans.map((p) => [p.code, p.entitlements.features])) : null;
  const nameOf = (code: PlanCode) => planName(plans.data?.plans.find((p) => p.code === code)?.name ?? code);
  return (
    <Dialog open={!!brief} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[6%] max-h-[88vh] max-w-2xl overflow-y-auto p-0">
        {brief && (
          <div data-help-brief-dialog={brief.id}>
            <div
              className="border-b border-border px-6 pb-6 pt-7"
              style={{ background: `linear-gradient(135deg, hsl(var(--chart-${brief.tone}) / 0.18), transparent 70%)` }}
            >
              <div className="flex items-start gap-4">
                <ToneIcon icon={brief.icon} tone={brief.tone} size="lg" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary">{brief.kind === 'facility' ? t('Facility') : t('Feature')}</Badge>
                    {audience === 'workspace' && brief.features.length > 0 && <AvailabilityBadge brief={brief} t={t} />}
                    <UpdatedOn iso={brief.updatedAt} />
                  </div>
                  <DialogTitle className="mt-2 text-xl font-semibold">{brief.title}</DialogTitle>
                  {brief.tagline && <p className="text-sm font-medium text-primary">{brief.tagline}</p>}
                </div>
              </div>
              <DialogDescription className="mt-4 text-sm leading-relaxed text-foreground/80">{brief.summary}</DialogDescription>
            </div>
            <div className="space-y-5 px-6 py-5">
              {brief.highlights.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {brief.highlights.map((h) => (
                    <li key={h} className="flex gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {h}
                    </li>
                  ))}
                </ul>
              )}
              <ArticleBody body={brief.body} audience={audience} />
              <VideoLink url={brief.videoUrl} />
              {brief.features.length > 0 && (
                <div data-brief-features>
                  <h3 className="mb-2 text-sm font-semibold">{t('What it includes')}</h3>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {brief.features.map((f) => {
                      const def = FEATURE_BY_KEY[f];
                      const from = lists ? cheapestPlanWith(f, lists) : null;
                      return (
                        <li key={f} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm" data-brief-feature={f}>
                          <span className="min-w-0">
                            <span className="block font-medium">{t.maybe(def.label)}</span>
                            <span className="block text-xs text-muted-foreground">{t.maybe(def.description)}</span>
                          </span>
                          {audience === 'workspace' && (
                            <FeatureState included={brief.included.includes(f)} from={from ? nameOf(from) : null} t={t} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {audience === 'workspace' && brief.href && (
                  <Button asChild>
                    <Link href={brief.href} onClick={onClose}>
                      {t('Open page')} <ArrowRight className="rtl:rotate-180" aria-hidden />
                    </Link>
                  </Button>
                )}
                {onOpenGuide &&
                  brief.guides.filter((g) => guideIds.has(g)).map((g) => (
                  <Button key={g} variant="outline" onClick={() => onOpenGuide(g)} data-brief-guide={g}>
                    {t('Read the guide')}
                    <GuideTitle id={g} />
                  </Button>
                ))}
              </div>
              {audience === 'workspace' && <FeedbackBar articleKey={brief.key} mine={myFeedback[brief.key]} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The page a guide button opens, after "Read the guide:", in the screen's own words. */
function GuideTitle({ id }: { id: string }) {
  const t = useT();
  const title = GUIDE_TITLES.get(id);
  return title ? <span className="text-muted-foreground">· {t.maybe(title)}</span> : null;
}

const GUIDE_TITLES = new Map(allGuides().map((g) => [g.id as string, g.topic.title]));

function FeatureState({ included, from, t }: { included: boolean; from: string | null; t: Translator }) {
  if (included)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success" data-feature-state="included">
        <Check className="size-3.5" aria-hidden /> {t('Included')}
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" data-feature-state="not-included">
      <Minus className="size-3.5" aria-hidden />
      {from ? t('From the {plan} plan', { plan: from }) : t('Not included')}
    </span>
  );
}

/** The plans on offer, from the live catalogue the Console edits, with the reader's own plan marked. */
function Plans({
  t,
  currentPlan,
  billingHref,
  audience,
}: {
  t: Translator;
  currentPlan: string | null;
  billingHref: string | null;
  audience: 'workspace' | 'console';
}) {
  const pricing = useLivePlans();
  const plans = pricing.data?.plans ?? [];
  if (!plans.length) return null;
  return (
    <div data-help-plans>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Crown className="size-5 text-primary" aria-hidden /> {t('Plans on offer')}
        </h3>
        <div className="flex gap-2">
          {billingHref && (
            <Button asChild variant="outline" size="sm">
              <Link href={billingHref}>{audience === 'console' ? t('Manage plans') : t('Your plan and billing')}</Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing" target="_blank" rel="noreferrer">
              {t('Compare plans')} <ArrowRight className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
      {/* Scrolls sideways on narrow screens, so it can take focus for keyboard scrolling. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable */}
      <ul tabIndex={0} aria-label={t('Plans on offer')} className="flex snap-x gap-3 overflow-x-auto rounded-2xl pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {plans.map((p) => {
          const mine = p.code === currentPlan;
          const price = p.monthly;
          const e = p.entitlements;
          return (
            <li
              key={p.code}
              className={`relative flex w-56 shrink-0 snap-start flex-col rounded-2xl border p-4 ${mine ? 'border-primary bg-primary/5 ring-2 ring-primary/30' : 'border-border bg-card'}`}
              data-help-plan={p.code}
              data-current={mine || undefined}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold">{planName(p.name)}</span>
                {mine && <Badge tone="primary">{t('Your plan')}</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">{t.maybe(p.audience)}</span>
              <span className={`mt-3 font-semibold tabular-nums ${!pricing.data?.published && p.code !== 'free' ? 'text-base' : 'text-2xl'}`}>
                {!pricing.data?.published && p.code !== 'free' ? t('Price on request') : price === null ? t('Custom') : `$${price}`}
                {pricing.data?.published && price ? <span className="text-xs font-normal text-muted-foreground"> {t('/user/mo')}</span> : null}
              </span>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>{t('{n} of {total} features', { n: e.features.length, total: FEATURES.length })}</li>
                <li>{t('{n} AI credits per user per month', { n: e.monthlyAiCredits.toLocaleString(fmtLocale()) })}</li>
                <li>{t('{n} automation runs per month', { n: e.automationRunsPerMonth.toLocaleString(fmtLocale()) })}</li>
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
