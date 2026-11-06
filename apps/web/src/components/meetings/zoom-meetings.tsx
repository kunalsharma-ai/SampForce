'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@dealflow/ui';
import type { AppStatus, ZoomMeetingRow, ZoomTranscriptStatus } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Video } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';

type Target = { leadId?: string; contactId?: string; dealId?: string };

const TRANSCRIPT: Record<ZoomTranscriptStatus, { label: string; tone: 'neutral' | 'primary' | 'success' | 'critical' } | null> = {
  none: null,
  waiting: { label: 'Recording: transcript after the meeting', tone: 'neutral' },
  ready: { label: 'Importing transcript', tone: 'primary' },
  imported: { label: 'Transcript in meeting notes', tone: 'success' },
  failed: { label: 'Transcript not imported', tone: 'critical' },
};

function defaultStart(): string {
  const d = new Date(Date.now() + 86_400_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

/** Zoom meetings for a lead, contact or deal: schedule one and see its transcript status. Shown once Zoom is connected. */
export function RecordZoomMeetings({ target }: { target: Target }) {
  const t = useT();
  const canRead = useCan('activities:read');
  const canWrite = useCan('activities:write');
  const qc = useQueryClient();
  const apps = useQuery({ enabled: canRead, queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const zoom = apps.data?.find((a) => a.key === 'zoom');
  const live = zoom?.state === 'connected' || zoom?.state === 'error';
  const qs = new URLSearchParams(target as Record<string, string>).toString();
  const meetings = useQuery({ enabled: canRead && !!zoom && zoom.state !== 'pending_configuration', queryKey: ['zoom-meetings', qs], queryFn: () => api<ZoomMeetingRow[]>(`/apps/zoom/meetings?${qs}`) });
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [duration, setDuration] = useState('30');
  const [record, setRecord] = useState(false);
  const [consent, setConsent] = useState(false);
  const transcriptsReady = !!zoom && zoom.warnings.length === 0;
  const schedule = useMutation({
    mutationFn: () =>
      api<ZoomMeetingRow>('/apps/zoom/meetings', {
        method: 'POST',
        json: { topic, startsAt: new Date(startsAt).toISOString(), durationMinutes: Number(duration), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...target, recordToCloud: record, recordingConsent: record && consent },
      }),
    onSuccess: async () => {
      setOpen(false);
      setTopic('');
      setRecord(false);
      setConsent(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ['zoom-meetings'] }), qc.invalidateQueries({ queryKey: ['activities'] }), qc.invalidateQueries({ queryKey: ['timeline'] })]);
    },
  });
  if (!canRead || !live) return null;
  const items = meetings.data ?? [];
  return (
    <Card role="region" aria-labelledby="zoom-meetings-heading">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle id="zoom-meetings-heading" className="text-base">
          {t('Zoom meetings')}
        </CardTitle>
        {canWrite && !open && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Video aria-hidden /> {t('Schedule')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {zoom.state === 'error' && <p className="text-xs text-critical">{zoom.connection?.lastError ?? t('Zoom needs reconnecting in Integrations.')}</p>}
        {open && (
          <form
            className="space-y-2 rounded-md border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              schedule.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="zoom-topic">{t('Topic')}</Label>
              <Input id="zoom-topic" value={topic} maxLength={200} required onChange={(e) => setTopic(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="zoom-start">{t('Starts')}</Label>
                <Input id="zoom-start" type="datetime-local" value={startsAt} required onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zoom-duration">{t('Length')}</Label>
                <Select id="zoom-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>
                      {new Intl.NumberFormat(t.language, { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(m)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={record} disabled={!transcriptsReady} onChange={(e) => setRecord(e.target.checked)} />
              <span>
                {t('Record to the Zoom cloud and add the transcript to meeting notes')}
                {!transcriptsReady && <span className="block text-xs text-muted-foreground">{t.maybe(zoom.warnings[0] ?? '')}</span>}
              </span>
            </label>
            {record && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>{t('Everyone in the meeting has agreed to it being recorded and transcribed. Zoom also announces the recording.')}</span>
              </label>
            )}
            <p className="text-xs text-muted-foreground">{t('The meeting is created in your Zoom user (your SampForce email) and logged on this record.')}</p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={schedule.isPending || !topic.trim() || (record && !consent)}>
                {schedule.isPending ? t('Scheduling…') : t('Schedule Zoom meeting')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
            </div>
            {schedule.error && (
              <p role="alert" className="text-xs text-critical">
                {schedule.error.message}
              </p>
            )}
          </form>
        )}
        {items.length === 0 ? (
          <p className="text-muted-foreground">{t('No Zoom meetings scheduled from SampForce for this record.')}</p>
        ) : (
          <ul className="space-y-2" aria-label={t('Zoom meetings')}>
            {items.map((m) => {
              const ts = TRANSCRIPT[m.transcriptStatus];
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.topic}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.startsAt).toLocaleString(fmtLocale())} · {new Intl.NumberFormat(t.language, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(m.durationMinutes)}
                  </span>
                  <a href={m.joinUrl} target="_blank" rel="noreferrer noopener" className="text-xs text-primary underline underline-offset-2">
                    {t('Join link')}
                  </a>
                  {ts && <Badge tone={ts.tone}>{t.maybe(ts.label)}</Badge>}
                  {m.meetingRecordId && (
                    <Link href={`/app/meetings/records/${m.meetingRecordId}`} className="text-xs text-primary underline underline-offset-2">
                      {t('Open meeting notes')}
                    </Link>
                  )}
                  {m.transcriptError && <span className="w-full text-xs text-critical">{m.transcriptError}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
