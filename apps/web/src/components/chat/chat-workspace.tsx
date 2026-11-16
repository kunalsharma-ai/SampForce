'use client';

import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_MESSAGE_MAX, type ChatConversationRow, type ChatLinkOption, type ChatMessageRow } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, CheckCheck, CloudOff, FileSpreadsheet, Handshake, Hash, LifeBuoy, Link2, LogOut, MessageSquarePlus, Paperclip, Pencil, RotateCcw, Search, Send, Trash2, UserPlus, Users, Wifi, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { formatBytes } from '@/components/forms/upload-zone';
import { Select, Textarea } from '@/components/crm/select';
import {
  attachmentUrl,
  type ChatRealm,
  discardOutboxItem,
  type OutboxItem,
  queueMessage,
  retryOutboxItem,
  useChatConnection,
  useChatLive,
  useChatMutations,
  useChatPeople,
  useChatSearch,
  useConversation,
  useConversations,
  useLinkOptions,
  useMessages,
  useOutbox,
} from '@/lib/chat';
import { fmtLocale, useT } from '@/lib/i18n';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

function Avatar({ name, operator, className }: { name: string; operator?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold', operator ? 'bg-warning text-black' : 'bg-primary text-primary-foreground', className)}>
      {initials(name) || '?'}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(fmtLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function shortWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString(fmtLocale(), { day: 'numeric', month: 'short' });
}

const LINK_ICON = { COMPANY: Building2, RFQ: FileSpreadsheet, DEAL: Handshake } as const;
const LINK_KIND = { COMPANY: 'Company', RFQ: 'RFQ', DEAL: 'Deal' } as const;

function LinkChip({ link, onRemove }: { link: { type: 'COMPANY' | 'RFQ' | 'DEAL'; label: string; href?: string | null }; onRemove?: () => void }) {
  const t = useT();
  const Icon = LINK_ICON[link.type];
  const inner = (
    <>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{t(LINK_KIND[link.type])}: </span>
      <span className="truncate">{link.label}</span>
    </>
  );
  const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium';
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {link.href ? (
        <Link href={link.href} className={cn(cls, 'hover:bg-muted')}>
          {inner}
        </Link>
      ) : (
        <span className={cls}>{inner}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="rounded-full p-1 hover:bg-muted" aria-label={t('Remove link')}>
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

function ConnectionBadge() {
  const t = useT();
  const state = useChatConnection((s) => s.state);
  if (state === 'live')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" data-chat-connection="live">
        <Wifi className="size-3.5" aria-hidden /> {t('Live')}
      </span>
    );
  if (state === 'offline')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-critical" data-chat-connection="offline">
        <CloudOff className="size-3.5" aria-hidden /> {t('Offline')}
      </span>
    );
  return (
    <span className="text-xs text-muted-foreground" data-chat-connection="connecting">
      {t('Connecting…')}
    </span>
  );
}

function KindIcon({ c }: { c: ChatConversationRow }) {
  if (c.kind === 'SUPPORT') return <LifeBuoy className="size-4 text-warning" aria-hidden />;
  if (c.kind === 'CHANNEL') return <Hash className="size-4 text-muted-foreground" aria-hidden />;
  return null;
}

/** The chat screen: conversations on one side, the open conversation on the other. */
export function ChatWorkspace({ realm, header, initialId }: { realm: ChatRealm; header?: React.ReactNode; initialId?: string | null }) {
  const t = useT();
  const [selected, setSelected] = React.useState<string | null>(initialId ?? null);
  const [archived, setArchived] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [dialog, setDialog] = React.useState<'direct' | 'channel' | null>(null);
  const list = useConversations(realm, archived);
  const search = useChatSearch(realm.kind === 'user' ? q : '');
  const rows = React.useMemo(() => list.data ?? [], [list.data]);
  const isUser = realm.kind === 'user';
  useChatLive(realm);
  React.useEffect(() => {
    if (initialId) setSelected(initialId);
  }, [initialId]);
  React.useEffect(() => {
    if (!selected && rows.length && window.matchMedia('(min-width: 1024px)').matches) setSelected(rows[0]!.id);
  }, [rows, selected]);
  const filtered = realm.kind === 'operator' && q.trim() ? rows.filter((c) => `${c.workspace} ${c.lastMessagePreview ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) : rows;

  return (
    <div className="grid gap-4 lg:h-[calc(100vh-15rem)] lg:min-h-[32rem] lg:grid-cols-[22rem_1fr]">
      <section aria-label={t('Conversations')} className={cn('flex min-h-0 flex-col rounded-xl border border-border bg-surface', selected && 'hidden lg:flex')}>
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <ConnectionBadge />
            {isUser && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setDialog('direct')}>
                  <MessageSquarePlus aria-hidden /> {t('New message')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog('channel')}>
                  <Hash aria-hidden /> {t('New channel')}
                </Button>
              </div>
            )}
          </div>
          {header}
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isUser ? t('Search messages') : t('Search workspaces')} aria-label={isUser ? t('Search messages') : t('Search workspaces')} className="ps-9" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isUser && q.trim().length >= 2 ? (
            <SearchResults hits={search.data} loading={search.isLoading} onOpen={(id) => { setSelected(id); setQ(''); }} />
          ) : list.isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{archived ? t('No archived channels.') : isUser ? t('No conversations yet. Start a message or a channel.') : t('No support conversations yet.')}</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.id)}
                    aria-current={selected === c.id ? 'true' : undefined}
                    data-conversation={c.title}
                    className={cn('flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-muted', selected === c.id && 'bg-muted')}
                  >
                    {c.kind === 'DIRECT' ? <Avatar name={c.title} /> : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted"><KindIcon c={c} /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{realm.kind === 'operator' ? c.workspace : c.kind === 'SUPPORT' ? t('SampForce support') : c.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{shortWhen(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? (c.topic || t('No messages yet.'))}</span>
                        {c.unread > 0 && (
                          <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground" aria-label={t('{n} unread', { n: c.unread })}>
                            {c.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {isUser && (
          <div className="border-t border-border p-2">
            <button type="button" className="inline-flex min-h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setArchived((a) => !a)}>
              <Archive className="size-3.5" aria-hidden /> {archived ? t('Back to conversations') : t('Archived channels')}
            </button>
          </div>
        )}
      </section>

      <section aria-label={t('Conversation')} className={cn('flex min-h-0 flex-col rounded-xl border border-border bg-surface', !selected && 'hidden lg:flex')}>
        {selected ? (
          <Thread key={selected} realm={realm} id={selected} onBack={() => setSelected(null)} onGone={() => setSelected(null)} />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{t('Choose a conversation.')}</div>
        )}
      </section>

      {isUser && dialog === 'direct' && <NewDirectDialog realm={realm} onClose={() => setDialog(null)} onOpen={setSelected} />}
      {isUser && dialog === 'channel' && <ChannelDialog realm={realm} onClose={() => setDialog(null)} onOpen={setSelected} />}
    </div>
  );
}

function SearchResults({ hits, loading, onOpen }: { hits: import('@dealflow/types').ChatSearchHit[] | undefined; loading: boolean; onOpen: (id: string) => void }) {
  const t = useT();
  if (loading) return <Skeleton className="m-2 h-14" />;
  if (!hits?.length) return <p className="p-4 text-sm text-muted-foreground">{t('No messages match.')}</p>;
  return (
    <ul className="space-y-1" aria-label={t('Search results')}>
      {hits.map((h) => (
        <li key={h.message.id}>
          <button type="button" onClick={() => onOpen(h.conversation.id)} className="w-full rounded-lg p-2 text-start hover:bg-muted">
            <span className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate font-medium text-foreground">{h.conversation.kind === 'SUPPORT' ? t('SampForce support') : h.conversation.title}</span>
              <span>{shortWhen(h.message.createdAt)}</span>
            </span>
            <span className="line-clamp-2 text-sm">
              <span className="font-medium">{h.message.author?.name}: </span>
              {h.message.body || h.message.link?.label}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Thread({ realm, id, onBack, onGone }: { realm: ChatRealm; id: string; onBack: () => void; onGone: () => void }) {
  const t = useT();
  const conv = useConversation(realm, id);
  const messages = useMessages(realm, id);
  const outbox = useOutbox(realm, id);
  const { markRead } = useChatMutations(realm);
  const [manage, setManage] = React.useState<'people' | 'edit' | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const c = conv.data;
  const rows = messages.data ?? [];
  const last = rows.at(-1);

  // Reading the conversation marks it read (the others then see the read receipt).
  const unread = c?.unread ?? 0;
  React.useEffect(() => {
    if (!last || !unread || document.visibilityState !== 'visible') return;
    markRead.mutate({ id, messageId: last.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, last?.id, unread]);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [rows.length, outbox.length]);
  React.useEffect(() => {
    if (conv.error) onGone();
  }, [conv.error, onGone]);

  if (!c) return <Skeleton className="m-4 h-40" />;
  const title = realm.kind === 'operator' ? c.workspace : c.kind === 'SUPPORT' ? t('SampForce support') : c.title;
  const others = c.members.filter((m) => m.person.id !== realm.selfId);
  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Button variant="ghost" size="sm" className="lg:hidden" onClick={onBack}>
          {t('Back')}
        </Button>
        {c.kind === 'DIRECT' ? <Avatar name={c.title} /> : <span className="grid size-9 place-items-center rounded-full bg-muted"><KindIcon c={c} /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {c.kind === 'SUPPORT' ? (realm.kind === 'operator' ? t('Support line of this workspace') : t('Your workspace admins and the SampForce super admins')) : c.topic || t('{n} people', { n: c.members.length })}
          </p>
        </div>
        {c.link && <LinkChip link={c.link} />}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={c.members.map((m) => m.person.name).join(', ')}>
          <Users className="size-3.5" aria-hidden /> {t('{n} people', { n: c.members.length })}
        </span>
        {realm.kind === 'user' && c.canManage && (
          <>
            <Button size="sm" variant="outline" onClick={() => setManage('people')}>
              <UserPlus aria-hidden /> {t('Add people')}
            </Button>
            {c.kind === 'CHANNEL' && (
              <Button size="sm" variant="ghost" onClick={() => setManage('edit')} aria-label={t('Edit channel')}>
                <Pencil aria-hidden />
              </Button>
            )}
          </>
        )}
        {realm.kind === 'user' && c.kind === 'CHANNEL' && <LeaveButton realm={realm} conv={c} onLeft={onGone} />}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions">
        {messages.isLoading ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 && outbox.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">{t('No messages yet. Say hello.')}</p>
        ) : (
          <ol className="space-y-3">
            {rows.map((m, i) => (
              <React.Fragment key={m.id}>
                {(i === 0 || new Date(rows[i - 1]!.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) && (
                  <li className="py-1 text-center text-xs font-medium text-muted-foreground" aria-hidden>
                    {day(m.createdAt)}
                  </li>
                )}
                <MessageItem realm={realm} m={m} mine={m.author?.id === realm.selfId} />
              </React.Fragment>
            ))}
            {last && last.author?.id === realm.selfId && <ReadReceipt c={c} last={last} selfId={realm.selfId} others={others.length} />}
            {outbox.map((o) => (
              <OutboxLine key={o.clientId} realm={realm} item={o} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>
      <Composer realm={realm} conv={c} />
      {manage === 'people' && <AddPeopleDialog realm={realm} conv={c} onClose={() => setManage(null)} />}
      {manage === 'edit' && <ChannelDialog realm={realm} conv={c} onClose={() => setManage(null)} />}
    </>
  );
}

function ReadReceipt({ c, last, selfId, others }: { c: ChatConversationRow; last: ChatMessageRow; selfId: string; others: number }) {
  const t = useT();
  const seen = c.members.filter((m) => m.person.id !== selfId && m.lastReadAt && m.lastReadAt >= last.createdAt);
  if (!seen.length) return <li className="text-end text-xs text-muted-foreground" data-read-receipt="sent">{t('Sent')}</li>;
  const label = c.kind === 'DIRECT' || (seen.length === others && others === 1) ? t('Seen') : seen.length === others ? t('Seen by everyone') : t('Seen by {n}', { n: seen.length });
  return (
    <li className="flex items-center justify-end gap-1 text-xs text-muted-foreground" title={seen.map((m) => m.person.name).join(', ')} data-read-receipt="seen">
      <CheckCheck className="size-3.5 text-primary" aria-hidden /> {label}
    </li>
  );
}

function MessageItem({ realm, m, mine }: { realm: ChatRealm; m: ChatMessageRow; mine: boolean }) {
  const t = useT();
  const { edit, remove } = useChatMutations(realm);
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(m.body);
  const name = m.author?.name ?? t('Someone');
  return (
    <li className={cn('group flex gap-3', mine && 'flex-row-reverse')} data-message={m.id}>
      <Avatar name={name} operator={m.author?.operator} className="size-8" />
      <div className={cn('min-w-0 max-w-[80%] space-y-1', mine && 'items-end text-end')}>
        <div className={cn('flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground', mine && 'justify-end')}>
          <span className="font-semibold text-foreground">{name}</span>
          {m.author?.operator && <Badge tone="warning">{t('Super admin')}</Badge>}
          <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
          {m.editedAt && <span>{t('(edited)')}</span>}
        </div>
        {m.deleted ? (
          <p className="text-sm italic text-muted-foreground">{t('This message was deleted.')}</p>
        ) : editing ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              edit.mutate({ id: m.id, body: text.trim() }, { onSuccess: () => setEditing(false) });
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Edit message')} maxLength={CHAT_MESSAGE_MAX} className="min-h-[64px]" />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={edit.isPending}>
                {t('Save')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {m.body && <p className={cn('inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-start text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{m.body}</p>}
            {m.link && (
              <div>
                <LinkChip link={m.link} />
              </div>
            )}
            {m.attachments.length > 0 && (
              <ul className={cn('flex flex-wrap gap-2', mine && 'justify-end')}>
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={attachmentUrl(realm, m.conversationId, a.id)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-muted" download={a.name}>
                      <Paperclip className="size-3.5" aria-hidden />
                      <span className="max-w-[16rem] truncate font-medium">{a.name}</span>
                      <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {m.writtenAt && <p className="text-xs text-muted-foreground">{t('Written at {time} while offline', { time: `${shortWhen(m.writtenAt)} ${time(m.writtenAt)}`.trim() })}</p>}
          </>
        )}
        {mine && !m.deleted && !editing && (
          <div className="flex justify-end gap-1">
            {m.body && (
              <button type="button" className="inline-flex min-h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { setText(m.body); setEditing(true); }}>
                <Pencil className="size-3" aria-hidden /> {t('Edit')}
              </button>
            )}
            <button type="button" className="inline-flex min-h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { if (window.confirm(t('Delete this message?'))) remove.mutate(m.id); }}>
              <Trash2 className="size-3" aria-hidden /> {t('Delete')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function OutboxLine({ realm, item }: { realm: ChatRealm; item: OutboxItem }) {
  const t = useT();
  const qc = useQueryClient();
  const status = item.status === 'failed' ? t('Not sent: {reason}', { reason: t.maybe(item.error ?? '') }) : item.status === 'sending' ? t('Sending…') : t('Waiting for the connection. It will be sent automatically.');
  return (
    <li className="flex flex-row-reverse gap-3" data-outbox={item.status}>
      <span className="size-8 shrink-0" />
      <div className="max-w-[80%] space-y-1 text-end">
        {item.body && <p className="inline-block whitespace-pre-wrap break-words rounded-2xl border border-dashed border-primary px-3 py-2 text-start text-sm">{item.body}</p>}
        {item.link && (
          <div>
            <LinkChip link={item.link} />
          </div>
        )}
        {item.files.map((f) => (
          <p key={f.name} className="text-xs">
            <Paperclip className="inline size-3" aria-hidden /> {f.name}
          </p>
        ))}
        <p className={cn('text-xs', item.status === 'failed' ? 'text-critical' : 'text-muted-foreground')} role={item.status === 'failed' ? 'alert' : undefined}>
          {status}
        </p>
        {item.status === 'failed' && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => void retryOutboxItem(qc, realm, item)}>
              <RotateCcw aria-hidden /> {t('Try again')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void discardOutboxItem(realm, item.clientId)}>
              {t('Discard')}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function Composer({ realm, conv }: { realm: ChatRealm; conv: ChatConversationRow }) {
  const t = useT();
  const qc = useQueryClient();
  const connection = useChatConnection((s) => s.state);
  const [body, setBody] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [link, setLink] = React.useState<ChatLinkOption | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  if (conv.archived) return <p className="border-t border-border p-4 text-sm text-muted-foreground">{t('This channel is archived.')}</p>;

  const send = async () => {
    const text = body.trim();
    if (!text && !files.length && !link) return;
    setError(null);
    // Clear the composer first: anything added while the message is being queued belongs to the next one.
    const message = { conversationId: conv.id, body: text, link: link ? { type: link.type, id: link.id, label: link.label } : null, files };
    setBody('');
    setFiles([]);
    setLink(null);
    await queueMessage(qc, realm, message);
  };
  const addFiles = (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const tooBig = picked.find((f) => f.size > CHAT_ATTACHMENT_MAX_BYTES);
    if (tooBig) setError(t('Files can be up to 10 MB.'));
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= CHAT_ATTACHMENT_MAX_BYTES)].slice(0, CHAT_ATTACHMENTS_PER_MESSAGE));
  };
  return (
    <div className="space-y-2 border-t border-border p-3">
      {connection === 'offline' && (
        <p className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs" role="status">
          <CloudOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t('You are offline. Messages you write are kept on this device and sent when the connection to the SampForce server returns.')}
        </p>
      )}
      {(files.length > 0 || link) && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
              <Paperclip className="size-3.5" aria-hidden /> {f.name} <span className="text-muted-foreground">{formatBytes(f.size)}</span>
              <button type="button" className="rounded-full p-0.5 hover:bg-muted" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={t('Remove {name}', { name: f.name })}>
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {link && <LinkChip link={link} onRemove={() => setLink(null)} />}
        </div>
      )}
      {error && (
        <p className="text-xs text-critical" role="alert">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-chat-file-input="" />
        <Button type="button" variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label={t('Attach a file')}>
          <Paperclip aria-hidden />
        </Button>
        {realm.kind === 'user' && (
          <Button type="button" variant="ghost" size="icon" onClick={() => setPicking(true)} aria-label={t('Link a company, RFQ or deal')}>
            <Link2 aria-hidden />
          </Button>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          maxLength={CHAT_MESSAGE_MAX}
          placeholder={t('Write a message')}
          aria-label={t('Message')}
          className="min-h-[44px] flex-1 resize-none"
          rows={1}
        />
        <Button type="submit" aria-label={t('Send')} disabled={!body.trim() && !files.length && !link}>
          <Send aria-hidden />
        </Button>
      </form>
      {picking && <LinkPicker onPick={(o) => { setLink(o); setPicking(false); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

function LinkPicker({ onPick, onClose }: { onPick: (o: ChatLinkOption) => void; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const options = useLinkOptions(q, true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{t('Link a company, RFQ or deal')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">{t('Everyone in the conversation sees its name; they open it only if they are allowed to.')}</DialogDescription>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name or number')} aria-label={t('Search by name or number')} autoFocus />
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {(options.data ?? []).map((o) => {
            const Icon = LINK_ICON[o.type];
            return (
              <li key={`${o.type}-${o.id}`}>
                <button type="button" className="flex w-full items-center gap-2 rounded-md p-2 text-start text-sm hover:bg-muted" onClick={() => onPick(o)}>
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate">{o.label}</span>
                  <span className="text-xs text-muted-foreground">{t(LINK_KIND[o.type])}</span>
                </button>
              </li>
            );
          })}
          {options.data?.length === 0 && <li className="p-2 text-sm text-muted-foreground">{t('Nothing found.')}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PeopleChecklist({ selected, onChange, exclude }: { selected: string[]; onChange: (ids: string[]) => void; exclude: string[] }) {
  const t = useT();
  const people = useChatPeople(true);
  const [q, setQ] = React.useState('');
  const list = (people.data ?? []).filter((p) => !exclude.includes(p.id) && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search people')} aria-label={t('Search people')} />
      <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-border p-1">
        {list.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-muted">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))} />
              <Avatar name={p.name} className="size-6 text-[10px]" />
              {p.name}
            </label>
          </li>
        ))}
        {list.length === 0 && <li className="p-2 text-sm text-muted-foreground">{t('Nothing found.')}</li>}
      </ul>
    </div>
  );
}

function NewDirectDialog({ realm, onClose, onOpen }: { realm: ChatRealm; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const people = useChatPeople(true);
  const { create } = useChatMutations(realm);
  const [q, setQ] = React.useState('');
  const list = (people.data ?? []).filter((p) => p.id !== realm.selfId && p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="text-lg font-semibold">{t('New message')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">{t('Choose who to write to.')}</DialogDescription>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search people')} aria-label={t('Search people')} autoFocus />
        <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md p-2 text-start text-sm hover:bg-muted"
                disabled={create.isPending}
                onClick={() => create.mutate({ kind: 'DIRECT', userId: p.id }, { onSuccess: (c) => { onOpen(c.id); onClose(); } })}
              >
                <Avatar name={p.name} className="size-7 text-[10px]" /> {p.name}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ChannelDialog({ realm, conv, onClose, onOpen }: { realm: ChatRealm; conv?: ChatConversationRow; onClose: () => void; onOpen?: (id: string) => void }) {
  const t = useT();
  const { create, update } = useChatMutations(realm);
  const [name, setName] = React.useState(conv?.title ?? '');
  const [topic, setTopic] = React.useState(conv?.topic ?? '');
  const [members, setMembers] = React.useState<string[]>([]);
  const [link, setLink] = React.useState<ChatLinkOption | null>(conv?.link ? { type: conv.link.type, id: conv.link.id, label: conv.link.label } : null);
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t('Give the channel a name.'));
    const fail = (err: Error) => setError(t.maybe(err.message));
    if (conv) update.mutate({ id: conv.id, patch: { name: name.trim(), topic: topic.trim() || null, link: link ? { type: link.type, id: link.id } : null } }, { onSuccess: onClose, onError: fail });
    else create.mutate({ kind: 'CHANNEL', name: name.trim(), topic: topic.trim() || null, memberIds: members, link: link ? { type: link.type, id: link.id } : null }, { onSuccess: (c) => { onOpen?.(c.id); onClose(); }, onError: fail });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{conv ? t('Edit channel') : t('New channel')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('A channel is a group conversation, such as Project updates. Only the people in it can read it.')}</DialogDescription>
        <form className="space-y-4" onSubmit={submit}>
          <Field id="chat-channel-name" label={t('Channel name')} error={error ?? undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('Project updates')} />
          </Field>
          <Field id="chat-channel-topic" label={t('What it is about')}>
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} />
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('Linked record')}</p>
            {link ? <LinkChip link={link} onRemove={() => setLink(null)} /> : (
              <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
                <Link2 aria-hidden /> {t('Link a company, RFQ or deal')}
              </Button>
            )}
          </div>
          {!conv && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('People')}</p>
              <PeopleChecklist selected={members} onChange={setMembers} exclude={[realm.selfId]} />
            </div>
          )}
          <div className="flex justify-between gap-2">
            {conv ? (
              <Button type="button" variant="outline" onClick={() => update.mutate({ id: conv.id, patch: { archived: true } }, { onSuccess: onClose })}>
                <Archive aria-hidden /> {t('Archive channel')}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={pending}>
              {conv ? t('Save') : t('Create channel')}
            </Button>
          </div>
        </form>
        {picking && <LinkPicker onPick={(o) => { setLink(o); setPicking(false); }} onClose={() => setPicking(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AddPeopleDialog({ realm, conv, onClose }: { realm: ChatRealm; conv: ChatConversationRow; onClose: () => void }) {
  const t = useT();
  const { addMembers, removeMember } = useChatMutations(realm);
  const [ids, setIds] = React.useState<string[]>([]);
  const users = conv.members.filter((m) => !m.person.operator);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[4%] max-h-[92vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('People in this conversation')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">{conv.kind === 'SUPPORT' ? t('Workspace admins are always on the support line.') : t('Add people from your workspace or take someone out.')}</DialogDescription>
        <ul className="mb-4 space-y-1">
          {conv.members.map((m) => (
            <li key={m.person.id} className="flex items-center gap-2 text-sm">
              <Avatar name={m.person.name} operator={m.person.operator} className="size-6 text-[10px]" />
              <span className="flex-1">{m.person.name}</span>
              {m.person.operator && <Badge tone="warning">{t('Super admin')}</Badge>}
              {m.role === 'OWNER' && <Badge>{t('Owner')}</Badge>}
              {!m.person.operator && m.person.id !== realm.selfId && conv.kind === 'CHANNEL' && (
                <button type="button" className="inline-flex min-h-6 items-center rounded px-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => removeMember.mutate({ id: conv.id, userId: m.person.id })}>
                  {t('Remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
        <PeopleChecklist selected={ids} onChange={setIds} exclude={users.map((m) => m.person.id)} />
        <div className="mt-4 flex justify-end">
          <Button disabled={!ids.length || addMembers.isPending} onClick={() => addMembers.mutate({ id: conv.id, userIds: ids }, { onSuccess: onClose })}>
            <UserPlus aria-hidden /> {t('Add people')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LeaveButton({ realm, conv, onLeft }: { realm: ChatRealm; conv: ChatConversationRow; onLeft: () => void }) {
  const t = useT();
  const { removeMember } = useChatMutations(realm);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t('Leave channel')}
      onClick={() => {
        if (window.confirm(t('Leave this channel?'))) removeMember.mutate({ id: conv.id, userId: realm.selfId }, { onSuccess: onLeft });
      }}
    >
      <LogOut aria-hidden />
    </Button>
  );
}

/** Workspace picker for super admins: open (or start) a workspace's support line. */
export function SupportLinePicker({ tenants, onOpen }: { tenants: { id: string; name: string }[]; onOpen: (tenantId: string) => void }) {
  const t = useT();
  const [id, setId] = React.useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (id) onOpen(id); }}>
      <Select value={id} onChange={(e) => setId(e.target.value)} aria-label={t('Workspace')} className="h-9">
        <option value="">{t('Write to a workspace…')}</option>
        {tenants.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" disabled={!id}>
        {t('Open')}
      </Button>
    </form>
  );
}
