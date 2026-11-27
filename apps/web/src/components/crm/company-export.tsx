'use client';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@dealflow/ui';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { downloadFile } from '@/lib/api';
import { toQuery } from '@/lib/crm';
import { useHasFeature } from '@/lib/features';
import { type MessageKey, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

type Part = 'companies' | 'employees' | 'branches' | 'interactions';

const CSV_PARTS: { part: Part; label: MessageKey }[] = [
  { part: 'companies', label: 'CSV: companies' },
  { part: 'employees', label: 'CSV: employees' },
  { part: 'branches', label: 'CSV: branches' },
  { part: 'interactions', label: 'CSV: interactions' },
];

/**
 * Export companies (ADR 0079): an Excel workbook with Companies, Employees, Branches and Interactions sheets, or one
 * CSV file per part. With `companyId` it exports that company from its page; otherwise the list as filtered on
 * screen (`filters`). Every stored field goes out; details the person may not see stay blank (the server decides).
 */
export function CompanyExportMenu({ companyId, filters, size = 'sm' }: { companyId?: string; filters?: Record<string, string | number | undefined | null>; size?: 'sm' | 'default' }) {
  const t = useT();
  const canExport = useCan('data:export');
  const excel = useHasFeature('excel_export');
  const canContacts = useCan('contacts:read');
  const canActivities = useCan('activities:read');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canExport) return null;

  const base = companyId ? `/companies/${companyId}/export` : '/exports/companies';
  const run = (format: 'csv' | 'xlsx', part?: Part) => {
    const key = `${format}:${part ?? ''}`;
    setBusy(key);
    setError(null);
    const { page: _page, pageSize: _size, ...rest } = filters ?? {};
    downloadFile(`${base}${toQuery({ ...(companyId ? {} : rest), format, part })}`, `sampforce-companies.${format}`)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };
  const parts = CSV_PARTS.filter((p) => (p.part === 'employees' ? canContacts : p.part === 'interactions' ? canActivities : true));

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} disabled={!!busy} data-testid="company-export">
            <Download aria-hidden /> {busy ? t('Exporting…') : t('Export')} <ChevronDown aria-hidden className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{companyId ? t('Export this company with its employees') : t('Export the companies in this list')}</DropdownMenuLabel>
          {excel && (
            <DropdownMenuItem onSelect={() => run('xlsx')}>
              <FileSpreadsheet aria-hidden className="shrink-0" />
              <span className="flex flex-col">
                <span>{t('Excel workbook (.xlsx)')}</span>
                <span className="text-xs text-muted-foreground">{t('Companies, employees, branches and interactions on separate sheets')}</span>
              </span>
            </DropdownMenuItem>
          )}
          {excel && <DropdownMenuSeparator />}
          {parts.map((p) => (
            <DropdownMenuItem key={p.part} onSelect={() => run('csv', p.part)}>
              <FileText aria-hidden /> {t(p.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p role="alert" className="max-w-xs text-end text-xs text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
