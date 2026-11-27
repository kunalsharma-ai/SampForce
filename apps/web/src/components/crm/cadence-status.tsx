'use client';

import type { ContactCadence } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { CircleCheck, CircleSlash, MailCheck, MailQuestion, Repeat } from 'lucide-react';
import { formatDate } from '@/lib/crm';
import { useMarkInitialEmail } from '@/lib/follow-up-cadence';
import { type MessageKey, useT } from '@/lib/i18n';

/** Why a cadence stopped, as the server records it, in words people read. */
const STOP_REASON: Record<string, MessageKey> = {
  'the contact replied': 'the contact replied',
  'the contact replied by email': 'the contact replied by email',
  'the contact called': 'the contact called',
  'a call took place': 'a call took place',
  'a meeting took place': 'a meeting took place',
  'negotiation started': 'negotiation started',
  'an RFQ arrived': 'an RFQ arrived',
};

/**
 * One employee's place in the follow-up cadence (ADR 0083): "Initial email pending", "Follow-up 2 of 5, due 3 Dec",
 * "All 5 follow-ups done" or "Stopped: the contact replied". While the initial email is pending, people who can edit
 * the employee can record that it went out (an email sent outside SampForce); the cadence starts from then.
 */
export function CadenceStatus({ cadence, contactId, companyId, canMark, className }: { cadence: ContactCadence | null | undefined; contactId: string; companyId?: string | null; canMark: boolean; className?: string }) {
  const t = useT();
  const mark = useMarkInitialEmail(contactId, companyId);
  if (!cadence || cadence.state === 'NONE') return null;
  const c = cadence;
  const line = (() => {
    switch (c.state) {
      case 'FRESH':
        return { icon: MailQuestion, tone: 'text-cyan-700 dark:text-cyan-300', text: t('Initial email pending') };
      case 'ACTIVE':
        return c.next
          ? { icon: Repeat, tone: c.next.overdue ? 'font-semibold text-critical' : 'text-foreground', text: t('Follow-up {step} of {total}, due {date}', { step: c.next.step, total: c.total, date: formatDate(c.next.dueAt) }) }
          : { icon: Repeat, tone: 'text-foreground', text: t('{done} of {total} follow-ups done', { done: c.completed, total: c.total }) };
      case 'COMPLETE':
        return { icon: CircleCheck, tone: 'text-success', text: t('All {total} follow-ups done', { total: c.total }) };
      case 'STOPPED':
        return { icon: CircleSlash, tone: 'text-muted-foreground', text: t('Cadence stopped: {reason}', { reason: c.stoppedReason && STOP_REASON[c.stoppedReason] ? t(STOP_REASON[c.stoppedReason]!) : (c.stoppedReason ?? t('the contact answered')) }) };
      default:
        return null;
    }
  })();
  if (!line) return null;
  const Icon = line.icon;
  return (
    <div className={cn('space-y-0.5 text-xs', className)} data-cadence={c.state}>
      <p className={cn('flex items-center gap-1', line.tone)}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span>{line.text}</span>
      </p>
      {c.state === 'FRESH' && canMark && (
        <button
          type="button"
          disabled={mark.isPending}
          onClick={() => mark.mutate({})}
          className="inline-flex min-h-6 items-center gap-1 font-medium text-primary hover:underline disabled:opacity-60"
        >
          <MailCheck aria-hidden className="size-3.5" />
          {t('Mark initial email as sent')}
        </button>
      )}
      {mark.error && <p role="alert" className="text-critical">{mark.error.message}</p>}
    </div>
  );
}
