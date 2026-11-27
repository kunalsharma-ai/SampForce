'use client';

import type { TeamApprovalCategory, TeamApprovalStatus } from '@dealflow/types';
import { Ban, BadgeCheck, CheckCircle2, Database, Hourglass, ListTodo, type LucideIcon, MessageSquareText, PencilLine, Target, TimerOff, Trash2, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';

/** Each kind of request and each status has its own colour and icon, used the same way on every screen. */

export const CATEGORY_LOOK: Record<TeamApprovalCategory, { icon: LucideIcon; color: string; label: string }> = {
  delete: { icon: Trash2, color: '#e11d48', label: 'Delete' },
  record_edit: { icon: PencilLine, color: '#d97706', label: 'Edit a record' },
  task_change: { icon: ListTodo, color: '#0284c7', label: 'Task change' },
  target_change: { icon: Target, color: '#7c3aed', label: 'Target change' },
  data_change: { icon: Database, color: '#0d9488', label: 'Data change' },
  other: { icon: MessageSquareText, color: '#475569', label: 'Other request' },
};

export const STATUS_LOOK: Record<TeamApprovalStatus, { icon: LucideIcon; tone: 'warning' | 'success' | 'critical' | 'neutral' | 'primary'; color: string; label: string }> = {
  PENDING: { icon: Hourglass, tone: 'warning', color: '#d97706', label: 'Pending' },
  APPROVED: { icon: CheckCircle2, tone: 'success', color: '#059669', label: 'Approved' },
  REJECTED: { icon: XCircle, tone: 'critical', color: '#e11d48', label: 'Rejected' },
  CANCELLED: { icon: Ban, tone: 'neutral', color: '#64748b', label: 'Cancelled' },
  EXPIRED: { icon: TimerOff, tone: 'neutral', color: '#64748b', label: 'Expired' },
  COMPLETED: { icon: BadgeCheck, tone: 'primary', color: '#2563eb', label: 'Completed' },
};

/** A soft tile in a colour, for an icon (icons carry no text, so the tint never hurts contrast). */
export function tile(color: string): CSSProperties {
  return { color, background: `linear-gradient(135deg, ${color}2e, ${color}12)`, boxShadow: `inset 0 0 0 1px ${color}33, 0 6px 16px -10px ${color}` };
}

export function IconTile({ icon: Icon, color, size = 'md' }: { icon: LucideIcon; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12 rounded-2xl' : size === 'sm' ? 'size-8 rounded-lg' : 'size-10 rounded-xl';
  const glyph = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5';
  return (
    <span className={`grid shrink-0 place-items-center ${box}`} style={tile(color)} aria-hidden>
      <Icon className={glyph} />
    </span>
  );
}

/** Initials in a coloured circle, for the people on a request. */
export function PersonDot({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = ['#1d4ed8', '#6d28d9', '#be185d', '#0e7490', '#047857', '#b45309', '#4338ca', '#0f766e'];
  const color = hues[hash % hues.length]!;
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: color }} aria-hidden>
      {initials}
    </span>
  );
}
