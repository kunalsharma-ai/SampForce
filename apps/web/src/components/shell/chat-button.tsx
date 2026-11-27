'use client';

import * as React from 'react';
import { ChatNotices, useUnreadTitle } from '@/components/chat/chat-notices';
import { useChatLive, useChatUnread, userRealm } from '@/lib/chat';
import { useHasFeature } from '@/lib/features';
import { useSession } from '@/lib/session';

/** The signed-in person's chat realm, or null without team chat. */
export function useChatRealm() {
  const { data } = useSession();
  const on = useHasFeature('team_chat');
  return React.useMemo(() => (data && on ? userRealm(data.tenant.id, data.user.id) : null), [data, on]);
}

/**
 * Team chat's live connection on every page (ADR 0069), so new messages pop up and counts update wherever you are.
 * Since the header redesign (R1) the unread count shows on Team chat in the sidebar, not as a header button.
 */
export function ChatLive() {
  const realm = useChatRealm();
  useChatLive(realm);
  const unread = useChatUnread(realm).data?.total ?? 0;
  useUnreadTitle(realm ? unread : 0);
  if (!realm) return null;
  return <ChatNotices />;
}

/** The unread chat count for the sidebar's Team chat item. */
export function useChatUnreadTotal(): number | null {
  const realm = useChatRealm();
  const unread = useChatUnread(realm).data?.total ?? 0;
  return realm ? unread : null;
}
