'use client';

import type { CrmStatusRef } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { countryName } from '@/components/forms/locale-data';
import { textOn } from '@/lib/company-crm';
import { useT } from '@/lib/i18n';

/** A company or employee status in its configured colour. Default status names show in the reader's language. */
export function StatusChip({ status, className }: { status: Pick<CrmStatusRef, 'name' | 'color'> | null | undefined; className?: string }) {
  const t = useT();
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn('inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={{ backgroundColor: status.color, color: textOn(status.color) }}
    >
      {t.maybe(status.name)}
    </span>
  );
}

/** A country flag (SVG, so it shows on every system) with the country's name for screen readers and on hover. */
/** `decorative` hides the flag from screen readers where the country is already written next to it. */
export function CountryFlag({ code, withName = false, decorative = false, className }: { code: string | null | undefined; withName?: boolean; decorative?: boolean; className?: string }) {
  const t = useT();
  if (!code) return withName ? <span className="text-muted-foreground">—</span> : null;
  const name = countryName(code, t.formatLocale);
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {decorative ? (
        <span className={`fi fi-${code.toLowerCase()} rounded-[2px] shadow-sm`} aria-hidden title={name} />
      ) : (
        <span className={`fi fi-${code.toLowerCase()} rounded-[2px] shadow-sm`} role="img" aria-label={name} title={name} />
      )}
      {withName && <span>{name}</span>}
    </span>
  );
}
