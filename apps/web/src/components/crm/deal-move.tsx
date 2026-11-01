'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import type { DealRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { type MessageKey, useT } from '@/lib/i18n';

/** Stored in English (reports group by it) and shown translated. */
export const LOSS_REASONS: MessageKey[] = ['Price', 'Chose a competitor', 'No budget', 'No decision', 'Timing', 'Missing feature', 'Other'];

export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stageId, lossReason }: { id: string; stageId: string; lossReason?: string }) =>
      api<DealRow>(`/deals/${id}/move`, { method: 'POST', json: { stageId, lossReason } }),
    onSuccess: (row) => {
      qc.setQueryData(['deals', 'detail', row.id], row);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['board'] });
      void qc.invalidateQueries({ queryKey: ['deals', 'list'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['deal-views'] });
      void qc.invalidateQueries({ queryKey: ['deals', 'history'] });
    },
  });
}

/** Asks why a deal was lost; the API requires a reason for the Lost stage. */
export function LossReasonDialog({ dealName, onCancel, onConfirm }: { dealName: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const t = useT();
  const [choice, setChoice] = useState(LOSS_REASONS[0]!);
  const [other, setOther] = useState('');
  const reason = choice === 'Other' ? other.trim() : choice;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="p-6">
        <DialogTitle className="text-lg font-semibold">{t('Mark “{name}” as lost', { name: dealName })}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('Loss reasons feed win/loss reporting.')}</DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) onConfirm(reason);
          }}
        >
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('Loss reason')}</legend>
            {LOSS_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="radio" name="loss-reason" value={r} checked={choice === r} onChange={() => setChoice(r)} className="accent-[hsl(var(--primary))]" />
                {t(r)}
              </label>
            ))}
          </fieldset>
          {choice === 'Other' && (
            <Field id="loss-other" label={t('Describe the reason')}>
              <Input value={other} onChange={(e) => setOther(e.target.value)} maxLength={300} autoFocus />
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('Cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason}>
              {t('Mark as lost')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
