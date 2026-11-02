'use client';

import { Select } from '@/components/crm/select';
import { Field } from '@/components/revenue/tabs';
import { usePipelines } from '@/lib/crm';
import { useT } from '@/lib/i18n';

export const WINDOWS = [30, 90, 180, 365] as const;

/** Pipeline and time-window pickers shared by the flow and replay views. */
export function WindowControls({ id, pipelineId, setPipelineId, days, setDays }: { id: string; pipelineId: string | undefined; setPipelineId: (v: string | undefined) => void; days: number; setDays: (d: number) => void }) {
  const t = useT();
  const pipelines = usePipelines();
  return (
    <div className="flex flex-wrap items-end gap-3">
      {(pipelines.data?.length ?? 0) > 1 && (
        <Field id={`${id}-pipeline`} label={t('Pipeline')}>
          <Select id={`${id}-pipeline`} value={pipelineId ?? ''} onChange={(e) => setPipelineId(e.target.value || undefined)}>
            <option value="">{t('Default pipeline')}</option>
            {pipelines.data!.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      )}
      <Field id={`${id}-days`} label={t('Period')}>
        <Select id={`${id}-days`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {WINDOWS.map((d) => <option key={d} value={d}>{t.plural('count.lastDays', d)}</option>)}
        </Select>
      </Field>
    </div>
  );
}
