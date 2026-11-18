'use client';

import type { CompanyRow } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { UsersRound } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useT } from '@/lib/i18n';
import { CompanyEmployeeDirectory } from './company-dashboard';

/**
 * The Contacts column of the companies list (ADR 0066): the count opens the company's employees in place, where they
 * can be added, edited or moved without leaving the list.
 */
export function CompanyContactsCell({ company }: { company: CompanyRow }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-6 items-center gap-1 rounded px-1 tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('Contacts at {company}: {count}', { company: company.name, count: company.contactCount })}
        onClick={() => setOpen(true)}
      >
        <UsersRound aria-hidden className="size-3.5" /> {company.contactCount}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[5%] max-h-[90vh] max-w-5xl overflow-y-auto p-6">
          <DialogTitle className="text-lg font-semibold">{company.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {[company.leadNumber, t('Add, edit and see this company’s contacts here.')].filter(Boolean).join(' · ')}
          </DialogDescription>
          {open && <CompanyEmployeeDirectory company={company} compact />}
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/companies/${company.id}`}>{t('Open company')}</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
