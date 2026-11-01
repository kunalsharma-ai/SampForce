'use client';

import type { BulkActionResult, TableEntity } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useBulkAction } from '@/lib/table-views';

/** Actions for the selected rows. Each record is changed through the normal API rules and audited. */
export function BulkBar({
  entity,
  ids,
  noun,
  statuses,
  onClear,
}: {
  entity: TableEntity;
  ids: string[];
  noun: { one: string; many: string };
  statuses?: { value: string; label: string }[];
  onClear: () => void;
}) {
  const members = useMembers();
  const bulk = useBulkAction(entity);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string>('');
  const t = useT();
  const label = `${ids.length} ${t.maybe(ids.length === 1 ? noun.one.toLowerCase() : noun.many.toLowerCase())}`;

  const report = (verb: MessageKey) => (r: BulkActionResult) => {
    const failed = r.failed.length ? ` ${t('{count} could not be changed: {reason}', { count: r.failed.length, reason: r.failed[0]!.message })}` : '';
    setResult(`${t(verb, { count: r.updated })}${failed}`);
    if (!r.failed.length) onClear();
  };
  const onError = (e: Error) => setResult(e.message);

  return (
    <div role="region" aria-label={t('Bulk actions')} className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2 text-sm">
      <span className="font-medium">{t('{items} selected', { items: label })}</span>
      <label htmlFor={`${entity}-bulk-owner`} className="sr-only">
        {t('Assign selected to')}
      </label>
      <Select
        id={`${entity}-bulk-owner`}
        className="h-control-sm w-44"
        value=""
        disabled={bulk.isPending}
        onChange={(e) => e.target.value && bulk.mutate({ ids, action: 'assign', ownerId: e.target.value }, { onSuccess: report('Assigned {count}.'), onError })}
      >
        <option value="">{t('Assign to…')}</option>
        {members.data
          ?.filter((m) => m.status === 'ACTIVE')
          .map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
      </Select>
      {statuses && (
        <>
          <label htmlFor={`${entity}-bulk-status`} className="sr-only">
            {t('Set status of selected')}
          </label>
          <Select
            id={`${entity}-bulk-status`}
            className="h-control-sm w-40"
            value=""
            disabled={bulk.isPending}
            onChange={(e) => e.target.value && bulk.mutate({ ids, action: 'status', status: e.target.value }, { onSuccess: report('Updated {count}.'), onError })}
          >
            <option value="">{t('Set status…')}</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {t.maybe(s.label)}
              </option>
            ))}
          </Select>
        </>
      )}
      <Button variant="outline" size="sm" className="text-critical" disabled={bulk.isPending} onClick={() => setConfirm(true)}>
        <Trash2 aria-hidden /> {t('Delete')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X aria-hidden /> {t('Clear selection')}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {bulk.isPending ? t('Working…') : result}
      </span>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">{t('Delete {items}?', { items: label })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('They are removed from lists, search and reports, and each deletion is recorded in the audit log.')}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                bulk.mutate({ ids, action: 'delete' }, { onSuccess: report('Deleted {count}.'), onError });
              }}
            >
              {t('Delete {items}', { items: label })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
