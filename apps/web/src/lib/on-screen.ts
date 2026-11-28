'use client';

import { create } from 'zustand';

/*
 * On-screen notifications (Kunal's spec section 9): an animated card in the corner of the screen for a few seconds
 * when something happens (a teammate checks in or takes a break, a task is assigned or finished, an approval is
 * asked for or decided, a message, a deal is won, a SampBidx transfer finishes...). Every one of them is also a
 * notification in the bell and the Notification Center, so nothing is lost when a card goes away.
 */

/** The look of a card: its picture, colours and animation. Worked out from the notification's type. */
export type OnScreenKind =
  | 'check-in'
  | 'check-out'
  | 'break'
  | 'back'
  | 'away'
  | 'task-assigned'
  | 'task-updated'
  | 'task-progress'
  | 'task-half'
  | 'task-done'
  | 'task-blocked'
  | 'task-overdue'
  | 'task-cancelled'
  | 'message'
  | 'approval-request'
  | 'approval-granted'
  | 'approval-rejected'
  | 'company-created'
  | 'contact-created'
  | 'deal-created'
  | 'deal-won'
  | 'deal-lost'
  | 'sampbidx-done'
  | 'sampbidx-failed'
  | 'sampbidx'
  | 'call-done'
  | 'follow-up'
  | 'target'
  | 'award'
  | 'pip'
  | 'announcement'
  | 'summary'
  | 'general';

/** The card for a notification type (exact types first, then families). */
export function onScreenKindOf(type: string): OnScreenKind {
  const exact: Record<string, OnScreenKind> = {
    'team.status.checked_in': 'check-in',
    'team.status.working': 'check-in',
    'team.status.available': 'check-in',
    'team.status.checked_out': 'check-out',
    'team.status.on_break': 'break',
    'team.status.back': 'back',
    'team.status.away': 'away',
    'task.assigned': 'task-assigned',
    'task.updated': 'task-updated',
    'task.commented': 'task-updated',
    'task.acknowledged': 'task-progress',
    'task.in_progress': 'task-progress',
    'task.half_completed': 'task-half',
    'task.completed': 'task-done',
    'task.blocked': 'task-blocked',
    'task.overdue': 'task-overdue',
    'task.not_completed': 'task-overdue',
    'task.cancelled': 'task-cancelled',
    'task.due_soon': 'follow-up',
    'approval.requested': 'approval-request',
    'quote.approval_requested': 'approval-request',
    'approval.approved': 'approval-granted',
    'approval.granted': 'approval-granted',
    'approval.rejected': 'approval-rejected',
    'company.created': 'company-created',
    'contact.created': 'contact-created',
    'deal.created': 'deal-created',
    'deal.won': 'deal-won',
    'deal.lost': 'deal-lost',
    'sampbidx.transfer_completed': 'sampbidx-done',
    'sampbidx.transfer_failed': 'sampbidx-failed',
    'call.completed': 'call-done',
  };
  if (exact[type]) return exact[type];
  if (type === 'team.status') return 'check-in';
  if (type.startsWith('sampbidx.')) return 'sampbidx';
  if (type.startsWith('followup.')) return 'follow-up';
  if (type.startsWith('target.')) return 'target';
  // Employee of the Month and performance improvement plans (built in another part of the redesign).
  if (type.startsWith('recognition.')) return 'award';
  if (type.startsWith('pip.')) return 'pip';
  if (type.startsWith('announcement.')) return 'announcement';
  if (type.startsWith('task.')) return 'task-updated';
  if (/^(inbox|sms|whatsapp|portal)\.(message|received|note)/.test(type) || type === 'support.reply') return 'message';
  return 'general';
}

export interface OnScreenCard {
  /** Unique per card; a notification's id when it comes from one, so the same notification never shows twice. */
  id: string;
  kind: OnScreenKind;
  title: string;
  body?: string | null;
  /** Where clicking the card goes. */
  href?: string | null;
  /** The notification it shows, marked read when the card is opened. */
  notificationId?: string;
  /** Who it is from, for the small line under the title. */
  from?: string | null;
  /** Urgent and action-required ones stay until closed. */
  sticky?: boolean;
  /** For the "N more" summary card: the notifications it stands for. */
  count?: number;
  /** A chat pop-up (team chat keeps its own sound and quick-chat rules). */
  chat?: { conversationId: string };
  /** Shown only in the settings preview, so the picture can be tried without anything happening. */
  preview?: boolean;
}

/** At most this many cards at once; more arrive as one summary card instead of a wall of pop-ups. */
export const MAX_CARDS = 4;
/** A burst bigger than this (recurring tasks generated at once, a teammate importing...) becomes one summary card. */
export const BURST = 3;
/** Each id is remembered this long, so a card closed in one tab is not shown again by a late message from another. */
const SEEN_MS = 10 * 60_000;

interface OnScreenState {
  cards: OnScreenCard[];
  seen: Map<string, number>;
  push: (cards: OnScreenCard[]) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useOnScreen = create<OnScreenState>((set, get) => ({
  cards: [],
  seen: new Map(),
  push: (incoming) => {
    const now = Date.now();
    const seen = get().seen;
    for (const [k, at] of seen) if (now - at > SEEN_MS) seen.delete(k);
    const fresh = incoming.filter((c) => !seen.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) seen.set(c.id, now);
    set((s) => {
      // A chat card replaces the older card of the same conversation.
      const kept = s.cards.filter((c) => !fresh.some((f) => f.chat && c.chat?.conversationId === f.chat.conversationId));
      const all = [...kept, ...fresh];
      if (all.length <= MAX_CARDS) return { cards: all };
      // Too many: the newest stay, the rest fold into one summary card at the top.
      const overflow = all.slice(0, all.length - (MAX_CARDS - 1));
      const folded = overflow.reduce((n, c) => n + (c.count ?? 1), 0);
      const summary: OnScreenCard = { id: `summary:${now}`, kind: 'summary', title: '', count: folded, href: '/app/notifications' };
      return { cards: [summary, ...all.slice(all.length - (MAX_CARDS - 1))] };
    });
  },
  dismiss: (id) => set((s) => ({ cards: s.cards.filter((c) => c.id !== id) })),
  clear: () => set({ cards: [] }),
}));

/**
 * Browser tests opt in to the cards (like celebrations), so they never cover the buttons other tests click. Team chat
 * pop-ups are older and stay on.
 */
export function onScreenTestsOptedOut(): boolean {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return false;
  try {
    return window.localStorage.getItem('sampforce.onscreen.test') !== 'on';
  } catch {
    return true;
  }
}
