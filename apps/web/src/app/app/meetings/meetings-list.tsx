'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { MEETING_PLATFORM_LABELS, type MeetingRecord, type MeetingRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MeetingNotesButton, MeetingRecordList } from '@/components/meetings/record-meetings';
import { api } from '@/lib/api';
import { useIntegrations, useMeetings } from '@/lib/automation';
import { useMeetingRecords } from '@/lib/meetings';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

const fmt = (iso: string) => new Date(iso).toLocaleString(fmtLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function MeetingsList() {
  const meetings = useMeetings();
  const integrations = useIntegrations();
  const connected = integrations.data?.some((p) => p.connection?.status === 'CONNECTED');
  if (meetings.isPending) return <Skeleton className="h-48" />;
  const now = Date.now();
  const upcoming = meetings.data?.filter((m) => new Date(m.endsAt).getTime() >= now) ?? [];
  const past = (meetings.data?.filter((m) => new Date(m.endsAt).getTime() < now) ?? []).reverse();
  return (
    <div className="space-y-4">
      {!connected && !integrations.isPending && (
        <p className="text-sm text-muted-foreground">
          No calendar connected.{' '}
          <Link href="/app/integrations" className="text-primary underline underline-offset-2">
            Connect Google or Microsoft 365
          </Link>{' '}
          to see meetings here.
        </p>
      )}
      <Section title="Upcoming" items={upcoming} empty="No upcoming meetings with contacts." />
      <Section title="Past 30 days" items={past} empty="No recent meetings with contacts." notes />
      <NotesSection />
    </div>
  );
}

function Section({ title, items, empty, notes }: { title: string; items: MeetingRow[]; empty: string; notes?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className={`text-sm font-medium ${m.canceled ? 'line-through text-muted-foreground' : ''}`}>{m.title}</span>
                {m.canceled && <Badge tone="neutral">Canceled</Badge>}
                {m.platform && <Badge tone="neutral">{MEETING_PLATFORM_LABELS[m.platform]}</Badge>}
                <span className="ms-auto flex flex-wrap gap-2">
                  {!notes && m.joinUrl && !m.canceled && (
                    <a href={m.joinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2">
                      Join <span className="sr-only">{m.title}</span>
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  )}
                  {m.recordId ? (
                    <Link href={`/app/meetings/records/${m.recordId}`} className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2">
                      <NotebookPen className="size-3.5" aria-hidden /> Open notes <span className="sr-only">for {m.title}</span>
                    </Link>
                  ) : (
                    notes && !m.canceled && m.contactIds.length > 0 && <MeetingNotesButton target={{ meetingId: m.id }} label="Add notes" />
                  )}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  {fmt(m.startsAt)}
                  {m.location && !m.location.startsWith('http') && ` · ${m.location}`}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  {m.attendees.slice(0, 6).join(', ')}
                  {m.attendees.length > 6 && ` +${m.attendees.length - 6}`}
                  {m.contactIds.map((id, i) => (
                    <Link key={id} href={`/app/contacts/${id}`} className="ms-2 text-primary underline underline-offset-2">
                      Contact {m.contactIds.length > 1 ? i + 1 : ''}
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Every meeting notes page in the workspace, including ones for calls that were not in a calendar. */
function NotesSection() {
  const canWrite = useCan('activities:write');
  const records = useMeetingRecords();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: () => api<MeetingRecord>('/meeting-records', { method: 'POST', json: { title: title.trim() } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['meeting-records'] });
      router.push(`/app/meetings/records/${r.id}`);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Meeting notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) create.mutate();
            }}
          >
            <div className="min-w-56 flex-1">
              <Field id="new-meeting-title" label="New notes for a call not in your calendar" error={create.error?.message}>
                <Input value={title} maxLength={300} placeholder="Discovery call with Acme" onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              New meeting notes
            </Button>
          </form>
        )}
        {records.isPending ? <Skeleton className="h-16" /> : <MeetingRecordList items={records.data ?? []} empty="No meeting notes yet." />}
      </CardContent>
    </Card>
  );
}
