'use client';

import { Button, Card, Skeleton } from '@dealflow/ui';
import type { DashboardSummary } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { ActivityStream } from '@/components/command-center/activity-stream';
import { KpiGrid } from '@/components/command-center/kpi-grid';
import { OnboardingChecklist } from '@/components/command-center/onboarding';
import { PipelineChart } from '@/components/command-center/pipeline-chart';
import { PageHeader } from '@/components/page-header';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';


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

      <OnboardingChecklist />

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

    </div>
  );
}
