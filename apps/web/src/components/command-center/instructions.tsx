'use client';

import { INSTRUCTION_KINDS, type InstructionRow, MESSAGE_PRIORITIES, type PersonRef } from '@dealflow/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { Check, CheckCheck, Pencil, Send } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { useInstructionMutations, useInstructions } from '@/lib/command-center';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { INSTRUCTION_STATUS_LABEL, INSTRUCTION_STATUS_TONE, MESSAGE_PRIORITY_LABEL } from './cc-labels';

/**
 * Manager instructions and remarks (ADR 0063, spec 15.2). Managers send them to the people below them; the recipient
 * acknowledges each instruction and marks it done, and the sender follows its progress.
 */

/** The `date` input value of a due date, in the browser's time zone. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Send an instruction or remark to someone reporting to the caller. With `editing`, the sender changes that open
 * instruction instead (its recipient stays the same and is told it changed).
 */
export function InstructionDialog({
  people,
  toUserId,
  company,
  editing,
  onClose,
}: {
  people: PersonRef[];
  toUserId?: string;
  company?: { id: string; name: string } | null;
  editing?: InstructionRow;
  onClose: () => void;
}) {
  const t = useT();
  const { send, update } = useInstructionMutations();
  const [to, setTo] = React.useState(editing?.to?.id ?? toUserId ?? '');
  const [kind, setKind] = React.useState<(typeof INSTRUCTION_KINDS)[number]>(editing?.kind ?? 'INSTRUCTION');
  const [message, setMessage] = React.useState(editing?.message ?? '');
  const [priority, setPriority] = React.useState<(typeof MESSAGE_PRIORITIES)[number]>(editing?.priority ?? 'NORMAL');
  const [due, setDue] = React.useState(toDateInput(editing?.dueAt ?? null));
  const choices = editing?.to ? [editing.to] : people;
  const pending = send.isPending || update.isPending;
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to) return setError(t('Choose who it is for.'));
    if (!message.trim()) return setError(t('Write the instruction.'));
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, input: { kind, message: message.trim(), priority, dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null } });
        onClose();
        return;
      }
      await send.mutateAsync({
        toUserId: to,
        kind,
        message: message.trim(),
        priority,
        companyId: company?.id ?? null,
        dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{editing ? t('Edit instruction') : t('Send an instruction')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {editing
            ? t('They are told it changed and see the new wording.')
            : company?.name
            ? t('About {company}. They are notified and can acknowledge it and mark it done.', { company: company.name })
            : t('They are notified and can acknowledge it and mark it done.')}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ins-to" label={t('To')}>
              <Select value={to} disabled={!!editing} onChange={(e) => setTo(e.target.value)}>
                {!editing && <option value="">{t('Choose a person')}</option>}
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ins-kind" label={t('Type')}>
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="INSTRUCTION">{t('Instruction')}</option>
                <option value="REMARK">{t('Remark')}</option>
              </Select>
            </Field>
          </div>
          <Field id="ins-message" label={t('Message')}>
            <Textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ins-priority" label={t('Priority')}>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
                {MESSAGE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(MESSAGE_PRIORITY_LABEL[p])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="ins-due" label={t('Due by (optional)')}>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {editing ? (
                pending ? t('Saving…') : t('Save changes')
              ) : (
                <>
                  <Send aria-hidden /> {pending ? t('Sending…') : t('Send')}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Meta({ r, sent }: { r: InstructionRow; sent: boolean }) {
  const t = useT();
  return (
    <p className="text-xs text-muted-foreground">
      {[
        sent ? r.to && t('To {name}', { name: r.to.name }) : r.from && t('From {name}', { name: r.from.designation ? `${r.from.name}, ${t.maybe(r.from.designation)}` : r.from.name }),
        r.kind === 'REMARK' ? t('Remark') : null,
        r.dueAt && t('Due {date}', { date: formatDate(r.dueAt) }),
        relativeTime(r.createdAt),
        r.editedAt && t('(edited)'),
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}

/** Instructions sent to the caller, to acknowledge and complete (executive dashboard). */
export function ReceivedInstructions() {
  const t = useT();
  const params = useSearchParams();
  const focus = params.get('instruction');
  const [all, setAll] = React.useState(false);
  const q = useInstructions('received', all ? 'all' : 'open');
  const { progress } = useInstructionMutations();
  const [finishing, setFinishing] = React.useState<InstructionRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const act = async (id: string, action: 'ACKNOWLEDGE' | 'REOPEN') => {
    setError(null);
    try {
      await progress.mutateAsync({ id, input: { action } });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save.'));
    }
  };
  return (
    <Card className="p-3">
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
          {all ? t('Show open only') : t('Show done too')}
        </Button>
      </div>
      {q.isPending ? (
        <Skeleton className="h-20" />
      ) : !q.data?.length ? (
        <p className="p-2 text-sm text-muted-foreground">{t('No instructions for you right now.')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="instructions-received">
          {q.data.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-start justify-between gap-3 px-2 py-3 ${focus === r.id ? 'rounded-md bg-primary/5' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-sm font-medium">{r.message}</p>
                {r.company && (
                  <Link href={`/app/companies/${r.company.id}`} className="text-xs text-primary hover:underline">
                    {[r.company.leadNumber, r.company.name].filter(Boolean).join(' ')}
                  </Link>
                )}
                <Meta r={r} sent={false} />
                {r.completionNote && <p className="mt-1 text-xs">{r.completionNote}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {(r.priority === 'HIGH' || r.priority === 'URGENT') && (
                  <Badge tone={r.priority === 'URGENT' ? 'critical' : 'warning'}>{t(MESSAGE_PRIORITY_LABEL[r.priority])}</Badge>
                )}
                <Badge tone={INSTRUCTION_STATUS_TONE[r.status]}>{t(INSTRUCTION_STATUS_LABEL[r.status])}</Badge>
                {r.canProgress && r.status === 'OPEN' && (
                  <Button size="sm" variant="outline" onClick={() => act(r.id, 'ACKNOWLEDGE')} disabled={progress.isPending}>
                    <Check aria-hidden /> {t('Acknowledge')}
                  </Button>
                )}
                {r.canProgress && r.status !== 'DONE' && (
                  <Button size="sm" onClick={() => setFinishing(r)}>
                    <CheckCheck aria-hidden /> {t('Mark done')}
                  </Button>
                )}
                {r.canProgress && r.status === 'DONE' && (
                  <Button size="sm" variant="ghost" onClick={() => act(r.id, 'REOPEN')} disabled={progress.isPending}>
                    {t('Reopen')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
      {finishing && <DoneDialog row={finishing} onClose={() => setFinishing(null)} />}
    </Card>
  );
}

function DoneDialog({ row, onClose }: { row: InstructionRow; onClose: () => void }) {
  const t = useT();
  const { progress } = useInstructionMutations();
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await progress.mutateAsync({ id: row.id, input: { action: 'DONE', note: note.trim() || null } });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('Mark the instruction done')}</DialogTitle>
        <DialogDescription className="mb-4 line-clamp-3 text-sm text-muted-foreground">{row.message}</DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="ins-note" label={t('What was done (optional)')} error={error ?? undefined}>
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={progress.isPending}>
              {progress.isPending ? t('Saving…') : t('Mark done')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Instructions the caller sent, with where each one stands (manager dashboard). */
export function SentInstructions({ onSend }: { onSend: (() => void) | null }) {
  const t = useT();
  const [all, setAll] = React.useState(false);
  const q = useInstructions('sent', all ? 'all' : 'open');
  const { cancel } = useInstructionMutations();
  const [editing, setEditing] = React.useState<InstructionRow | null>(null);
  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
          {all ? t('Show open only') : t('Show done too')}
        </Button>
        {onSend && (
          <Button size="sm" variant="outline" onClick={onSend}>
            <Send aria-hidden /> {t('Send an instruction')}
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-20" />
      ) : !q.data?.length ? (
        <p className="p-2 text-sm text-muted-foreground">{t('No open instructions. Instructions you send appear here until they are done.')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="instructions-sent">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line text-sm font-medium">{r.message}</p>
                {r.company && (
                  <Link href={`/app/companies/${r.company.id}`} className="text-xs text-primary hover:underline">
                    {[r.company.leadNumber, r.company.name].filter(Boolean).join(' ')}
                  </Link>
                )}
                <Meta r={r} sent />
                {r.completionNote && <p className="mt-1 text-xs">{t('Their note: {note}', { note: r.completionNote })}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={INSTRUCTION_STATUS_TONE[r.status]}>{t(INSTRUCTION_STATUS_LABEL[r.status])}</Badge>
                {r.canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t('Edit “{subject}”', { subject: r.message.slice(0, 60) })}>
                    <Pencil aria-hidden />
                  </Button>
                )}
                {r.canCancel && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)} disabled={cancel.isPending}>
                    {t('Withdraw')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <InstructionDialog people={[]} editing={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
