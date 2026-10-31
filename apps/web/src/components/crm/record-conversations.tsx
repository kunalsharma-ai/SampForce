'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { INBOX_STATUS_LABELS } from '@dealflow/types';
import Link from 'next/link';
import { useInboxThreads } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

/** Inbox conversations linked to a deal, so its email history sits on the record. */
export function RecordConversations({ dealId }: { dealId: string }) {
  const canRead = useCan('activities:read');
  const threads = useInboxThreads({ dealId }, canRead);
  if (!canRead) return null;
  const items = threads.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conversations</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No email conversations linked yet. Link one from the inbox.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.slice(0, 10).map((t) => (
              <li key={t.id} className="flex items-start gap-2">
                <Link
                  href={`/app/communication?conversation=${t.id}`}
                  className="min-w-0 flex-1 truncate text-primary underline underline-offset-2"
                >
                  {t.subject}
                </Link>
                <Badge
                  tone={
                    t.status === 'CLOSED'
                      ? 'neutral'
                      : t.status === 'WAITING'
                        ? 'warning'
                        : 'primary'
                  }
                >
                  {INBOX_STATUS_LABELS[t.status]}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(t.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
