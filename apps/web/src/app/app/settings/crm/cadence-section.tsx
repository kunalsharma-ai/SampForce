'use client';

import { CADENCE_MAX_FOLLOW_UPS, CADENCE_MAX_INTERVAL_DAYS, type FollowUpCadence } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { ApiError } from '@/lib/api';
import { useCadenceSettings } from '@/lib/follow-up-cadence';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * The follow-up cadence (redesign R3, ADR 0083): how many follow-ups each employee gets after the initial email, and how
 * many days apart. Everyone can read it; only the Super Workspace's administrators change it.
 */
export function FollowUpCadenceSection() {
  const t = useT();
  const { query, save } = useCadenceSettings();
  const [draft, setDraft] = useState<FollowUpCadence | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (query.isPending) return <Skeleton className="h-64" />;
  if (query.error) return <p role="alert" className="text-sm text-critical">{query.error.message}</p>;
  const s = query.data;
  const v = draft ?? { followUps: s.followUps, intervalDays: s.intervalDays };
  const set = (patch: Partial<FollowUpCadence>) => {
    setNotice(null);
    setDraft({ ...v, ...patch });
  };
  const valid = Number.isInteger(v.followUps) && v.followUps >= 1 && v.followUps <= CADENCE_MAX_FOLLOW_UPS && Number.isInteger(v.intervalDays) && v.intervalDays >= 1 && v.intervalDays <= CADENCE_MAX_INTERVAL_DAYS;
  const total = v.followUps * v.intervalDays;

  return (
    <form
      className="space-y-4"
      data-cadence-settings
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate(v, { onSuccess: () => { setDraft(null); setNotice(t('Saved.')); } });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t('Follow-up cadence')}
            <InfoTip topic="crm.followUpCadence" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('Every new employee starts in Fresh Email Pending. When the initial email goes out, SampForce plans each follow-up as a task for the employee owner, and stops as soon as the employee answers or an RFQ arrives.')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cadence-count" label={t('Follow-ups after the initial email')}>
              <Input type="number" min={1} max={CADENCE_MAX_FOLLOW_UPS} step={1} value={Number.isNaN(v.followUps) ? '' : v.followUps} disabled={!s.canEdit} onChange={(e) => set({ followUps: e.target.valueAsNumber })} />
            </Field>
            <Field id="cadence-days" label={t('Days between follow-ups')}>
              <Input type="number" min={1} max={CADENCE_MAX_INTERVAL_DAYS} step={1} value={Number.isNaN(v.intervalDays) ? '' : v.intervalDays} disabled={!s.canEdit} onChange={(e) => set({ intervalDays: e.target.valueAsNumber })} />
            </Field>
          </div>
          {valid ? (
            <p className="text-sm" data-cadence-summary>
              {t('{count} follow-ups, one every {days} days: the last one is due {total} days after the initial email.', { count: v.followUps, days: v.intervalDays, total })}
            </p>
          ) : (
            <p role="alert" className="text-sm text-critical">
              {t('Choose 1 to {max} follow-ups, 1 to {days} days apart.', { max: CADENCE_MAX_FOLLOW_UPS, days: CADENCE_MAX_INTERVAL_DAYS })}
            </p>
          )}
          {!s.canEdit && <p className="text-sm text-muted-foreground">{t('Only administrators of the Super Workspace can change the follow-up cadence.')}</p>}
          {s.updatedBy && <p className="text-xs text-muted-foreground">{t('Last changed by {name} {time}', { name: s.updatedBy.name, time: s.updatedAt ? relativeTime(s.updatedAt) : '' })}</p>}
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
