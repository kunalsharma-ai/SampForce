import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { LeadWizard } from './lead-wizard';

export const metadata: Metadata = { title: 'Create new company' };

export default function NewCompanyLeadPage() {
  return (
    <div>
      <PageHeader title="Create new company" description="A company with its location, business details, employees, ownership and status. Save a draft at any step." />
      <Suspense>
        <LeadWizard />
      </Suspense>
    </div>
  );
}
