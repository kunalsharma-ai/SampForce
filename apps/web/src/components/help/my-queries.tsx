'use client';

import { HELP_CATEGORY_BY_ID, type HelpCategoryId, helpText } from '@dealflow/help';
import { SUPPORT_TICKET_STATUSES, type SupportAttachmentRow, type SupportTicketDetail, type SupportTicketMessageRow, type SupportTicketRow, type SupportTicketStatus } from '@dealflow/types';
import { Button, Card, Skeleton } from '@dealflow/ui';
import { ArrowLeft, ArrowUpCircle, CheckCircle2, Inbox, LifeBuoy, MessageSquareReply, RotateCcw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { Segmented } from '@/components/forms/segmented';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/lib/i18n';
import { type TicketScope, useCanSeeTeamQueries, useEscalateTicket, useReplyToTicket, useTicket, useTicketStatus, useTickets } from '@/lib/support';
import { TicketStatusBadge, ToneIcon, usePriorityLabel, useStatusLabel } from './help-ui';
import { AttachmentPicker, MessageFiles, RelatedRecord } from './support-files';

/** My queries (ADR 0073): the questions a person sent from Help, and for managers their team's, with each conversation. */
export function MyQueries() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canTeam = useCanSeeTeamQueries();
  const asked = params.get('scope');
  const [scope, setScopeState] = useState<TicketScope>(canTeam && (asked === 'team' || asked === 'handling') ? asked : 'mine');
  const list = useTickets(scope);
  const selected = params.get('ticket');
  const go = (next: TicketScope, id: string | null) => {
    const q = new URLSearchParams();
    if (next !== 'mine') q.set('scope', next);
    if (id) q.set('ticket', id);
    router.replace(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const select = (id: string | null) => go(scope, id);
  const setScope = (next: TicketScope) => {
    setScopeState(next);
    go(next, null);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="My queries"
        description="Questions you sent to SampForce support, with their replies."
        actions={
          <Button asChild>
            <Link href="/app/help?raise=1">
              <LifeBuoy aria-hidden /> {t('Raise a query')}
            </Link>
          </Button>
        }
      />
      {canTeam && (
        <div className="mb-4 max-w-xl">
          <Segmented
            legend={t('Show')}
            name="query-scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: t('My queries') },
              { value: 'team', label: t('My team’s queries') },
              { value: 'handling', label: t('Waiting on my workspace') },
            ]}
          />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className={`overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
          {list.isLoading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : !list.data?.length ? (
            <div className="p-8 text-center" data-no-queries>
              <Inbox className="mx-auto size-10 text-muted-foreground" aria-hidden />
              <p className="mt-2 font-medium">{t('No queries yet')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('When the Help Center does not answer you, raise a query and it appears here.')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('My queries')}>
              {list.data.map((row) => (
                <li key={row.id}>
                  <TicketListItem row={row} active={row.id === selected} onSelect={() => select(row.id)} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className={selected ? '' : 'hidden lg:block'}>{selected ? <TicketThread id={selected} onBack={() => select(null)} /> : <EmptyThread />}</div>
      </div>
    </div>
  );
}

function TicketListItem({ row, active, onSelect }: { row: SupportTicketRow; active: boolean; onSelect: () => void }) {
  const t = useT();
  const cat = HELP_CATEGORY_BY_ID[row.category as HelpCategoryId];
  const replied = row.lastAuthorKind !== 'USER' && row.status === 'AWAITING_USER';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      data-ticket={row.number}
      className="flex w-full items-start gap-3 p-4 text-start hover:bg-muted/40 aria-[current=true]:bg-primary/5"
    >
      {cat ? <ToneIcon icon={cat.icon} tone={cat.tone} size="sm" /> : <ToneIcon icon="life-buoy" tone={5} size="sm" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            <span className="font-normal">#{row.number}</span> {row.subject}
          </span>
          <TicketStatusBadge status={row.status} />
        </span>
        <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {!row.mine && row.raisedBy && <span>{row.raisedBy.name}</span>}
          <span>{new Date(row.lastMessageAt).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
          {replied && <span className="font-medium text-success">{t('Support replied')}</span>}
        </span>
      </span>
    </button>
  );
}

function EmptyThread() {
  const t = useT();
  return (
    <Card className="grid h-full min-h-64 place-items-center p-8 text-center">
      <div>
        <MessageSquareReply className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-sm text-muted-foreground">{t('Choose a query to read its conversation.')}</p>
      </div>
    </Card>
  );
}

function TicketThread({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const priority = usePriorityLabel();
  const ticket = useTicket(id);
  if (ticket.isLoading) return <Skeleton className="h-96" />;
  if (!ticket.data) return <EmptyThread />;
  const d = ticket.data;
  const cat = HELP_CATEGORY_BY_ID[d.category as HelpCategoryId];
  return (
    <Card className="flex flex-col overflow-hidden" data-ticket-thread={d.number}>
      <div className="border-b border-border bg-gradient-to-br from-primary/10 to-transparent p-4">
        <Button variant="ghost" size="sm" className="mb-2 lg:hidden" onClick={onBack}>
          <ArrowLeft className="rtl:rotate-180" aria-hidden /> {t('All queries')}
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">
            <span className="text-muted-foreground">#{d.number}</span> {d.subject}
          </h2>
          <TicketStatusBadge status={d.status} />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{cat ? helpText(cat.title, t.language) : d.categoryOther ? `${t('Other')}: ${d.categoryOther}` : t('Other')}</span>
          <span>{priority(d.priority)}</span>
          {d.pagePath && <span>{d.pagePath}</span>}
          {!d.mine && d.raisedBy && <span>{t('Raised by {name}', { name: d.raisedBy.name })}</span>}
          {d.relatedRecord && <RelatedRecord record={d.relatedRecord} />}
          {d.handling && d.contactMethod !== 'IN_APP' && (
            <span data-contact-method={d.contactMethod}>
              {d.contactMethod === 'PHONE' ? t('Call back on {phone}', { phone: d.contactPhone ?? '' }) : t('Prefers email: {email}', { email: d.context?.email ?? '' })}
            </span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 text-xs" data-ticket-handler={d.handler.level}>
          <span>
            <span className="text-muted-foreground">{t('Answered by')}</span> <span className="font-medium">{d.handler.level === 'CONSOLE' ? t('SampForce support') : t.maybe(d.handler.name)}</span>
          </span>
          {d.assignedTo && (
            <span>
              <span className="text-muted-foreground">{t('Support representative')}</span> <span className="font-medium">{d.assignedTo.name}</span>
            </span>
          )}
        </p>
      </div>
      {d.resolutionNote && (
        <div className="border-b border-border bg-success/5 px-4 py-3 text-sm" data-resolution-note>
          <p className="text-xs font-semibold text-success">{t('Resolution')}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{d.resolutionNote}</p>
        </div>
      )}
      <ol className="flex-1 space-y-3 p-4" aria-label={t('Conversation')}>
        {d.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </ol>
      {d.handling && !d.mine ? <HandlerPanel ticket={d} /> : d.canReply && <Composer ticket={d} />}
    </Card>
  );
}

function Message({ message }: { message: SupportTicketMessageRow }) {
  const t = useT();
  const support = message.authorKind === 'OPERATOR';
  return (
    <li className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`} data-message-author={message.authorKind}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${message.mine ? 'bg-primary text-primary-foreground' : support ? 'border border-success/30 bg-success/10' : 'bg-muted'}`}>
        <p className={`text-xs font-semibold ${message.mine ? 'text-primary-foreground/80' : support ? 'text-success' : 'text-muted-foreground'}`}>
          {support ? t('SampForce support') : (message.author?.name ?? '')}
          {message.authorKind === 'WORKSPACE' && !message.mine && <span className="font-normal"> · {t('answering')}</span>}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
        <MessageFiles files={message.attachments} inverted={message.mine} />
        <p className={`mt-1 text-[11px] ${message.mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {new Date(message.createdAt).toLocaleString(t.formatLocale, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </div>
    </li>
  );
}

function Composer({ ticket }: { ticket: SupportTicketDetail }) {
  const t = useT();
  const reply = useReplyToTicket(ticket.id);
  const status = useTicketStatus(ticket.id);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<SupportAttachmentRow[]>([]);
  const finished = ticket.status === 'CLOSED' || ticket.status === 'RESOLVED';
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await reply.mutateAsync({ body: body.trim(), attachmentIds: files.map((f) => f.id) });
    setBody('');
    setFiles([]);
  };
  return (
    <form onSubmit={send} className="space-y-2 border-t border-border p-4">
      <label htmlFor="ticket-reply" className="sr-only">
        {t('Reply')}
      </label>
      <Textarea id="ticket-reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={finished ? t('Write to open this query again') : t('Add details or answer support')} />
      <AttachmentPicker files={files} onChange={setFiles} id="ticket-reply-files" />
      {(reply.error || status.error) && (
        <p role="alert" className="text-sm text-critical">
          {(reply.error ?? status.error)?.message}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {finished ? (
            <Button type="button" variant="ghost" size="sm" disabled={status.isPending} onClick={() => status.mutate('SUBMITTED')} data-toggle-ticket>
              <RotateCcw aria-hidden /> {t('Reopen query')}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={status.isPending} onClick={() => status.mutate('RESOLVED')} data-resolve-ticket>
              <CheckCircle2 aria-hidden /> {t('Mark as resolved')}
            </Button>
          )}
          {ticket.status !== 'CLOSED' && (
            <Button type="button" variant="ghost" size="sm" disabled={status.isPending} onClick={() => status.mutate('CLOSED')} data-close-ticket>
              <XCircle aria-hidden /> {t('Close query')}
            </Button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={!body.trim() || reply.isPending}>
          {t('Send reply')}
        </Button>
      </div>
    </form>
  );
}

/**
 * For the workspace a query waits on (ADR 0071 part 5): answer it, set its status and resolution note, or pass it one
 * level up (a manager to the Super Workspace, the Super Workspace to SampForce support).
 */
function HandlerPanel({ ticket }: { ticket: SupportTicketDetail }) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const reply = useReplyToTicket(ticket.id);
  const status = useTicketStatus(ticket.id);
  const escalate = useEscalateTicket(ticket.id);
  const [body, setBody] = useState('');
  const [next, setNext] = useState<SupportTicketStatus>(ticket.status);
  const [note, setNote] = useState(ticket.resolutionNote ?? '');
  const [passOn, setPassOn] = useState('');
  const [files, setFiles] = useState<SupportAttachmentRow[]>([]);
  const error = reply.error ?? status.error ?? escalate.error;
  // Opening a new query marks it Under review, so the person who asked knows it was seen.
  const reviewed = useRef(false);
  useEffect(() => {
    if (ticket.status !== 'SUBMITTED' || reviewed.current) return;
    reviewed.current = true;
    status.mutate({ status: 'UNDER_REVIEW' }, { onSuccess: () => setNext('UNDER_REVIEW') });
  }, [ticket.status, status]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await reply.mutateAsync({ body: body.trim(), attachmentIds: files.map((f) => f.id) });
    setBody('');
    setFiles([]);
    setNext('AWAITING_USER');
  };
  const upTo = ticket.handlerLevel === 'MANAGER' ? t('the Super Workspace') : t('SampForce support');
  return (
    <div className="space-y-4 border-t border-border p-4" data-handler-panel>
      <form onSubmit={send} className="space-y-2">
        <label htmlFor="ticket-answer" className="text-sm font-medium">
          {t('Your answer')}
        </label>
        <Textarea id="ticket-answer" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('The person who raised it is notified and the query waits for their reply.')} />
        <AttachmentPicker files={files} onChange={setFiles} id="ticket-answer-files" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || reply.isPending} data-send-answer>
            {t('Send answer')}
          </Button>
        </div>
      </form>
      <form
        className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          status.mutate({ status: next, resolutionNote: note.trim() || null });
        }}
      >
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('Status')}</span>
          <Select className="h-9" value={next} onChange={(e) => setNext(e.target.value as SupportTicketStatus)}>
            {SUPPORT_TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">{t('Resolution note')}</span>
          <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('How it was resolved, for the person who asked')} />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={status.isPending} data-save-status>
          {t('Save')}
        </Button>
      </form>
      {ticket.canEscalate && (
        <form
          className="space-y-2 rounded-lg border border-dashed border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            escalate.mutate(passOn.trim(), { onSuccess: () => setPassOn('') });
          }}
        >
          <label htmlFor="ticket-escalate" className="text-sm font-medium">
            {t('Pass it to {who}', { who: upTo })}
          </label>
          <Textarea id="ticket-escalate" rows={2} value={passOn} onChange={(e) => setPassOn(e.target.value)} placeholder={t('A note for them (optional)')} />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="outline" disabled={escalate.isPending} data-escalate>
              <ArrowUpCircle aria-hidden /> {t('Escalate')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error.message}
        </p>
      )}
    </div>
  );
}
