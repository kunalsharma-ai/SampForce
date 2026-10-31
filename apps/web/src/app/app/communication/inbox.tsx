'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Skeleton,
} from '@dealflow/ui';
import {
  EMAIL_INTENT_LABELS,
  type EmailIntent,
  INBOX_CATEGORIES,
  INBOX_CATEGORY_LABELS,
  INBOX_STATUS_LABELS,
  INBOX_STATUSES,
  type InboxCategory,
  type InboxMessage,
  type InboxStatus,
  type InboxThread,
  type InboxThreadRow,
  type InboxUpdate,
} from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  History,
  MessageSquareText,
  PenSquare,
  Plug,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmailReading, INTENT_TONE } from '@/components/ai/email-reading';
import { RecordPicker } from '@/components/crm/record-picker';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import {
  type InboxFilters,
  useInboxThread,
  useInboxThreads,
  useIntegrations,
  useSyncLogs,
} from '@/lib/automation';
import { useMembers } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';
import { ComposeDialog } from './mailbox';

const STATUS_TONE: Record<InboxStatus, 'primary' | 'warning' | 'neutral'> = {
  OPEN: 'primary',
  WAITING: 'warning',
  CLOSED: 'neutral',
};

/**
 * Enhancement feature 8: one inbox for the team. Conversations come from connected mailboxes and DealFlow sends;
 * each can be assigned, categorised, linked to a deal and discussed in internal notes.
 */
export function Inbox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('conversation');
  const integrations = useIntegrations();
  const canSend = useCan('activities:write');
  const [filters, setFilters] = useState<InboxFilters>({ status: 'ACTIVE' });
  const [search, setSearch] = useState('');
  const [compose, setCompose] = useState(false);
  const [logs, setLogs] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search.trim() || undefined })), 250);
    return () => clearTimeout(t);
  }, [search]);
  const threads = useInboxThreads(filters);
  const connected = integrations.data?.filter((p) => p.connection?.status === 'CONNECTED') ?? [];
  const select = (id: string | null) =>
    router.replace(id ? `${pathname}?conversation=${id}` : pathname, { scroll: false });
  const set = (patch: InboxFilters) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {connected.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Connected:{' '}
            {connected
              .map(
                (c) =>
                  `${c.connection!.accountEmail} (${c.provider === 'GOOGLE' ? 'Google' : 'Microsoft'})`,
              )
              .join(', ')}
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
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setLogs(true)}>
            <History aria-hidden /> Sync log
          </Button>
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

      <div
        className="flex flex-wrap items-end gap-2"
        role="search"
        aria-label="Filter conversations"
      >
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search conversations"
            placeholder="Search subject, people or message text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(e) => set({ status: e.target.value || undefined })}
          className="h-9 w-auto"
        >
          <option value="ACTIVE">Open or waiting</option>
          <option value="">Any status</option>
          {INBOX_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INBOX_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Category"
          value={filters.category ?? ''}
          onChange={(e) => set({ category: e.target.value || undefined })}
          className="h-9 w-auto"
        >
          <option value="">Any category</option>
          {INBOX_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {INBOX_CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Assigned to"
          value={filters.assigned ?? ''}
          onChange={(e) => set({ assigned: e.target.value || undefined })}
          className="h-9 w-auto"
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </Select>
        <Select
          aria-label="Mailbox"
          value={filters.mine ?? ''}
          onChange={(e) => set({ mine: e.target.value || undefined })}
          className="h-9 w-auto"
        >
          <option value="">All mailboxes</option>
          <option value="true">My mailboxes</option>
        </Select>
        <Select
          aria-label="Linked records"
          value={filters.linked ?? ''}
          onChange={(e) => set({ linked: e.target.value || undefined })}
          className="h-9 w-auto"
        >
          <option value="">Any link</option>
          <option value="deal">Linked to a deal</option>
          <option value="none">Not linked to a record</option>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={selected ? 'hidden lg:block' : ''}>
          {threads.isPending ? (
            <Skeleton className="h-64" />
          ) : threads.error ? (
            <ErrorText error={threads.error} />
          ) : threads.data.items.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                {filters.q ||
                filters.category ||
                filters.assigned ||
                filters.mine ||
                filters.linked ||
                (filters.status && filters.status !== 'ACTIVE')
                  ? 'No conversations match these filters.'
                  : 'No email yet. Conversations appear here after a connected mailbox syncs, or when you send from DealFlow.'}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-border" aria-label="Conversations">
                {threads.data.items.map((t) => (
                  <ThreadItem
                    key={t.id}
                    t={t}
                    active={t.id === selected}
                    onOpen={() => select(t.id)}
                  />
                ))}
              </ul>
              {threads.data.nextCursor && (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  Showing the 50 most recent. Narrow the filters or search to find older
                  conversations.
                </p>
              )}
            </Card>
          )}
        </div>
        <div className={selected ? '' : 'hidden lg:block'}>
          {selected ? (
            <ThreadView key={selected} id={selected} onBack={() => select(null)} />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Choose a conversation to read it, reply, assign it or add a note.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <ComposeDialog open={compose} onOpenChange={setCompose} />
      <SyncLogDialog open={logs} onOpenChange={setLogs} />
    </div>
  );
}

function ThreadItem({
  t,
  active,
  onOpen,
}: {
  t: InboxThreadRow;
  active: boolean;
  onOpen: () => void;
}) {
  const who = t.contact?.name ?? t.lead?.name ?? t.preview?.from ?? '';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active || undefined}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 ${active ? 'bg-muted/60' : ''}`}
      >
        {t.lastDirection === 'INBOUND' ? (
          <ArrowDownLeft
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-label="Last message received"
          />
        ) : (
          <ArrowUpRight
            className="mt-0.5 size-4 shrink-0 text-accent"
            aria-label="Last message sent"
          />
        )}
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{t.subject}</span>
            {t.messageCount > 1 && (
              <span className="text-xs text-muted-foreground">({t.messageCount})</span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {who}
            {t.contact?.companyName ? ` · ${t.contact.companyName}` : ''}
            {t.preview?.snippet ? ` · ${t.preview.snippet}` : ''}
          </span>
          <span className="flex flex-wrap gap-1 pt-0.5">
            <Badge tone={STATUS_TONE[t.status]}>{INBOX_STATUS_LABELS[t.status]}</Badge>
            {t.category && <Badge>{INBOX_CATEGORY_LABELS[t.category]}</Badge>}
            {t.aiIntent && t.aiIntent in EMAIL_INTENT_LABELS && (
              <Badge
                tone={INTENT_TONE[t.aiIntent as EmailIntent]}
                title="The AI's reading of the latest received email"
              >
                AI: {EMAIL_INTENT_LABELS[t.aiIntent as EmailIntent]}
              </Badge>
            )}
            {t.assignedTo && <Badge tone="neutral">{t.assignedTo.name}</Badge>}
            {t.noteCount > 0 && (
              <Badge tone="neutral">
                <MessageSquareText className="size-3" aria-hidden /> {t.noteCount}{' '}
                {t.noteCount === 1 ? 'note' : 'notes'}
              </Badge>
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {relativeTime(t.lastMessageAt)}
        </span>
      </button>
    </li>
  );
}

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const thread = useInboxThread(id);
  const canWrite = useCan('activities:write');
  const session = useSession();
  const members = useMembers();
  const [reply, setReply] = useState<{ subject: string; body: string } | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['inbox'] });
  const update = useMutation({
    mutationFn: (patch: InboxUpdate) =>
      api<InboxThread>(`/inbox/threads/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: (t) => {
      qc.setQueryData(['inbox', 'detail', id], t);
      return qc.invalidateQueries({ queryKey: ['inbox', 'list'] });
    },
  });
  const addNote = useMutation({
    mutationFn: () => api(`/inbox/threads/${id}/notes`, { method: 'POST', json: { body: note } }),
    onSuccess: async () => {
      setNote('');
      await refresh();
    },
  });

  if (thread.isPending) return <Skeleton className="h-96" />;
  if (thread.error) return <ErrorText error={thread.error} />;
  const t = thread.data;
  const lastInbound = [...t.messages].reverse().find((m) => m.direction === 'INBOUND');
  const replyTo = lastInbound?.from ?? t.messages.at(-1)?.to[0] ?? '';
  const reSubject = t.subject.startsWith('Re:') ? t.subject : `Re: ${t.subject}`;
  const me = session.data?.user.id;
  const people = members.data?.filter((m) => m.status === 'ACTIVE') ?? [];

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-4" aria-hidden /> All conversations
        </button>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t.subject}</h2>
          <p className="text-xs text-muted-foreground">
            In {t.mailbox.accountEmail} ({t.mailbox.provider === 'GOOGLE' ? 'Gmail' : 'Outlook'}) ·{' '}
            {t.messageCount} {t.messageCount === 1 ? 'message' : 'messages'}
          </p>
          <p className="flex flex-wrap gap-3 text-sm">
            {t.contact && (
              <Link
                className="text-primary underline underline-offset-2"
                href={`/app/contacts/${t.contact.id}`}
              >
                {t.contact.name}
              </Link>
            )}
            {t.contact?.companyId && (
              <Link
                className="text-primary underline underline-offset-2"
                href={`/app/companies/${t.contact.companyId}`}
              >
                {t.contact.companyName}
              </Link>
            )}
            {t.lead && (
              <Link
                className="text-primary underline underline-offset-2"
                href={`/app/leads/${t.lead.id}`}
              >
                Lead: {t.lead.name}
              </Link>
            )}
            {t.deal && (
              <Link
                className="text-primary underline underline-offset-2"
                href={`/app/deals/${t.deal.id}`}
              >
                Deal: {t.deal.name}
              </Link>
            )}
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1 text-xs font-medium">
            <label htmlFor={`status-${id}`}>Conversation status</label>
            <Select
              id={`status-${id}`}
              value={t.status}
              disabled={!canWrite || update.isPending}
              onChange={(e) => update.mutate({ status: e.target.value as InboxStatus })}
              className="h-9 w-full"
            >
              {INBOX_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {INBOX_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 text-xs font-medium">
            <label htmlFor={`category-${id}`}>Conversation category</label>
            <Select
              id={`category-${id}`}
              value={t.category ?? ''}
              disabled={!canWrite || update.isPending}
              onChange={(e) =>
                update.mutate({ category: (e.target.value || null) as InboxCategory | null })
              }
              className="h-9 w-full"
            >
              <option value="">None</option>
              {INBOX_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {INBOX_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1 text-xs font-medium">
            <label htmlFor={`assignee-${id}`}>Assign conversation to</label>
            <Select
              id={`assignee-${id}`}
              value={t.assignedTo?.id ?? ''}
              disabled={!canWrite || update.isPending}
              onChange={(e) => update.mutate({ assignedToId: e.target.value || null })}
              className="h-9 w-full"
            >
              <option value="">Nobody</option>
              {me && !people.some((p) => p.userId === me) && <option value={me}>Me</option>}
              {t.assignedTo &&
                !people.some((p) => p.userId === t.assignedTo!.id) &&
                t.assignedTo.id !== me && (
                  <option value={t.assignedTo.id}>{t.assignedTo.name}</option>
                )}
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.userId === me ? `${p.name} (me)` : p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {canWrite && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium" htmlFor={`deal-${id}`}>
                Linked deal
              </label>
              <RecordPicker
                id={`deal-${id}`}
                entity="deals"
                value={t.deal}
                onChange={(v) => update.mutate({ dealId: v?.id ?? null })}
                placeholder="Search deals"
              />
            </div>
            {!t.contact && !t.lead && (
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor={`contact-${id}`}>
                  Linked contact
                </label>
                <RecordPicker
                  id={`contact-${id}`}
                  entity="contacts"
                  value={null}
                  onChange={(v) => v && update.mutate({ contactId: v.id })}
                  placeholder="Search contacts"
                />
              </div>
            )}
          </div>
        )}
        <ErrorText error={update.error} />

        <ol className="space-y-3" aria-label="Messages">
          {t.messages.map((m) => (
            <MessageItem key={m.id} m={m} />
          ))}
        </ol>

        {lastInbound && (
          <EmailReading
            emailId={lastInbound.id}
            from={lastInbound.from}
            onReply={(d) => setReply(d)}
          />
        )}
        {canWrite && replyTo && (
          <div className="space-y-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setReply({ subject: reSubject, body: '' })}
            >
              Reply
            </Button>
            {!t.canReplyInThread && (
              <p className="text-xs text-muted-foreground">
                This conversation is in {t.mailbox.accountEmail}. A reply goes from your own mailbox
                and starts a new conversation.
              </p>
            )}
          </div>
        )}

        <section className="space-y-2 border-t border-border pt-4" aria-labelledby={`notes-${id}`}>
          <h3 id={`notes-${id}`} className="text-sm font-semibold">
            Internal notes
          </h3>
          <p className="text-xs text-muted-foreground">
            Only your team sees these. They are never sent.
          </p>
          {t.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {t.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-muted/40 p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="pt-1 text-xs text-muted-foreground">
                    {n.author?.name ?? 'Former member'} · {relativeTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNote.mutate();
              }}
            >
              <Textarea
                aria-label="New internal note"
                value={note}
                maxLength={5000}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add context for your team"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={addNote.isPending || !note.trim()}
              >
                Add note
              </Button>
              <ErrorText error={addNote.error} />
            </form>
          )}
        </section>
      </CardContent>
      {reply && (
        <ComposeDialog
          key={reply.subject + reply.body}
          open
          onOpenChange={(o) => {
            if (!o) {
              setReply(null);
              void refresh();
            }
          }}
          to={replyTo}
          subject={reply.subject}
          body={reply.body}
          contactId={t.contact?.id}
          leadId={t.contact ? undefined : t.lead?.id}
          replyTo={lastInbound?.id}
          conversationId={t.canReplyInThread ? t.id : undefined}
        />
      )}
    </Card>
  );
}

function MessageItem({ m }: { m: InboxMessage }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="rounded-lg border border-border p-3">
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline gap-x-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {m.direction === 'INBOUND' ? (
          <ArrowDownLeft className="size-4 self-center text-primary" aria-label="Received" />
        ) : (
          <ArrowUpRight className="size-4 self-center text-accent" aria-label="Sent" />
        )}
        <span className="text-sm font-medium">{m.from}</span>
        <span className="text-xs text-muted-foreground">to {m.to.join(', ')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(m.sentAt).toLocaleString()}
        </span>
      </button>
      {open && (
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">
          {m.bodyText ?? m.snippet ?? 'No text body.'}
        </pre>
      )}
      {m.direction === 'OUTBOUND' && <Tracking m={m} />}
    </li>
  );
}

/** What DealFlow observed for a sent message, worded so estimates are not read as facts. */
function Tracking({ m }: { m: InboxMessage }) {
  const t = m.tracking;
  if (!t)
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Sent. Gmail and Outlook do not report delivery, and opens are tracked only for sequence
        emails.
      </p>
    );
  const parts: string[] = [];
  if (t.bouncedAt) parts.push(`Bounced ${relativeTime(t.bouncedAt)}`);
  if (t.repliedAt) parts.push(`Replied ${relativeTime(t.repliedAt)}`);
  if (t.clickCount) parts.push(`${t.clickCount} ${t.clickCount === 1 ? 'click' : 'clicks'}`);
  if (t.openCount)
    parts.push(`opened about ${t.openCount} ${t.openCount === 1 ? 'time' : 'times'} (estimate)`);
  return (
    <p className="mt-2 text-xs text-muted-foreground" aria-label="Tracking">
      Sequence email: {parts.length ? parts.join(' · ') : 'no opens, clicks or replies seen yet'}.
      Opens and clicks can come from security scanners.
    </p>
  );
}

function SyncLogDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const logs = useSyncLogs(open);
  const integrations = useIntegrations();
  const canSync = useCan('activities:write');
  const mine =
    integrations.data?.filter((p) => p.connection && p.connection.status !== 'DISCONNECTED') ?? [];
  const sync = useMutation({
    mutationFn: (provider: string) =>
      api(`/integrations/${provider.toLowerCase()}/sync`, { method: 'POST' }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox'] }),
        qc.invalidateQueries({ queryKey: ['integrations'] }),
      ]),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">Mailbox sync log</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          Each sync of a connected mailbox, newest first. DealFlow stores only messages that involve
          a known contact or lead.
        </DialogDescription>
        {canSync && mine.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {mine.map((p) => (
              <Button
                key={p.provider}
                size="sm"
                variant="outline"
                disabled={sync.isPending}
                onClick={() => sync.mutate(p.provider)}
              >
                Sync {p.connection!.accountEmail} now
              </Button>
            ))}
          </div>
        )}
        <ErrorText error={sync.error} />
        {logs.isPending ? (
          <Skeleton className="mt-4 h-32" />
        ) : logs.data?.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No syncs recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Mailbox</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 text-right font-medium">Emails</th>
                  <th className="pb-2 text-right font-medium">Meetings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.data?.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-2">
                      {relativeTime(l.startedAt)}
                      <span className="block text-xs text-muted-foreground">
                        {l.trigger === 'manual' ? 'Started by hand' : 'Scheduled'}
                      </span>
                    </td>
                    <td className="py-2 pr-2">{l.mailbox.accountEmail}</td>
                    <td className="py-2 pr-2">
                      <Badge tone={l.ok ? 'success' : 'critical'}>{l.ok ? 'OK' : 'Failed'}</Badge>
                      {l.error && <span className="block text-xs text-critical">{l.error}</span>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{l.emails}</td>
                    <td className="py-2 text-right tabular-nums">{l.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
