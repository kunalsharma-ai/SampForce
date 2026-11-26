'use client';

import { cn } from '@dealflow/ui';
import { PhoneCall } from 'lucide-react';
import Link from 'next/link';
import { useHasFeature } from '@/lib/features';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/**
 * Opens the Calls section with this company or employee already on the call card (ADR 0088): their company name,
 * employee name, designation, email and both phone numbers come across, nothing to retype.
 */
export function CallButton({ companyId, contactId, name, variant = 'icon', className }: { companyId?: string | null; contactId?: string | null; name: string; variant?: 'icon' | 'chip'; className?: string }) {
  const t = useT();
  const canWrite = useCan('activities:write');
  const hasInteractions = useHasFeature('interactions');
  const allowed = canWrite && hasInteractions;
  if (!allowed || (!companyId && !contactId)) return null;
  const qs = new URLSearchParams();
  if (companyId) qs.set('company', companyId);
  if (contactId) qs.set('contact', contactId);
  const label = t('Call {name} from Calls', { name });
  return (
    <Link
      href={`/app/calls?${qs}`}
      aria-label={label}
      title={label}
      data-call-button=""
      className={cn(
        variant === 'icon'
          ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white shadow-sm transition hover:scale-110 hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          : 'inline-flex min-h-8 items-center gap-1.5 rounded-full bg-emerald-700 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <PhoneCall aria-hidden className="size-3.5" />
      {variant === 'chip' && t('Call')}
    </Link>
  );
}
