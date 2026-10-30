'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import {
  type ExecutionRow,
  type SimulationResult,
  TRIGGER_EVENTS,
  type WorkflowDefinition,
  workflowDefinitionSchema,
  type WorkflowRow,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pause, Play, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { type PickerValue, RecordPicker } from '@/components/crm/record-picker';
import { Textarea } from '@/components/crm/select';
import { api, ApiError } from '@/lib/api';
import { EXECUTION_LABEL, EXECUTION_TONE, useExecutions, useVersions, useWorkflow } from '@/lib/automation';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { WorkflowEditor } from './workflow-editor';
import { emptyDefinition, entityOf, TEMPLATES } from './workflow-model';

type Tab = 'builder' | 'simulate' | 'runs' | 'versions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'builder', label: 'Builder' },
  { key: 'simulate', label: 'Simulate' },
  { key: 'runs', label: 'Run history' },
  { key: 'versions', label: 'Versions' },
];

export function WorkflowWorkspace({ id }: { id: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const workflow = useWorkflow(id);
  const template = TEMPLATES.find((t) => t.key === params.get('template'));
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [definition, setDefinition] = useState<WorkflowDefinition>(template?.definition ?? emptyDefinition());
  const [dirty, setDirty] = useState(!id);
  const [tab, setTab] = useState<Tab>(params.get('run') ? 'runs' : 'builder');

  useEffect(() => {
    if (workflow.data && !dirty) {
      setName(workflow.data.name);
      setDescription(workflow.data.description ?? '');
      setDefinition(workflow.data.definition);
    }
  }, [workflow.data, dirty]);

  const issues = useMemo(() => {
    const r = workflowDefinitionSchema.safeParse(definition);
    return r.success ? [] : [...new Set(r.error.issues.map((i) => i.message))];
  }, [definition]);

  const invalidate = () => Promise.all([qc.invalidateQueries({ queryKey: ['workflows'] }), qc.invalidateQueries({ queryKey: ['executions'] })]);
  const save = useMutation({
    mutationFn: () =>
      id
        ? api<WorkflowRow>(`/workflows/${id}`, { method: 'PUT', json: { name, description: description || undefined, definition } })
        : api<WorkflowRow>('/workflows', { method: 'POST', json: { name, description: description || undefined, definition } }),
    onSuccess: async (row) => {
      setDirty(false);
      await invalidate();
      if (!id) router.replace(`/app/automation/${row.id}`);
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'PAUSED') => api<WorkflowRow>(`/workflows/${id}/status`, { method: 'PATCH', json: { status } }),
    onSuccess: () => invalidate(),
  });
  const remove = useMutation({
    mutationFn: () => api(`/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await invalidate();
      router.replace('/app/automation');
    },
  });

  if (id && workflow.isPending) return <Skeleton className="h-96" />;
  if (id && workflow.error) return <p role="alert" className="text-sm text-critical">{workflow.error.message}</p>;

  const wf = workflow.data;
  const change = (d: WorkflowDefinition) => {
    setDefinition(d);
    setDirty(true);
  };
  const error = save.error ?? setStatus.error ?? remove.error;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/app/automation" className="text-sm text-primary hover:underline">
          ← All workflows
        </Link>
        {wf && (
          <>
            <Badge tone={wf.status === 'ACTIVE' ? 'success' : wf.status === 'PAUSED' ? 'warning' : 'neutral'}>{wf.status === 'ACTIVE' ? 'Active' : wf.status === 'PAUSED' ? 'Paused' : 'Draft'}</Badge>
            <span className="text-xs text-muted-foreground">
              Version {wf.version} · runs as {wf.createdBy?.name ?? 'unknown'}
            </span>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={!name.trim() || issues.length > 0 || save.isPending || (!dirty && !!id)}>
            <Save aria-hidden /> {id ? (dirty ? 'Save new version' : 'Saved') : 'Create workflow'}
          </Button>
          {wf && wf.status !== 'ACTIVE' && (
            <Button onClick={() => setStatus.mutate('ACTIVE')} disabled={dirty || setStatus.isPending}>
              <Play aria-hidden /> Activate
            </Button>
          )}
          {wf?.status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => setStatus.mutate('PAUSED')} disabled={setStatus.isPending}>
              <Pause aria-hidden /> Pause
            </Button>
          )}
          {wf && (
            <Button
              variant="ghost"
              aria-label="Delete workflow"
              onClick={() => {
                if (window.confirm(`Delete "${wf.name}"? Runs in progress are canceled.`)) remove.mutate();
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {dirty && wf && <p className="text-xs text-muted-foreground">Unsaved changes. Saving creates version {wf.version + 1}; runs already in progress finish on the version they started with.</p>}
      {error && (
        <div role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {error.message}
          {error instanceof ApiError && error.details?.length ? (
            <ul className="mt-1 list-disc pl-5">
              {error.details.map((d, i) => (
                <li key={i}>{d.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={name} maxLength={120} onChange={(e) => (setName(e.target.value), setDirty(true))} placeholder="e.g. Follow up on high-value leads" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-desc">Description</Label>
            <Textarea id="wf-desc" className="min-h-10" value={description} maxLength={500} onChange={(e) => (setDescription(e.target.value), setDirty(true))} />
          </div>
        </CardContent>
      </Card>

      <div role="tablist" aria-label="Workflow views" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            disabled={!id && (t.key === 'runs' || t.key === 'versions')}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm disabled:opacity-50 ${tab === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'builder' && (
          <div className="space-y-3">
            {issues.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">Fix these before saving:</p>
                <ul className="list-disc pl-5">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            )}
            <WorkflowEditor definition={definition} onChange={change} />
          </div>
        )}
        {tab === 'simulate' && <SimulatePanel definition={definition} valid={issues.length === 0} />}
        {tab === 'runs' && id && <RunsPanel workflowId={id} highlight={params.get('run')} />}
        {tab === 'versions' && id && <VersionsPanel workflowId={id} />}
      </div>
    </div>
  );
}

const PICKER_ENTITY = { lead: 'leads', contact: 'contacts', company: 'companies', deal: 'deals' } as const;

function SimulatePanel({ definition, valid }: { definition: WorkflowDefinition; valid: boolean }) {
  const entity = entityOf(definition.trigger.event);
  const pickerEntity = PICKER_ENTITY[entity as keyof typeof PICKER_ENTITY];
  const [record, setRecord] = useState<PickerValue | null>(null);
  const sim = useMutation({ mutationFn: () => api<SimulationResult>('/workflows/simulate', { method: 'POST', json: { definition, recordId: record!.id } }) });
  if (!pickerEntity) {
    return <p className="text-sm text-muted-foreground">Simulation works with lead, contact, company and deal triggers. This trigger starts from a {entity}.</p>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dry run against a real record</CardTitle>
        <p className="text-sm text-muted-foreground">Shows the path this version would take for “{TRIGGER_EVENTS[definition.trigger.event].label}”. Nothing is changed, sent or created; waits and approvals are skipped.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="sim-record">Record</Label>
            <RecordPicker id="sim-record" entity={pickerEntity} value={record} onChange={setRecord} placeholder={`Search ${pickerEntity}…`} />
          </div>
          <Button onClick={() => sim.mutate()} disabled={!record || !valid || sim.isPending}>
            Run simulation
          </Button>
        </div>
        {sim.error && (
          <p role="alert" className="text-sm text-critical">
            {sim.error.message}
          </p>
        )}
        {sim.data && (
          <div aria-live="polite" className="space-y-2">
            {!sim.data.triggerMatched ? (
              <p className="text-sm">The trigger conditions do not match this record, so the workflow would not start.</p>
            ) : (
              <ol className="space-y-1.5">
                {sim.data.path.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{p.nodeId}</span>
                    <Badge tone={p.nodeType === 'condition' ? (p.outcome === 'true' ? 'success' : 'neutral') : 'primary'}>
                      {p.nodeType === 'condition' ? (p.outcome === 'true' ? 'Yes' : 'No') : p.nodeType}
                    </Badge>
                    {p.detail && <span>{p.detail}</span>}
                  </li>
                ))}
                <li className="text-xs text-muted-foreground">{sim.data.ended === 'failed' ? 'The run would fail here.' : 'The run would finish here.'}</li>
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunsPanel({ workflowId, highlight }: { workflowId: string; highlight: string | null }) {
  const runs = useExecutions(workflowId);
  if (runs.isPending) return <Skeleton className="h-40" />;
  if (!runs.data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">No runs yet. Activate the workflow and it will run the next time its trigger happens.</p>;
  return (
    <ul className="space-y-2">
      {runs.data.map((r) => (
        <RunItem key={r.id} run={r} open={r.id === highlight} />
      ))}
    </ul>
  );
}

function RunItem({ run, open: initiallyOpen }: { run: ExecutionRow; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const href = run.entityId && run.entityType && ['lead', 'contact', 'company', 'deal'].includes(run.entityType) ? `/app/${run.entityType === 'company' ? 'companies' : `${run.entityType}s`}/${run.entityId}` : null;
  return (
    <li className="rounded-md border border-border">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
        <Badge tone={EXECUTION_TONE[run.status]}>{EXECUTION_LABEL[run.status]}</Badge>
        <span>{TRIGGER_EVENTS[run.eventType as keyof typeof TRIGGER_EVENTS]?.label ?? run.eventType}</span>
        <span className="text-xs text-muted-foreground">v{run.version} · {relativeTime(run.startedAt)}</span>
        {run.status === 'WAITING' && run.resumeAt && <span className="text-xs text-muted-foreground">· resumes {formatDate(run.resumeAt)}</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {href && (
            <Link href={href} className="text-xs text-primary hover:underline">
              Open the {run.entityType}
            </Link>
          )}
          {run.error && <p className="text-sm text-critical">{run.error}</p>}
          <ol className="space-y-1">
            {run.steps.map((s, i) => (
              <li key={i} className="flex flex-wrap gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{s.nodeId}</span>
                <span className={s.status === 'failed' ? 'text-critical' : ''}>{s.status.replace('_', ' ')}</span>
                {s.error && <span className="text-critical">{s.error}</span>}
                {!s.error && Object.keys(s.output).length > 0 && <span className="truncate text-muted-foreground">{JSON.stringify(s.output)}</span>}
              </li>
            ))}
          </ol>
          {run.status === 'AWAITING_APPROVAL' && (
            <Link href="/app/approvals" className="text-xs text-primary hover:underline">
              Review in Approvals
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function VersionsPanel({ workflowId }: { workflowId: string }) {
  const versions = useVersions(workflowId);
  if (versions.isPending) return <Skeleton className="h-24" />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {versions.data?.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium">Version {v.version}</span>
          <span className="text-muted-foreground">
            {formatDate(v.createdAt)} by {v.createdBy?.name ?? 'unknown'} · {v.definition.nodes.length} steps
          </span>
        </li>
      ))}
    </ul>
  );
}
