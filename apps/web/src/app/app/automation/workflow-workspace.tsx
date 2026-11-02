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
import { AI_DRAFT_KEY, type AiWorkflowDraft, EMAIL_TEMPLATES, emptyDefinition, entityOf, TEMPLATES } from './workflow-model';
import { inSentence, useT } from '@/lib/i18n';

type Tab = 'builder' | 'simulate' | 'runs' | 'versions';
const TABS: { key: Tab; label: string }[] = [
  { key: 'builder', label: 'Builder' },
  { key: 'simulate', label: 'Simulate' },
  { key: 'runs', label: 'Run history' },
  { key: 'versions', label: 'Versions' },
];

export function WorkflowWorkspace({ id }: { id: string | null }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const workflow = useWorkflow(id);
  const template = [...TEMPLATES, ...EMAIL_TEMPLATES].find((item) => item.key === params.get('template'));
  const [name, setName] = useState(template ? t.maybe(template.name) : '');
  const [description, setDescription] = useState(template ? t.maybe(template.description) : '');
  const [definition, setDefinition] = useState<WorkflowDefinition>(template?.definition ?? emptyDefinition());
  const [dirty, setDirty] = useState(!id);
  const [tab, setTab] = useState<Tab>(params.get('run') ? 'runs' : 'builder');
  const [aiDraft, setAiDraft] = useState<{ prompt: string; notes: string } | null>(null);

  // A draft from "Describe it with AI" arrives through sessionStorage, so it never touches the URL or the server until saved.
  useEffect(() => {
    if (id || params.get('draft') !== 'ai') return;
    try {
      const raw = sessionStorage.getItem(AI_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as AiWorkflowDraft;
      const parsed = workflowDefinitionSchema.safeParse(d.definition);
      if (!parsed.success) return;
      setName(d.name);
      setDescription(d.prompt);
      setDefinition(parsed.data);
      setAiDraft({ prompt: d.prompt, notes: d.notes });
      sessionStorage.removeItem(AI_DRAFT_KEY);
    } catch {
      // Storage unavailable or the draft is unreadable: start from an empty workflow.
    }
  }, [id, params]);

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
          {t('← All workflows')}
        </Link>
        {wf && (
          <>
            <Badge tone={wf.status === 'ACTIVE' ? 'success' : wf.status === 'PAUSED' ? 'warning' : 'neutral'}>{wf.status === 'ACTIVE' ? t('Active') : wf.status === 'PAUSED' ? t('Paused') : t('Draft')}</Badge>
            <span className="text-xs text-muted-foreground">
              {t('Version {n} · runs as {name}', { n: wf.version, name: wf.createdBy?.name ?? t('unknown') })}
            </span>
          </>
        )}
        <div className="ms-auto flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={!name.trim() || issues.length > 0 || save.isPending || (!dirty && !!id)}>
            <Save aria-hidden /> {id ? (dirty ? t('Save new version') : t('Saved')) : t('Create workflow')}
          </Button>
          {wf && wf.status !== 'ACTIVE' && (
            <Button onClick={() => setStatus.mutate('ACTIVE')} disabled={dirty || setStatus.isPending}>
              <Play aria-hidden /> {t('Activate')}
            </Button>
          )}
          {wf?.status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => setStatus.mutate('PAUSED')} disabled={setStatus.isPending}>
              <Pause aria-hidden /> {t('Pause')}
            </Button>
          )}
          {wf && (
            <Button
              variant="ghost"
              aria-label={t('Delete workflow')}
              onClick={() => {
                if (window.confirm(t('Delete “{name}”? Runs in progress are canceled.', { name: wf.name }))) remove.mutate();
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {aiDraft && (
        <div role="status" className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <p className="font-medium">{t('Drafted by AI from your description. Check every step before you save it.')}</p>
          {aiDraft.notes && <p className="mt-1 text-muted-foreground">{aiDraft.notes}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{t('It is saved as a draft and does nothing until you activate it. Emails and webhooks still wait for approval.')}</p>
        </div>
      )}
      {dirty && wf && <p className="text-xs text-muted-foreground">{t('Unsaved changes. Saving creates version {n}; runs already in progress finish on the version they started with.', { n: wf.version + 1 })}</p>}
      {error && (
        <div role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {error.message}
          {error instanceof ApiError && error.details?.length ? (
            <ul className="mt-1 list-disc ps-5">
              {error.details.map((d, i) => (
                <li key={i}>{t.maybe(d.message)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wf-name">{t('Name')}</Label>
            <Input id="wf-name" value={name} maxLength={120} onChange={(e) => (setName(e.target.value), setDirty(true))} placeholder={t('e.g. Follow up on high-value leads')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wf-desc">{t('Description')}</Label>
            <Textarea id="wf-desc" className="min-h-10" value={description} maxLength={500} onChange={(e) => (setDescription(e.target.value), setDirty(true))} />
          </div>
        </CardContent>
      </Card>

      <div role="tablist" aria-label={t('Workflow views')} className="flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls={`panel-${item.key}`}
            disabled={!id && (item.key === 'runs' || item.key === 'versions')}
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm disabled:opacity-50 ${tab === item.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {t.maybe(item.label)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'builder' && (
          <div className="space-y-3">
            {issues.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="font-medium">{t('Fix these before saving:')}</p>
                <ul className="list-disc ps-5">
                  {issues.map((i) => (
                    <li key={i}>{t.maybe(i)}</li>
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
const SEARCH_PLACEHOLDER = { leads: 'Search leads…', contacts: 'Search contacts…', companies: 'Search companies…', deals: 'Search deals…' } as const;
const ENTITY_LABEL: Record<string, string> = { lead: 'Lead', contact: 'Contact', company: 'Company', deal: 'Deal', activity: 'Activity', person: 'Person', task: 'Task' };
const NODE_LABEL: Record<string, string> = { action: 'Action', condition: 'If / else', delay: 'Wait', approval: 'Approval' };
const OPEN_RECORD: Record<string, string> = { lead: 'Open the lead', contact: 'Open the contact', company: 'Open the company', deal: 'Open the deal' };
const STEP_STATUS: Record<string, string> = { succeeded: 'Succeeded', failed: 'Failed', waiting: 'Waiting', awaiting_approval: 'Awaiting approval', simulated: 'Simulated' };

function SimulatePanel({ definition, valid }: { definition: WorkflowDefinition; valid: boolean }) {
  const t = useT();
  const entity = entityOf(definition.trigger.event);
  const pickerEntity = PICKER_ENTITY[entity as keyof typeof PICKER_ENTITY];
  const [record, setRecord] = useState<PickerValue | null>(null);
  const sim = useMutation({ mutationFn: () => api<SimulationResult>('/workflows/simulate', { method: 'POST', json: { definition, recordId: record!.id } }) });
  if (!pickerEntity) {
    return <p className="text-sm text-muted-foreground">{t('Simulation works with lead, contact, company and deal triggers. This trigger starts from a record of this kind: {entity}.', { entity: inSentence(t, t.maybe(ENTITY_LABEL[entity] ?? entity)) })}</p>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Dry run against a real record')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('Shows the path this version would take for “{trigger}”. Nothing is changed, sent or created; waits and approvals are skipped.', { trigger: t.maybe(TRIGGER_EVENTS[definition.trigger.event].label) })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1.5">
            <Label htmlFor="sim-record">{t('Record')}</Label>
            <RecordPicker id="sim-record" entity={pickerEntity} value={record} onChange={setRecord} placeholder={t.maybe(SEARCH_PLACEHOLDER[pickerEntity])} />
          </div>
          <Button onClick={() => sim.mutate()} disabled={!record || !valid || sim.isPending}>
            {t('Run simulation')}
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
              <p className="text-sm">{t('The trigger conditions do not match this record, so the workflow would not start.')}</p>
            ) : (
              <ol className="space-y-1.5">
                {sim.data.path.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{p.nodeId}</span>
                    <Badge tone={p.nodeType === 'condition' ? (p.outcome === 'true' ? 'success' : 'neutral') : 'primary'}>
                      {p.nodeType === 'condition' ? (p.outcome === 'true' ? t('Yes') : t('No')) : t.maybe(NODE_LABEL[p.nodeType] ?? p.nodeType)}
                    </Badge>
                    {p.detail && <span>{t.maybe(p.detail)}</span>}
                  </li>
                ))}
                <li className="text-xs text-muted-foreground">{sim.data.ended === 'failed' ? t('The run would fail here.') : t('The run would finish here.')}</li>
              </ol>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunsPanel({ workflowId, highlight }: { workflowId: string; highlight: string | null }) {
  const t = useT();
  const runs = useExecutions(workflowId);
  if (runs.isPending) return <Skeleton className="h-40" />;
  if (!runs.data?.length) return <p className="py-6 text-center text-sm text-muted-foreground">{t('No runs yet. Activate the workflow and it will run the next time its trigger happens.')}</p>;
  return (
    <ul className="space-y-2">
      {runs.data.map((r) => (
        <RunItem key={r.id} run={r} open={r.id === highlight} />
      ))}
    </ul>
  );
}

function RunItem({ run, open: initiallyOpen }: { run: ExecutionRow; open: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(initiallyOpen);
  const href = run.entityId && run.entityType && ['lead', 'contact', 'company', 'deal'].includes(run.entityType) ? `/app/${run.entityType === 'company' ? 'companies' : `${run.entityType}s`}/${run.entityId}` : null;
  return (
    <li className="rounded-md border border-border">
      <button type="button" className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-start text-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="rtl:-scale-x-100 size-4" aria-hidden />}
        <Badge tone={EXECUTION_TONE[run.status]}>{t.maybe(EXECUTION_LABEL[run.status])}</Badge>
        <span>{t.maybe(TRIGGER_EVENTS[run.eventType as keyof typeof TRIGGER_EVENTS]?.label ?? run.eventType)}</span>
        <span className="text-xs text-muted-foreground">v{run.version} · {relativeTime(run.startedAt)}</span>
        {run.status === 'WAITING' && run.resumeAt && <span className="text-xs text-muted-foreground">· {t('resumes {date}', { date: formatDate(run.resumeAt) })}</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          {href && (
            <Link href={href} className="text-xs text-primary hover:underline">
              {t.maybe(OPEN_RECORD[run.entityType ?? ''] ?? 'Open record')}
            </Link>
          )}
          {run.error && <p className="text-sm text-critical">{run.error}</p>}
          <ol className="space-y-1">
            {run.steps.map((s, i) => (
              <li key={i} className="flex flex-wrap gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{s.nodeId}</span>
                <span className={s.status === 'failed' ? 'text-critical' : ''}>{t.maybe(STEP_STATUS[s.status] ?? s.status.replace('_', ' '))}</span>
                {s.error && <span className="text-critical">{s.error}</span>}
                {!s.error && Object.keys(s.output).length > 0 && <span className="truncate text-muted-foreground">{JSON.stringify(s.output)}</span>}
              </li>
            ))}
          </ol>
          {run.status === 'AWAITING_APPROVAL' && (
            <Link href="/app/approvals" className="text-xs text-primary hover:underline">
              {t('Review in Approvals')}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function VersionsPanel({ workflowId }: { workflowId: string }) {
  const t = useT();
  const versions = useVersions(workflowId);
  if (versions.isPending) return <Skeleton className="h-24" />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {versions.data?.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="font-medium">{t('Version {n}', { n: v.version })}</span>
          <span className="text-muted-foreground">
            {t('{date} by {name}', { date: formatDate(v.createdAt), name: v.createdBy?.name ?? t('unknown') })} · {t.plural('count.steps', v.definition.nodes.length)}
          </span>
        </li>
      ))}
    </ul>
  );
}
