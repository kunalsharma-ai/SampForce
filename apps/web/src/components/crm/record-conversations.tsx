'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { INBOX_STATUS_LABELS } from '@dealflow/types';
import Link from 'next/link';
import { useInboxThreads } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { InfoTip } from '@/components/info-tip';

/** Inbox conversations linked to a deal, so its email history sits on the record. */
export function RecordConversations({ dealId }: { dealId: string }) {
  const canRead = useCan('activities:read');
  const tr = useT();
  const threads = useInboxThreads({ dealId }, canRead);
  if (!canRead) return null;
  const items = threads.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{tr('Conversations')}</CardTitle>
          <InfoTip topic="record.conversations" />
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tr('No email conversations linked yet. Link one from the inbox.')}
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
                  {tr.maybe(INBOX_STATUS_LABELS[t.status])}
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
