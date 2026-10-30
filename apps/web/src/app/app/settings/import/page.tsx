import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ImportWizard } from './import-wizard';

export const metadata: Metadata = { title: 'Import data' };

export default function ImportPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Import data" description="Bring in leads, contacts or companies from a CSV file (UTF-8, up to 2 MB and 5,000 rows). Every file is checked before anything is saved." />
      <Suspense>
        <ImportWizard />
      </Suspense>
    </div>
  );
}
