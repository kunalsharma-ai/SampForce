'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { REPORT_CATALOG, REPORT_TEMPLATES } from '@dealflow/types';
import { BarChart3, LineChart, PieChart, Plus, Sigma, Table2 } from 'lucide-react';
import Link from 'next/link';
import { ErrorText } from '@/components/revenue/tabs';
import { formatDate } from '@/lib/crm';
import { useReports } from '@/lib/reports';
import { useCan } from '@/lib/session';

export const CHART_ICON = { table: Table2, bar: BarChart3, line: LineChart, pie: PieChart, number: Sigma } as const;

export function ReportsIndex() {
  const reports = useReports();
  const canWrite = useCan('reports:write');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Saved reports</h2>
        {canWrite && (
          <Button asChild>
            <Link href="/app/reports/new">
              <Plus aria-hidden /> New report
            </Link>
          </Button>
        )}
      </div>
      {reports.isPending ? (
        <Skeleton className="h-40" />
      ) : reports.error ? (
        <ErrorText error={reports.error} />
      ) : reports.data.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No reports yet.{canWrite ? ' Start from a template below or build one from scratch.' : ' Reports that teammates share with the workspace will appear here.'}
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.data.map((r) => {
            const Icon = CHART_ICON[r.definition.chart];
            return (
              <li key={r.id}>
                <Link href={`/app/reports/${r.id}`} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardHeader className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{r.name}</CardTitle>
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </div>
                      <CardDescription>
                        {REPORT_CATALOG[r.definition.entity].label} · {r.createdBy?.name ?? 'Former member'} · updated {formatDate(r.updatedAt)}
                      </CardDescription>
                      <div>
                        <Badge tone={r.visibility === 'WORKSPACE' ? 'primary' : 'neutral'}>{r.visibility === 'WORKSPACE' ? 'Shared' : 'Private'}</Badge>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (
        <section aria-labelledby="templates-h" className="space-y-3">
          <h2 id="templates-h" className="text-lg font-semibold">Start from a template</h2>
          <ul className="flex flex-wrap gap-2">
            {REPORT_TEMPLATES.map((t, i) => (
              <li key={t.name}>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/reports/new?template=${i}`}>{t.name}</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
