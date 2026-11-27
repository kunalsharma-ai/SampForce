'use client';

import { cn } from '@dealflow/ui';
import { MessagesSquare, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { type ChatNotice, useChatNotices } from '@/lib/chat';
import { useT } from '@/lib/i18n';
import { useQuickChat } from './quick-chat';

const SHOW_MS = 7000;

/** Pop-ups for new messages that arrive while you are on another page or in another conversation. */
export function ChatNotices() {
  const notices = useChatNotices((s) => s.notices);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // While quick chat is open its list shows new messages; pop-ups would only cover its composer (R9).
  const quickOpen = useQuickChat((s) => s.open);
  // In a portal: the top bar's backdrop blur would otherwise pin "fixed" pop-ups to the bar.
  if (!mounted || quickOpen) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {notices.map((n) => (
        <Notice key={n.id} n={n} />
      ))}
    </div>,
    document.body,
  );
}

function Notice({ n }: { n: ChatNotice }) {
  const t = useT();
  const dismiss = useChatNotices((s) => s.dismiss);
  const [hover, setHover] = React.useState(false);
  React.useEffect(() => {
    if (hover) return;
    const timer = setTimeout(() => dismiss(n.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [dismiss, hover, n.id]);
  return (
    <div
      role="status"
      data-chat-notice={n.title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn('pointer-events-auto flex items-start gap-3 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-xl animate-in fade-in slide-in-from-bottom-4')}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
        <MessagesSquare className="size-4" aria-hidden />
      </span>
      <Link href={n.href} className="min-w-0 flex-1" onClick={() => dismiss(n.id)}>
        <span className="block text-xs text-muted-foreground">{t('New message')}</span>
        <span className="block truncate text-sm font-semibold">{n.title}</span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{n.preview}</span>
      </Link>
      <button type="button" className="rounded-full p-1 text-muted-foreground hover:bg-muted" onClick={() => dismiss(n.id)} aria-label={t('Close')}>
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Shows the unread count in the browser tab's title, "(3) Deals · SampForce". */
export function useUnreadTitle(unread: number): void {
  React.useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\) /, '');
      const next = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    // Pages set their own title on navigation; put the count back.
    const head = document.querySelector('title');
    const obs = head ? new MutationObserver(apply) : null;
    if (head && obs) obs.observe(head, { childList: true, characterData: true, subtree: true });
    return () => {
      obs?.disconnect();
      document.title = document.title.replace(/^\(\d+\+?\) /, '');
    };
  }, [unread]);
}
