'use client';

import { Badge, Button, cn } from '@dealflow/ui';
import { ArrowLeft, Bell, BellOff, Maximize2, MessagesSquare, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { type ChatRealm, useChatSound, useChatUnread, useChatView, useConversations } from '@/lib/chat';
import { useT } from '@/lib/i18n';
import { Thread } from './chat-workspace';

/*
 * Quick chat (redesign R9): team chat from any page without leaving it. On a computer a slim tab sits on the right
 * edge in a gutter the page keeps free (the main area has room for it), so it never covers anything; on phones it is a
 * tab of the bottom bar. It opens a panel with your conversations and one conversation at a time.
 */

interface QuickChatState {
  open: boolean;
  conversationId: string | null;
  set: (patch: Partial<Pick<QuickChatState, 'open' | 'conversationId'>>) => void;
}
export const useQuickChat = create<QuickChatState>((set) => ({ open: false, conversationId: null, set: (patch) => set(patch) }));

/** The right-edge tab, from the lg breakpoint up. Hidden on the Team chat page itself. */
export function QuickChatTab({ realm }: { realm: ChatRealm }) {
  const t = useT();
  const pathname = usePathname();
  const open = useQuickChat((s) => s.open);
  const set = useQuickChat((s) => s.set);
  const unread = useChatUnread(realm).data?.total ?? 0;
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted || pathname.startsWith('/app/chat')) return null;
  // In a portal: the top bar's backdrop blur would otherwise pin a "fixed" element to the bar.
  return createPortal(
    <button
      type="button"
      data-quick-chat-tab=""
      onClick={() => set({ open: !open })}
      aria-expanded={open}
      aria-label={t('Open quick chat, {n} unread', { n: unread })}
      className="fixed end-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-s-2xl border border-e-0 border-border bg-primary px-2 py-3 text-primary-foreground shadow-lg transition-[padding] hover:pe-3 lg:flex"
    >
      <MessagesSquare className="size-5" aria-hidden />
      <span className="text-[11px] font-semibold [writing-mode:vertical-rl] rtl:rotate-180">{t('Quick chat')}</span>
      {unread > 0 && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[10px] font-bold text-white tabular" data-quick-chat-unread={unread}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>,
    document.body,
  );
}

/** The bottom bar's chat tab on phones and small tablets. */
export function QuickChatBarButton({ realm, className }: { realm: ChatRealm; className?: string }) {
  const t = useT();
  const set = useQuickChat((s) => s.set);
  const open = useQuickChat((s) => s.open);
  const unread = useChatUnread(realm).data?.total ?? 0;
  return (
    <button
      type="button"
      onClick={() => set({ open: !open })}
      aria-expanded={open}
      aria-label={t('Open quick chat, {n} unread', { n: unread })}
      data-quick-chat-bar=""
      className={cn('relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px]', open ? 'font-semibold text-primary' : 'text-muted-foreground', className)}
    >
      <MessagesSquare className="size-5" aria-hidden />
      {t('Quick chat')}
      {unread > 0 && <span className="absolute end-[22%] top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[hsl(var(--sf-red))] px-1 text-[9px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

/** The panel: your conversations, or one conversation. */
export function QuickChatPanel({ realm }: { realm: ChatRealm }) {
  const t = useT();
  const { open, conversationId, set } = useQuickChat();
  const pathname = usePathname();
  const sound = useChatSound();
  const setView = useChatView((s) => s.setOpen);
  const conversations = useConversations(open ? realm : null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // The open conversation counts as on screen: no pop-up or sound for it.
  React.useEffect(() => {
    if (!open || !conversationId) return;
    setView(conversationId);
    return () => setView(null);
  }, [open, conversationId, setView]);
  // Escape closes the panel.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && set({ open: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, set]);
  // Going to the full chat page closes it.
  React.useEffect(() => {
    if (pathname.startsWith('/app/chat')) set({ open: false });
  }, [pathname, set]);
  if (!mounted || !open) return null;
  const list = (conversations.data ?? []).filter((c) => c.kind === 'DIRECT' || c.kind === 'CHANNEL' || c.kind === 'SUPPORT');
  return createPortal(
    <section
      aria-label={t('Quick chat')}
      data-quick-chat=""
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] top-14 z-40 flex flex-col overflow-hidden border border-border bg-background shadow-2xl animate-in fade-in slide-in-from-right-4 sm:inset-x-auto sm:end-3 sm:w-[24rem] sm:rounded-2xl lg:bottom-4 lg:end-16 lg:top-20 lg:w-[26rem]"
    >
      <header className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {conversationId ? (
          <Button variant="ghost" size="icon" onClick={() => set({ conversationId: null })} aria-label={t('Back to conversations')}>
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
          </Button>
        ) : (
          <MessagesSquare className="mx-2 size-4 text-primary" aria-hidden />
        )}
        <h2 className="flex-1 truncate text-sm font-semibold">{t('Quick chat')}</h2>
        <Button variant="ghost" size="icon" onClick={() => sound.set(!sound.on)} aria-pressed={sound.on} aria-label={t('Sound for new messages')} title={t('Sound for new messages')} data-quick-chat-sound={sound.on ? 'on' : 'off'}>
          {sound.on ? <Bell aria-hidden /> : <BellOff aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" asChild>
          <Link href={conversationId ? `/app/chat?c=${conversationId}` : '/app/chat'} aria-label={t('Open full chat')} title={t('Open full chat')}>
            <Maximize2 aria-hidden />
          </Link>
        </Button>
        <Button variant="ghost" size="icon" onClick={() => set({ open: false })} aria-label={t('Close quick chat')}>
          <X aria-hidden />
        </Button>
      </header>
      {conversationId ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <Thread key={conversationId} realm={realm} id={conversationId} onBack={() => set({ conversationId: null })} onGone={() => set({ conversationId: null })} details={false} onToggleDetails={() => undefined} embedded />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-1" data-quick-chat-list="">
          {conversations.data && list.length === 0 && <li className="p-4 text-sm text-muted-foreground">{t('No conversations yet. Start one from Team chat.')}</li>}
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => set({ conversationId: c.id })} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start hover:bg-muted" data-quick-chat-conversation={c.title}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{c.title.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', c.unread > 0 && 'font-semibold')}>{c.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? ''}</span>
                </span>
                {c.unread > 0 && <Badge tone="critical">{c.unread}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>,
    document.body,
  );
}
