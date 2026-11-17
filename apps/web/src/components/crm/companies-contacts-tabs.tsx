'use client';

import { cn } from '@dealflow/ui';
import { Building2, ContactRound } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';

/**
 * Companies and their contacts as one place (ADR 0066): the two lists sit side by side as tabs. The records stay
 * separate underneath, so links, imports, exports and permissions work as before.
 */
export function CompaniesContactsTabs({ active }: { active: 'companies' | 'contacts' }) {
  const t = useT();
  const tab = (key: 'companies' | 'contacts', label: 'Companies' | 'Contacts', Icon: typeof Building2) => (
    <Link
      href={`/app/${key}`}
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
        active === key ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon aria-hidden className="size-4" /> {t(label)}
    </Link>
  );
  return (
    <nav aria-label={t('Companies and contacts')} className="mb-4 inline-flex gap-1 rounded-lg border border-border bg-muted/50 p-1">
      {tab('companies', 'Companies', Building2)}
      {tab('contacts', 'Contacts', ContactRound)}
    </nav>
  );
}
