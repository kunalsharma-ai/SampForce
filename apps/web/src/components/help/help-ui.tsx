'use client';

import type { SupportTicketPriority, SupportTicketStatus } from '@dealflow/types';
import { Badge } from '@dealflow/ui';
import {
  Bot,
  Building,
  Building2,
  CalendarCheck,
  CreditCard,
  Database,
  FileSignature,
  Handshake,
  HeartHandshake,
  KeyRound,
  Layers,
  LifeBuoy,
  LineChart,
  type LucideIcon,
  MessagesSquare,
  Network,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  Smartphone,
  UserRoundCog,
} from 'lucide-react';
import { useT } from '@/lib/i18n';

/** The lucide icon behind each Help Center category's icon name (packages/help keeps names, not components). */
const ICONS: Record<string, LucideIcon> = {
  rocket: Rocket,
  'user-round-cog': UserRoundCog,
  network: Network,
  'building-2': Building2,
  handshake: Handshake,
  'calendar-check': CalendarCheck,
  'messages-square': MessagesSquare,
  send: Send,
  'file-signature': FileSignature,
  bot: Bot,
  'line-chart': LineChart,
  'heart-handshake': HeartHandshake,
  plug: Plug,
  database: Database,
  'credit-card': CreditCard,
  smartphone: Smartphone,
  'life-buoy': LifeBuoy,
  building: Building,
  layers: Layers,
  'key-round': KeyRound,
  'shield-check': ShieldCheck,
};

export function categoryIcon(name: string): LucideIcon {
  return ICONS[name] ?? LifeBuoy;
}

/** A category's icon in a soft disc of its chart colour, so the tiles stay readable in every theme. */
export function ToneIcon({ icon, tone, size = 'md' }: { icon: string; tone: number; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = categoryIcon(icon);
  const box = size === 'lg' ? 'size-12 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl';
  const glyph = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5';
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center ${box}`}
      style={{ background: `hsl(var(--chart-${tone}) / 0.14)`, color: `hsl(var(--chart-${tone}))`, boxShadow: `inset 0 0 0 1px hsl(var(--chart-${tone}) / 0.25)` }}
    >
      <Icon className={glyph} />
    </span>
  );
}

const STATUS_TONE: Record<SupportTicketStatus, 'primary' | 'warning' | 'success' | 'neutral'> = {
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'primary',
  IN_PROGRESS: 'primary',
  AWAITING_USER: 'success',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export function useStatusLabel() {
  const t = useT();
  const labels: Record<SupportTicketStatus, string> = {
    SUBMITTED: t('Submitted'),
    UNDER_REVIEW: t('Under review'),
    IN_PROGRESS: t('In progress'),
    AWAITING_USER: t('Awaiting response'),
    RESOLVED: t('Resolved'),
    CLOSED: t('Closed query'),
  };
  return (s: SupportTicketStatus) => labels[s];
}

export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  const label = useStatusLabel();
  return (
    <Badge tone={STATUS_TONE[status]} data-ticket-status={status}>
      {label(status)}
    </Badge>
  );
}

export function usePriorityLabel() {
  const t = useT();
  const labels: Record<SupportTicketPriority, string> = { LOW: t('Low priority'), NORMAL: t('Normal priority'), HIGH: t('High priority') };
  return (p: SupportTicketPriority) => labels[p];
}
