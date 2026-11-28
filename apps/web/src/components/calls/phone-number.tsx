'use client';

import type { CallRow } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { dialableNumber, type DialLink, useDialNumber } from '@/lib/dial-number';
import { useT } from '@/lib/i18n';

/**
 * A phone number shown in Calls. Clicking it puts it in the dialer, ready to call. Outside the Calls page, or when
 * it is not a number anyone could dial, it is plain text.
 */
export function PhoneNumber({ number, link, className }: { number: string | null | undefined; link?: DialLink | null; className?: string }) {
  const t = useT();
  const dial = useDialNumber();
  if (!number) return null;
  const dialable = dialableNumber(number);
  if (!dial || !dialable) return <span className={className}>{number}</span>;
  return (
    <button
      type="button"
      data-testid="dial-number"
      onClick={(e) => {
        e.stopPropagation();
        dial.fill(number, link ?? null);
      }}
      aria-label={t('Put {number} in the dialer', { number })}
      title={t('Put {number} in the dialer', { number })}
      className={cn('inline max-w-full truncate rounded text-start underline decoration-dotted decoration-1 underline-offset-2 transition hover:text-emerald-700 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-emerald-300', className)}
    >
      {number}
    </button>
  );
}

/** The number of an earlier call, kept on the company and contact that call was with. */
export function callDialLink(c: Pick<CallRow, 'company' | 'employee'>): DialLink {
  return { companyId: c.company?.id ?? null, contactId: c.employee?.id ?? null, source: 'OTHER', label: [c.employee?.name, c.company?.name].filter(Boolean).join(' · ') || null };
}
