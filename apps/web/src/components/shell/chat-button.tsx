'use client';

import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useChatBackground, useChatUnread, userRealm } from '@/lib/chat';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Team chat in the top bar: the unread count, and the outbox sender that runs on every page. The live stream opens
 * only on the chat page itself.
 */
export function ChatButton() {
  const t = useT();
  const { data } = useSession();
  const on = useHasFeature('team_chat');
  const realm = React.useMemo(() => (data && on ? userRealm(data.tenant.id, data.user.id) : null), [data, on]);
  useChatBackground(realm);
  const unread = useChatUnread(realm).data?.total ?? 0;
  if (!realm) return null;
  const label = unread ? t('Team chat, {n} unread', { n: unread }) : t('Team chat');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon" className="relative">
          <Link href="/app/chat" aria-label={label} data-chat-unread={unread}>
            <MessagesSquare aria-hidden />
            {unread > 0 && (
              <span aria-hidden className="absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-background">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
