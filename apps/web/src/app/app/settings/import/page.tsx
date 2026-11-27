import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ImportWizard } from './import-wizard';

export const metadata: Metadata = { title: 'Import data' };

export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Import data" description="Bring in companies with their employees, inbound contacts, contacts or companies from a CSV or Excel file (up to 2 MB and 5,000 rows). Every file is checked before anything is saved." />
      <Suspense>
        <ImportWizard />
      </Suspense>
    </div>
  );
}
