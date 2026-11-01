'use client';

import { Badge, cn } from '@dealflow/ui';
import { DEAL_RISK_LABELS, type DealPriority, type DealRow } from '@dealflow/types';
import { Flag } from 'lucide-react';
import { type MessageKey, useT } from '@/lib/i18n';

export const PRIORITY_LABEL: Record<DealPriority, MessageKey> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const PRIORITY_TONE = { HIGH: 'critical', MEDIUM: 'warning', LOW: 'neutral' } as const;
const RISK_TONE = { low: 'bg-success', medium: 'bg-warning', high: 'bg-critical' } as const;

export function PriorityBadge({ priority, className }: { priority: DealPriority | null; className?: string }) {
  const t = useT();
  if (!priority) return null;
  return (
    <Badge tone={PRIORITY_TONE[priority]} className={cn('gap-1', className)}>
      <Flag className="size-3" aria-hidden />
      {t(PRIORITY_LABEL[priority])}
      <span className="sr-only">{t(' priority')}</span>
    </Badge>
  );
}

/** Health from deal intelligence as a coloured dot plus text; "Not scored" when no score is stored yet. */
export function RiskIndicator({ health, compact }: { health: DealRow['health']; compact?: boolean }) {
  const t = useT();
  const label = health ? `${t.maybe(DEAL_RISK_LABELS[health.risk])} · ${health.score.toLocaleString(t.formatLocale)}` : t('Not scored');
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={health ? t('Deal health {score} of 100', { score: health.score }) : t('No health score yet')}>
      <span className={cn('size-2 shrink-0 rounded-full', health ? RISK_TONE[health.risk] : 'border border-muted-foreground')} aria-hidden />
      {compact ? <span className="sr-only">{t('Health: {label}', { label })}</span> : <span>{label}</span>}
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
