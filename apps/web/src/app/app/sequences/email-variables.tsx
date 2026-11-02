'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { EmailVariableRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useEmailVariables } from '@/lib/sequences';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** Workspace email variables: one value for every recipient, such as a booking link, inserted as {{var.key}}. */
export function EmailVariables() {
  const t = useT();
  const list = useEmailVariables();
  const canManage = useCan('marketing:manage');
  const qc = useQueryClient();
  const [v, setV] = useState({ key: '', label: '', value: '' });
  const save = useMutation({
    mutationFn: (input: { key: string; label: string; value: string }) => api<EmailVariableRow>('/email-variables', { method: 'PUT', json: input }),
    onSuccess: async () => {
      setV({ key: '', label: '', value: '' });
      await qc.invalidateQueries({ queryKey: ['email-variables'] });
    },
  });
  const remove = useMutation({
    mutationFn: (key: string) => api(`/email-variables/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-variables'] }),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardContent className="space-y-3 p-4">
          {list.isPending ? (
            <Skeleton className="h-24" />
          ) : list.error ? (
            <ErrorText error={list.error} />
          ) : list.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No variables yet. A variable holds one value for everyone, such as your booking link, so you can change it in one place.')}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {list.data.map((x) => (
                <li key={x.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{x.label}</span>
                  <code className="rounded bg-muted px-1 text-xs">{`{{var.${x.key}}}`}</code>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{x.value || t('(empty)')}</span>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setV({ key: x.key, label: x.label, value: x.value })} aria-label={t('Edit {name}', { name: x.label })}>
                        {t('Edit')}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-critical" onClick={() => remove.mutate(x.key)} disabled={remove.isPending} aria-label={t('Delete {name}', { name: x.label })}>
                        {t('Delete')}
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={remove.error} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Add or change a variable')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t('Saving an existing key changes its value in every template and sequence that uses it. An empty variable pauses sending, like an empty merge field.')}</p>
          {canManage ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(v);
              }}
            >
              <Field id="var-key" label={t('Key')} hint={t('Lowercase letters, digits and underscores, for example booking_link.')}>
                <Input id="var-key" required maxLength={40} pattern="[a-z][a-z0-9_]*" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} />
              </Field>
              <Field id="var-label" label={t('Label')}>
                <Input id="var-label" required maxLength={80} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
              </Field>
              <Field id="var-value" label={t('Value')}>
                <Input id="var-value" maxLength={2000} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
              </Field>
              <Button type="submit" size="sm" disabled={save.isPending}>
                {t('Save variable')}
              </Button>
              <ErrorText error={save.error} />
            </form>
          ) : (
            <p className="text-muted-foreground">{t('Ask someone who manages marketing to add variables.')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
