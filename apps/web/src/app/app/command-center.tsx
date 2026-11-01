'use client';

import { Button, Card, cn, Skeleton } from '@dealflow/ui';
import { completeLayout, DASHBOARD_PERIODS, DASHBOARD_PRESETS, type DashboardFilter, type DashboardLayout, type DashboardWidget } from '@dealflow/types';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutGrid, Maximize2, Minimize2, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ActivityStream } from '@/components/command-center/activity-stream';
import { GoalCard, RevenueTrendChart, RiskChart, StageConversionChart, TeamChart, WinLossChart } from '@/components/command-center/charts';
import { SalesInsights } from '@/components/command-center/insights';
import { KpiGrid } from '@/components/command-center/kpi-grid';
import { NextActions } from '@/components/command-center/next-actions';
import { OnboardingChecklist } from '@/components/command-center/onboarding';
import { PipelineChart } from '@/components/command-center/pipeline-chart';
import { PageHeader } from '@/components/page-header';
import { useMembers, usePipelines } from '@/lib/crm';
import { useDashboardCharts, useDashboardLayout, useDashboardSummary, useSaveDashboardLayout } from '@/lib/dashboard';
import { useCan, useSession } from '@/lib/session';

const WIDGET_LABEL: Record<DashboardWidget, string> = {
  kpis: 'Key metrics',
  nextActions: 'Next best actions',
  insights: 'Sales insights',
  pipeline: 'Pipeline by stage',
  revenueTrend: 'Revenue trend',
  stageConversion: 'Stage conversion',
  winLoss: 'Win and loss',
  team: 'Team performance',
  risk: 'Deal risk',
  goal: 'Goal attainment',
  activity: 'Recent activity',
};
const CHART_WIDGETS: DashboardWidget[] = ['revenueTrend', 'stageConversion', 'winLoss', 'team', 'risk', 'goal'];
const SUMMARY_WIDGETS: DashboardWidget[] = ['kpis', 'pipeline', 'activity'];
const PERIOD_LABEL: Record<(typeof DASHBOARD_PERIODS)[number], string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', '365d': 'Last 12 months' };
const PRESET_LABEL = { executive: 'Executive', salesperson: 'Salesperson', custom: 'Custom' } as const;

const selectClass = 'h-9 rounded-md border border-input bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CommandCenter() {
  const { data: session } = useSession();
  const canDashboard = useCan('dashboard:read');
  const canSetTargets = useCan('pipelines:manage');
  const { layout: savedLayout, saved, isPending: layoutPending } = useDashboardLayout();
  const save = useSaveDashboardLayout();
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<DashboardWidget | null>(null);
  const layout = draft ?? savedLayout;
  const filters = layout.filters;
  const editing = draft !== null;

  const visible = layout.widgets.filter((w) => !w.hidden && (canDashboard || (w.id !== 'nextActions' && w.id !== 'insights')));
  const summary = useDashboardSummary(filters, !layoutPending && visible.some((w) => SUMMARY_WIDGETS.includes(w.id)));
  const charts = useDashboardCharts(filters, !layoutPending && visible.some((w) => CHART_WIDGETS.includes(w.id)));
  const members = useMembers();
  const pipelines = usePipelines();
  const firstName = session?.user.name.split(' ')[0];

  const setFilters = (patch: Partial<DashboardFilter>) => {
    const next = { ...filters, ...patch };
    for (const k of ['ownerId', 'pipelineId'] as const) if (!next[k]) delete next[k];
    if (draft) setDraft({ ...draft, filters: next });
    else save.mutate({ ...savedLayout, filters: next });
  };

  const choosePreset = (p: 'executive' | 'salesperson') => {
    const next = completeLayout(DASHBOARD_PRESETS[p]);
    if (draft) setDraft(next);
    else save.mutate(next);
    setAnnounce(`${PRESET_LABEL[p]} layout applied.`);
  };

  const editWidgets = (fn: (w: DashboardLayout['widgets']) => DashboardLayout['widgets'], message: string) => {
    if (!draft) return;
    setDraft({ ...draft, preset: 'custom', widgets: fn([...draft.widgets]) });
    setAnnounce(message);
  };
  const move = (id: DashboardWidget, dir: -1 | 1) =>
    editWidgets((ws) => {
      // Move past hidden widgets so each press visibly changes the order.
      const shown = ws.filter((w) => !w.hidden).map((w) => w.id);
      const target = shown[shown.indexOf(id) + dir];
      if (!target) return ws;
      const from = ws.findIndex((w) => w.id === id);
      const [item] = ws.splice(from, 1);
      const to = ws.findIndex((w) => w.id === target);
      ws.splice(dir === 1 ? to + 1 : to, 0, item!);
      return ws;
    }, `${WIDGET_LABEL[id]} moved ${dir === -1 ? 'up' : 'down'}.`);
  const dropOn = (target: DashboardWidget) => {
    if (!dragId || dragId === target) return;
    const id = dragId;
    editWidgets((ws) => {
      const from = ws.findIndex((w) => w.id === id);
      const [item] = ws.splice(from, 1);
      ws.splice(ws.findIndex((w) => w.id === target), 0, item!);
      return ws;
    }, `${WIDGET_LABEL[id]} moved before ${WIDGET_LABEL[target]}.`);
    setDragId(null);
  };
  const resize = (id: DashboardWidget) =>
    editWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, size: w.size === 'full' ? 'half' : 'full' } : w)), `${WIDGET_LABEL[id]} resized.`);
  const setHidden = (id: DashboardWidget, hidden: boolean) =>
    editWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, hidden } : w)), `${WIDGET_LABEL[id]} ${hidden ? 'hidden' : 'shown'}.`);

  const finish = () => {
    if (draft) save.mutate(draft);
    setDraft(null);
    setAnnounce('Layout saved.');
  };
  const reset = () => {
    save.mutate(null);
    setDraft(null);
    setAnnounce('Layout reset to the salesperson view.');
  };

  const summaryBlock = (render: (d: NonNullable<typeof summary.data>) => React.ReactNode, height = 'h-40') =>
    summary.data ? render(summary.data) : summary.error ? <Card role="alert" className="p-5 text-sm text-critical">Metrics are temporarily unavailable. {summary.error.message}</Card> : <Skeleton className={height} aria-label="Loading" />;
  const chartBlock = (render: (d: NonNullable<typeof charts.data>) => React.ReactNode) =>
    charts.data ? render(charts.data) : charts.error ? <Card role="alert" className="p-5 text-sm text-critical">Charts are temporarily unavailable. {charts.error.message}</Card> : <Skeleton className="h-72" aria-label="Loading chart" />;

  const renderWidget = (id: DashboardWidget) => {
    switch (id) {
      case 'kpis':
        return summaryBlock((d) => <KpiGrid kpis={d.kpis} currency={d.currency} />, 'h-48');
      case 'nextActions':
        return <NextActions />;
      case 'insights':
        return <SalesInsights />;
      case 'pipeline':
        return summaryBlock((d) => (d.pipeline ? <PipelineChart pipeline={d.pipeline} currency={d.currency} /> : <Card className="p-5 text-sm text-muted-foreground">No pipeline configured.</Card>), 'h-72');
      case 'activity':
        return summaryBlock((d) => <ActivityStream items={d.recentActivity} />);
      case 'revenueTrend':
        return chartBlock((d) => <RevenueTrendChart data={d} />);
      case 'stageConversion':
        return chartBlock((d) => <StageConversionChart data={d} />);
      case 'winLoss':
        return chartBlock((d) => <WinLossChart data={d} />);
      case 'team':
        return chartBlock((d) => <TeamChart data={d} />);
      case 'risk':
        return chartBlock((d) => <RiskChart data={d} />);
      case 'goal':
        return chartBlock((d) => <GoalCard data={d} canSetTargets={canSetTargets} />);
    }
  };

  const hidden = layout.widgets.filter((w) => w.hidden);
  const refresh = () => {
    void summary.refetch();
    if (charts.isFetched) void charts.refetch();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : 'Command Center'}
        description={`Live metrics for ${session?.tenant.name ?? 'your workspace'} · ${PERIOD_LABEL[filters.period].toLowerCase()}${summary.data ? ` · ${summary.data.currency}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={summary.isFetching}>
              <RefreshCw className={summary.isFetching ? 'animate-spin' : undefined} aria-hidden />
              Refresh
            </Button>
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => setDraft(structuredClone(savedLayout))}>
                <LayoutGrid aria-hidden />
                Customize layout
              </Button>
            )}
          </div>
        }
      />

      <OnboardingChecklist />

      <section aria-label="Dashboard filters" className="flex flex-wrap items-end gap-3" data-secondary>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Period
          <select className={selectClass} value={filters.period} onChange={(e) => setFilters({ period: e.target.value as DashboardFilter['period'] })}>
            {DASHBOARD_PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Owner
          <select className={selectClass} value={filters.ownerId ?? ''} onChange={(e) => setFilters({ ownerId: e.target.value || undefined })}>
            <option value="">Everyone</option>
            <option value="me">Just me</option>
            {(members.data ?? [])
              .filter((m) => m.userId !== session?.user.id)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Pipeline
          <select className={selectClass} value={filters.pipelineId ?? ''} onChange={(e) => setFilters({ pipelineId: e.target.value || undefined })}>
            <option value="">All pipelines</option>
            {(pipelines.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Layout</legend>
          <div className="flex rounded-md border border-input p-0.5" role="group">
            {(['salesperson', 'executive'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={layout.preset === p}
                onClick={() => choosePreset(p)}
                className={cn('h-8 rounded px-3 text-sm transition-colors', layout.preset === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            {layout.preset === 'custom' && <span className="flex h-8 items-center px-3 text-sm text-muted-foreground">Custom</span>}
          </div>
        </fieldset>
      </section>

      {editing && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/[0.04] p-4" role="region" aria-label="Customize dashboard">
          <p className="text-sm">
            Drag widgets, or use the arrows, to reorder. Changes are saved for you only, in this workspace.
          </p>
          <div className="flex flex-wrap gap-2">
            {saved && (
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw aria-hidden />
                Reset to default
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={finish}>
              Done
            </Button>
          </div>
          {hidden.length > 0 && (
            <div className="w-full">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Hidden widgets</p>
              <ul className="flex flex-wrap gap-2" aria-label="Hidden widgets">
                {hidden.map((w) => (
                  <li key={w.id}>
                    <Button variant="outline" size="sm" onClick={() => setHidden(w.id, false)} aria-label={`Show ${WIDGET_LABEL[w.id]}`}>
                      <Eye aria-hidden />
                      {WIDGET_LABEL[w.id]}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {save.isError && (
        <Card role="alert" className="p-4 text-sm text-critical">
          Your layout could not be saved. {save.error.message}
        </Card>
      )}

      {layoutPending ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading dashboard">
          <Skeleton className="h-48 md:col-span-2" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Dashboard widgets">
          {visible.map((w, i) => (
            <li
              key={w.id}
              data-widget={w.id}
              className={cn('min-w-0', w.size === 'full' && 'md:col-span-2', editing && 'rounded-xl outline-dashed outline-2 outline-offset-4 outline-border', dragId === w.id && 'opacity-50')}
              draggable={editing}
              onDragStart={(e) => {
                setDragId(w.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', w.id);
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (editing && dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(w.id);
              }}
            >
              {editing && (
                <div className="mb-2 flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1" aria-label={`${WIDGET_LABEL[w.id]} controls`} role="group">
                  <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm font-medium">{WIDGET_LABEL[w.id]}</span>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => move(w.id, -1)} disabled={i === 0} aria-label={`Move ${WIDGET_LABEL[w.id]} up`}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => move(w.id, 1)} disabled={i === visible.length - 1} aria-label={`Move ${WIDGET_LABEL[w.id]} down`}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => resize(w.id)} aria-label={w.size === 'full' ? `Make ${WIDGET_LABEL[w.id]} half width` : `Make ${WIDGET_LABEL[w.id]} full width`}>
                    {w.size === 'full' ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => setHidden(w.id, true)} aria-label={`Hide ${WIDGET_LABEL[w.id]}`}>
                    <EyeOff aria-hidden />
                  </Button>
                </div>
              )}
              <div className={cn(editing && 'pointer-events-none select-none')} inert={editing || undefined}>
                {renderWidget(w.id)}
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="md:col-span-2">
              <Card className="p-8 text-center text-sm text-muted-foreground">Every widget is hidden. Choose Customize layout to show some again.</Card>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
