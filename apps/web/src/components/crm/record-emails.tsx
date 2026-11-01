'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@dealflow/ui';
import { ArrowDownLeft, ArrowUpRight, Mail } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ComposeDialog } from '@/app/app/communication/mailbox';
import { useEmails, useIntegrations } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** Email history for one contact or lead, with a compose button when a mailbox is connected. */
export function RecordEmails({
  contactId,
  leadId,
  email,
}: {
  contactId?: string;
  leadId?: string;
  email: string | null;
}) {
  const emails = useEmails({ contactId, leadId });
  const t = useT();
  const integrations = useIntegrations();
  const canSend = useCan('activities:write');
  const [compose, setCompose] = useState(false);
  const connected = integrations.data?.some((p) => p.connection?.status === 'CONNECTED');
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('Email')}</CardTitle>
        {canSend && email && connected && (
          <Button size="sm" variant="outline" onClick={() => setCompose(true)}>
            <Mail aria-hidden /> {t('Send email')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {emails.data?.length ? (
          <ul className="space-y-2">
            {emails.data.slice(0, 10).map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                {e.direction === 'INBOUND' ? (
                  <ArrowDownLeft className="mt-0.5 size-4 text-primary" aria-label={t('Received')} />
                ) : (
                  <ArrowUpRight className="mt-0.5 size-4 text-accent" aria-label={t('Sent')} />
                )}
                <span className="min-w-0 flex-1">
                  {e.conversationId ? (
                    <Link
                      href={`/app/communication?conversation=${e.conversationId}`}
                      className="block truncate text-primary underline underline-offset-2"
                    >
                      {e.subject}
                    </Link>
                  ) : (
                    <span className="block truncate">{e.subject}</span>
                  )}
                  {e.snippet && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">{e.snippet}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(e.sentAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('No email yet.')}
            {!connected && (
              <>
                {' '}
                <Link
                  href="/app/integrations"
                  className="text-primary underline underline-offset-2"
                >
                  {t('Connect a mailbox')}
                </Link>{' '}
                {t('to sync and send.')}
              </>
            )}
          </p>
        )}
      </CardContent>
      {email && (
        <ComposeDialog
          open={compose}
          onOpenChange={setCompose}
          to={email}
          contactId={contactId}
          leadId={leadId}
        />
      )}
    </Card>
  );
}
