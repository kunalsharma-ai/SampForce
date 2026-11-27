'use client';

import type { CommandCenterView } from '@dealflow/types';
import { cn, Skeleton } from '@dealflow/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExecutiveDashboard } from '@/components/command-center/executive-dashboard';
import { OnboardingChecklist } from '@/components/command-center/onboarding';
import { ManagerDashboard } from '@/components/command-center/manager-dashboard';
import { SeniorDashboard } from '@/components/command-center/senior-dashboard';
import { HomeNotifications } from '@/components/notifications/home-notifications';
import { PageHeader } from '@/components/page-header';
import { YourTargets } from '@/components/workspace-work/targets';
import { TasksForYou } from '@/components/workspace-work/tasks';
import { LevelDashboard } from '@/components/workspace-dashboard/level-dashboards';
import { RoleDashboard } from '@/components/workspace-dashboard/role-dashboards';
import { useHasFeature } from '@/lib/features';
import { useCommandCenterContext } from '@/lib/command-center';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan, useSession } from '@/lib/session';
import { AnalyticsDashboard } from './command-center';

/** The dashboards (ADR 0063), plus the dashboard of the workspace level (ADR 0071 part 6). */
/** `workspace` is the role dashboard (redesign R6, ADR 0086); `overview` keeps the level dashboard it replaced. */
type View = CommandCenterView | 'workspace' | 'overview';
const BUILT: CommandCenterView[] = ['senior', 'manager', 'executive', 'analytics'];
const LEVEL_LABEL: Record<'SUPER' | 'MANAGER' | 'EXECUTIVE', MessageKey> = { SUPER: 'Organisation', MANAGER: 'Team', EXECUTIVE: 'My day' };
/** Which designation dashboards each workspace level may also open: a manager its team's, an executive its own. */
const LEVEL_VIEWS: Record<'SUPER' | 'MANAGER' | 'EXECUTIVE', CommandCenterView[] | null> = { SUPER: null, MANAGER: ['manager'], EXECUTIVE: ['executive'] };
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
  const hasTasks = useHasFeature('task_management');
  const hasTargets = useHasFeature('sales_target_management');
  const hasNotifications = useHasFeature('notifications');
  const ctx = useCommandCenterContext(!!session && !session.restriction && canDashboard);
  if (!session || (canDashboard && ctx.isPending && !session.restriction))
    return <Skeleton className="h-96" aria-label={t('Loading')} />;
  if (!ctx.data) return <AnalyticsDashboard />;

  const level = session.workspace?.level ?? 'SUPER';
  // The organisation overview is for the Super Workspace's administrators; managers and executives always have theirs.
  const hasLevelView = level !== 'SUPER' || session.permissions.includes('members:manage');
  const allowed = LEVEL_VIEWS[level];
  const views: View[] = [...(hasLevelView ? (['workspace', 'overview'] as const) : []), ...ctx.data.views.filter((v) => BUILT.includes(v) && (!allowed || allowed.includes(v)))];
  const asked = params.get('view') as View | null;
  const fallback: View = hasLevelView ? 'workspace' : BUILT.includes(ctx.data.defaultView) ? ctx.data.defaultView : 'analytics';
  const view = asked && views.includes(asked) ? asked : fallback;
  const choose = (v: View) => {
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
        className="mb-4 inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-0.5"
      >
        {views.map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => choose(v)}
            className={cn(
              'h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-sm transition-colors',
              view === v
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(v === 'workspace' ? LEVEL_LABEL[level] : v === 'overview' ? 'Overview' : VIEW_LABEL[v])}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div>
      {tabs}
      {/* The workspace level's own dashboard leads; work handed down the hierarchy (ADR 0071) follows it, or comes first on the others. */}
      {view === 'overview' && level === 'SUPER' && <OnboardingChecklist />}
      {view === 'workspace' && <RoleDashboard level={level} />}
      {view === 'workspace' && level === 'SUPER' && (
        <div className="mt-4">
          <OnboardingChecklist />
        </div>
      )}
      {view === 'overview' && <LevelDashboard level={level} />}
      {(hasTasks || hasTargets || hasNotifications) && (
        <div className={view === 'workspace' || view === 'overview' ? 'mt-4 space-y-4' : 'mb-4 space-y-4'}>
          {/* The home dashboard's way to notifications (ADR 0075). The role dashboard draws its own target rings. */}
          {hasNotifications && <HomeNotifications />}
          {hasTasks && <TasksForYou />}
          {hasTargets && view !== 'workspace' && <YourTargets />}
        </div>
      )}
      {view === 'workspace' || view === 'overview' ? null : view === 'senior' ? (
        <div className="space-y-2">
          <PageHeader
            title="Senior management dashboard"
            description="The organisation’s numbers for the period, how each department and team is doing, who is ahead, where revenue comes from, and what needs attention. Every number opens the records it counts."
          />
          <OnboardingChecklist />
          <SeniorDashboard context={ctx.data} />
        </div>
      ) : view === 'manager' ? (
        <div className="space-y-2">
          <PageHeader
            title="Manager dashboard"
            description="Your team’s companies, follow-ups, pipeline and revenue for the period, and the work that needs you. Every number opens the records it counts."
          />
          <ManagerDashboard key={params.get('person') ?? ''} context={ctx.data} />
        </div>
      ) : view === 'executive' ? (
        <div className="space-y-2">
          <PageHeader
            title="Executive dashboard"
            description="Your companies, work, pipeline and credited revenue for the period. Every number opens the records it counts."
          />
          <ExecutiveDashboard key={params.get('person') ?? ''} context={ctx.data} />
        </div>
      ) : (
        <AnalyticsDashboard />
      )}
    </div>
  );
}
