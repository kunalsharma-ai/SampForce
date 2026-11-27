'use client';

import { CALL_OUTCOME_LABELS, type CallOutcome, type CallOutcomeDef, DEFAULT_CALL_OUTCOMES } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import {
  Ban,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarClock,
  Clock,
  FileCheck2,
  FileClock,
  Flag,
  Handshake,
  Languages,
  type LucideIcon,
  MailPlus,
  MoreHorizontal,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  UserX,
  Users,
  Voicemail,
} from 'lucide-react';
import { useCallOutcomes } from '@/lib/calls';
import { useT } from '@/lib/i18n';

/** The icons an outcome may have (OUTCOME_ICONS), drawn with lucide. */
export const OUTCOME_ICON: Record<string, LucideIcon> = {
  PhoneMissed,
  PhoneOff,
  PhoneCallback: PhoneIncoming,
  ThumbsDown,
  ThumbsUp,
  PhoneForwarded,
  MailPlus,
  CalendarClock,
  CalendarCheck,
  Sparkles,
  BadgeCheck,
  FileClock,
  FileCheck2,
  Handshake,
  Building2,
  PhoneCall,
  Voicemail,
  MoreHorizontal,
  Star,
  Flag,
  Clock,
  Ban,
  Languages,
  UserX,
  Users,
};

const FALLBACK = (key: string): CallOutcomeDef => DEFAULT_CALL_OUTCOMES.find((d) => d.key === key) ?? { key, label: 'Other', icon: 'MoreHorizontal', color: '#64748b', tone: 'neutral', reached: false, action: 'NONE', followUpInMinutes: null, custom: false, active: true };

/** The workspace's outcomes, and a look-up that also knows outcomes removed since a call was logged. */
export function useOutcomeLookup() {
  const q = useCallOutcomes();
  const list = q.data ?? DEFAULT_CALL_OUTCOMES;
  const map = new Map(list.map((o) => [o.key, o]));
  return { list, active: list.filter((o) => o.active), get: (key: string) => map.get(key) ?? FALLBACK(key), loading: q.isPending };
}

/** An outcome's label: SampForce's own are translated; a workspace's are shown as its admins wrote them. */
export function useOutcomeLabel() {
  const t = useT();
  return (o: CallOutcomeDef) => (!o.custom && CALL_OUTCOME_LABELS[o.key as CallOutcome] === o.label ? t.maybe(o.label) : o.label);
}

export function OutcomeIcon({ def, className }: { def: CallOutcomeDef; className?: string }) {
  const Icon = OUTCOME_ICON[def.icon] ?? MoreHorizontal;
  return <Icon aria-hidden className={className} />;
}

/**
 * The colour darkened just enough for white text on it to meet WCAG AA (4.5:1), keeping its hue. Admins pick any
 * colour for an outcome, so light ones are made readable here instead of refused.
 */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  let rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  for (let i = 0; i < 20 && 1.05 / (lum(rgb) + 0.05) < 4.6; i++) rgb = rgb.map((v) => Math.round(v * 0.92));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function OutcomeChip({ outcome, className }: { outcome: string; className?: string }) {
  const { get } = useOutcomeLookup();
  const label = useOutcomeLabel();
  const def = get(outcome);
  return (
    <span data-outcome={def.key} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold text-white', className)} style={{ backgroundColor: readableOn(def.color) }}>
      <OutcomeIcon def={def} className="size-3" />
      {label(def)}
    </span>
  );
}
