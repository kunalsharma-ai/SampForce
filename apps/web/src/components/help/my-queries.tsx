'use client';

import { HELP_CATEGORY_BY_ID, type HelpCategoryId, helpText } from '@dealflow/help';
import type { SupportTicketDetail, SupportTicketMessageRow, SupportTicketRow } from '@dealflow/types';
import { Button, Card, Skeleton } from '@dealflow/ui';
import { ArrowLeft, Inbox, LifeBuoy, MessageSquareReply } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { Segmented } from '@/components/forms/segmented';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/lib/i18n';
import { useCanSeeTeamQueries, useReplyToTicket, useTicket, useTicketStatus, useTickets } from '@/lib/support';
import { TicketStatusBadge, ToneIcon, usePriorityLabel } from './help-ui';

/** My queries (ADR 0073): the questions a person sent from Help, and for managers their team's, with each conversation. */
export function MyQueries() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canTeam = useCanSeeTeamQueries();
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const list = useTickets(scope);
  const selected = params.get('ticket');
  const select = (id: string | null) => router.replace(id ? `${pathname}?ticket=${id}` : pathname, { scroll: false });

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
        <div className="mb-4 max-w-sm">
          <Segmented
            legend={t('Show')}
            name="query-scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'mine', label: t('My queries') },
              { value: 'team', label: t('My team’s queries') },
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
  const replied = row.lastAuthorKind === 'OPERATOR' && row.status === 'ANSWERED';
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
            <span className="text-muted-foreground">#{row.number}</span> {row.subject}
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
          <span>{cat ? helpText(cat.title, t.language) : t('Something else')}</span>
          <span>{priority(d.priority)}</span>
          {d.pagePath && <span>{d.pagePath}</span>}
          {!d.mine && d.raisedBy && <span>{t('Raised by {name}', { name: d.raisedBy.name })}</span>}
        </p>
      </div>
      <ol className="flex-1 space-y-3 p-4" aria-label={t('Conversation')}>
        {d.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </ol>
      {d.canReply && <Composer ticket={d} />}
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
        </p>
        <p className="mt-0.5 whitespace-pre-wrap">{message.body}</p>
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
  const closed = ticket.status === 'CLOSED';
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await reply.mutateAsync(body.trim());
    setBody('');
  };
  return (
    <form onSubmit={send} className="space-y-2 border-t border-border p-4">
      <label htmlFor="ticket-reply" className="sr-only">
        {t('Reply')}
      </label>
      <Textarea id="ticket-reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={closed ? t('Write to open this query again') : t('Add details or answer support')} />
      {(reply.error || status.error) && (
        <p role="alert" className="text-sm text-critical">
          {(reply.error ?? status.error)?.message}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={status.isPending} onClick={() => status.mutate(closed ? 'OPEN' : 'CLOSED')} data-toggle-ticket>
          {closed ? t('Reopen query') : t('Close query')}
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim() || reply.isPending}>
          {t('Send reply')}
        </Button>
      </div>
    </form>
  );
}
