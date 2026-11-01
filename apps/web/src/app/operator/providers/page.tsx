'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { OperatorProviderRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';

const STATE: Record<OperatorProviderRow['state'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'critical' }> = {
  not_configured: { label: 'Not configured', tone: 'neutral' },
  configured: { label: 'Key set, not verified', tone: 'warning' },
  verified: { label: 'Live check passed', tone: 'success' },
  failed: { label: 'Live check failed', tone: 'critical' },
};

function ProviderCard({ p, admin }: { p: OperatorProviderRow; admin: boolean }) {
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: () => api<OperatorProviderRow>(`/operator/providers/${p.key}/check`, { method: 'POST', json: {} }),
    onSuccess: (row) => qc.setQueryData<OperatorProviderRow[]>(['operator', 'providers'], (rows) => rows?.map((r) => (r.key === row.key ? row : r))),
  });
  const s = !p.checkable && p.state === 'configured' ? { label: 'Keys set', tone: 'neutral' as const } : STATE[p.state];
  const headingId = `provider-${p.key}`;
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={headingId}>{p.name}</CardTitle>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <CardDescription>{p.usedFor}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-1" aria-label={`${p.name} deployment secrets`}>
          {p.env.map((v) => (
            <li key={v.name} className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{v.name}</code>
              <span className={v.set ? 'text-success' : v.required ? 'text-critical' : 'text-muted-foreground'}>{v.set ? 'Set' : v.required ? 'Missing' : 'Not set (optional)'}</span>
            </li>
          ))}
        </ul>
        <p>
          <span className="text-muted-foreground">In workspaces: </span>
          {p.appStatus}
        </p>
        {p.lastCheck && (
          <p className="rounded-md border border-border bg-muted/30 p-2">
            {p.lastCheck.ok ? 'Passed' : 'Failed'} on {new Date(p.lastCheck.at).toLocaleString()}
            {p.lastCheck.by && ` by ${p.lastCheck.by}`}: {p.lastCheck.message}
            {p.lastCheck.stale && <span className="block text-muted-foreground">Made with a different key from the one set now, so it no longer counts. Run the check again.</span>}
          </p>
        )}
        {p.checkable ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">{p.checkNote}</p>
            {admin ? (
              <Button type="button" variant="outline" size="sm" disabled={!p.configured || check.isPending} onClick={() => check.mutate()}>
                {check.isPending ? 'Checking…' : 'Run live check'}
              </Button>
            ) : (
              <p className="text-muted-foreground">Only operators with the Admin role can run checks.</p>
            )}
            {!p.configured && <p className="text-muted-foreground">Add the key to the deployment secrets and restart the API to enable the check.</p>}
            <ErrorText error={check.error} />
          </div>
        ) : (
          <p className="text-muted-foreground">No automatic check: this is confirmed when someone first connects or uses it.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function OperatorProvidersPage() {
  const me = useOperator();
  const providers = useQuery({ enabled: !!me.data, queryKey: ['operator', 'providers'], queryFn: () => api<OperatorProviderRow[]>('/operator/providers') });
  if (!me.data || providers.isPending) return <Skeleton className="h-64" />;
  if (providers.error) return <ErrorText error={providers.error} />;
  const missing = providers.data.filter((p) => !p.configured).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        description="Which provider keys this deployment has, and whether they work. Keys live only in the deployment's secrets; this page shows whether each is set, never its value. Checks are recorded in the operator log."
      />
      <p className="text-sm" role="status">
        {missing === 0 ? 'Every provider has its keys set.' : `${missing} of ${providers.data.length} providers are missing keys.`}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {providers.data.map((p) => (
          <ProviderCard key={p.key} p={p} admin={me.data!.role === 'ADMIN'} />
        ))}
      </div>
    </div>
  );
}
