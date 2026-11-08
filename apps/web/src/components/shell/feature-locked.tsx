'use client';

import { cheapestPlanWith, FEATURE_BY_KEY, type FeatureKey, PLAN_CATALOG, type PlanCode, type PublicPricing } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useHasFeature } from '@/lib/features';
import { useCan, useSession } from '@/lib/session';

const planName = (code: PlanCode | null | undefined) => (PLAN_CATALOG.find((p) => p.code === code)?.name ?? code ?? '').replace('SampForce ', '');

/** The live plan catalogue (operators can change what each plan includes), to say which plan includes a feature. */
export function useLivePlans() {
  return useQuery({ queryKey: ['public-pricing'], queryFn: () => api<PublicPricing>('/public/pricing'), staleTime: 5 * 60_000 });
}

/** Shown instead of a page whose feature the workspace's plan does not include (ADR 0057). */
export function FeatureLocked({ feature }: { feature: FeatureKey }) {
  const t = useT();
  const { data: me } = useSession();
  const canBuy = useCan('billing:manage');
  const plans = useLivePlans();
  const def = FEATURE_BY_KEY[feature];
  const from = plans.data ? cheapestPlanWith(feature, Object.fromEntries(plans.data.plans.map((p) => [p.code, p.entitlements.features]))) : null;
  return (
    <Card className="mx-auto mt-8 max-w-lg" data-feature-locked={feature}>
      <CardHeader>
        <div className="mb-2 grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-5" aria-hidden />
        </div>
        <CardTitle>{t('{feature} is not in your plan', { feature: t.maybe(def.label) })}</CardTitle>
        <CardDescription>{t.maybe(def.description)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {t('Your workspace is on the {plan} plan.', { plan: planName(me?.tenant.appliedPlan) })}{' '}
          {from && t('{feature} is included from the {plan} plan.', { feature: t.maybe(def.label), plan: planName(from) })}
        </p>
        <p className="text-muted-foreground">{t('Nothing you created is deleted. It is all here again when your plan includes this feature.')}</p>
        {canBuy ? (
          <Button asChild>
            <Link href="/app/billing">{t('See plans and upgrade')}</Link>
          </Button>
        ) : (
          <p className="text-muted-foreground">{t('Ask a workspace admin to upgrade the plan.')}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** A small note in place of a widget or panel whose feature the plan leaves out. */
export function FeatureLockedNote({ feature }: { feature: FeatureKey }) {
  const t = useT();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" data-feature-locked={feature}>
      <Lock className="size-4 shrink-0" aria-hidden />
      {t('{feature} is not in your plan', { feature: t.maybe(FEATURE_BY_KEY[feature].label) })}
    </p>
  );
}

/**
 * Wraps a panel that belongs to a plan feature: it renders only while the plan includes the feature, and otherwise
 * `fallback` (nothing by default), so record pages and the Command Center do not show panels that would fail.
 */
export function gated<P extends object>(feature: FeatureKey, Component: React.ComponentType<P>, fallback: 'none' | 'note' = 'none'): React.FC<P> {
  function Gated(props: P) {
    const has = useHasFeature(feature);
    if (has) return <Component {...props} />;
    return fallback === 'note' ? <FeatureLockedNote feature={feature} /> : null;
  }
  Gated.displayName = `Gated(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Gated;
}
