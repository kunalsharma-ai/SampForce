'use client';

import type { CommandCenterView } from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExecutiveDashboard } from '@/components/command-center/executive-dashboard';
import { OnboardingChecklist } from '@/components/command-center/onboarding';
import { ManagerDashboard } from '@/components/command-center/manager-dashboard';
import { SeniorDashboard } from '@/components/command-center/senior-dashboard';
import { PageHeader } from '@/components/page-header';
import { useCommandCenterContext } from '@/lib/command-center';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan, useSession } from '@/lib/session';
import { AnalyticsDashboard } from './command-center';

/** The dashboards (ADR 0063). */
const BUILT: CommandCenterView[] = ['senior', 'manager', 'executive', 'analytics'];
const VIEW_LABEL: Record<CommandCenterView, MessageKey> = {
  executive: 'Executive',
  manager: 'Manager',
  senior: 'Senior management',
  analytics: 'Analytics',
};

/**
 * The Command Center (ADR 0063): each person opens on the dashboard of their designation tier (executive, manager or
 * senior management) and can switch to the others their tier allows, and to the analytics layout.
 */
export function CommandCenter() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();
  const canDashboard = useCan('dashboard:read');
  const ctx = useCommandCenterContext(!!session && !session.restriction && canDashboard);
  if (!session || (canDashboard && ctx.isPending && !session.restriction))
    return <Skeleton className="h-96" aria-label={t('Loading')} />;
  if (!ctx.data) return <AnalyticsDashboard />;

  const views = ctx.data.views.filter((v) => BUILT.includes(v));
  const asked = params.get('view') as CommandCenterView | null;
  const fallback = BUILT.includes(ctx.data.defaultView) ? ctx.data.defaultView : 'analytics';
  const view = asked && views.includes(asked) ? asked : fallback;
  const choose = (v: CommandCenterView) => {
    const next = new URLSearchParams(params.toString());
    next.set('view', v);
    next.delete('transfer');
    next.delete('person');
    next.delete('instruction');
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const tabs =
    views.length > 1 ? (
      <div
        role="tablist"
        aria-label={t('Dashboards')}
        className="mb-4 inline-flex rounded-lg border border-border bg-surface p-0.5"
      >
        {views.map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => choose(v)}
            className={cn(
              'h-8 rounded-md px-3 text-sm transition-colors',
              view === v
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(VIEW_LABEL[v])}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div>
      {tabs}
      {view === 'senior' ? (
        <div className="space-y-2">
          <PageHeader
            title="Senior management dashboard"
            description="The organisation's numbers for the period, how each department and team is doing, who leads, where revenue comes from, and what needs attention. Every number opens the records it counts."
          />
          <OnboardingChecklist />
          <SeniorDashboard context={ctx.data} />
        </div>
      ) : view === 'manager' ? (
        <div className="space-y-2">
          <PageHeader
            title="Manager dashboard"
            description="Your team's leads, follow-ups, pipeline and revenue for the period, and the work that needs you. Every number opens the records it counts."
          />
          <ManagerDashboard key={params.get('person') ?? ''} context={ctx.data} />
        </div>
      ) : view === 'executive' ? (
        <div className="space-y-2">
          <PageHeader
            title="Executive dashboard"
            description="Your leads, work, pipeline and credited revenue for the period. Every number opens the records it counts."
          />
          <ExecutiveDashboard key={params.get('person') ?? ''} context={ctx.data} />
        </div>
      ) : (
        <AnalyticsDashboard />
      )}
    </div>
  );
}
