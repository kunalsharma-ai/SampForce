'use client';

import { INTERACTION_KINDS, type InteractionKind, type InteractionRow, interactionInputSchema } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { CalendarClock, FileSignature, Handshake, Linkedin, Mail, MailOpen, MessageCircle, MessagesSquare, Paperclip, Phone, PhoneIncoming, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { InfoTip } from '@/components/info-tip';
import { fromLocalInput, toLocalInput, useInteractions, useLogInteraction, useRemoveInteraction } from '@/lib/company-work';
import { useCompanyFiles } from '@/lib/company-leads';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useCompanyAction } from './company-actions';
import { formatDateTime } from './follow-ups';
import { Select, Textarea } from './select';
import { INTERACTION_LABEL } from './work-labels';

const KIND_ICON: Record<InteractionKind, typeof Mail> = {
  EMAIL_SENT: Mail,
  EMAIL_RECEIVED: MailOpen,
  CALL_OUTGOING: Phone,
  CALL_INCOMING: PhoneIncoming,
  MEETING: Users,
  LINKEDIN: Linkedin,
  WHATSAPP: MessageCircle,
  RFQ_RECEIVED: FileSignature,
  RFQ_SUBMITTED: FileSignature,
  NEGOTIATION: Handshake,
  OTHER: MessagesSquare,
};

/** Company-wise communication: logged interactions and synced emails, filterable by kind and employee. */
export function CompanyInteractions({ company, employees }: { company: { id: string; name: string; restricted?: boolean }; employees: { id: string; name: string }[] }) {
  const t = useT();
  const canWrite = useCan('activities:write') && !company.restricted;
  const [kind, setKind] = React.useState<InteractionKind | ''>('');
  const [contactId, setContactId] = React.useState('');
  const list = useInteractions(company.id, { kind, contactId });
  const remove = useRemoveInteraction();
  const [logging, setLogging] = React.useState(false);
  useCompanyAction('logInteraction', canWrite ? () => setLogging(true) : null);
  return (
    <Card id="company-interactions">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {t('Interactions')}
          <InfoTip topic="crm.interactions" />
        </CardTitle>
        {canWrite && (
          <Button size="sm" onClick={() => setLogging(true)}>
            <Plus aria-hidden /> {t('Log interaction')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select aria-label={t('Interaction type')} className="h-9 w-auto" value={kind} onChange={(e) => setKind(e.target.value as InteractionKind | '')}>
            <option value="">{t('All interaction types')}</option>
            {INTERACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(INTERACTION_LABEL[k])}
              </option>
            ))}
          </Select>
          <Select aria-label={t('Employee')} className="h-9 w-auto" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">{t('All employees')}</option>
            {employees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {list.isPending ? (
          <Skeleton className="h-24" />
        ) : !list.data?.length ? (
          <p className="text-sm text-muted-foreground">{kind || contactId ? t('No interactions match these filters.') : t('No interactions logged with this company yet.')}</p>
        ) : (
          <ol className="relative space-y-3 border-s border-border ps-5" aria-label={t('Interactions')}>
            {list.data.map((i) => (
              <InteractionItem key={`${i.source}-${i.id}`} i={i} canDelete={canWrite && i.source === 'LOGGED'} onDelete={() => window.confirm(t('Delete “{subject}”?', { subject: i.subject })) && remove.mutate(i.id)} />
            ))}
          </ol>
        )}
      </CardContent>
      <LogInteractionDialog company={company} employees={employees} open={logging} onOpenChange={setLogging} />
    </Card>
  );
}

function InteractionItem({ i, canDelete, onDelete }: { i: InteractionRow; canDelete: boolean; onDelete: () => void }) {
  const t = useT();
  const Icon = KIND_ICON[i.kind];
  return (
    <li className="relative text-sm">
      <span className="absolute -start-[1.95rem] top-0 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-primary">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{i.subject}</span>
            <Badge tone="primary">{t(INTERACTION_LABEL[i.kind])}</Badge>
            {i.source === 'SYNCED' ? (
              <Badge tone="success">
                <RefreshCw aria-hidden className="size-3" /> {t('Synced from mailbox')}
              </Badge>
            ) : (
              <Badge tone="neutral">{t('Logged by hand')}</Badge>
            )}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span title={formatDateTime(i.occurredAt)}>{formatDateTime(i.occurredAt)} · {relativeTime(i.occurredAt)}</span>
            {i.contact && (
              <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/contacts/${i.contact.id}`}>
                {i.contact.name}
              </Link>
            )}
            {i.createdBy && <span>{t('by {name}', { name: i.createdBy.name })}</span>}
            {(i.sender || i.recipient) && <span>{[i.sender, i.recipient].filter(Boolean).join(' → ')}</span>}
          </p>
          {i.outcome && <p>{t('Outcome: {text}', { text: i.outcome })}</p>}
          {i.remarks && <p className="whitespace-pre-line text-muted-foreground">{i.remarks}</p>}
          {(i.nextAction || i.followUpAt) && (
            <p className="inline-flex items-center gap-1 text-xs">
              <CalendarClock aria-hidden className="size-3.5" />
              {[i.nextAction, i.followUpAt && formatDateTime(i.followUpAt)].filter(Boolean).join(' · ')}
            </p>
          )}
          {(i.file || i.rfq) && (
            <p className="flex flex-wrap gap-3 text-xs">
              {i.file && (
                <a className="inline-flex min-h-6 items-center gap-1 text-primary hover:underline" href={`/api/v1/company-files/${i.file.id}/download`}>
                  <Paperclip aria-hidden className="size-3.5" /> {i.file.name}
                </a>
              )}
              {i.rfq && (
                <Link className="inline-flex min-h-6 items-center text-primary hover:underline" href={`/app/rfqs?open=${i.rfq.id}`}>
                  {i.rfq.number}
                </Link>
              )}
            </p>
          )}
        </div>
        {canDelete && (
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={t('Delete “{subject}”', { subject: i.subject })}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}

/** Logs an email, call, meeting, message, RFQ step or negotiation, and optionally schedules the follow-up. */
export function LogInteractionDialog({ company, employees, open, onOpenChange }: { company: { id: string; name: string }; employees: { id: string; name: string }[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const log = useLogInteraction();
  const files = useCompanyFiles(company.id);
  const blank = () => ({ kind: 'EMAIL_SENT' as InteractionKind, contactId: '', subject: '', occurredAt: toLocalInput(new Date()), sender: '', recipient: '', outcome: '', remarks: '', nextAction: '', followUpAt: '', fileId: '' });
  const [v, setV] = React.useState(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setV(blank());
      setErrors({});
      setFormError(null);
    }
  }, [open]);
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      companyId: company.id,
      contactId: v.contactId || null,
      kind: v.kind,
      subject: v.subject,
      occurredAt: fromLocalInput(v.occurredAt) ?? undefined,
      sender: v.sender || null,
      recipient: v.recipient || null,
      outcome: v.outcome || null,
      remarks: v.remarks || null,
      nextAction: v.nextAction || null,
      followUpAt: fromLocalInput(v.followUpAt),
      fileId: v.fileId || null,
    };
    const parsed = interactionInputSchema.safeParse(body);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      return;
    }
    try {
      await log.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5%] max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('Log interaction')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('With {company}. Emails you log here are marked as logged by hand, apart from synced ones.', { company: company.name })}</DialogDescription>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field id="ix-kind" label={t('Interaction type')}>
            <Select value={v.kind} onChange={(e) => set({ kind: e.target.value as InteractionKind })}>
              {INTERACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(INTERACTION_LABEL[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ix-contact" label={t('Employee')}>
            <Select value={v.contactId} onChange={(e) => set({ contactId: e.target.value })}>
              <option value="">{t('Whole company')}</option>
              {employees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="ix-subject" label={t('Subject *')} error={errors.subject}>
              <Input value={v.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={200} />
            </Field>
          </div>
          <Field id="ix-when" label={t('Date and time')}>
            <Input type="datetime-local" value={v.occurredAt} onChange={(e) => set({ occurredAt: e.target.value })} />
          </Field>
          <Field id="ix-outcome" label={t('Outcome')}>
            <Input value={v.outcome} onChange={(e) => set({ outcome: e.target.value })} maxLength={500} />
          </Field>
          <Field id="ix-sender" label={t('Sender')}>
            <Input value={v.sender} onChange={(e) => set({ sender: e.target.value })} maxLength={200} />
          </Field>
          <Field id="ix-recipient" label={t('Recipient')}>
            <Input value={v.recipient} onChange={(e) => set({ recipient: e.target.value })} maxLength={200} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="ix-remarks" label={t('Remarks')}>
              <Textarea rows={3} value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} />
            </Field>
          </div>
          <Field id="ix-next" label={t('Next action')}>
            <Input value={v.nextAction} onChange={(e) => set({ nextAction: e.target.value })} maxLength={500} />
          </Field>
          <Field id="ix-follow" label={t('Follow-up date')} hint={t('Set it to schedule the follow-up too.')}>
            <Input type="datetime-local" value={v.followUpAt} onChange={(e) => set({ followUpAt: e.target.value })} />
          </Field>
          {!!files.data?.length && (
            <div className="sm:col-span-2">
              <Field id="ix-file" label={t('Attachment')} hint={t('One of the company’s files. Upload new files in Attachments.')}>
                <Select value={v.fileId} onChange={(e) => set({ fileId: e.target.value })}>
                  <option value="">{t('None')}</option>
                  {files.data.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {formError && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={log.isPending}>
              {log.isPending ? t('Saving…') : t('Log interaction')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
