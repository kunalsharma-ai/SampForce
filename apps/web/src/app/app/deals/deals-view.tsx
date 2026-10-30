'use client';

import { KanbanSquare, List } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DealsBoard } from '@/components/crm/deals-board';
import { RecordList } from '@/components/crm/record-list';
import { Select } from '@/components/crm/select';
import { usePipelines } from '@/lib/crm';

type View = 'board' | 'list';

export function DealsView() {
  const [view, setView] = useState<View>('board');
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = useState<string | undefined>();

  useEffect(() => {
    try {
      const saved = localStorage.getItem('df-deals-view');
      if (saved === 'board' || saved === 'list') setView(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('df-deals-view', v);
    } catch {
      /* storage unavailable */
    }
  };

  const toggle = (
    <div role="group" aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
      {(
        [
          ['board', 'Board', KanbanSquare],
          ['list', 'List', List],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => choose(v)}
          className="inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="size-3.5" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );

  const pipelinePicker =
    view === 'board' && (pipelines.data?.length ?? 0) > 1 ? (
      <>
        <label htmlFor="board-pipeline" className="sr-only">
          Pipeline
        </label>
        <Select id="board-pipeline" className="h-8 w-48 text-xs" value={pipelineId ?? pipelines.data?.find((p) => p.isDefault)?.id} onChange={(e) => setPipelineId(e.target.value)}>
          {pipelines.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </>
    ) : null;

  return (
    <div>
      <RecordList
        entity="deals"
        description="Opportunities across your pipelines. Drag cards between stages, or use each card's Move menu."
        headerExtra={
          <>
            {pipelinePicker}
            {toggle}
          </>
        }
        hideTable={view === 'board'}
      />
      {view === 'board' && <DealsBoard pipelineId={pipelineId} />}
    </div>
  );
}
