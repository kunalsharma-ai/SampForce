'use client';

import type { BulkActionResult, TableEntity } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { useMembers } from '@/lib/crm';
import { type MessageKey, useT } from '@/lib/i18n';
import { useBulkAction } from '@/lib/table-views';
import { ENTITY_FEATURE, useCanDelete } from '@/lib/features';

/** Actions for the selected rows. Each record is changed through the normal API rules and audited. */
export function BulkBar({
  entity,
  ids,
  noun,
  statuses,
  total,
  all,
  onSelectAll,
  onClear,
}: {
  entity: TableEntity;
  ids: string[];
  noun: { one: string; many: string };
  statuses?: { value: string; label: string }[];
  /** How many records match the list, when more than the rows on screen (offers "select all"). */
  total?: number;
  /** Set when every matching record on every page is selected. */
  all?: { query: Record<string, string>; expected: number };
  onSelectAll?: (all: boolean) => void;
  onClear: () => void;
}) {
  const members = useMembers();
  const bulk = useBulkAction(entity);
  const canDelete = useCanDelete(ENTITY_FEATURE[entity]);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<string>('');
  const t = useT();
  const count = all ? all.expected : ids.length;
  const label = `${count.toLocaleString(t.formatLocale)} ${t.maybe(count === 1 ? noun.one.toLowerCase() : noun.many.toLowerCase())}`;
  // The ticked rows, or every matching record on every page (no limit).
  const target = all ? { all } : { ids };

  const report = (verb: MessageKey) => (r: BulkActionResult) => {
    const failed = r.failed.length ? ` ${t('{count} could not be changed: {reason}', { count: r.failed.length, reason: r.failed[0]!.message })}` : '';
    setResult(`${t(verb, { count: r.updated })}${failed}`);
    if (!r.failed.length) onClear();
  };
  // The client's own messages (a delete sent to the manager for approval, a cancelled password) are phrases.
  const onError = (e: Error) => setResult(t.maybe(e.message));

  return (
    <div role="region" aria-label={t('Bulk actions')} className="flex flex-wrap items-center gap-2 border-b border-border bg-primary/5 px-3 py-2 text-sm">
      <span className="font-medium">{all ? t('All {items} selected, on every page', { items: label }) : t('{items} selected', { items: label })}</span>
      {!all && total && onSelectAll && (
        <Button variant="link" size="sm" className="h-auto px-1" onClick={() => onSelectAll(true)}>
          {t('Select all {items}', { items: `${total.toLocaleString(t.formatLocale)} ${t.maybe(noun.many.toLowerCase())}` })}
        </Button>
      )}
      <label htmlFor={`${entity}-bulk-owner`} className="sr-only">
        {t('Assign selected to')}
      </label>
      <Select
        id={`${entity}-bulk-owner`}
        className="h-control-sm w-44"
        value=""
        disabled={bulk.isPending}
        onChange={(e) => e.target.value && bulk.mutate({ ...target, action: 'assign', ownerId: e.target.value }, { onSuccess: report('Assigned {count}.'), onError })}
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
            onChange={(e) => e.target.value && bulk.mutate({ ...target, action: 'status', status: e.target.value }, { onSuccess: report('Updated {count}.'), onError })}
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
      {canDelete && (
        <Button variant="outline" size="sm" className="text-critical" disabled={bulk.isPending} onClick={() => setConfirm(true)}>
          <Trash2 aria-hidden /> {t('Delete')}
        </Button>
      )}
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
          {all && (
            <p className="mt-3 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm" role="note">
              {t('This deletes every record that matches this list, on every page, not only the rows you can see.')}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                bulk.mutate({ ...target, action: 'delete' }, { onSuccess: report('Deleted {count}.'), onError });
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
