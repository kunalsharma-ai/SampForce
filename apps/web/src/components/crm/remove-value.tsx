'use client';

import { Button } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import * as React from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Removing one saved value from a company or contact (ADR 0097): a PATCH of that field to empty, or of its list without
 * the item. It is an edit, so it is audited like one. A cleared field becomes the person's own, so company auto-fill
 * never writes it again, and a list item auto-fill had added is never added back once removed (ADR 0076).
 */
export function useRemoveValue(entity: 'companies' | 'contacts', id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api(`/${entity}/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () =>
      Promise.all(['companies', 'contacts', 'company-employees', 'company-dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

/** A small × beside a value; the first press asks "Remove?", the second removes it. */
export function RemoveValue({ label, onRemove, className }: { label: string; onRemove: () => Promise<unknown>; className?: string }) {
  const t = useT();
  const [asking, setAsking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!asking) {
    return (
      <button
        type="button"
        aria-label={t('Remove {item}', { item: label })}
        title={t('Remove {item}', { item: label })}
        onClick={() => setAsking(true)}
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-critical/10 hover:text-critical focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${className ?? ''}`}
      >
        <X aria-hidden className="size-3.5" />
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="destructive"
        className="h-6 px-2 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onRemove();
            setAsking(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : t('Could not save.'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Check aria-hidden className="size-3" /> {t('Remove')}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setAsking(false)}>
        {t('Cancel')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-critical">
          {error}
        </span>
      )}
    </span>
  );
}
