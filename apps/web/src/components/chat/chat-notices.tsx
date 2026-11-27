'use client';

import * as React from 'react';
import { OnScreenHost } from '@/components/on-screen/on-screen-host';

/**
 * Pop-ups for new messages that arrive while you are on another page or in another conversation. Since the on-screen
 * notifications (spec section 9) they are cards in the one on-screen stack, so this is that stack.
 */
export const ChatNotices = OnScreenHost;

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
