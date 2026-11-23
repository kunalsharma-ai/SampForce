'use client';

import { Badge } from '@dealflow/ui';
import type { ClientState, PaymentStatus } from '@dealflow/types';
import { PAYMENT_STATUS_LABEL } from '@dealflow/types';
import { formatMinor } from '@/lib/billing';

/** Shared pieces of the Console Admin screens (ADR 0071). The console is for platform staff and reads in English. */

export const selectClass = 'h-9 w-full rounded-md border border-input bg-surface px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const STATE: Record<ClientState, { label: string; tone: 'success' | 'warning' | 'critical' }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  DEACTIVATED: { label: 'Deactivated', tone: 'critical' },
};

export function StateBadge({ state }: { state: ClientState }) {
  return <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const tone = status === 'PAID' ? 'success' : status === 'OVERDUE' ? 'critical' : status === 'PENDING' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{PAYMENT_STATUS_LABEL[status]}</Badge>;
}

export function price(cents: number | null, currency: string, frequency?: 'MONTH' | 'YEAR'): string {
  if (cents === null) return 'Priced per client';
  return `${formatMinor(cents, currency)}${frequency ? ` / ${frequency === 'YEAR' ? 'year' : 'month'}` : ''}`;
}

/** "3 / 4 used" with a bar; an empty limit means unlimited. */
export function UsageMeter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const over = max !== null && used > max;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className={over ? 'font-medium text-critical tabular' : 'tabular'} data-usage={label}>
          {max === null ? `${used} used · no limit` : `${used} / ${max} used`}
        </span>
      </div>
      {max !== null && (
        <div className="mt-1 h-1.5 rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
          <div className={`h-full rounded-full ${over ? 'bg-critical' : pct >= 100 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Number input where empty means "no limit" (null) or "use the plan's" (undefined) depending on the caller. */
export function toLimit(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function toCents(value: string): number | null {
  const t = value.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function months(n: number): string {
  return `${n} ${n === 1 ? 'month' : 'months'}`;
}
