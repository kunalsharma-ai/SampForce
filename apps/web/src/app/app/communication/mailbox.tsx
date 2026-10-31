'use client';

import { Badge, Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { type EmailRow, sendEmailSchema } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, PenSquare, Plug } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
import { useEmails, useIntegrations } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

export function Mailbox() {
  const integrations = useIntegrations();
  const emails = useEmails();
  const canSend = useCan('activities:write');
  const [open, setOpen] = useState<EmailRow | null>(null);
  const [compose, setCompose] = useState(false);
  const connected = integrations.data?.filter((p) => p.connection?.status === 'CONNECTED') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {connected.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Connected: {connected.map((c) => `${c.connection!.accountEmail} (${c.provider === 'GOOGLE' ? 'Google' : 'Microsoft'})`).join(', ')}
          </p>
        ) : (
          !integrations.isPending && (
            <p className="text-sm text-muted-foreground">
              No mailbox connected.{' '}
              <Link href="/app/integrations" className="text-primary underline underline-offset-2">
                Connect Gmail or Microsoft 365
              </Link>{' '}
              to sync and send email.
            </p>
          )
        )}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/integrations">
              <Plug aria-hidden /> Mailbox settings
            </Link>
          </Button>
          {canSend && (
            <Button size="sm" onClick={() => setCompose(true)} disabled={connected.length === 0}>
              <PenSquare aria-hidden /> Compose
            </Button>
          )}
        </div>
      </div>

      {emails.isPending ? (
        <Skeleton className="h-48" />
      ) : emails.data?.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No email yet. Messages appear here after a connected mailbox syncs, or when you send from DealFlow.</CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {emails.data?.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setOpen(e)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50">
                  {e.direction === 'INBOUND' ? <ArrowDownLeft className="mt-0.5 size-4 text-primary" aria-label="Received" /> : <ArrowUpRight className="mt-0.5 size-4 text-accent" aria-label="Sent" />}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{e.subject}</span>
                      <span className="text-xs text-muted-foreground">{e.direction === 'INBOUND' ? `from ${e.from}` : `to ${e.to.join(', ')}`}</span>
                    </span>
                    {e.snippet && <span className="line-clamp-1 text-xs text-muted-foreground">{e.snippet}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.sentAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <EmailDialog email={open} onClose={() => setOpen(null)} />
      <ComposeDialog open={compose} onOpenChange={setCompose} />
    </div>
  );
}

function EmailDialog({ email, onClose }: { email: EmailRow | null; onClose: () => void }) {
  const detail = useQuery({ enabled: !!email, queryKey: ['emails', 'detail', email?.id], queryFn: () => api<EmailRow & { bodyText: string | null }>(`/emails/${email!.id}`) });
  return (
    <Dialog open={!!email} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-6">
        <DialogTitle className="pr-8 text-lg font-semibold">{email?.subject}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          {email && `${email.from} → ${email.to.join(', ')} · ${new Date(email.sentAt).toLocaleString()}`}
        </DialogDescription>
        <div className="mt-2 flex gap-2">
          {email?.contactId && (
            <Link className="text-xs text-primary hover:underline" href={`/app/contacts/${email.contactId}`}>
              Open contact
            </Link>
          )}
          {email?.leadId && (
            <Link className="text-xs text-primary hover:underline" href={`/app/leads/${email.leadId}`}>
              Open lead
            </Link>
          )}
          {email && <Badge>{email.provider === 'GOOGLE' ? 'Gmail' : 'Outlook'}</Badge>}
        </div>
        {detail.isPending ? <Skeleton className="mt-4 h-32" /> : <pre className="mt-4 whitespace-pre-wrap font-sans text-sm">{detail.data?.bodyText ?? detail.data?.snippet ?? 'No text body.'}</pre>}
      </DialogContent>
    </Dialog>
  );
}

export function ComposeDialog({ open, onOpenChange, to: initialTo = '', contactId, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; to?: string; contactId?: string; leadId?: string }) {
  const qc = useQueryClient();
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => api<EmailRow>('/emails/send', { method: 'POST', json: { to, subject, body, contactId, leadId } }),
    onSuccess: async () => {
      setSubject('');
      setBody('');
      onOpenChange(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ['emails'] }), qc.invalidateQueries({ queryKey: ['activities'] })]);
    },
  });
  const submit = () => {
    const r = sendEmailSchema.safeParse({ to, subject, body });
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    send.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-6">
        <DialogTitle className="text-lg font-semibold">New email</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Sent from your connected mailbox and logged on the matching contact or lead.</DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="mail-to" label="To" error={errors.to}>
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
          </Field>
          <Field id="mail-subject" label="Subject" error={errors.subject}>
            <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field id="mail-body" label="Message" error={errors.body}>
            <Textarea className="min-h-40" value={body} maxLength={20_000} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {send.error && (
            <p role="alert" className="text-sm text-critical">
              {send.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending}>
              Send
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
