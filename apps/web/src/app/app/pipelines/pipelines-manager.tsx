'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type PipelineInput, pipelineInputSchema, type PipelineRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { usePipelines } from '@/lib/crm';
import { useCan } from '@/lib/session';

type DraftStage = PipelineInput['stages'][number];

const NEW_PIPELINE: PipelineInput = {
  name: '',
  stages: [
    { name: 'Discovery', probability: 10, category: 'OPEN' },
    { name: 'Proposal', probability: 50, category: 'OPEN' },
    { name: 'Won', probability: 100, category: 'WON' },
    { name: 'Lost', probability: 0, category: 'LOST' },
  ],
};

export function PipelinesManager() {
  const pipelines = usePipelines();
  const canManage = useCan('pipelines:manage');
  const [creating, setCreating] = useState(false);

  if (pipelines.isPending) return <Skeleton className="h-64" />;
  if (pipelines.error) return <p role="alert" className="text-sm text-critical">{pipelines.error.message}</p>;
  return (
    <div className="space-y-4">
      {pipelines.data.map((p) => (
        <PipelineEditor key={p.id} pipeline={p} canManage={canManage} />
      ))}
      {canManage &&
        (creating ? (
          <PipelineEditor onDone={() => setCreating(false)} canManage />
        ) : (
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New pipeline
          </Button>
        ))}
    </div>
  );
}

function PipelineEditor({ pipeline, canManage, onDone }: { pipeline?: PipelineRow; canManage: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PipelineInput>(
    pipeline ? { name: pipeline.name, stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, category: s.category })) } : NEW_PIPELINE,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = !pipeline || JSON.stringify(draft) !== JSON.stringify({ name: pipeline.name, stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, category: s.category })) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['pipelines'] }).then(() => qc.invalidateQueries({ queryKey: ['board'] }));

  const save = useMutation({
    mutationFn: (body: PipelineInput) => (pipeline ? api<PipelineRow>(`/pipelines/${pipeline.id}`, { method: 'PUT', json: body }) : api<PipelineRow>('/pipelines', { method: 'POST', json: body })),
    onSuccess: async () => {
      await invalidate();
      setSaved(true);
      onDone?.();
    },
    onError: (e) => setError(e.message),
  });
  const makeDefault = useMutation({ mutationFn: () => api(`/pipelines/${pipeline!.id}/default`, { method: 'POST' }), onSuccess: invalidate, onError: (e) => setError(e.message) });
  const remove = useMutation({ mutationFn: () => api(`/pipelines/${pipeline!.id}`, { method: 'DELETE' }), onSuccess: invalidate, onError: (e) => setError(e.message) });

  const setStage = (i: number, patch: Partial<DraftStage>) => {
    setSaved(false);
    setDraft((d) => ({ ...d, stages: d.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  };
  const moveStage = (i: number, delta: number) =>
    setDraft((d) => {
      const stages = [...d.stages];
      const [s] = stages.splice(i, 1);
      stages.splice(i + delta, 0, s!);
      return { ...d, stages };
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = pipelineInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the stages.');
      return;
    }
    save.mutate(parsed.data);
  }

  const idBase = pipeline?.id ?? 'new';
  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
          <CardTitle className="sr-only">{pipeline?.name ?? 'New pipeline'}</CardTitle>
          <label htmlFor={`${idBase}-name`} className="sr-only">
            Pipeline name
          </label>
          <Input id={`${idBase}-name`} className="h-9 max-w-xs font-semibold" placeholder="Pipeline name" value={draft.name} disabled={!canManage} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          {pipeline?.isDefault && <Badge tone="primary">Default</Badge>}
          {pipeline && <span className="text-xs text-muted-foreground">{pipeline.dealCount} deals</span>}
          {canManage && pipeline && !pipeline.isDefault && (
            <div className="ms-auto flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => makeDefault.mutate()}>
                <Star aria-hidden /> Make default
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${pipeline.name}`} onClick={() => remove.mutate()} disabled={pipeline.dealCount > 0} title={pipeline.dealCount > 0 ? 'Move or delete its deals first' : undefined}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <table className="w-full text-sm">
            <caption className="sr-only">Stages</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium">Stage</th>
                <th scope="col" className="w-28 pb-2 font-medium">Probability</th>
                <th scope="col" className="w-32 pb-2 font-medium">Type</th>
                <th scope="col" className="w-28 pb-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.stages.map((s, i) => (
                <tr key={s.id ?? `new-${i}`}>
                  <td className="py-1 pe-2">
                    <Input aria-label={`Stage ${i + 1} name`} className="h-9" value={s.name} disabled={!canManage} onChange={(e) => setStage(i, { name: e.target.value })} />
                  </td>
                  <td className="py-1 pe-2">
                    <Input aria-label={`Stage ${i + 1} probability`} className="h-9" type="number" min={0} max={100} value={s.probability} disabled={!canManage} onChange={(e) => setStage(i, { probability: Number(e.target.value) })} />
                  </td>
                  <td className="py-1 pe-2">
                    <Select aria-label={`Stage ${i + 1} type`} className="h-9" value={s.category} disabled={!canManage} onChange={(e) => setStage(i, { category: e.target.value as DraftStage['category'] })}>
                      <option value="OPEN">Open</option>
                      <option value="WON">Won</option>
                      <option value="LOST">Lost</option>
                    </Select>
                  </td>
                  <td className="py-1">
                    {canManage && (
                      <div className="flex">
                        <Button type="button" variant="ghost" size="icon" aria-label={`Move ${s.name || 'stage'} up`} disabled={i === 0} onClick={() => moveStage(i, -1)}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Move ${s.name || 'stage'} down`} disabled={i === draft.stages.length - 1} onClick={() => moveStage(i, 1)}>
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${s.name || 'stage'}`} onClick={() => setDraft({ ...draft, stages: draft.stages.filter((_, j) => j !== i) })}>
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, stages: [...draft.stages, { name: '', probability: 50, category: 'OPEN' }] })}>
                <Plus aria-hidden /> Add stage
              </Button>
              <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
                {saved && !dirty ? 'Saved' : ''}
              </span>
              {onDone && (
                <Button type="button" variant="ghost" size="sm" onClick={onDone}>
                  Cancel
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
                {save.isPending ? 'Saving…' : pipeline ? 'Save stages' : 'Create pipeline'}
              </Button>
            </div>
          )}
        </CardContent>
      </form>
    </Card>
  );
}
