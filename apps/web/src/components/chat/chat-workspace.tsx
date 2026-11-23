'use client';

import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENTS_PER_MESSAGE, CHAT_MESSAGE_MAX, type ChatConversationRow, type ChatDirectoryPerson, type ChatLinkOption, type ChatMessageRow, type ChatSearchHit } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  Bell,
  Building2,
  Check,
  CheckCheck,
  Clock,
  CloudOff,
  FileSpreadsheet,
  FileText,
  Handshake,
  Hash,
  Info,
  LifeBuoy,
  Link2,
  Loader2,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Paperclip,
  Pencil,
  RotateCcw,
  Search,
  SendHorizontal,
  Smile,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { formatBytes } from '@/components/forms/upload-zone';
import { Select, Textarea } from '@/components/crm/select';
import {
  announceTyping,
  attachmentUrl,
  type ChatRealm,
  discardOutboxItem,
  flattenMessages,
  type OutboxItem,
  queueMessage,
  retryOutboxItem,
  stoppedTyping,
  useChatConnection,
  useChatMutations,
  useChatPeople,
  useChatPresence,
  useChatSearch,
  useChatView,
  useConversation,
  useConversations,
  useLinkOptions,
  useMessages,
  useOutbox,
  useTyping,
  useTypingStore,
} from '@/lib/chat';
import { fmtLocale, useT } from '@/lib/i18n';

// ─── Small pieces ───

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** A steady colour per person, from the theme's own colours. */
const AVATAR_TONES = ['bg-primary text-primary-foreground', 'bg-accent text-accent-foreground', 'bg-secondary text-secondary-foreground'];
function tone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

function Avatar({ name, operator, online, className }: { name: string; operator?: boolean; online?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn('relative grid size-10 shrink-0 place-items-center rounded-full text-xs font-semibold shadow-sm ring-2 ring-surface', operator ? 'bg-warning text-background' : tone(name), className)}>
      {initials(name) || '?'}
      {online !== undefined && <span className={cn('absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-surface transition-colors', online ? 'bg-success' : 'bg-muted-foreground/50')} />}
    </span>
  );
}

function GroupAvatar({ c, className }: { c: ChatConversationRow; className?: string }) {
  return (
    <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-full shadow-sm ring-2 ring-surface', c.kind === 'SUPPORT' ? 'bg-warning/20 text-warning' : 'bg-primary/15 text-primary', className)}>
      {c.kind === 'SUPPORT' ? <LifeBuoy className="size-5" /> : <Hash className="size-5" />}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(fmtLocale(), { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string, t: ReturnType<typeof useT>): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t('Today');
  if (d.toDateString() === yesterday.toDateString()) return t('Yesterday');
  return d.toLocaleDateString(fmtLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function shortWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString(fmtLocale(), { day: 'numeric', month: 'short' });
}
function lastSeen(iso: string | null, t: ReturnType<typeof useT>): string {
  if (!iso) return t('Offline');
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return t('Last seen just now');
  if (mins < 60) return t('Last seen {n} min ago', { n: mins });
  if (mins < 24 * 60) return t('Last seen at {time}', { time: time(iso) });
  return t('Last seen {date}', { date: shortWhen(iso) });
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
  const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground';
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {link.href ? (
        <Link href={link.href} className={cn(cls, 'transition-colors hover:bg-muted')}>
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

/** Live, reconnecting or offline, with how events arrive. */
function ConnectionBadge() {
  const t = useT();
  const { state, transport } = useChatConnection();
  if (state === 'live')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success" data-chat-connection="live" data-chat-transport={transport ?? undefined} title={transport === 'polling' ? t('Your network does not pass WebSockets on, so chat checks for news continuously instead. It still arrives within a second or two.') : undefined}>
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        {transport === 'polling' ? t('Live (compatibility mode)') : t('Live')}
      </span>
    );
  if (state === 'offline')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-critical/10 px-2 py-0.5 text-xs font-medium text-critical" data-chat-connection="offline">
        <CloudOff className="size-3.5" aria-hidden /> {t('Offline')}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-chat-connection="connecting">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> {t('Connecting…')}
    </span>
  );
}

function NotificationsToggle() {
  const t = useT();
  const [perm, setPerm] = React.useState<NotificationPermission | 'unsupported'>('unsupported');
  React.useEffect(() => {
    setPerm(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  }, []);
  if (perm !== 'default') return null;
  return (
    <button
      type="button"
      className="inline-flex min-h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => void Notification.requestPermission().then(setPerm)}
    >
      <Bell className="size-3.5" aria-hidden /> {t('Turn on desktop notifications')}
    </button>
  );
}

// ─── The chat screen ───

type ListFilter = 'all' | 'unread' | 'direct' | 'groups';

/** The chat screen: conversations on one side, the open conversation on the other, details on demand. */
export function ChatWorkspace({ realm, header, initialId }: { realm: ChatRealm; header?: React.ReactNode; initialId?: string | null }) {
  const t = useT();
  const [selected, setSelectedState] = React.useState<string | null>(initialId ?? null);
  const [archived, setArchived] = React.useState(false);
  const [filter, setFilter] = React.useState<ListFilter>('all');
  const [q, setQ] = React.useState('');
  const [dialog, setDialog] = React.useState<'new' | 'channel' | null>(null);
  const [details, setDetails] = React.useState(false);
  const list = useConversations(realm, archived);
  const isUser = realm.kind === 'user';
  const search = useChatSearch(isUser ? q : '');
  const people = useChatPeople(isUser);
  const presence = useChatPresence(isUser);
  const typing = useTypingStore((s) => s.typing);
  const setOpen = useChatView((s) => s.setOpen);
  const rows = React.useMemo(() => list.data ?? [], [list.data]);

  const threadRef = React.useRef<HTMLElement>(null);
  const setSelected = React.useCallback((id: string | null) => {
    setSelectedState(id);
    // On a phone the conversation takes the whole screen: bring it (and its composer) into view.
    if (id && !window.matchMedia('(min-width: 1024px)').matches) requestAnimationFrame(() => threadRef.current?.scrollIntoView({ block: 'start' }));
    // Keep the address in step, so a reload or a shared link opens the same conversation.
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('c', id);
    else url.searchParams.delete('c');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  React.useEffect(() => {
    if (!initialId) return;
    setSelectedState(initialId);
    if (!window.matchMedia('(min-width: 1024px)').matches) requestAnimationFrame(() => threadRef.current?.scrollIntoView({ block: 'start' }));
  }, [initialId]);
  React.useEffect(() => {
    if (!selected && rows.length && window.matchMedia('(min-width: 1024px)').matches) setSelectedState(rows[0]!.id);
  }, [rows, selected]);
  React.useEffect(() => {
    setOpen(selected);
    return () => setOpen(null);
  }, [selected, setOpen]);

  const text = q.trim().toLowerCase();
  const otherOf = (c: ChatConversationRow) => (c.kind === 'DIRECT' ? c.members.find((m) => m.person.id !== realm.selfId)?.person : undefined);
  const filtered = rows.filter((c) => {
    if (filter === 'unread' && !c.unread) return false;
    if (filter === 'direct' && c.kind !== 'DIRECT') return false;
    if (filter === 'groups' && c.kind === 'DIRECT') return false;
    if (!text) return true;
    const hay = `${realm.kind === 'operator' ? c.workspace : c.title} ${c.topic ?? ''} ${c.members.map((m) => m.person.name).join(' ')} ${realm.kind === 'operator' ? (c.lastMessagePreview ?? '') : ''}`.toLowerCase();
    return hay.includes(text);
  });
  // People you have no direct message with yet, matching the search, to start one from here.
  const directWith = new Set(rows.filter((c) => c.kind === 'DIRECT').map((c) => otherOf(c)?.id));
  const newPeople = isUser && text ? (people.data ?? []).filter((p) => p.id !== realm.selfId && !directWith.has(p.id) && `${p.name} ${p.email ?? ''}`.toLowerCase().includes(text)).slice(0, 5) : [];
  const unreadCount = rows.filter((c) => c.unread > 0).length;
  const { create } = useChatMutations(realm);

  return (
    <div className={cn('grid gap-4 lg:h-[calc(100dvh-14rem)] lg:min-h-[34rem]', details ? 'lg:grid-cols-[22rem_1fr] 2xl:grid-cols-[22rem_1fr_20rem]' : 'lg:grid-cols-[22rem_1fr]')}>
      <section aria-label={t('Conversations')} className={cn('flex h-[calc(100dvh-11rem)] min-h-[26rem] scroll-mt-20 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:h-auto', selected && 'hidden lg:flex')}>
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <ConnectionBadge />
            {isUser && (
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setDialog('new')}>
                  <MessageSquarePlus aria-hidden /> {t('New message')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDialog('channel')} aria-label={t('New channel')} title={t('New channel')}>
                  <Hash aria-hidden />
                </Button>
              </div>
            )}
          </div>
          {header}
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isUser ? t('Search people, chats and messages') : t('Search workspaces')} aria-label={isUser ? t('Search messages') : t('Search workspaces')} className="rounded-full ps-9" />
            {q && (
              <button type="button" className="absolute end-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted" onClick={() => setQ('')} aria-label={t('Clear search')}>
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          {!text && !archived && (
            <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t('Show')}>
              {(
                [
                  ['all', t('All')],
                  ['unread', unreadCount ? `${t('Unread')} · ${unreadCount}` : t('Unread')],
                  ...(isUser ? [['direct', t('Direct')] as const, ['groups', t('Groups')] as const] : []),
                ] as [ListFilter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors', filter === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.isLoading ? (
            <div className="space-y-2 p-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : list.error ? (
            <div className="space-y-2 p-4 text-sm" role="alert">
              <p className="flex items-center gap-2 text-critical">
                <AlertTriangle className="size-4" aria-hidden /> {t('Could not load your conversations.')}
              </p>
              <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
                <RotateCcw aria-hidden /> {t('Try again')}
              </Button>
            </div>
          ) : (
            <>
              {text && filtered.length > 0 && <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Conversations')}</p>}
              {filtered.length === 0 && !text ? (
                <EmptyList archived={archived} isUser={isUser} filter={filter} onNew={() => setDialog('new')} />
              ) : (
                <ul className="space-y-0.5">
                  {filtered.map((c) => {
                    const other = otherOf(c);
                    const typers = Object.values(typing[c.id] ?? {}).map((x) => x.name);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(c.id)}
                          aria-current={selected === c.id ? 'true' : undefined}
                          data-conversation={c.title}
                          data-unread={c.unread || undefined}
                          className={cn(
                            'group relative flex w-full items-center gap-3 rounded-xl p-2.5 text-start transition-colors hover:bg-muted/70',
                            selected === c.id && 'bg-primary/10 hover:bg-primary/10',
                          )}
                        >
                          {c.unread > 0 && <span aria-hidden className="absolute inset-y-3 start-0 w-1 rounded-full bg-primary" />}
                          {c.kind === 'DIRECT' ? <Avatar name={c.title} online={other ? presence.get(other.id)?.online ?? false : undefined} /> : <GroupAvatar c={c} />}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className={cn('truncate text-sm', c.unread ? 'font-semibold text-foreground' : 'font-medium')}>{realm.kind === 'operator' ? c.workspace : c.kind === 'SUPPORT' ? t('SampForce support') : c.title}</span>
                              <span className={cn('shrink-0 text-[11px]', c.unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>{shortWhen(c.lastMessageAt)}</span>
                            </span>
                            <span className="flex items-center justify-between gap-2">
                              {typers.length ? (
                                <span className="truncate text-xs font-medium italic text-primary">{typers.length === 1 ? t('{name} is typing…', { name: typers[0]! }) : t('Several people are typing…')}</span>
                              ) : (
                                <span className={cn('truncate text-xs', c.unread ? 'text-foreground' : 'text-muted-foreground')}>{c.lastMessagePreview ?? (c.topic || t('No messages yet.'))}</span>
                              )}
                              {c.unread > 0 && (
                                <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground animate-in zoom-in-50" aria-label={t('{n} unread', { n: c.unread })}>
                                  {c.unread > 99 ? '99+' : c.unread}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {newPeople.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('People')}</p>
                  <ul className="space-y-0.5">
                    {newPeople.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={create.isPending}
                          onClick={() => create.mutate({ kind: 'DIRECT', userId: p.id }, { onSuccess: (c) => { setQ(''); setSelected(c.id); } })}
                          className="flex w-full items-center gap-3 rounded-xl p-2.5 text-start hover:bg-muted/70"
                        >
                          <Avatar name={p.name} online={presence.get(p.id)?.online ?? p.online} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{p.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{[p.role, p.email].filter(Boolean).join(' · ')}</span>
                          </span>
                          <MessageSquarePlus className="size-4 text-muted-foreground" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {isUser && text.length >= 2 && <SearchResults hits={search.data} loading={search.isLoading} onOpen={(id) => { setSelected(id); setQ(''); }} />}
              {text && filtered.length === 0 && newPeople.length === 0 && !isUser && <p className="p-4 text-sm text-muted-foreground">{t('Nothing found.')}</p>}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-border p-2">
          {isUser ? (
            <button type="button" className="inline-flex min-h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setArchived((a) => !a)}>
              <Archive className="size-3.5" aria-hidden /> {archived ? t('Back to conversations') : t('Archived channels')}
            </button>
          ) : (
            <span />
          )}
          <NotificationsToggle />
        </div>
      </section>

      <section ref={threadRef} aria-label={t('Conversation')} className={cn('flex h-[calc(100dvh-11rem)] min-h-[26rem] scroll-mt-20 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm lg:h-auto', !selected && 'hidden lg:flex')}>
        {selected ? (
          <Thread key={selected} realm={realm} id={selected} onBack={() => setSelected(null)} onGone={() => setSelected(null)} details={details} onToggleDetails={() => setDetails((d) => !d)} />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div className="max-w-xs space-y-3">
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <MessagesSquare className="size-8" aria-hidden />
              </span>
              <p className="text-base font-semibold">{t('Choose a conversation.')}</p>
              <p className="text-sm text-muted-foreground">{isUser ? t('Or start a new one with anyone in your workspace.') : t('Pick a workspace’s support line on the left.')}</p>
              {isUser && (
                <Button size="sm" onClick={() => setDialog('new')}>
                  <MessageSquarePlus aria-hidden /> {t('New message')}
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      {details && selected && <DetailsPanel realm={realm} id={selected} onClose={() => setDetails(false)} />}

      {isUser && dialog === 'new' && <NewChatDialog realm={realm} onClose={() => setDialog(null)} onOpen={setSelected} />}
      {isUser && dialog === 'channel' && <ChannelDialog realm={realm} onClose={() => setDialog(null)} onOpen={setSelected} />}
    </div>
  );
}

function EmptyList({ archived, isUser, filter, onNew }: { archived: boolean; isUser: boolean; filter: ListFilter; onNew: () => void }) {
  const t = useT();
  const text = archived ? t('No archived channels.') : filter === 'unread' ? t('You are all caught up.') : isUser ? t('No conversations yet. Start a message or a channel.') : t('No support conversations yet.');
  return (
    <div className="space-y-3 p-6 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
        {filter === 'unread' ? <CheckCheck className="size-6" aria-hidden /> : <MessagesSquare className="size-6" aria-hidden />}
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
      {isUser && !archived && filter !== 'unread' && (
        <Button size="sm" variant="outline" onClick={onNew}>
          <MessageSquarePlus aria-hidden /> {t('New message')}
        </Button>
      )}
    </div>
  );
}

function SearchResults({ hits, loading, onOpen }: { hits: ChatSearchHit[] | undefined; loading: boolean; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <>
      <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Messages')}</p>
      {loading ? (
        <Skeleton className="m-2 h-14" />
      ) : !hits?.length ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">{t('No messages match.')}</p>
      ) : (
        <ul className="space-y-0.5" aria-label={t('Search results')}>
          {hits.map((h) => (
            <li key={h.message.id}>
              <button type="button" onClick={() => onOpen(h.conversation.id)} className="w-full rounded-xl p-2.5 text-start hover:bg-muted/70">
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
      )}
    </>
  );
}

// ─── One conversation ───

type Status = 'sent' | 'delivered' | 'read';

/** Where a message of mine has got to: every other person has it on a device (delivered) or has read it. */
function statusOf(c: ChatConversationRow, selfId: string, createdAt: string): Status {
  const others = c.members.filter((m) => m.person.id !== selfId);
  if (!others.length) return 'sent';
  if (others.every((m) => m.lastReadAt && m.lastReadAt >= createdAt)) return 'read';
  if (others.every((m) => m.lastDeliveredAt && m.lastDeliveredAt >= createdAt)) return 'delivered';
  return 'sent';
}

function Ticks({ status, onPrimary }: { status: Status | 'pending' | 'failed'; onPrimary?: boolean }) {
  const t = useT();
  if (status === 'pending') return <Clock className="size-3.5 opacity-80" aria-label={t('Sending…')} />;
  if (status === 'failed') return <AlertTriangle className="size-3.5 text-critical" aria-label={t('Not sent')} />;
  if (status === 'sent') return <Check className="size-3.5 opacity-80" aria-label={t('Sent')} />;
  // Read stands out from delivered: bold on your own bubble, the info colour elsewhere.
  const read = status === 'read';
  return <CheckCheck className={cn('size-3.5', read ? (onPrimary ? 'stroke-[3] opacity-100' : 'text-info') : 'opacity-60')} aria-label={read ? t('Seen') : t('Delivered')} />;
}

function Thread({ realm, id, onBack, onGone, details, onToggleDetails }: { realm: ChatRealm; id: string; onBack: () => void; onGone: () => void; details: boolean; onToggleDetails: () => void }) {
  const t = useT();
  const conv = useConversation(realm, id);
  const messages = useMessages(realm, id);
  const outboxAll = useOutbox(realm, id);
  const presence = useChatPresence(realm.kind === 'user');
  const typers = useTyping(id);
  const connection = useChatConnection((s) => s.state);
  const { markRead } = useChatMutations(realm);
  const [manage, setManage] = React.useState<'people' | 'edit' | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);
  const [newBelow, setNewBelow] = React.useState(0);
  const c = conv.data;
  const rows = React.useMemo(() => flattenMessages(messages.data), [messages.data]);
  const stored = React.useMemo(() => new Set(rows.map((m) => m.clientId)), [rows]);
  // An outbox copy whose message the server already has is about to go: never show both.
  const outbox = outboxAll.filter((o) => !stored.has(o.clientId));
  const last = rows.at(-1);
  const lastMine = [...rows].reverse().find((m) => m.author?.id === realm.selfId && !m.deleted);

  // Where "New messages" goes: fixed when the conversation opens, so it does not jump while reading.
  const [unreadFrom, setUnreadFrom] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (unreadFrom !== undefined || !c || !messages.data) return;
    const mine = c.members.find((m) => m.person.id === realm.selfId);
    const first = c.unread ? rows.find((m) => m.author?.id !== realm.selfId && (!mine?.lastReadAt || m.createdAt > mine.lastReadAt)) : undefined;
    setUnreadFrom(first?.id ?? null);
  }, [c, messages.data, rows, realm.selfId, unreadFrom]);

  // Reading the conversation marks it read (the others then see the read receipt).
  const unread = c?.unread ?? 0;
  React.useEffect(() => {
    if (!last || !unread) return;
    const read = () => {
      if (document.visibilityState === 'visible' && atBottom.current) markRead.mutate({ id, messageId: last.id });
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, last?.id, unread]);

  React.useEffect(() => {
    if (conv.error) onGone();
  }, [conv.error, onGone]);

  const scrollToEnd = React.useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewBelow(0);
  }, []);

  // First paint: jump to the first unread message, or to the end.
  const placed = React.useRef(false);
  React.useLayoutEffect(() => {
    if (placed.current || unreadFrom === undefined || !scroller.current) return;
    placed.current = true;
    const marker = unreadFrom ? scroller.current.querySelector('[data-unread-divider]') : null;
    if (marker) (marker as HTMLElement).scrollIntoView({ block: 'center' });
    else scrollToEnd();
  }, [unreadFrom, scrollToEnd]);

  // New messages: follow them when reading at the end, otherwise offer a button.
  const count = rows.length + outbox.length;
  const prevCount = React.useRef(count);
  const prevLast = React.useRef(last?.id);
  React.useLayoutEffect(() => {
    const grew = count > prevCount.current;
    const newAtEnd = last?.id !== prevLast.current;
    prevCount.current = count;
    prevLast.current = last?.id;
    if (!placed.current || !grew || !newAtEnd) return;
    const mineNow = last?.author?.id === realm.selfId || outbox.length > 0;
    if (atBottom.current || mineNow) scrollToEnd(true);
    else setNewBelow((n) => n + 1);
  }, [count, last, outbox.length, realm.selfId, scrollToEnd]);
  React.useEffect(() => {
    if (typers.length && atBottom.current) scrollToEnd(true);
  }, [typers.length, scrollToEnd]);

  // Scrolling up loads older messages, keeping the reading position.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom.current) {
      setNewBelow(0);
      if (unread && last && document.visibilityState === 'visible') markRead.mutate({ id, messageId: last.id });
    }
    if (el.scrollTop < 80 && messages.hasNextPage && !messages.isFetchingNextPage) {
      const before = el.scrollHeight;
      void messages.fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (scroller.current) scroller.current.scrollTop += scroller.current.scrollHeight - before;
        });
      });
    }
  };

  if (conv.isLoading || !c)
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border p-3">
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <ThreadSkeleton />
      </div>
    );
  const title = realm.kind === 'operator' ? c.workspace : c.kind === 'SUPPORT' ? t('SampForce support') : c.title;
  const others = c.members.filter((m) => m.person.id !== realm.selfId);
  const other = c.kind === 'DIRECT' ? others[0]?.person : undefined;
  const otherPresence = other ? presence.get(other.id) : undefined;
  const onlineCount = c.members.filter((m) => !m.person.operator && (m.person.id === realm.selfId || presence.get(m.person.id)?.online)).length;
  const subtitle = typers.length
    ? typers.length === 1
      ? t('{name} is typing…', { name: typers[0]! })
      : t('Several people are typing…')
    : c.kind === 'SUPPORT'
      ? realm.kind === 'operator'
        ? t('Support line of this workspace')
        : t('Your workspace admins and the SampForce super admins')
      : c.kind === 'DIRECT'
        ? otherPresence?.online
          ? t('Online')
          : lastSeen(otherPresence?.lastSeenAt ?? null, t)
        : c.topic || (realm.kind === 'user' ? t('{n} people, {k} online', { n: c.members.length, k: onlineCount }) : t('{n} people', { n: c.members.length }));

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border bg-surface/80 p-3 backdrop-blur">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t('Back to conversations')}>
          <ArrowLeft aria-hidden />
        </Button>
        {c.kind === 'DIRECT' ? <Avatar name={c.title} online={otherPresence?.online ?? false} /> : <GroupAvatar c={c} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          <p className={cn('truncate text-xs', typers.length ? 'font-medium text-primary' : c.kind === 'DIRECT' && otherPresence?.online ? 'text-success' : 'text-muted-foreground')} data-chat-subtitle="">
            {subtitle}
          </p>
        </div>
        {c.link && <span className="hidden md:inline-flex"><LinkChip link={c.link} /></span>}
        {c.kind !== 'DIRECT' && (
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex" title={c.members.map((m) => m.person.name).join(', ')}>
            <Users className="size-3.5" aria-hidden /> {t('{n} people', { n: c.members.length })}
          </span>
        )}
        {realm.kind === 'user' && c.canManage && (
          <>
            <Button size="sm" variant="outline" onClick={() => setManage('people')}>
              <UserPlus aria-hidden /> <span className="hidden sm:inline">{t('Add people')}</span>
            </Button>
            {c.kind === 'CHANNEL' && (
              <Button size="icon" variant="ghost" onClick={() => setManage('edit')} aria-label={t('Edit channel')}>
                <Pencil aria-hidden />
              </Button>
            )}
          </>
        )}
        {realm.kind === 'user' && c.kind === 'CHANNEL' && <LeaveButton realm={realm} conv={c} onLeft={onGone} />}
        <Button size="icon" variant={details ? 'accent' : 'ghost'} onClick={onToggleDetails} aria-label={t('Conversation details')} aria-pressed={details} className="hidden 2xl:inline-flex">
          <Info aria-hidden />
        </Button>
      </header>

      {connection !== 'live' && (
        <p className={cn('flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs', connection === 'offline' ? 'bg-critical/10 text-critical' : 'bg-warning/10 text-foreground')} role="status">
          {connection === 'offline' ? <CloudOff className="size-3.5 shrink-0" aria-hidden /> : <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />}
          {connection === 'offline' ? t('You are offline. Messages you write are kept on this device and sent when the connection to the SampForce server returns.') : t('Reconnecting… New messages will appear as soon as the connection is back.')}
        </p>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain bg-[radial-gradient(hsl(var(--muted))_1px,transparent_1px)] px-3 py-4 [background-size:18px_18px] sm:px-5" aria-live="polite" aria-relevant="additions">
          {messages.isLoading ? (
            <ThreadSkeleton />
          ) : messages.error ? (
            <div className="grid h-full place-items-center text-center text-sm" role="alert">
              <div className="space-y-2">
                <p className="text-critical">{t('Could not load the messages.')}</p>
                <Button size="sm" variant="outline" onClick={() => void messages.refetch()}>
                  <RotateCcw aria-hidden /> {t('Try again')}
                </Button>
              </div>
            </div>
          ) : rows.length === 0 && outbox.length === 0 ? (
            <EmptyThread realm={realm} conv={c} />
          ) : (
            <ol className="mx-auto max-w-4xl space-y-0.5">
              {messages.hasNextPage ? (
                <li className="flex justify-center py-2">
                  <Button size="sm" variant="ghost" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
                    {messages.isFetchingNextPage ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null} {t('Load earlier messages')}
                  </Button>
                </li>
              ) : (
                <li className="py-2 text-center text-[11px] text-muted-foreground">{t('This is the beginning of the conversation.')}</li>
              )}
              {rows.map((m, i) => {
                const prev = rows[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const grouped = !!prev && !newDay && !prev.deleted && prev.author?.id === m.author?.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000 && m.id !== unreadFrom;
                const mine = m.author?.id === realm.selfId;
                return (
                  <React.Fragment key={m.id}>
                    {newDay && (
                      <li className="sticky top-0 z-10 flex justify-center py-2" aria-hidden>
                        <span className="rounded-full border border-border bg-surface/90 px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">{dayLabel(m.createdAt, t)}</span>
                      </li>
                    )}
                    {m.id === unreadFrom && (
                      <li className="flex items-center gap-3 py-2" data-unread-divider="">
                        <span className="h-px flex-1 bg-primary/50" />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">{t('New messages')}</span>
                        <span className="h-px flex-1 bg-primary/50" />
                      </li>
                    )}
                    <MessageItem realm={realm} m={m} mine={mine} grouped={grouped} status={mine ? statusOf(c, realm.selfId, m.createdAt) : undefined} />
                  </React.Fragment>
                );
              })}
              {lastMine && lastMine.id === last?.id && <ReadReceipt c={c} last={lastMine} selfId={realm.selfId} others={others.length} />}
              {outbox.map((o) => (
                <OutboxLine key={o.clientId} realm={realm} item={o} />
              ))}
              {typers.length > 0 && <TypingBubble names={typers} />}
            </ol>
          )}
        </div>
        {newBelow > 0 && (
          <button type="button" onClick={() => scrollToEnd(true)} className="absolute bottom-4 start-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow animate-in fade-in slide-in-from-bottom-2 rtl:translate-x-1/2">
            <ArrowDown className="size-3.5" aria-hidden /> {t('{n} new messages', { n: newBelow })}
          </button>
        )}
      </div>
      <Composer realm={realm} conv={c} />
      {manage === 'people' && <AddPeopleDialog realm={realm} conv={c} onClose={() => setManage(null)} />}
      {manage === 'edit' && <ChannelDialog realm={realm} conv={c} onClose={() => setManage(null)} />}
    </>
  );
}

function ThreadSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" aria-hidden>
      {[60, 40, 75, 35, 55].map((w, i) => (
        <div key={i} className={cn('flex items-end gap-2', i % 2 && 'flex-row-reverse')}>
          {!(i % 2) && <Skeleton className="size-8 rounded-full" />}
          <Skeleton className="h-10 rounded-2xl" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function EmptyThread({ realm, conv }: { realm: ChatRealm; conv: ChatConversationRow }) {
  const t = useT();
  const qc = useQueryClient();
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-primary/10 text-3xl" aria-hidden>
          👋
        </span>
        <p className="text-base font-semibold">{conv.kind === 'DIRECT' ? t('Start your conversation with {name}', { name: conv.title }) : t('No messages yet. Say hello.')}</p>
        <p className="text-sm text-muted-foreground">{t('Messages are kept on your SampForce server, so everyone in the conversation sees the whole history on every device.')}</p>
        {!conv.archived && (
          <Button size="sm" variant="outline" onClick={() => void queueMessage(qc, realm, { conversationId: conv.id, body: '👋', link: null, files: [] })}>
            {t('Wave hello')} 👋
          </Button>
        )}
      </div>
    </div>
  );
}

function TypingBubble({ names }: { names: string[] }) {
  const t = useT();
  return (
    <li className="flex items-end gap-2 pt-2 animate-in fade-in slide-in-from-bottom-1" data-typing="">
      <span className="size-8 shrink-0" />
      <span className="inline-flex items-center gap-2 rounded-2xl rounded-es-md bg-muted px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          {[0, 150, 300].map((d) => (
            <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
          ))}
        </span>
        <span className="text-xs text-muted-foreground">{names.length === 1 ? t('{name} is typing…', { name: names[0]! }) : t('Several people are typing…')}</span>
      </span>
    </li>
  );
}

function ReadReceipt({ c, last, selfId, others }: { c: ChatConversationRow; last: ChatMessageRow; selfId: string; others: number }) {
  const t = useT();
  const seen = c.members.filter((m) => m.person.id !== selfId && m.lastReadAt && m.lastReadAt >= last.createdAt);
  if (!seen.length) {
    const delivered = statusOf(c, selfId, last.createdAt) === 'delivered';
    return (
      <li className="pe-1 pt-0.5 text-end text-[11px] text-muted-foreground" data-read-receipt={delivered ? 'delivered' : 'sent'}>
        {delivered ? t('Delivered') : t('Sent')}
      </li>
    );
  }
  const label = c.kind === 'DIRECT' || (seen.length === others && others === 1) ? t('Seen') : seen.length === others ? t('Seen by everyone') : t('Seen by {n}', { n: seen.length });
  return (
    <li className="flex items-center justify-end gap-1 pe-1 pt-0.5 text-[11px] text-muted-foreground" title={seen.map((m) => m.person.name).join(', ')} data-read-receipt="seen">
      <CheckCheck className="size-3.5 text-info" aria-hidden /> {label}
    </li>
  );
}

function MessageItem({ realm, m, mine, grouped, status }: { realm: ChatRealm; m: ChatMessageRow; mine: boolean; grouped: boolean; status?: Status }) {
  const t = useT();
  const { edit, remove } = useChatMutations(realm);
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(m.body);
  const name = m.author?.name ?? t('Someone');
  const onlyEmoji = !!m.body && m.body.length <= 8 && /^(?:\p{Extended_Pictographic}|‍|️|\s)+$/u.test(m.body);
  return (
    <li className={cn('group flex items-end gap-2', mine && 'flex-row-reverse', grouped ? 'pt-0.5' : 'pt-3')} data-message={m.id}>
      {grouped ? <span className="size-8 shrink-0" /> : <Avatar name={name} operator={m.author?.operator} className="size-8 text-[10px]" />}
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
        {!grouped && (
          <div className={cn('flex flex-wrap items-baseline gap-2 px-1 text-xs text-muted-foreground', mine && 'justify-end')}>
            <span className="font-semibold text-foreground">{mine ? t('You') : name}</span>
            {m.author?.operator && <Badge tone="warning">{t('Super admin')}</Badge>}
          </div>
        )}
        {m.deleted ? (
          <p className="rounded-2xl border border-dashed border-border px-3 py-2 text-sm italic text-muted-foreground">{t('This message was deleted.')}</p>
        ) : editing ? (
          <form
            className="w-full min-w-[16rem] space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              edit.mutate({ id: m.id, body: text.trim() }, { onSuccess: () => setEditing(false) });
            }}
          >
            <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label={t('Edit message')} maxLength={CHAT_MESSAGE_MAX} className="min-h-[64px]" autoFocus />
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
            {(m.body || (!m.link && !m.attachments.length)) && (
              <div
                className={cn(
                  'relative whitespace-pre-wrap break-words text-start text-sm shadow-sm',
                  onlyEmoji ? 'bg-transparent px-1 text-4xl leading-tight shadow-none' : 'rounded-2xl px-3 py-2',
                  !onlyEmoji && (mine ? 'bg-primary text-primary-foreground' : 'border border-border bg-surface-raised text-foreground'),
                  !onlyEmoji && !grouped && (mine ? 'rounded-ee-md' : 'rounded-es-md'),
                )}
              >
                {m.body}
                <span className={cn('ms-2 inline-flex translate-y-0.5 items-center gap-1 align-bottom text-[10px]', onlyEmoji ? 'text-muted-foreground' : mine ? 'text-primary-foreground' : 'text-muted-foreground')}>
                  {m.editedAt && <span>{t('(edited)')}</span>}
                  <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
                  {mine && status && <Ticks status={status} onPrimary={!onlyEmoji} />}
                </span>
              </div>
            )}
            {m.link && <LinkChip link={m.link} />}
            {m.attachments.length > 0 && (
              <ul className={cn('flex flex-wrap gap-2', mine && 'justify-end')}>
                {m.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={attachmentUrl(realm, m.conversationId, a.id)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-sm transition-colors hover:bg-muted" download={a.name}>
                      <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="size-4" aria-hidden />
                      </span>
                      <span className="flex flex-col">
                        <span className="max-w-[14rem] truncate font-medium">{a.name}</span>
                        <span className="text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {!m.body && (m.link || m.attachments.length > 0) && (
              <span className="inline-flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
                {mine && status && <Ticks status={status} />}
              </span>
            )}
            {m.writtenAt && <p className="px-1 text-[11px] text-muted-foreground">{t('Written at {time} while offline', { time: `${shortWhen(m.writtenAt)} ${time(m.writtenAt)}`.trim() })}</p>}
          </>
        )}
      </div>
      {mine && !m.deleted && !editing && (
        <div className="flex shrink-0 gap-0.5 self-center opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100 lg:opacity-0">
          {m.body && (
            <button type="button" className="inline-flex min-h-6 min-w-6 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { setText(m.body); setEditing(true); }}>
              <Pencil className="size-3" aria-hidden /> <span className="sr-only sm:not-sr-only">{t('Edit')}</span>
            </button>
          )}
          <button type="button" className="inline-flex min-h-6 min-w-6 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted" onClick={() => { if (window.confirm(t('Delete this message?'))) remove.mutate(m.id); }}>
            <Trash2 className="size-3" aria-hidden /> <span className="sr-only sm:not-sr-only">{t('Delete')}</span>
          </button>
        </div>
      )}
    </li>
  );
}

function OutboxLine({ realm, item }: { realm: ChatRealm; item: OutboxItem }) {
  const t = useT();
  const qc = useQueryClient();
  const failed = item.status === 'failed';
  const status = failed ? t('Not sent: {reason}', { reason: t.maybe(item.error ?? '') }) : item.status === 'sending' ? t('Sending…') : t('Waiting for the connection. It will be sent automatically.');
  return (
    <li className="flex flex-row-reverse items-end gap-2 pt-1 animate-in fade-in slide-in-from-bottom-1" data-outbox={item.status}>
      <span className="size-8 shrink-0" />
      <div className="flex max-w-[85%] flex-col items-end gap-1 sm:max-w-[70%]">
        {item.body && (
          <p className={cn('whitespace-pre-wrap break-words rounded-2xl rounded-ee-md px-3 py-2 text-start text-sm', failed ? 'border border-critical/60 bg-critical/5' : 'bg-primary/70 text-primary-foreground')}>
            {item.body}
            <span className="ms-2 inline-flex translate-y-0.5 items-center align-bottom">
              <Ticks status={failed ? 'failed' : 'pending'} />
            </span>
          </p>
        )}
        {item.link && <LinkChip link={item.link} />}
        {item.files.map((f) => (
          <p key={f.name} className="inline-flex items-center gap-1 rounded-xl border border-dashed border-border px-3 py-1.5 text-xs">
            <Paperclip className="size-3" aria-hidden /> {f.name}
          </p>
        ))}
        <p className={cn('px-1 text-[11px]', failed ? 'text-critical' : 'text-muted-foreground')} role={failed ? 'alert' : undefined}>
          {status}
        </p>
        {failed && (
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

const EMOJI = ['👍', '🙏', '🎉', '✅', '👀', '😊', '😂', '❤️', '🔥', '🚀', '👏', '🤝', '💡', '📌', '⏰', '📞', '📈', '💰', '❗', '❓', '🙌', '😅', '🤔', '👋'];

function Composer({ realm, conv }: { realm: ChatRealm; conv: ChatConversationRow }) {
  const t = useT();
  const qc = useQueryClient();
  const [body, setBody] = React.useState('');
  const [files, setFiles] = React.useState<File[]>([]);
  const [link, setLink] = React.useState<ChatLinkOption | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [emoji, setEmoji] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);
  // Grow with the text, up to about eight lines.
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);
  if (conv.archived)
    return (
      <p className="flex items-center gap-2 border-t border-border p-4 text-sm text-muted-foreground">
        <Archive className="size-4" aria-hidden /> {t('This channel is archived.')}
      </p>
    );

  const send = async () => {
    const text = body.trim();
    if (!text && !files.length && !link) return;
    setError(null);
    // Clear the composer first: anything added while the message is being queued belongs to the next one.
    const message = { conversationId: conv.id, body: text, link: link ? { type: link.type, id: link.id, label: link.label } : null, files };
    setBody('');
    setFiles([]);
    setLink(null);
    setEmoji(false);
    stoppedTyping(conv.id);
    area.current?.focus();
    await queueMessage(qc, realm, message);
  };
  const addFiles = (list: FileList | File[] | null) => {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    const tooBig = picked.find((f) => f.size > CHAT_ATTACHMENT_MAX_BYTES);
    if (tooBig) setError(t('Files can be up to 10 MB.'));
    setFiles((f) => [...f, ...picked.filter((x) => x.size <= CHAT_ATTACHMENT_MAX_BYTES)].slice(0, CHAT_ATTACHMENTS_PER_MESSAGE));
  };
  const insert = (e: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    setBody((b) => b.slice(0, at) + e + b.slice(el?.selectionEnd ?? at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + e.length, at + e.length);
    });
  };
  const near = body.length > CHAT_MESSAGE_MAX - 200;
  return (
    <div
      className={cn('relative space-y-2 border-t border-border bg-surface p-3', dragging && 'ring-2 ring-inset ring-primary')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {dragging && <p className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-primary/10 text-sm font-medium text-primary">{t('Drop files to attach them')}</p>}
      {(files.length > 0 || link) && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs animate-in fade-in zoom-in-95">
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
      {emoji && (
        <div className="grid grid-cols-8 gap-1 rounded-xl border border-border bg-popover p-2 shadow-lg animate-in fade-in slide-in-from-bottom-2 sm:max-w-sm" role="group" aria-label={t('Emoji')}>
          {EMOJI.map((e) => (
            <button key={e} type="button" className="rounded-md p-1 text-xl transition-transform hover:scale-125 hover:bg-muted motion-reduce:hover:scale-100" onClick={() => insert(e)} aria-label={e}>
              {e}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-1.5 rounded-2xl border border-input bg-background p-1.5 shadow-sm transition-shadow focus-within:border-primary focus-within:shadow-glow"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-chat-file-input="" />
        <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => fileRef.current?.click()} aria-label={t('Attach a file')}>
          <Paperclip aria-hidden />
        </Button>
        {realm.kind === 'user' && (
          <Button type="button" variant="ghost" size="icon" className="hidden shrink-0 rounded-full sm:inline-flex" onClick={() => setPicking(true)} aria-label={t('Link a company, RFQ or deal')}>
            <Link2 aria-hidden />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" onClick={() => setEmoji((v) => !v)} aria-label={t('Emoji')} aria-pressed={emoji}>
          <Smile aria-hidden />
        </Button>
        <textarea
          ref={area}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (e.target.value.trim()) announceTyping(conv.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          maxLength={CHAT_MESSAGE_MAX}
          placeholder={t('Write a message')}
          aria-label={t('Message')}
          className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
          rows={1}
        />
        <Button type="submit" size="icon" className="shrink-0 rounded-full transition-transform active:scale-90" aria-label={t('Send')} disabled={!body.trim() && !files.length && !link}>
          <SendHorizontal aria-hidden className="rtl:-scale-x-100" />
        </Button>
      </form>
      <p className="flex justify-between px-2 text-[11px] text-muted-foreground">
        <span className="hidden sm:inline">{t('Enter to send, Shift + Enter for a new line')}</span>
        {near && <span className={cn(body.length >= CHAT_MESSAGE_MAX && 'text-critical')}>{`${body.length} / ${CHAT_MESSAGE_MAX}`}</span>}
      </p>
      {picking && <LinkPicker onPick={(o) => { setLink(o); setPicking(false); }} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** People, presence, the linked record and the files of the open conversation. */
function DetailsPanel({ realm, id, onClose }: { realm: ChatRealm; id: string; onClose: () => void }) {
  const t = useT();
  const conv = useConversation(realm, id);
  const messages = useMessages(realm, id);
  const presence = useChatPresence(realm.kind === 'user');
  const c = conv.data;
  if (!c) return null;
  const files = flattenMessages(messages.data).flatMap((m) => m.attachments.map((a) => ({ ...a, conversationId: m.conversationId, at: m.createdAt })));
  return (
    <aside aria-label={t('Conversation details')} className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm 2xl:flex">
      <div className="flex items-center justify-between border-b border-border p-3">
        <h3 className="text-sm font-semibold">{t('Details')}</h3>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('Close')}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        {c.link && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Linked record')}</h4>
            <LinkChip link={c.link} />
          </section>
        )}
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('People')}</h4>
          <ul className="space-y-2">
            {c.members.map((m) => {
              const p = presence.get(m.person.id);
              return (
                <li key={m.person.id} className="flex items-center gap-2 text-sm">
                  <Avatar name={m.person.name} operator={m.person.operator} online={m.person.operator ? undefined : m.person.id === realm.selfId || (p?.online ?? false)} className="size-8 text-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{m.person.id === realm.selfId ? t('{name} (you)', { name: m.person.name }) : m.person.name}</span>
                    {!m.person.operator && m.person.id !== realm.selfId && <span className="block truncate text-xs text-muted-foreground">{p?.online ? t('Online') : lastSeen(p?.lastSeenAt ?? null, t)}</span>}
                  </span>
                  {m.person.operator && <Badge tone="warning">{t('Super admin')}</Badge>}
                  {m.role === 'OWNER' && <Badge>{t('Owner')}</Badge>}
                </li>
              );
            })}
          </ul>
        </section>
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Files')}</h4>
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('No files shared yet.')}</p>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => (
                <li key={f.id}>
                  <a href={attachmentUrl(realm, f.conversationId, f.id)} download={f.name} className="flex items-center gap-2 rounded-lg p-1.5 text-xs hover:bg-muted">
                    <FileText className="size-4 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-muted-foreground">{shortWhen(f.at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

/** Anyone in the workspace: one person opens a direct message; several make a group. */
function NewChatDialog({ realm, onClose, onOpen }: { realm: ChatRealm; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const people = useChatPeople(true);
  const presence = useChatPresence(true);
  const { create } = useChatMutations(realm);
  const [q, setQ] = React.useState('');
  const [picked, setPicked] = React.useState<ChatDirectoryPerson[]>([]);
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const text = q.trim().toLowerCase();
  const all = (people.data ?? []).filter((p) => p.id !== realm.selfId);
  const list = all
    .filter((p) => `${p.name} ${p.email ?? ''} ${p.role ?? ''}`.toLowerCase().includes(text))
    .sort((a, b) => Number(presence.get(b.id)?.online ?? b.online) - Number(presence.get(a.id)?.online ?? a.online) || a.name.localeCompare(b.name));
  const group = picked.length > 1;
  const fail = (err: Error) => setError(t.maybe(err.message));
  const start = (who: ChatDirectoryPerson[]) => {
    setError(null);
    if (who.length === 1) return create.mutate({ kind: 'DIRECT', userId: who[0]!.id }, { onSuccess: (c) => { onOpen(c.id); onClose(); }, onError: fail });
    const groupName = name.trim() || who.map((p) => p.name.split(' ')[0]).join(', ').slice(0, 80);
    create.mutate({ kind: 'CHANNEL', name: groupName, memberIds: who.map((p) => p.id) }, { onSuccess: (c) => { onOpen(c.id); onClose(); }, onError: fail });
  };
  const toggle = (p: ChatDirectoryPerson) => setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[6%] max-h-[88vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('New message')}</DialogTitle>
        <DialogDescription className="mb-3 text-sm text-muted-foreground">{t('Choose who to write to.')} {t('Pick more than one person to start a group.')}</DialogDescription>
        {picked.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pe-1 ps-1 text-xs font-medium text-primary animate-in zoom-in-95">
                <Avatar name={p.name} className="size-5 text-[8px] ring-0" />
                {p.name}
                <button type="button" className="rounded-full p-0.5 hover:bg-primary/20" onClick={() => toggle(p)} aria-label={t('Remove {name}', { name: p.name })}>
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search by name, email or role')} aria-label={t('Search people')} className="ps-9" autoFocus />
        </div>
        <ul className="mt-3 max-h-72 space-y-0.5 overflow-y-auto" aria-label={t('People')}>
          {people.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
          {list.map((p) => {
            const on = picked.some((x) => x.id === p.id);
            const online = presence.get(p.id)?.online ?? p.online;
            return (
              <li key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-start text-sm transition-colors hover:bg-muted/70', on && 'bg-primary/10')}
                  disabled={create.isPending}
                  onClick={() => (picked.length ? toggle(p) : start([p]))}
                >
                  <Avatar name={p.name} online={online} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[online ? t('Online') : null, p.role, p.email].filter(Boolean).join(' · ')}</span>
                  </span>
                  {on && <Check className="size-4 text-primary" aria-hidden />}
                </button>
                {!picked.length && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => toggle(p)} aria-label={t('Add {name} to a group', { name: p.name })} title={t('Add to a group')}>
                    <UserPlus aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
          {!people.isLoading && list.length === 0 && (
            <li className="space-y-1 p-3 text-center text-sm text-muted-foreground">
              <p>{all.length ? t('Nobody matches.') : t('Nobody else is in your workspace yet.')}</p>
            </li>
          )}
        </ul>
        {group && (
          <Field id="chat-group-name" label={t('Group name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={picked.map((p) => p.name.split(' ')[0]).join(', ')} />
          </Field>
        )}
        {error && (
          <p className="mt-2 text-sm text-critical" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Link href="/app/team" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            {t('Someone missing? Invite them to your workspace')}
          </Link>
          {picked.length > 0 && (
            <Button disabled={create.isPending} onClick={() => start(picked)}>
              {group ? <Users aria-hidden /> : <MessageSquarePlus aria-hidden />} {group ? t('Start group') : t('Start chat')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
