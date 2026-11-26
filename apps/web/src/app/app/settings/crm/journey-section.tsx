'use client';

import { DEFAULT_JOURNEY, JOURNEY_ALWAYS_SHOWN, type JourneyKey, type JourneySettingsInput, type JourneyStageRow } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Skeleton } from '@dealflow/ui';
import * as React from 'react';
import { STAGE_CHIP, STAGE_DOT, stageStyle } from '@/components/crm/stage-chip';
import { InfoTip } from '@/components/info-tip';
import { useJourneySettings } from '@/lib/journey';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Journey stages (redesign R5, ADR 0085): every company is in one of these on the Pipeline. The Super Workspace can
 * rename, recolour or hide them; New Company, RFQ Received, Won and Lost always show.
 */
export function JourneySection() {
  const t = useT();
  const { query, save } = useJourneySettings();
  const [draft, setDraft] = React.useState<JourneyStageRow[] | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-96" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const s = query.data;
  const rows = draft ?? s.stages;
  const set = (key: JourneyKey, patch: Partial<JourneyStageRow>) => {
    setNotice(null);
    setDraft(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const valid = rows.every((r) => r.name.trim().length > 0 && r.name.trim().length <= 40);
  const toInput = (): JourneySettingsInput => ({
    stages: Object.fromEntries(
      rows.map((r) => [r.key, { ...(r.name.trim() !== DEFAULT_JOURNEY[r.key].name ? { name: r.name.trim() } : {}), ...(r.color !== DEFAULT_JOURNEY[r.key].color ? { color: r.color } : {}), ...(r.hidden ? { hidden: true } : {}) }]),
    ),
  });
  return (
    <form
      className="space-y-4"
      data-journey-settings
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate(toInput(), { onSuccess: () => { setDraft(null); setNotice(t('Saved.')); } });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Journey stages')}
            <InfoTip topic="crm.journey" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('Every company is in one of these stages on the Pipeline, worked out from its employees, RFQs, deals and status. Rename, recolour or hide them; New Company, RFQ Received, Won and Lost always show.')}</p>
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label={t('Journey stages')}>
            {rows.map((r) => {
              const locked = JOURNEY_ALWAYS_SHOWN.includes(r.key);
              return (
                <li key={r.key} className={cn('grid grid-cols-1 items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]', r.hidden && 'bg-muted/40')} data-journey-stage={r.key}>
                  <div className="flex min-w-0 items-center gap-2" style={stageStyle(r.color)}>
                    <span aria-hidden className={cn('size-3 shrink-0 rounded-full', STAGE_DOT)} />
                    <Input
                      value={r.name}
                      maxLength={40}
                      disabled={!s.canEdit}
                      aria-label={t('Name of the stage {name}', { name: t.maybe(DEFAULT_JOURNEY[r.key].name) })}
                      onChange={(e) => set(r.key, { name: e.target.value })}
                      className="min-w-0"
                    />
                    <span className={cn('hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium md:inline', STAGE_CHIP)}>{t('Preview')}</span>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="color" value={r.color} disabled={!s.canEdit} onChange={(e) => set(r.key, { color: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-input bg-surface p-1 disabled:cursor-not-allowed" aria-label={t('Colour of the stage {name}', { name: r.name })} />
                  </label>
                  <label className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={!r.hidden} disabled={!s.canEdit || locked} onChange={(e) => set(r.key, { hidden: !e.target.checked })} />
                    {locked ? t('Always shown') : t('Shown')}
                  </label>
                </li>
              );
            })}
          </ul>
          {!s.canEdit && <p className="text-sm text-muted-foreground">{t('Only administrators of the Super Workspace can change the journey stages.')}</p>}
          {s.updatedBy && <p className="text-xs text-muted-foreground">{t('Last changed by {name} {time}', { name: s.updatedBy.name, time: s.updatedAt ? relativeTime(s.updatedAt) : '' })}</p>}
        </CardContent>
      </Card>
      {s.canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!draft || !valid || save.isPending}>{save.isPending ? t('Saving…') : t('Save')}</Button>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={() => { setNotice(null); setDraft(rows.map((r) => ({ ...r, name: DEFAULT_JOURNEY[r.key].name, color: DEFAULT_JOURNEY[r.key].color, hidden: false, customised: false }))); }}>
            {t('Reset to defaults')}
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>
          {save.error && <p role="alert" className="text-sm text-critical">{save.error.message}</p>}
        </div>
      )}
    </form>
  );
}
