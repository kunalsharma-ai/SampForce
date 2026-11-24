'use client';

import { Badge, Button, Card, Input, Skeleton } from '@dealflow/ui';
import type { PlanWorkspaceRulesRow, WorkspaceRules } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { can, useOperator } from '../operator-shell';
import { RulesEditor } from './rules-editor';

type RulesList = { defaults: WorkspaceRules; plans: PlanWorkspaceRulesRow[] };

/**
 * Console rules per plan (workspace redesign W3): whether each level may delete, which modules it may use and whether
 * it must use two-step sign-in. Support staff can read them; only admins change them. A client's own exceptions are
 * on its profile.
 */
export default function WorkspaceRulesPage() {
  const me = useOperator();
  const q = useQuery({ enabled: !!me.data, queryKey: ['operator', 'workspace-rules'], queryFn: () => api<RulesList>('/operator/workspace-rules') });
  if (!me.data || q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorText error={q.error} />;
  const admin = can(me.data, 'workspaces.manage');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Workspace rules"
        description="Limits for the Manager and Executive Workspaces of every client on a plan. A client's Super Workspace chooses within them and can never go beyond. A change applies on each client's next request. Rules never create or remove a Super Workspace."
      />
      {q.data.plans.map((p) => (
        <PlanRules key={p.planCode} row={p} admin={admin} />
      ))}
    </div>
  );
}

function PlanRules({ row, admin }: { row: PlanWorkspaceRulesRow; admin: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(row.rules);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState('');
  const save = useMutation({
    mutationFn: () => api<RulesList>(`/operator/workspace-rules/plans/${row.planCode}`, { method: 'PUT', json: { rules: draft, reason } }),
    onSuccess: (r) => {
      qc.setQueryData(['operator', 'workspace-rules'], r);
      setReason('');
      setSaved(`Saved. It applies to every client on ${row.planName}.`);
    },
  });
  const headingId = `rules-${row.planCode}`;
  return (
    <Card className="space-y-4 p-5" aria-labelledby={headingId} data-plan-rules={row.planCode}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-medium">
          {row.planName}
        </h2>
        <Badge tone={row.customised ? 'warning' : 'neutral'}>{row.customised ? 'Limits set' : 'No limits'}</Badge>
      </div>
      <RulesEditor value={draft} onChange={(r) => (setSaved(''), setDraft(r))} disabled={!admin || save.isPending} name={row.planCode} />
      {admin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <label htmlFor={`${headingId}-reason`} className="text-sm font-medium">
              Reason for {row.planName}
            </label>
            <Input id={`${headingId}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the rules change" />
          </div>
          <Button disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate()} aria-label={`Save rules for ${row.planName}`}>
            Save
          </Button>
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {saved}
      </p>
      <ErrorText error={save.error} />
    </Card>
  );
}
