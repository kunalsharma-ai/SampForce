'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { DashboardSummary } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ActivityStream } from '@/components/command-center/activity-stream';
import { KpiGrid } from '@/components/command-center/kpi-grid';
import { PipelineChart } from '@/components/command-center/pipeline-chart';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const NEXT_UP = [
  { phase: 2, title: 'Core CRM', body: 'Leads, contacts, companies, deals with Kanban pipelines, import/export and search.', href: '/app/leads' },
  { phase: 3, title: 'Automation Studio', body: 'Visual workflows with simulation, approvals, email and calendar sync.', href: '/app/automation' },
  { phase: 4, title: 'Revenue Brain & Copilot', body: 'AI gateway, explainable deal health and permissioned agents.', href: '/app/agents' },
];

export function CommandCenter() {
  const { data: session } = useSession();
  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
    refetchInterval: 60_000,
  });
  const firstName = session?.user.name.split(' ')[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : 'Command Center'}
        description={
          summary.data
            ? `Live metrics for ${session?.tenant.name ?? 'your workspace'} · last 30 days · ${summary.data.currency}`
            : 'Live revenue metrics for your workspace.'
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => summary.refetch()} disabled={summary.isFetching}>
            <RefreshCw className={summary.isFetching ? 'animate-spin' : undefined} aria-hidden />
            Refresh
          </Button>
        }
      />

      {summary.isPending ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true" aria-label="Loading metrics">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : summary.error ? (
        <Card role="alert" className="p-5 text-sm text-critical">
          Metrics are temporarily unavailable. {summary.error.message}
        </Card>
      ) : (
        <>
          <KpiGrid kpis={summary.data.kpis} currency={summary.data.currency} />
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              {summary.data.pipeline ? (
                <PipelineChart pipeline={summary.data.pipeline} currency={summary.data.currency} />
              ) : (
                <Card className="p-5 text-sm text-muted-foreground">No pipeline configured.</Card>
              )}
            </div>
            <ActivityStream items={summary.data.recentActivity} />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" aria-hidden /> Coming to your Command Center
          </CardTitle>
          <CardDescription>
            AI Opportunity Radar, Revenue Globe and next-best actions appear here as their modules ship.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {NEXT_UP.map((n) => (
            <Link key={n.title} href={n.href} className="group rounded-lg border border-border p-4 transition-colors hover:border-primary/50 hover:bg-muted/50">
              <Badge tone="primary">Phase {n.phase}</Badge>
              <p className="mt-2 font-medium">{n.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                View roadmap <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
