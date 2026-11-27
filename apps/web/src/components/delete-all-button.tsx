'use client';

import type { BulkActionResult, FeatureKey, Permission } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCanDelete } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/**
 * "Delete all" for a list that is not a table (ADR 0096): deletes every record the list shows for its current filters,
 * on every page and past any display limit. `path` is the list's API path (`/rfqs`) and `query` the filters the list
 * was loaded with. The dialog shows the server's count of every match; if the list changes before the person confirms,
 * nothing is deleted. The password is asked once for all of them, and each deletion is audited as if made by hand.
 */
export function DeleteAllButton({
  path,
  query,
  hasItems,
  permission,
  feature,
  invalidate,
}: {
  path: string;
  query: Record<string, string | number | boolean | null | undefined>;
  /** Whether the list shows anything (the button is hidden on an empty list). */
  hasItems: boolean;
  permission: Permission;
  feature: FeatureKey;
  /** The query keys to refresh afterwards. */
  invalidate: string[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const canWrite = useCan(permission);
  const canDelete = useCanDelete(feature);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  // Every match, not only what the list shows: asked for when the dialog opens.
  const counted = useQuery({
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    queryKey: ['delete-all-count', path, clean],
    queryFn: () => api<{ count: number }>(`${path}/count-all`, { method: 'POST', json: { query: clean } }),
  });
  const count = counted.data?.count ?? 0;
  const run = useMutation({
    mutationFn: () => api<BulkActionResult>(`${path}/delete-all`, { method: 'POST', json: { query: clean, expected: count } }),
    onSuccess: (r) => {
      const failed = r.failed.length ? ` ${t('{count} could not be changed: {reason}', { count: r.failed.length, reason: r.failed[0]!.message })}` : '';
      setResult(`${t('Deleted {count}.', { count: r.updated })}${failed}`);
    },
    onError: (e: Error) => setResult(e.message),
    onSettled: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
  if (!canWrite || !canDelete || (!hasItems && !result)) return null;
  const n = count.toLocaleString(t.formatLocale);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {hasItems && (
        <Button variant="outline" size="sm" className="text-critical" disabled={run.isPending} onClick={() => setOpen(true)}>
          <Trash2 aria-hidden /> {t('Delete all')}
        </Button>
      )}
      <span role="status" className="text-xs text-muted-foreground">
        {run.isPending ? t('Working…') : result}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6">
          <DialogTitle className="text-lg font-semibold">{t('Delete everything in this list?')}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('They are removed from lists, search and reports, and each deletion is recorded in the audit log.')}
          </DialogDescription>
          {counted.error ? (
            <p role="alert" className="mt-3 text-sm text-critical">
              {counted.error.message}
            </p>
          ) : (
            <p className="mt-3 rounded-md border border-critical/40 bg-critical/10 p-3 text-sm" role="note">
              {counted.isPending ? t('Counting…') : t('This deletes all {count} records this list shows with its current filters, not only the ones you can see.', { count: n })}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!count}
              onClick={() => {
                setOpen(false);
                setResult('');
                run.mutate();
              }}
            >
              {t('Delete all {count}', { count: n })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}
