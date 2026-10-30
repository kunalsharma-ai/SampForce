'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { TRIGGER_EVENTS } from '@dealflow/types';
import { Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useApprovals, useWorkflows } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { TEMPLATES } from './workflow-model';

export function WorkflowList() {
  const workflows = useWorkflows();
  const pending = useApprovals('PENDING');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href="/app/automation/new">
            <Plus aria-hidden /> New workflow
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/approvals">
            <ShieldCheck aria-hidden /> Approvals
            {!!pending.data?.length && <Badge tone="warning">{pending.data.length} waiting</Badge>}
          </Link>
        </Button>
      </div>

      {workflows.isPending ? (
        <Skeleton className="h-40" />
      ) : workflows.error ? (
        <p role="alert" className="text-sm text-critical">
          {workflows.error.message}
        </p>
      ) : workflows.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workflows yet. Start from scratch or from one of the templates below.</p>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {workflows.data.map((w) => (
              <li key={w.id}>
                <Link href={`/app/automation/${w.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted/50">
                  <span className="font-medium">{w.name}</span>
                  <Badge tone={w.status === 'ACTIVE' ? 'success' : w.status === 'PAUSED' ? 'warning' : 'neutral'}>{w.status === 'ACTIVE' ? 'Active' : w.status === 'PAUSED' ? 'Paused' : 'Draft'}</Badge>
                  <span className="text-sm text-muted-foreground">{TRIGGER_EVENTS[w.triggerType]?.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {w.runs30d} runs in 30 days{w.failures30d > 0 && <span className="text-critical"> · {w.failures30d} failed</span>} · v{w.version} · edited {relativeTime(w.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby="templates-heading" className="space-y-3">
        <h2 id="templates-heading" className="text-sm font-semibold">
          Start from a template
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {TEMPLATES.map((t) => (
            <Card key={t.key} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-sm">{t.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <p className="flex-1 text-sm text-muted-foreground">{t.description}</p>
                <Button asChild variant="outline" size="sm" className="self-start">
                  <Link href={`/app/automation/new?template=${t.key}`} aria-label={`Use template: ${t.name}`}>
                    Use template
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
