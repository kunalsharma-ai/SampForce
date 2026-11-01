'use client';

import type { DealRow } from '@dealflow/types';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { LossReasonDialog, useMoveDeal } from '@/components/crm/deal-move';
import { usePipelines } from '@/lib/crm';
import { useCan } from '@/lib/session';

/** The deal's pipeline as a row of stage buttons; choosing one moves the deal (asking why when it is lost). */
export function StageStepper({ deal }: { deal: DealRow }) {
  const pipelines = usePipelines();
  const canWrite = useCan('deals:write');
  const move = useMoveDeal();
  const [losing, setLosing] = useState<string | null>(null);
  const stages = pipelines.data?.find((p) => p.id === deal.pipeline.id)?.stages ?? [];

  const goTo = (stageId: string, category: string) => {
    if (stageId === deal.stage.id) return;
    if (category === 'LOST') setLosing(stageId);
    else move.mutate({ id: deal.id, stageId });
  };

  return (
    <div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline stages">
        {stages.map((s) => {
          const current = s.id === deal.stage.id;
          const passed = s.position < deal.stage.position && deal.stage.category === 'OPEN' && s.category === 'OPEN';
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!canWrite || move.isPending}
                aria-current={current ? 'step' : undefined}
                onClick={() => goTo(s.id, s.category)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                  current
                    ? s.category === 'LOST'
                      ? 'border-critical bg-critical text-critical-foreground'
                      : s.category === 'WON'
                        ? 'border-success bg-success text-background'
                        : 'border-primary bg-primary text-primary-foreground'
                    : passed
                      ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                      : 'border-border hover:bg-muted'
                }`}
              >
                {passed && <Check className="size-3" aria-hidden />}
                {s.name}
                <span>· {s.probability}%</span>
              </button>
            </li>
          );
        })}
      </ol>
      {move.error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {move.error.message}
        </p>
      )}
      {losing && (
        <LossReasonDialog
          dealName={deal.name}
          onCancel={() => setLosing(null)}
          onConfirm={(lossReason) => {
            move.mutate({ id: deal.id, stageId: losing, lossReason });
            setLosing(null);
          }}
        />
      )}
    </div>
  );
}
