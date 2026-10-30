'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { MeetingRow } from '@dealflow/types';
import Link from 'next/link';
import { MeetingNotesButton } from '@/components/ai/record-ai';
import { useIntegrations, useMeetings } from '@/lib/automation';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

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
          <Link href="/app/integrations" className="text-primary hover:underline">
            Connect Google or Microsoft 365
          </Link>{' '}
          to see meetings here.
        </p>
      )}
      <Section title="Upcoming" items={upcoming} empty="No upcoming meetings with contacts." />
      <Section title="Past 30 days" items={past} empty="No recent meetings with contacts." summarise />
    </div>
  );
}

function Section({ title, items, empty, summarise }: { title: string; items: MeetingRow[]; empty: string; summarise?: boolean }) {
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
                {summarise && !m.canceled && m.contactIds.length > 0 && (
                  <span className="ml-auto">
                    <MeetingNotesButton target={{ meetingId: m.id }} label="Summarise notes" />
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {fmt(m.startsAt)}
                  {m.location && ` · ${m.location}`}
                </span>
                <span className="w-full text-xs text-muted-foreground">
                  {m.attendees.slice(0, 6).join(', ')}
                  {m.attendees.length > 6 && ` +${m.attendees.length - 6}`}
                  {m.contactIds.map((id, i) => (
                    <Link key={id} href={`/app/contacts/${id}`} className="ml-2 text-primary hover:underline">
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
