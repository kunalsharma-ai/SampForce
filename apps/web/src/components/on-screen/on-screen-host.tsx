'use client';

import { cn } from '@dealflow/ui';
import {
  AlarmClock,
  Ban,
  Bell,
  BellRing,
  Building2,
  CalendarClock,
  CheckCheck,
  CircleCheckBig,
  ClipboardList,
  Coffee,
  Handshake,
  Megaphone,
  MessagesSquare,
  Moon,
  OctagonAlert,
  PhoneCall,
  PlaneTakeoff,
  RotateCcw,
  Send,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sun,
  Target,
  TimerReset,
  TrendingDown,
  Trophy,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useQuickChat } from '@/components/chat/quick-chat';
import { useChatNotices } from '@/lib/chat';
import { useT } from '@/lib/i18n';
import { useMotionLevel } from '@/lib/motion';
import { useNotificationActions, useNotificationPreferences } from '@/lib/notification-center';
import { type OnScreenCard, type OnScreenKind, useOnScreen } from '@/lib/on-screen';
import './on-screen.css';

type Anim = 'rise' | 'set' | 'steam' | 'spin' | 'drop' | 'tick' | 'jump' | 'shake' | 'wiggle' | 'pulse' | 'fly' | 'swing' | 'half' | 'fall';

interface Look {
  icon: LucideIcon;
  /** The small label above the title ("Checked in", "Task completed"). */
  label: string;
  /** Gradient start and end, and the glow under the picture. */
  a: string;
  b: string;
  anim: Anim;
  /** Sparkles burst round the picture. */
  sparkle?: boolean;
}

const LOOKS: Record<OnScreenKind, Look> = {
  'check-in': { icon: Sun, label: 'Checked in', a: '#f59e0b', b: '#fde047', anim: 'rise' },
  'check-out': { icon: Moon, label: 'Checked out', a: '#4338ca', b: '#a78bfa', anim: 'set' },
  break: { icon: Coffee, label: 'On a break', a: '#b45309', b: '#fbbf24', anim: 'steam' },
  back: { icon: RotateCcw, label: 'Back from break', a: '#0d9488', b: '#5eead4', anim: 'spin' },
  away: { icon: TimerReset, label: 'Away', a: '#64748b', b: '#cbd5e1', anim: 'swing' },
  'task-assigned': { icon: ClipboardList, label: 'New task', a: '#2563eb', b: '#60a5fa', anim: 'drop' },
  'task-updated': { icon: ClipboardList, label: 'Task updated', a: '#4f46e5', b: '#818cf8', anim: 'wiggle' },
  'task-progress': { icon: TimerReset, label: 'Task in progress', a: '#0891b2', b: '#67e8f9', anim: 'spin' },
  'task-half': { icon: Target, label: 'Task half done', a: '#7c3aed', b: '#c4b5fd', anim: 'half' },
  'task-done': { icon: CircleCheckBig, label: 'Task completed', a: '#059669', b: '#6ee7b7', anim: 'tick', sparkle: true },
  'task-blocked': { icon: OctagonAlert, label: 'Task blocked', a: '#dc2626', b: '#fb923c', anim: 'shake' },
  'task-overdue': { icon: AlarmClock, label: 'Task not completed in time', a: '#dc2626', b: '#f97316', anim: 'shake' },
  'task-cancelled': { icon: Ban, label: 'Task cancelled', a: '#475569', b: '#94a3b8', anim: 'fall' },
  message: { icon: MessagesSquare, label: 'New message', a: '#2563eb', b: '#38bdf8', anim: 'wiggle' },
  'approval-request': { icon: ShieldQuestion, label: 'Approval requested', a: '#d97706', b: '#facc15', anim: 'pulse' },
  'approval-granted': { icon: ShieldCheck, label: 'Approval granted', a: '#059669', b: '#34d399', anim: 'tick', sparkle: true },
  'approval-rejected': { icon: ShieldX, label: 'Approval rejected', a: '#be123c', b: '#fb7185', anim: 'shake' },
  'company-created': { icon: Building2, label: 'New company', a: '#0369a1', b: '#7dd3fc', anim: 'rise' },
  'contact-created': { icon: UserPlus, label: 'New contact', a: '#0f766e', b: '#5eead4', anim: 'drop' },
  'deal-created': { icon: Handshake, label: 'New deal', a: '#9333ea', b: '#f0abfc', anim: 'jump' },
  'deal-won': { icon: Trophy, label: 'Deal won', a: '#e02424', b: '#ffc857', anim: 'jump', sparkle: true },
  'deal-lost': { icon: TrendingDown, label: 'Deal lost', a: '#475569', b: '#94a3b8', anim: 'fall' },
  'sampbidx-done': { icon: PlaneTakeoff, label: 'Sent to SampBidx', a: '#e02424', b: '#fb923c', anim: 'fly', sparkle: true },
  'sampbidx-failed': { icon: Send, label: 'SampBidx transfer failed', a: '#b91c1c', b: '#f87171', anim: 'shake' },
  sampbidx: { icon: Send, label: 'SampBidx', a: '#e02424', b: '#fb923c', anim: 'fly' },
  'call-done': { icon: PhoneCall, label: 'Call completed', a: '#16a34a', b: '#86efac', anim: 'wiggle' },
  'follow-up': { icon: CalendarClock, label: 'Follow-up due', a: '#ea580c', b: '#fdba74', anim: 'swing' },
  target: { icon: Target, label: 'Target', a: '#c026d3', b: '#f0abfc', anim: 'pulse' },
  award: { icon: Trophy, label: 'Employee of the Month', a: '#d97706', b: '#fde047', anim: 'jump', sparkle: true },
  pip: { icon: Target, label: 'Performance plan', a: '#0f766e', b: '#5eead4', anim: 'pulse' },
  announcement: { icon: Megaphone, label: 'Announcement', a: '#e02424', b: '#f472b6', anim: 'wiggle' },
  summary: { icon: CheckCheck, label: 'More notifications', a: '#e02424', b: '#ffc857', anim: 'pulse' },
  general: { icon: Bell, label: 'Notification', a: '#e02424', b: '#ffc857', anim: 'swing' },
};

export function lookOf(kind: OnScreenKind): Look {
  return LOOKS[kind];
}

/** How long a card stays when the person's preferences are not loaded yet. */
const DEFAULT_SECONDS = 6;
/** Team chat pop-ups keep their own length (R9). */
const CHAT_SECONDS = 7;

/**
 * The corner of the screen where on-screen notifications appear (spec section 9), on every workspace page and in the
 * Console. Cards slide in under the header (in the bottom corner on wide screens), never over it, newest last, pause while the pointer or
 * keyboard focus is on them, and close by themselves after the person's chosen time. Team chat pop-ups appear here too.
 */
export function OnScreenHost() {
  const cards = useOnScreen((s) => s.cards);
  const push = useOnScreen((s) => s.push);
  const chatNotices = useChatNotices((s) => s.notices);
  const dismissChat = useChatNotices((s) => s.dismiss);
  const quickOpen = useQuickChat((s) => s.open);
  const [mounted, setMounted] = React.useState(false);
  const t = useT();
  React.useEffect(() => setMounted(true), []);

  // Team chat's pop-ups (lib/chat) become cards here, so there is one stack on screen, not two.
  React.useEffect(() => {
    if (!chatNotices.length) return;
    push(chatNotices.map((n) => ({ id: `chat:${n.id}`, kind: 'message' as const, title: n.title, body: n.preview, href: n.href, chat: { conversationId: n.conversationId } })));
    for (const n of chatNotices) dismissChat(n.id);
  }, [chatNotices, push, dismissChat]);

  // While quick chat is open its own list shows new messages; their cards would only cover its composer (R9).
  const shown = quickOpen ? cards.filter((c) => !c.chat) : cards;
  if (!mounted) return null;
  // In a portal: the header's backdrop blur would otherwise pin "fixed" cards to the header.
  return createPortal(
    <section
      aria-label={t('On-screen notifications')}
      // Under the header on phones and tablets (the bottom has the navigation bar) and from 1024 to 1279 pixels (the
      // bottom middle has achievement celebrations); in the bottom corner on wide screens, clear of both.
      className="pointer-events-none fixed inset-x-2 top-[4.5rem] z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:end-4 sm:w-[23rem] xl:bottom-4 xl:top-auto"
      data-onscreen-host=""
    >
      <div aria-live="polite" className="contents">
        <AnimatePresence initial={false}>
          {shown.map((c) => (
            <Card key={c.id} card={c} />
          ))}
        </AnimatePresence>
      </div>
    </section>,
    document.body,
  );
}

function Card({ card }: { card: OnScreenCard }) {
  const t = useT();
  const router = useRouter();
  const dismiss = useOnScreen((s) => s.dismiss);
  const prefs = useNotificationPreferences(!card.chat && !card.preview).data;
  const { read } = useNotificationActions();
  const motionLevel = useMotionLevel();
  const look = LOOKS[card.kind];
  const Icon = look.icon;
  const seconds = card.chat ? CHAT_SECONDS : (prefs?.popupSeconds ?? DEFAULT_SECONDS);
  const ms = seconds * 1000;
  const [paused, setPaused] = React.useState(false);
  const hover = React.useRef(false);
  const focus = React.useRef(false);
  const left = React.useRef(ms);
  const startedAt = React.useRef(Date.now());

  const close = React.useCallback(() => dismiss(card.id), [dismiss, card.id]);

  // The card's own clock: it runs while nobody is reading it, and sticky cards (action needed) wait to be closed.
  React.useEffect(() => {
    if (card.sticky || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(close, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(800, left.current - (Date.now() - startedAt.current));
    };
  }, [card.sticky, paused, close]);

  const hold = () => setPaused(hover.current || focus.current);

  const open = () => {
    if (card.notificationId) read.mutate([card.notificationId]);
    close();
    if (card.href) router.push(card.href);
  };

  const title = card.kind === 'summary' ? t('{count} more notifications', { count: card.count ?? 0 }) : card.title;
  const body = card.kind === 'summary' ? t('Open the Notification Center to see them all.') : card.body;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.9, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      role="status"
      data-onscreen-card={card.kind}
      data-chat-notice={card.chat ? card.title : undefined}
      data-paused={paused ? 'yes' : 'no'}
      onMouseEnter={() => {
        hover.current = true;
        hold();
      }}
      onMouseLeave={() => {
        hover.current = false;
        hold();
      }}
      onFocus={() => {
        focus.current = true;
        hold();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focus.current = false;
        hold();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
      style={{ ['--sfo-a' as string]: look.a, ['--sfo-b' as string]: look.b, ['--sfo-glow' as string]: `${look.a}59`, ['--sfo-ms' as string]: `${ms}ms` }}
      className="sfo-card pointer-events-auto relative overflow-hidden rounded-2xl border border-border/80 bg-popover/95 text-popover-foreground shadow-[0_18px_40px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl"
    >
      <div className="flex items-start gap-3 py-3 pe-2 ps-4">
        <Picture kind={card.kind} icon={Icon} look={look} />
        <button type="button" onClick={open} className="min-w-0 flex-1 rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {/* The kind's colour on a dot: the label itself stays readable on light and dark cards. */}
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: look.a }} />
            {card.preview ? `${t(look.label as 'Notification')} · ${t('Preview')}` : t(look.label as 'Notification')}
          </span>
          <span className="mt-0.5 block text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{title}</span>
          {body && <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{body}</span>}
          {card.from && <span className="mt-1 block truncate text-[0.7rem] text-muted-foreground">{t('From {name}', { name: card.from })}</span>}
        </button>
        <button
          type="button"
          onClick={close}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('Close this notification')}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {!card.sticky && motionLevel === 'full' && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-muted/60">
          <span className="sfo-timer block h-full w-full" />
        </span>
      )}
      {card.sticky && <span className="sr-only">{t('Stays until you close it.')}</span>}
    </motion.div>
  );
}

/** The card's picture: the kind's gradient tile with its icon, plus the extras some kinds animate. */
function Picture({ kind, icon: Icon, look }: { kind: OnScreenKind; icon: LucideIcon; look: Look }) {
  return (
    <span aria-hidden className="relative mt-0.5 grid size-11 shrink-0 place-items-center" data-sfo-anim={look.anim}>
      <span className="sfo-ripple absolute inset-0 rounded-2xl" />
      <span className="sfo-tile relative grid size-11 place-items-center overflow-hidden rounded-2xl text-white">
        {kind === 'check-in' && (
          <svg viewBox="0 0 44 44" className="sfo-rays absolute inset-0 size-full opacity-60">
            {Array.from({ length: 8 }, (_, i) => (
              <line key={i} x1="22" y1="4" x2="22" y2="9" stroke="#fff" strokeWidth="2" strokeLinecap="round" transform={`rotate(${i * 45} 22 22)`} />
            ))}
          </svg>
        )}
        {kind === 'break' && (
          <span className="absolute inset-x-0 top-1 flex justify-center gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="sfo-steam block h-2 w-0.5 rounded-full bg-white/80" />
            ))}
          </span>
        )}
        {kind === 'task-half' ? (
          <svg viewBox="0 0 28 28" className="relative size-7">
            <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="3.5" />
            <circle className="sfo-ring-fill" cx="14" cy="14" r="11" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="69.1" strokeDashoffset="34.6" transform="rotate(-90 14 14)" />
            <text x="14" y="17.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">50%</text>
          </svg>
        ) : (
          <Icon className={cn('sfo-icon relative size-5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]', kind === 'break' && 'mt-2')} strokeWidth={2.4} />
        )}
      </span>
      {look.sparkle &&
        SPARKS.map((s, i) => <span key={i} className="sfo-spark" style={{ ['--dx' as string]: `${s[0]}px`, ['--dy' as string]: `${s[1]}px`, ['--c' as string]: s[2] }} />)}
      {kind === 'approval-request' && <BellRing className="absolute -end-1 -top-1 size-3.5 rounded-full bg-amber-400 p-0.5 text-white" />}
    </span>
  );
}

const SPARKS: [number, number, string][] = [
  [-26, -18, '#ffc857'],
  [24, -22, '#ffffff'],
  [30, 6, '#fb7185'],
  [-30, 10, '#34d399'],
  [-6, -30, '#60a5fa'],
  [10, 28, '#ffc857'],
  [-18, 26, '#f472b6'],
];
