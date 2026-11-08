'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { FEATURE_GROUPS, type FeatureKey, FEATURES, type OperatorPlanRow, type PlanCode } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { useOperator } from '../operator-shell';

type Limits = OperatorPlanRow['limits'];
const LIMITS: { key: keyof Limits; label: string; unlimited: boolean }[] = [
  { key: 'maxUsers', label: 'Most users', unlimited: true },
  { key: 'maxPipelines', label: 'Most pipelines', unlimited: true },
  { key: 'monthlyAiCredits', label: 'AI credits per user per month', unlimited: false },
  { key: 'automationRunsPerMonth', label: 'Automation runs per month', unlimited: false },
];

/** The platform admin decides which features and limits each plan includes (ADR 0057). Support staff can read it. */
export default function OperatorPlansPage() {
  const me = useOperator();
  const plans = useQuery({ enabled: !!me.data, queryKey: ['operator', 'plans'], queryFn: () => api<OperatorPlanRow[]>('/operator/plans') });
  const [editing, setEditing] = useState<PlanCode | null>(null);
  if (!me.data || plans.isPending) return <Skeleton className="h-96" />;
  if (plans.error) return <ErrorText error={plans.error} />;
  const admin = me.data.role === 'ADMIN';
  const rows = plans.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans"
        description="What each plan includes. A change applies to every workspace on that plan on its next request, and shows on the public pricing page. Nothing a workspace created is deleted when a feature is removed; it becomes read-only until the feature is back."
      />
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <table className="w-full min-w-[720px] text-sm" data-operator-plans="">
            <thead>
              <tr className="border-b border-border text-start">
                <th scope="col" className="py-2 pe-3 text-start font-medium">
                  Feature
                </th>
                {rows.map((p) => (
                  <th key={p.code} scope="col" className="px-2 py-2 text-center font-medium">
                    <div>{p.name.replace('SampForce ', '')}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {p.workspaces} workspace{p.workspaces === 1 ? '' : 's'}
                    </div>
                    {admin && (
                      <Button size="sm" variant="outline" className="mt-1" onClick={() => setEditing(p.code)} aria-label={`Edit ${p.name}`}>
                        Edit
                      </Button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            {FEATURE_GROUPS.map((group) => (
              <tbody key={group}>
                <tr>
                  <th colSpan={rows.length + 1} scope="colgroup" className="pt-4 pb-1 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </th>
                </tr>
                {FEATURES.filter((f) => f.group === group).map((f) => (
                  <tr key={f.key} className="border-t border-border/50">
                    <th scope="row" className="py-1.5 pe-3 text-start font-normal" title={f.description}>
                      {f.label}
                    </th>
                    {rows.map((p) => (
                      <td key={p.code} className="px-2 py-1.5 text-center" data-plan={p.code} data-feature={f.key}>
                        {p.features.includes(f.key) ? '✓' : <span className="text-muted-foreground">·</span>}
                        {p.changedFromDefault.includes(f.key) && (
                          <span className="ms-1 text-[10px] text-warning" title="Changed from the shipped default">
                            *
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
            <tbody>
              <tr>
                <th colSpan={rows.length + 1} scope="colgroup" className="pt-4 pb-1 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Limits
                </th>
              </tr>
              {LIMITS.map((l) => (
                <tr key={l.key} className="border-t border-border/50">
                  <th scope="row" className="py-1.5 pe-3 text-start font-normal">
                    {l.label}
                  </th>
                  {rows.map((p) => (
                    <td key={p.code} className="px-2 py-1.5 text-center tabular">
                      {p.limits[l.key] === null ? 'Unlimited' : p.limits[l.key]!.toLocaleString()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">* differs from what the plan included when SampForce shipped.</p>
        </CardContent>
      </Card>
      {admin && editing && <PlanEditor key={editing} plan={rows.find((p) => p.code === editing)!} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PlanEditor({ plan, onClose }: { plan: OperatorPlanRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(plan.features));
  const [limits, setLimits] = useState<Record<keyof Limits, string>>(() => Object.fromEntries(LIMITS.map((l) => [l.key, plan.limits[l.key] === null ? '' : String(plan.limits[l.key])])) as Record<keyof Limits, string>);
  const [reason, setReason] = useState('');
  useEffect(() => document.getElementById('plan-editor')?.scrollIntoView({ block: 'start' }), []);
  const save = useMutation({
    mutationFn: () =>
      api<OperatorPlanRow[]>(`/operator/plans/${plan.code}`, {
        method: 'PUT',
        json: {
          features: [...features],
          limits: Object.fromEntries(LIMITS.map((l) => [l.key, limits[l.key].trim() === '' && l.unlimited ? null : Number(limits[l.key])])),
          reason,
        },
      }),
    onSuccess: (rows) => {
      qc.setQueryData(['operator', 'plans'], rows);
      void qc.invalidateQueries({ queryKey: ['public-pricing'] });
      onClose();
    },
  });
  const toggle = (k: FeatureKey) =>
    setFeatures((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Card id="plan-editor">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Edit {plan.name} <Badge>{plan.workspaces} workspaces</Badge>
        </CardTitle>
        <CardDescription>Last changed {formatDate(plan.updatedAt)}. Workspaces with their own feature overrides keep them.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURE_GROUPS.map((group) => (
              <fieldset key={group} className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</legend>
                {FEATURES.filter((f) => f.group === group).map((f) => (
                  <label key={f.key} className="flex items-start gap-2 text-sm" title={f.description}>
                    <input type="checkbox" className="mt-0.5" checked={features.has(f.key)} onChange={() => toggle(f.key)} name={f.key} />
                    {f.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {LIMITS.map((l) => (
              <Field key={l.key} id={`lim-${l.key}`} label={l.unlimited ? `${l.label} (empty = unlimited)` : l.label}>
                <Input
                  id={`lim-${l.key}`}
                  type="number"
                  min={l.unlimited ? 1 : 0}
                  required={!l.unlimited}
                  value={limits[l.key]}
                  onChange={(e) => setLimits((s) => ({ ...s, [l.key]: e.target.value }))}
                  className="w-36"
                />
              </Field>
            ))}
          </div>
          <Field id="plan-reason" label="Reason (recorded in the operator log)">
            <Input id="plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending || reason.trim().length < 5}>
              Save plan
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <ErrorText error={save.error} />
        </form>
      </CardContent>
    </Card>
  );
}
