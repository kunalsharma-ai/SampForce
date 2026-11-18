'use client';

import { ACTIVITY_TYPES, type ActivityRow, activityUpdateSchema } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { api } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/company-work';
import { titleCase } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { Select, Textarea } from './select';

/** Saves an edit to a logged activity and refreshes every list it shows up in. */
export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) => api<ActivityRow>(`/activities/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () =>
      Promise.all(['activities', 'timeline', 'interactions', 'company-dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

/**
 * Edits a logged note, call, email or meeting: its type, subject, details and when it happened (ADR 0065).
 * `activityId` loads the activity (the timeline only knows its id); `activity` uses the row the caller already has.
 */
export function EditActivityDialog({ activityId, activity, onClose }: { activityId?: string | null; activity?: ActivityRow | null; onClose: () => void }) {
  const t = useT();
  const id = activity?.id ?? activityId ?? null;
  const loaded = useQuery({ enabled: !!id && !activity, queryKey: ['activities', 'one', id], queryFn: () => api<ActivityRow>(`/activities/${id}`) });
  const row = activity ?? loaded.data ?? null;
  const update = useUpdateActivity();
  const [v, setV] = React.useState({ type: 'NOTE' as (typeof ACTIVITY_TYPES)[number], subject: '', body: '', occurredAt: '' });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (row) setV({ type: row.type, subject: row.subject, body: row.body ?? '', occurredAt: toLocalInput(row.occurredAt) });
    setErrors({});
    setFormError(null);
  }, [row]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) return;
    const parsed = activityUpdateSchema.safeParse({ ...(v.type !== row.type ? { type: v.type } : {}), subject: v.subject, body: v.body || null, occurredAt: fromLocalInput(v.occurredAt) ?? undefined });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      return;
    }
    try {
      await update.mutateAsync({ id: row.id, input: parsed.data });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{t('Edit activity')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Changes are saved to this activity and kept in the audit log.')}</DialogDescription>
        {!row ? (
          loaded.error ? (
            <p role="alert" className="text-sm text-critical">
              {loaded.error.message}
            </p>
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field id="act-edit-type" label={t('Activity type')} hint={row.interaction ? t('Set by the interaction type. Change it from the company page.') : undefined}>
              <Select disabled={!!row.interaction} value={v.type} onChange={(e) => setV((x) => ({ ...x, type: e.target.value as typeof v.type }))}>
                {ACTIVITY_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {t.maybe(titleCase(k))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="act-edit-when" label={t('Date and time')}>
              <Input type="datetime-local" value={v.occurredAt} onChange={(e) => setV((x) => ({ ...x, occurredAt: e.target.value }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field id="act-edit-subject" label={t('Subject *')} error={errors.subject}>
                <Input value={v.subject} onChange={(e) => setV((x) => ({ ...x, subject: e.target.value }))} maxLength={200} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field id="act-edit-body" label={t('Details')} error={errors.body}>
                <Textarea rows={4} value={v.body} onChange={(e) => setV((x) => ({ ...x, body: e.target.value }))} />
              </Field>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-critical sm:col-span-2">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t('Saving…') : t('Save changes')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
