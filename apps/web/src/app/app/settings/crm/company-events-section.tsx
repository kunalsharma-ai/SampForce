'use client';

import { COMPANY_EVENTS_MAX, type CompanyEvent } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useCompanyEvents } from '@/lib/company-events';
import { useT } from '@/lib/i18n';

type Draft = Omit<CompanyEvent, 'id'> & { id?: string; key: string };

const blank = (): Draft => ({ key: crypto.randomUUID(), title: '', emoji: '🎉', date: '', yearly: true, note: null });

/**
 * The company's own special days (Kunal, 2026-11-27): a founding day, an annual party, an office closure. On the day,
 * every home dashboard in the organisation shows it beside the clock. Only the Super Workspace's administrators edit
 * the list.
 */
export function CompanyEventsSection() {
  const t = useT();
  const { query, save } = useCompanyEvents();
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-64" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const s = query.data;
  const rows: Draft[] = draft ?? s.events.map((e) => ({ ...e, key: e.id }));
  const edit = (next: Draft[]) => {
    setNotice(null);
    setDraft(next);
  };
  const change = (key: string, patch: Partial<Draft>) => edit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const valid = rows.every((r) => r.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date));

  return (
    <form
      className="space-y-4"
      data-company-events
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate(
          { events: rows.map(({ key: _key, ...r }) => ({ ...r, emoji: r.emoji.trim() || '🎉', note: r.note?.trim() || null })) },
          { onSuccess: () => { setDraft(null); setNotice(t('Saved.')); } },
        );
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Company events')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('Your own special days, such as a founding day, an annual party or an office closure. On the day, every home dashboard in your organisation shows it beside the clock, together with public holidays and well-known days.')}
          </p>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('No company events yet.')}</p>}
          <ul className="space-y-3">
            {rows.map((r, i) => (
              <li key={r.key} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_10.5rem] lg:grid-cols-[4.5rem_minmax(0,1fr)_10.5rem_minmax(0,1fr)_auto_auto]" data-company-event={i}>
                <Input aria-label={t('Emoji')} value={r.emoji} maxLength={16} disabled={!s.canEdit} className="text-center text-lg" onChange={(e) => change(r.key, { emoji: e.target.value })} />
                <Input aria-label={t('Event name')} placeholder={t('Event name')} value={r.title} maxLength={80} disabled={!s.canEdit} onChange={(e) => change(r.key, { title: e.target.value })} />
                <Input aria-label={t('Date')} type="date" value={r.date} disabled={!s.canEdit} onChange={(e) => change(r.key, { date: e.target.value })} />
                <Input aria-label={t('Note (optional)')} placeholder={t('Note (optional)')} value={r.note ?? ''} maxLength={160} disabled={!s.canEdit} onChange={(e) => change(r.key, { note: e.target.value })} />
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={r.yearly} disabled={!s.canEdit} onChange={(e) => change(r.key, { yearly: e.target.checked })} />
                  {t('Every year')}
                </label>
                {s.canEdit && (
                  <Button type="button" variant="ghost" size="icon" aria-label={t('Remove {name}', { name: r.title || t('event') })} onClick={() => edit(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {s.canEdit && rows.length < COMPANY_EVENTS_MAX && (
            <Button type="button" variant="outline" onClick={() => edit([...rows, blank()])}>
              <Plus className="size-4" aria-hidden />
              {t('Add event')}
            </Button>
          )}
          {!valid && <p role="alert" className="text-sm text-critical">{t('Give every event a name and a date.')}</p>}
          {!s.canEdit && <p className="text-sm text-muted-foreground">{t('Only administrators of the Super Workspace can change company events.')}</p>}
        </CardContent>
      </Card>
      {s.canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!draft || !valid || save.isPending}>
            {save.isPending ? t('Saving…') : t('Save')}
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>
          {save.error ? <p role="alert" className="text-sm text-critical">{save.error instanceof ApiError || save.error instanceof Error ? save.error.message : null}</p> : null}
        </div>
      )}
    </form>
  );
}
