'use client';

import type {
  ChatConversationRow,
  ChatMessageRow,
  SampbidxChatPerson,
  SampbidxChatTransferOption,
} from '@dealflow/types';
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Gavel,
  Loader2,
  MessageSquarePlus,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import type { ChatRealm } from '@/lib/chat';
import { type MessageKey, useT } from '@/lib/i18n';

/*
 * Chat with the SampBidx team (ADR 0078) inside Team chat: a section of its own in the conversation list, the
 * SampBidx look of those conversations, who from SampBidx wrote, and whether SampBidx has each message yet.
 */

const REMOTE: Record<
  string,
  { label: MessageKey; tone: 'neutral' | 'primary' | 'success' | 'critical' | 'warning' }
> = {
  RECEIVED: { label: 'Received', tone: 'neutral' },
  IN_REVIEW: { label: 'In review', tone: 'primary' },
  BIDDING: { label: 'Bidding', tone: 'primary' },
  QUOTED: { label: 'Quoted', tone: 'warning' },
  WON: { label: 'Won', tone: 'success' },
  LOST: { label: 'Lost', tone: 'critical' },
  REJECTED: { label: 'Rejected', tone: 'critical' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const isSampbidx = (c: Pick<ChatConversationRow, 'kind'>) => c.kind === 'SAMPBIDX';

/** The SampBidx mark: a gavel on the warm SampBidx gradient. RFQ chats carry a small sheet badge. */
export function SampbidxAvatar({ c, className }: { c?: ChatConversationRow; className?: string }) {
  const rfq = c?.sampbidx?.scope === 'rfq';
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-warning to-accent text-background shadow-sm ring-2 ring-surface',
        className,
      )}
    >
      <Gavel className="size-5" />
      {rfq && (
        <span className="absolute -bottom-1 -end-1 grid size-4 place-items-center rounded-md bg-surface text-warning shadow ring-1 ring-border">
          <FileSpreadsheet className="size-3" />
        </span>
      )}
    </span>
  );
}

/** Someone from SampBidx: initials on an outlined warm disc, so they never look like a colleague. */
export function SampbidxPersonAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full border-2 border-warning bg-warning/15 text-xs font-semibold text-warning shadow-sm',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

export function RemoteStatus({ status }: { status: string | null | undefined }) {
  const t = useT();
  const s = status ? REMOTE[status] : undefined;
  if (!s) return null;
  return (
    <Badge tone={s.tone} className="shrink-0 px-1.5 py-0 text-[10px]">
      {t(s.label)}
    </Badge>
  );
}

/** The list's own section for SampBidx conversations, below its header with "New RFQ chat". */
export function SampbidxSection({
  rows,
  renderRow,
  onOpen,
  collapsedKey = 'sampforce-sampbidx-section',
}: {
  rows: ChatConversationRow[];
  renderRow: (c: ChatConversationRow) => React.ReactNode;
  onOpen: (id: string) => void;
  collapsedKey?: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(true);
  const [picking, setPicking] = React.useState(false);
  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(collapsedKey) === 'closed') setOpen(false);
    } catch {
      // Storage may be blocked; the section just starts open.
    }
  }, [collapsedKey]);
  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(collapsedKey, o ? 'closed' : 'open');
      } catch {
        // Not remembered, which is fine.
      }
      return !o;
    });
  const unread = rows.reduce((n, c) => n + c.unread, 0);
  // The general line first, then RFQ chats by their latest message.
  const sorted = [...rows].sort(
    (a, b) => Number(b.sampbidx?.scope === 'general') - Number(a.sampbidx?.scope === 'general'),
  );
  return (
    <section
      aria-label={t('Chat with SampBidx team')}
      className="mb-2 overflow-hidden rounded-xl border border-warning/40 bg-gradient-to-b from-warning/10 to-transparent"
      data-sampbidx-section=""
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-warning to-accent text-background">
            <Gavel className="size-3.5" aria-hidden />
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {t('Chat with SampBidx team')}
          </span>
          {unread > 0 && !open && (
            <span className="grid min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold leading-5 text-background">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
          <ChevronDown
            className={cn(
              'ms-auto size-4 shrink-0 text-muted-foreground transition-transform',
              !open && '-rotate-90 rtl:rotate-90',
            )}
            aria-hidden
          />
        </button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 border-warning/50 px-2 text-xs"
          onClick={() => setPicking(true)}
        >
          <Plus aria-hidden /> {t('RFQ chat')}
        </Button>
      </div>
      {open && (
        <ul className="space-y-0.5 px-1 pb-1.5">
          {sorted.map((c) => (
            <li key={c.id}>{renderRow(c)}</li>
          ))}
        </ul>
      )}
      {picking && <NewRfqChatDialog onClose={() => setPicking(false)} onOpen={onOpen} />}
    </section>
  );
}

/** What a SampBidx conversation is about, under its title. */
export function sampbidxSubtitle(c: ChatConversationRow, t: ReturnType<typeof useT>): string {
  const people = c.sampbidx?.people ?? [];
  const names = people
    .slice(0, 2)
    .map((p) => p.name)
    .join(', ');
  if (c.sampbidx?.scope === 'general')
    return names
      ? t('SampBidx bidding team · {names}', { names })
      : t('Your line to the SampBidx bidding team');
  const company = c.sampbidx?.transfer?.company?.name;
  return [company, names ? t('with {names}', { names }) : t('Sent to SampBidx')]
    .filter(Boolean)
    .join(' · ');
}

/** Header extras of a SampBidx conversation: the RFQ's status in SampBidx, and a link to it there. */
export function SampbidxHeaderExtras({ c }: { c: ChatConversationRow }) {
  const t = useT();
  const tr = c.sampbidx?.transfer;
  if (!tr) {
    return (
      <span className="hidden items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning sm:inline-flex">
        <ShieldCheck className="size-3.5" aria-hidden /> {t('Signed link to SampBidx')}
      </span>
    );
  }
  return (
    <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap md:inline-flex">
      {tr.remoteId && (
        <span className="font-mono text-[11px] text-muted-foreground">{tr.remoteId}</span>
      )}
      <RemoteStatus status={tr.remoteStatus} />
      {tr.remoteUrl && (
        <a
          href={tr.remoteUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
        >
          <ExternalLink className="size-3" aria-hidden /> {t('Open in SampBidx')}
        </a>
      )}
    </span>
  );
}

/** Whether SampBidx has my message: on its way, there, or not delivered with "Try again". */
export function SampbidxDeliveryLine({ m }: { m: ChatMessageRow }) {
  const t = useT();
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () =>
      api<ChatMessageRow>(`/apps/sampbidx/chat/messages/${m.id}/retry`, { method: 'POST' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['chat'] }),
  });
  const d = m.sampbidxDelivery;
  if (!d) return null;
  if (d.state === 'SENT')
    return (
      <p className="px-1 text-[11px] text-success" data-sampbidx-delivery="sent">
        {t('Delivered to SampBidx')}
      </p>
    );
  if (d.state === 'SENDING')
    return (
      <p
        className="inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
        data-sampbidx-delivery="sending"
      >
        <Clock className="size-3" aria-hidden />{' '}
        {d.attempts > 0 ? t('Trying SampBidx again…') : t('Sending to SampBidx…')}
      </p>
    );
  return (
    <div className="flex flex-col items-end gap-1" data-sampbidx-delivery="failed" role="alert">
      <p className="inline-flex items-center gap-1 px-1 text-[11px] text-critical">
        <AlertTriangle className="size-3" aria-hidden />{' '}
        {t('Not delivered to SampBidx: {reason}', { reason: t.maybe(d.error ?? '') })}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <RotateCcw aria-hidden />
        )}{' '}
        {t('Try again')}
      </Button>
    </div>
  );
}

/** A line from SampBidx about the RFQ (a status change), centred like a date. */
export function SampbidxSystemLine({ m }: { m: ChatMessageRow }) {
  return (
    <li className="flex justify-center py-2" data-sampbidx-system="">
      <span className="inline-flex max-w-[90%] items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-foreground shadow-sm">
        <Gavel className="size-3.5 shrink-0 text-warning" aria-hidden />
        <span className="truncate">{m.body}</span>
      </span>
    </li>
  );
}

/** SampBidx people of the conversation, for the details panel. */
export function SampbidxPeople({ people }: { people: SampbidxChatPerson[] }) {
  const t = useT();
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('From SampBidx')}
      </h4>
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('Nobody from SampBidx has written here yet.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={`${p.id}:${p.email}:${p.name}`} className="flex items-center gap-2 text-sm">
              <SampbidxPersonAvatar name={p.name} className="size-8 text-[10px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[p.role, p.email].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Starts (or opens) the chat about one RFQ sent to SampBidx. */
function NewRfqChatDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = React.useState('');
  const text = q.trim();
  const list = useQuery({
    queryKey: ['sampbidx-chat-transfers', text],
    queryFn: () =>
      api<SampbidxChatTransferOption[]>(
        `/apps/sampbidx/chat/transfers?q=${encodeURIComponent(text)}`,
      ),
  });
  const open = useMutation({
    mutationFn: (transferId: string) =>
      api<ChatConversationRow>('/apps/sampbidx/chat/open', {
        method: 'POST',
        json: { transferId },
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['chat'] });
      onOpen(c.id);
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="flex items-center gap-2">
          <SampbidxAvatar className="size-8 rounded-lg [&_svg]:size-4" /> {t('Chat about an RFQ')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t(
            'Pick an RFQ you sent to SampBidx. Its bidders see your messages, and their answers come back here.',
          )}
        </DialogDescription>
        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('Search RFQs sent to SampBidx')}
            aria-label={t('Search RFQs sent to SampBidx')}
            className="rounded-full ps-9"
            autoFocus
          />
        </div>
        <div className="mt-2 max-h-80 overflow-y-auto">
          {list.isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : list.error ? (
            <p className="p-3 text-sm text-critical" role="alert">
              {list.error instanceof ApiError
                ? t.maybe(list.error.message)
                : t('Could not load the RFQs.')}
            </p>
          ) : !list.data?.length ? (
            <div className="space-y-2 p-6 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <FileSpreadsheet className="size-6" aria-hidden />
              </span>
              <p className="text-sm text-muted-foreground">
                {text
                  ? t('No RFQ sent to SampBidx matches.')
                  : t('Nothing sent to SampBidx yet. Send an RFQ first, then chat about it here.')}
              </p>
              <Button asChild size="sm" variant="outline">
                <Link href="/app/rfqs">{t('Go to RFQs')}</Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {list.data.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    disabled={open.isPending}
                    onClick={() => open.mutate(o.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2.5 text-start transition-colors hover:border-warning/40 hover:bg-warning/5"
                    data-transfer={o.title}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
                      <FileSpreadsheet className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{o.title}</span>
                        <RemoteStatus status={o.remoteStatus} />
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[o.company?.name, o.remoteId].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                      <MessageSquarePlus className="size-4" aria-hidden />{' '}
                      {o.conversationId ? t('Open chat') : t('Start chat')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {open.error && (
          <p className="mt-2 text-sm text-critical" role="alert">
            {open.error instanceof ApiError
              ? t.maybe(open.error.message)
              : t('Could not open the chat.')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type { ChatRealm };
