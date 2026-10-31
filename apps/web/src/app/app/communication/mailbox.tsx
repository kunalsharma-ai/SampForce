'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { type EmailRow, type EmailTemplateRow, sendEmailSchema, type TemplatePreview } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EmailAssist } from '@/components/ai/email-assist';
import { Select, Textarea } from '@/components/crm/select';
import { api } from '@/lib/api';
import { useTemplates } from '@/lib/sequences';
import { useCan } from '@/lib/session';

/** The compose box used by the inbox and record pages. Sends from the person's own connected mailbox. */
export function ComposeDialog({
  open,
  onOpenChange,
  to: initialTo = '',
  contactId,
  leadId,
  subject: initialSubject = '',
  body: initialBody = '',
  replyTo,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  to?: string;
  contactId?: string;
  leadId?: string;
  subject?: string;
  body?: string;
  /** The received email this answers, so the assistant can read it. */
  replyTo?: string;
  /** Keep the reply in this inbox conversation (your own mailbox only). */
  conversationId?: string;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () =>
      api<EmailRow>('/emails/send', {
        method: 'POST',
        json: { to, subject, body, contactId, leadId, conversationId },
      }),
    onSuccess: async () => {
      setSubject('');
      setBody('');
      onOpenChange(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['emails'] }),
        qc.invalidateQueries({ queryKey: ['activities'] }),
        qc.invalidateQueries({ queryKey: ['inbox'] }),
      ]);
    },
  });
  const canTemplates = useCan('sequences:read');
  const templates = useTemplates({}, open && canTemplates);
  const [missing, setMissing] = useState<string[]>([]);
  const insert = useMutation({
    mutationFn: (t: EmailTemplateRow) =>
      api<TemplatePreview>('/email-templates/preview', {
        method: 'POST',
        json: {
          subject: t.subject,
          body: t.body,
          contactId,
          leadId: contactId ? undefined : leadId,
        },
      }),
    onSuccess: (p) => {
      if (!subject.trim() || !replyTo) setSubject(p.subject);
      setBody(p.body);
      setMissing(p.missing);
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
        <DialogDescription className="text-sm text-muted-foreground">
          Sent from your connected mailbox and logged on the matching contact or lead.
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id="mail-to" label="To" error={errors.to}>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field id="mail-subject" label="Subject" error={errors.subject}>
            <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          {canTemplates && (templates.data?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <label htmlFor="mail-template" className="text-sm font-medium">
                Insert a template
              </label>
              <Select
                id="mail-template"
                value=""
                disabled={insert.isPending}
                onChange={(e) => {
                  const t = templates.data?.find((x) => x.id === e.target.value);
                  if (t) insert.mutate(t);
                }}
              >
                <option value="">Choose a template</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.category ? `${t.category}: ` : ''}
                    {t.name}
                  </option>
                ))}
              </Select>
              {missing.length > 0 && (
                <p className="text-xs text-warning">
                  No value for {missing.join(', ')}. Fill these in before sending.
                </p>
              )}
              {insert.error && <p className="text-xs text-critical">{insert.error.message}</p>}
            </div>
          )}
          <Field id="mail-body" label="Message" error={errors.body}>
            <Textarea
              className="min-h-40"
              value={body}
              maxLength={20_000}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <EmailAssist
            subject={subject}
            body={body}
            target={{ contactId, leadId, emailId: replyTo }}
            onApply={(v) => {
              if (v.subject !== undefined) setSubject(v.subject);
              if (v.body !== undefined) setBody(v.body);
            }}
          />
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
