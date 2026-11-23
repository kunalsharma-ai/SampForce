'use client';

import { HELP_CATEGORY_BY_ID, type HelpCategoryId, helpText } from '@dealflow/help';
import {
  FEATURE_BY_KEY,
  type FeatureKey,
  SUPPORT_TICKET_STATUSES,
  type SupportAttachmentRow,
  type SupportTicketStatus,
} from '@dealflow/types';
import { Badge, Button, Card, Input, Skeleton } from '@dealflow/ui';
import { BarChart3, Inbox, Search, Smartphone } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import {
  TicketStatusBadge,
  ToneIcon,
  usePriorityLabel,
  useStatusLabel,
} from '@/components/help/help-ui';
import { AttachmentPicker, MessageFiles, RelatedRecord } from '@/components/help/support-files';
import { SupportReportView } from '@/components/help/support-report';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/lib/i18n';
import {
  useOperatorTicket,
  useOperatorTicketActions,
  useOperatorTicketCounts,
  useOperatorTickets,
  useSupportRepresentatives,
} from '@/lib/support';
import { useOperator } from '../operator-shell';

/** The Console's Support tickets inbox (ADR 0073): every client's queries from Help, answered here. */
export default function OperatorSupportPage() {
  return (
    <Suspense>
      <SupportInbox />
    </Suspense>
  );
}

const FILTERS: (SupportTicketStatus | 'ALL')[] = [...SUPPORT_TICKET_STATUSES, 'ALL'];

function SupportInbox() {
  const t = useT();
  const me = useOperator();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const statusLabel = useStatusLabel();
  const [filter, setFilter] = useState<SupportTicketStatus | 'ALL'>('SUBMITTED');
  const [q, setQ] = useState('');
  const counts = useOperatorTicketCounts(!!me.data);
  const list = useOperatorTickets(
    { status: filter === 'ALL' ? undefined : filter, q: q.trim() || undefined },
    !!me.data,
  );
  const selected = params.get('ticket');
  const reports = params.get('view') === 'reports';
  const select = (id: string) => router.replace(`${pathname}?ticket=${id}`, { scroll: false });
  const count = (s: SupportTicketStatus | 'ALL') =>
    !counts.data
      ? null
      : s === 'ALL'
        ? SUPPORT_TICKET_STATUSES.reduce((n, x) => n + counts.data![x], 0)
        : counts.data[s];

  return (
    <div>
      <PageHeader
        title="Support tickets"
        description="Queries raised from Help in every client’s workspaces."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.replace(reports ? pathname : `${pathname}?view=reports`, { scroll: false })
            }
            data-support-view={reports ? 'tickets' : 'reports'}
          >
            {reports ? <Inbox aria-hidden /> : <BarChart3 aria-hidden />}{' '}
            {reports ? t('Back to tickets') : t('Support reports')}
          </Button>
        }
      />
      {reports ? (
        <SupportReportView />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div
              role="tablist"
              aria-label={t('Ticket status')}
              className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
            >
              {FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={filter === s}
                  onClick={() => setFilter(s)}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
                  data-status-filter={s}
                >
                  {s === 'ALL' ? t('All tickets') : statusLabel(s)}
                  {count(s) !== null && (
                    <span className="ms-1.5 rounded-full bg-background px-1.5 text-[11px] font-medium">
                      {count(s)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="relative ms-auto w-full sm:w-72">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('Search subject or #number')}
                aria-label={t('Search tickets')}
                className="ps-9"
              />
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card className="overflow-hidden">
              {list.isLoading || !me.data ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : !list.data?.length ? (
                <div className="p-10 text-center" data-no-tickets>
                  <Inbox className="mx-auto size-10 text-muted-foreground" aria-hidden />
                  <p className="mt-2 text-sm text-muted-foreground">{t('No tickets here.')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-border" aria-label={t('Support tickets')}>
                  {list.data.map((row) => {
                    const cat = HELP_CATEGORY_BY_ID[row.category as HelpCategoryId];
                    return (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => select(row.id)}
                          aria-current={row.id === selected ? 'true' : undefined}
                          data-ticket={row.number}
                          className="flex w-full items-start gap-3 p-4 text-start hover:bg-muted/40 aria-[current=true]:bg-primary/5"
                        >
                          <ToneIcon
                            icon={cat?.icon ?? 'life-buoy'}
                            tone={cat?.tone ?? 5}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{row.subject}</span>
                              <TicketStatusBadge status={row.status} />
                            </span>
                            <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{row.tenant.name}</span>
                              <span>#{row.number}</span>
                              <span>{row.raisedBy?.name}</span>
                              {row.priority === 'HIGH' && (
                                <Badge tone="critical">{t('High priority')}</Badge>
                              )}
                              {row.source === 'mobile' && (
                                <Smartphone
                                  className="size-3.5"
                                  aria-label={t('From the mobile app')}
                                />
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {selected ? (
              <TicketPane id={selected} />
            ) : (
              <Card className="grid min-h-64 place-items-center p-8 text-sm text-muted-foreground">
                {t('Choose a ticket to read and answer it.')}
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TicketPane({ id }: { id: string }) {
  const t = useT();
  const priority = usePriorityLabel();
  const statusLabel = useStatusLabel();
  const ticket = useOperatorTicket(id);
  const actions = useOperatorTicketActions(id);
  const reps = useSupportRepresentatives();
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<SupportAttachmentRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  // Opening a new ticket marks it Under review, and the client is told it was seen.
  const reviewed = useRef<string | null>(null);
  const status = ticket.data?.status;
  useEffect(() => {
    if (status !== 'SUBMITTED' || reviewed.current === id) return;
    reviewed.current = id;
    actions.status.mutate('UNDER_REVIEW');
  }, [status, id, actions.status]);
  if (ticket.isLoading) return <Skeleton className="h-96" />;
  if (!ticket.data) return null;
  const d = ticket.data;
  const cat = HELP_CATEGORY_BY_ID[d.category as HelpCategoryId];
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    await actions.reply.mutateAsync({ body: body.trim(), attachmentIds: files.map((f) => f.id) });
    setBody('');
    setFiles([]);
  };
  return (
    <Card className="flex flex-col overflow-hidden" data-ticket-pane={d.number}>
      <div className="border-b border-border bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">
            <span className="text-muted-foreground">#{d.number}</span> {d.subject}
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('Status')}</span>
            <Select
              className="h-9 w-40"
              value={d.status}
              disabled={actions.status.isPending}
              onChange={(e) => actions.status.mutate(e.target.value as SupportTicketStatus)}
              aria-label={t('Ticket status')}
            >
              {SUPPORT_TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <Meta label={t('Client')} value={d.tenant.name} />
          <Meta
            label={t('Raised by')}
            value={`${d.raisedBy?.name ?? ''}${d.workspace ? ` · ${t.maybe(d.workspace.name)}` : ''}`}
          />
          <Meta
            label={t('Topic')}
            value={
              cat
                ? helpText(cat.title, t.language)
                : d.categoryOther
                  ? `${t('Other')}: ${d.categoryOther}`
                  : t('Other')
            }
          />
          <Meta
            label={t('Feature')}
            value={
              d.featureKey
                ? t.maybe(FEATURE_BY_KEY[d.featureKey as FeatureKey]?.label ?? d.featureKey)
                : '—'
            }
          />
          <Meta label={t('Priority')} value={priority(d.priority)} />
          <Meta label={t('From page')} value={d.pagePath ?? '—'} />
          {d.context && <Meta label={t('Role')} value={d.context.roleName} />}
          {d.context && <Meta label={t('Email')} value={d.context.email} />}
          <Meta
            label={t('Contact by')}
            value={
              d.contactMethod === 'PHONE'
                ? `${t('Phone')} · ${d.contactPhone ?? ''}`
                : d.contactMethod === 'EMAIL'
                  ? t('Email')
                  : t('In the app')
            }
          />
          <Meta label={t('App version')} value={d.appVersion ?? '—'} />
          <Meta label={t('Source')} value={d.source === 'mobile' ? t('Mobile app') : t('Web')} />
          {d.relatedRecord && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t('Record')}</dt>
              <dd>
                <RelatedRecord record={d.relatedRecord} link={false} />
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-3 grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">{t('Support representative')}</span>
            <Select
              className="h-9"
              value={d.assignedTo?.id ?? ''}
              disabled={actions.update.isPending}
              onChange={(e) =>
                actions.update.mutate({ assignedOperatorId: e.target.value || null })
              }
              data-assign-representative
            >
              <option value="">{t('Nobody yet')}</option>
              {(reps.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </label>
          <form
            className="space-y-1 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              actions.update.mutate({
                resolutionNote: (note ?? d.resolutionNote ?? '').trim() || null,
              });
            }}
          >
            <label htmlFor="resolution-note" className="text-muted-foreground">
              {t('Resolution note')}
            </label>
            <div className="flex gap-2">
              <Textarea
                id="resolution-note"
                rows={1}
                value={note ?? d.resolutionNote ?? ''}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('How it was resolved, for the person who asked')}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={actions.update.isPending}
                data-save-resolution
              >
                {t('Save')}
              </Button>
            </div>
          </form>
        </div>
      </div>
      <ol className="flex-1 space-y-3 p-4" aria-label={t('Conversation')}>
        {d.messages.map((m) => (
          <li
            key={m.id}
            className={`flex ${m.authorKind === 'OPERATOR' ? 'justify-end' : 'justify-start'}`}
            data-message-author={m.authorKind}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${m.authorKind === 'OPERATOR' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              <p
                className={`text-xs font-semibold ${m.authorKind === 'OPERATOR' ? 'text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {m.author?.name}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
              <MessageFiles
                files={m.attachments}
                operatorTicketId={d.id}
                inverted={m.authorKind === 'OPERATOR'}
              />
              <p
                className={`mt-1 text-[11px] ${m.authorKind === 'OPERATOR' ? 'text-primary-foreground' : 'text-muted-foreground'}`}
              >
                {new Date(m.createdAt).toLocaleString(t.formatLocale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="space-y-2 border-t border-border p-4">
        <label htmlFor="operator-reply" className="text-sm font-medium">
          {t('Your answer')}
        </label>
        <Textarea
          id="operator-reply"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t(
            'The person who raised it is notified and the ticket waits for their reply.',
          )}
        />
        <AttachmentPicker
          files={files}
          onChange={setFiles}
          ticketId={d.id}
          id="operator-reply-files"
        />
        {(actions.reply.error || actions.status.error || actions.update.error) && (
          <p role="alert" className="text-sm text-critical">
            {(actions.reply.error ?? actions.status.error ?? actions.update.error)?.message}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={!body.trim() || actions.reply.isPending} data-send-answer>
            {t('Send answer')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
