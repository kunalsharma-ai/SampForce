'use client';

import { Badge, cn } from '@dealflow/ui';
import { DEAL_RISK_LABELS, type DealPriority, type DealRow } from '@dealflow/types';
import { Flag } from 'lucide-react';

export const PRIORITY_LABEL: Record<DealPriority, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const PRIORITY_TONE = { HIGH: 'critical', MEDIUM: 'warning', LOW: 'neutral' } as const;
const RISK_TONE = { low: 'bg-success', medium: 'bg-warning', high: 'bg-critical' } as const;

export function PriorityBadge({ priority, className }: { priority: DealPriority | null; className?: string }) {
  if (!priority) return null;
  return (
    <Badge tone={PRIORITY_TONE[priority]} className={cn('gap-1', className)}>
      <Flag className="size-3" aria-hidden />
      {PRIORITY_LABEL[priority]}
      <span className="sr-only"> priority</span>
    </Badge>
  );
}

/** Health from deal intelligence as a coloured dot plus text; "Not scored" when no score is stored yet. */
export function RiskIndicator({ health, compact }: { health: DealRow['health']; compact?: boolean }) {
  const label = health ? `${DEAL_RISK_LABELS[health.risk]} · ${health.score}` : 'Not scored';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={health ? `Deal health ${health.score} of 100` : 'No health score yet'}>
      <span className={cn('size-2 shrink-0 rounded-full', health ? RISK_TONE[health.risk] : 'border border-muted-foreground')} aria-hidden />
      {compact ? <span className="sr-only">Health: {label}</span> : <span>{label}</span>}
    </span>
  );
}

export function initials(name: string | undefined | null) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
