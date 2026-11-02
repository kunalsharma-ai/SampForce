'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import type { MeetingRecord, MeetingRecordRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useMeetingRecords } from '@/lib/meetings';
import { type Translator, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

export interface MeetingTarget {
  meetingId?: string;
  dealId?: string;
  contactId?: string;
  leadId?: string;
}

/** Opens meeting notes for a calendar meeting or a record: creates the notes page (or reuses the meeting's) and goes there. */
export function MeetingNotesButton({ target, label = 'Meeting notes', title = 'Meeting notes' }: { target: MeetingTarget; label?: string; title?: string }) {
  const t = useT();
  const canWrite = useCan('activities:write');
  const router = useRouter();
  const qc = useQueryClient();
  const open = useMutation({
    mutationFn: () => api<MeetingRecord>('/meeting-records', { method: 'POST', json: target.meetingId ? { meetingId: target.meetingId } : { title: t.maybe(title), ...target } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['meeting-records'] });
      await qc.invalidateQueries({ queryKey: ['meetings'] });
      router.push(`/app/meetings/records/${r.id}`);
    },
  });
  if (!canWrite) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => open.mutate()} disabled={open.isPending}>
        <NotebookPen aria-hidden /> {t.maybe(label)}
      </Button>
      {open.error && (
        <p role="alert" className="text-xs text-critical">
          {open.error.message}
        </p>
      )}
    </>
  );
}

export function recordStage(r: Pick<MeetingRecordRow, 'hasAnalysis' | 'reviewed' | 'transcriptionStatus'>): { label: string; tone: 'neutral' | 'warning' | 'success' | 'primary' | 'critical' } {
  if (r.transcriptionStatus === 'processing') return { label: 'Transcribing', tone: 'primary' };
  if (r.transcriptionStatus === 'failed' && !r.hasAnalysis) return { label: 'Transcription failed', tone: 'critical' };
  if (r.reviewed) return { label: 'Reviewed', tone: 'success' };
  if (r.hasAnalysis) return { label: 'AI draft, not reviewed', tone: 'warning' };
  return { label: 'Notes only', tone: 'neutral' };
}

export function MeetingRecordList({ items, empty }: { items: MeetingRecordRow[]; empty: string }) {
  const t: Translator = useT();
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t.maybe(empty)}</p>;
  return (
    <ul className="space-y-2 text-sm" aria-label={t('Meeting notes')}>
      {items.map((r) => {
        const s = recordStage(r);
        return (
          <li key={r.id} className="flex flex-wrap items-start gap-2">
            <Link href={`/app/meetings/records/${r.id}`} className="min-w-0 flex-1 truncate text-primary underline underline-offset-2">
              {r.title}
            </Link>
            <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
            {r.taskCount > 0 && <span className="text-xs text-muted-foreground">{t.plural('count.tasks', r.taskCount)}</span>}
            <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(r.occurredAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Meeting notes linked to a deal, contact or lead. */
export function RecordMeetings({ target }: { target: Omit<MeetingTarget, 'meetingId'> }) {
  const t = useT();
  const canRead = useCan('activities:read');
  const records = useMeetingRecords(target, canRead);
  if (!canRead) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('Meeting notes')}</CardTitle>
        <MeetingNotesButton target={target} label={t('New notes')} />
      </CardHeader>
      <CardContent>
        <MeetingRecordList items={records.data ?? []} empty={t('No meeting notes yet. Add notes, paste a transcript or upload a recording.')} />
      </CardContent>
    </Card>
  );
}
