'use client';

import type { GoalProgress, GoalUnit } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { CheckCircle2, Info } from 'lucide-react';
import { Bar } from '@/components/task-plans/progress-ring';
import { type Translator, useT } from '@/lib/i18n';

/** A goal's figure in its own unit: "12", "$4,500" or "80%". */
export function goalValue(t: Translator, v: number | null, unit: GoalUnit, currency: string): string {
  if (v === null) return '—';
  if (unit === 'money') return new Intl.NumberFormat(t.formatLocale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  if (unit === 'percent') return `${new Intl.NumberFormat(t.formatLocale, { maximumFractionDigits: 1 }).format(v)}%`;
  return new Intl.NumberFormat(t.formatLocale, { maximumFractionDigits: 1 }).format(v);
}

/** Each goal with what it asks for, what is done, what remains and the percentage, counted on the server. */
export function GoalList({ goals, currency, compact = false }: { goals: GoalProgress[]; currency: string; compact?: boolean }) {
  const t = useT();
  return (
    <ul className={cn('space-y-2.5', compact && 'space-y-2')} data-goal-list>
      {goals.map((g) => (
        <li key={g.id} data-goal={g.measure} data-goal-met={g.met || undefined}>
          <div className="flex items-start justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              {g.met ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-label={t('Goal met')} /> : null}
              <span className="truncate" title={t.maybe(g.rule)}>
                {t.maybe(g.label)}
              </span>
              {!compact && (
                <span title={t.maybe(g.rule)} className="shrink-0 text-muted-foreground">
                  <Info className="size-3.5" aria-hidden />
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {g.measurable ? `${Math.round(g.percent)}%` : t('Not measured yet')}
            </span>
          </div>
          <div className="mt-1">
            <Bar percent={g.measurable ? g.percent : 0} label={t.maybe(g.label)} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{t('Required: {value}', { value: goalValue(t, g.required, g.unit, currency) })}</span>
            <span>{t('Done: {value}', { value: goalValue(t, g.done, g.unit, currency) })}</span>
            {!g.met && g.measurable && <span>{t('Remaining: {value}', { value: goalValue(t, g.remaining, g.unit, currency) })}</span>}
            {g.per === 'DAY' && <span>{t('{value} per working day', { value: goalValue(t, g.amount, g.unit, currency) })}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
