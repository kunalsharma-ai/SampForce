'use client';

import type { StageRow } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { Archive, ArchiveRestore, CalendarDays, CheckCheck, Flag, Trash2, UserRound, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LossReasonDialog } from '@/components/crm/deal-move';
import { Select } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import { useBulkDeals } from '@/lib/deal-views';
import { ENTITY_FEATURE, useCanDelete } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { useBulkAction } from '@/lib/table-views';
import { PRIORITY_LABEL } from './deal-badges';
import { SampBidxBulkSlot } from './sampbidx-bulk-slot';

/**
 * The floating bar for selected deals (ADR 0096): move to a stage (on the board, where every deal shares a pipeline),
 * assign, set priority or close date, archive or restore, delete, and send to SampBidx. It sits in the page flow at
 * the top of the view, in the page flow, so it never covers a card, the phone bar, the chat tab or a dialog.
 */
export function DealBulkBar({
  ids,
  onClear,
  stages,
  archived = false,
  compact = false,
}: {
  ids: string[];
  onClear: () => void;
  /** The board's stages; leave out where deals can come from different pipelines. */
  stages?: StageRow[];
  /** The selection is of archived deals: offer Restore instead of Archive. */
  archived?: boolean;
  /** Inside the table's own bulk row: no card of its own, and no assign or delete (the table has them). */
  compact?: boolean;
}) {
  const t = useT();
  const bulk = useBulkDeals();
  const remove = useBulkAction('deals');
  const qc = useQueryClient();
  const members = useMembers();
  const canDelete = useCanDelete(ENTITY_FEATURE.deals);
  const [result, setResult] = useState('');
  const [lossStage, setLossStage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState('');
  const n = ids.length;
  const busy = bulk.isPending || remove.isPending;

  const run = (input: Parameters<typeof bulk.mutate>[0], done: MessageKey) =>
    bulk.mutate(input, {
      onSuccess: (r) => {
        setResult(t(done, { count: r.updated }));
        onClear();
      },
      onError: (e) => setResult(e.message),
    });
  const moveTo = (stageId: string) => {
    const stage = stages?.find((s) => s.id === stageId);
    if (stage?.category === 'LOST') setLossStage(stageId);
    else run({ ids, stageId }, 'Moved {count}.');
  };
  const deleteAll = async () => {
    setConfirmDelete(false);
    let deleted = 0;
    const failed: string[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      try {
        const r = await remove.mutateAsync({ ids: ids.slice(i, i + 100), action: 'delete' });
        deleted += r.updated;
        failed.push(...r.failed.map((f) => f.message));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ['board'] }), qc.invalidateQueries({ queryKey: ['deal-views'] })]);
    setResult(t('Deleted {count}.', { count: deleted }) + (failed.length ? ` ${t('{count} could not be changed: {reason}', { count: failed.length, reason: failed[0]! })}` : ''));
    if (!failed.length) onClear();
  };

  const label = t.plural('count.deals', n);
  const control = 'h-9 min-w-0 rounded-lg text-xs';
  return (
    <div
      role={compact ? 'group' : 'region'}
      aria-label={compact ? t('Deal actions') : t('Bulk actions')}
      data-deal-bulk-bar
      className={cn(compact ? 'flex flex-wrap items-center gap-2' : 'sf-bulk mb-3 flex flex-wrap items-center gap-2 p-2.5 sm:p-3')}
    >
      {!compact && (
        <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
          <CheckCheck aria-hidden className="size-4" /> {t('{items} selected', { items: label })}
        </span>
      )}
      {stages && stages.length > 0 && (
        <label className="inline-flex min-w-0 items-center">
          <span className="sr-only">{t('Move selected to stage')}</span>
          <Select className={cn(control, 'w-40')} value="" disabled={busy} onChange={(e) => e.target.value && moveTo(e.target.value)}>
            <option value="">{t('Move to stage…')}</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {!compact && (
        <label className="inline-flex min-w-0 items-center gap-1">
          <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">{t('Assign selected to')}</span>
          <Select className={cn(control, 'w-40')} value="" disabled={busy} onChange={(e) => e.target.value && run({ ids, ownerId: e.target.value }, 'Assigned {count}.')}>
            <option value="">{t('Assign to…')}</option>
            {members.data
              ?.filter((m) => m.status === 'ACTIVE')
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
        </label>
      )}
      <label className="inline-flex min-w-0 items-center gap-1">
        <Flag aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">{t('Set priority of selected')}</span>
        <Select
          className={cn(control, 'w-36')}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && run({ ids, priority: e.target.value === 'NONE' ? null : (e.target.value as 'LOW' | 'MEDIUM' | 'HIGH') }, 'Updated {count}.')}
        >
          <option value="">{t('Priority…')}</option>
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
            <option key={p} value={p}>
              {t(PRIORITY_LABEL[p])}
            </option>
          ))}
          <option value="NONE">{t('Not set')}</option>
        </Select>
      </label>
      <form
        className="inline-flex min-w-0 items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (date) run({ ids, expectedCloseDate: date }, 'Updated {count}.');
        }}
      >
        <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <label className="sr-only" htmlFor="deal-bulk-close">
          {t('Expected close for selected')}
        </label>
        <Input id="deal-bulk-close" type="date" className={cn(control, 'w-36')} value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} />
        <Button type="submit" size="sm" variant="outline" disabled={!date || busy}>
          {t('Set date')}
        </Button>
      </form>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run({ ids, archived: !archived }, archived ? 'Restored {count}.' : 'Archived {count}.')}>
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} {archived ? t('Restore') : t('Archive')}
      </Button>
      {/* In the table the shared bulk bar already shows the SampBidx button for deals, so only the board renders it here. */}
      {!compact && <SampBidxBulkSlot dealIds={ids} onDone={onClear} />}
      {!compact && canDelete && (
        <Button type="button" size="sm" variant="outline" className="text-critical" disabled={busy} onClick={() => setConfirmDelete(true)}>
          <Trash2 aria-hidden /> {t('Delete')}
        </Button>
      )}
      {!compact && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <X aria-hidden /> {t('Clear selection')}
        </Button>
      )}
      <span role="status" className="min-w-0 text-xs text-muted-foreground">
        {busy ? t('Working…') : result}
      </span>
      {lossStage && (
        <LossReasonDialog
          dealName={label}
          onCancel={() => setLossStage(null)}
          onConfirm={(reason) => {
            run({ ids, stageId: lossStage, lossReason: reason }, 'Moved {count}.');
            setLossStage(null);
          }}
        />
      )}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">{t('Delete {items}?', { items: label })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('They are removed from lists, search and reports, and each deletion is recorded in the audit log.')}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('Cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void deleteAll()}>
              {t('Delete {items}', { items: label })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
