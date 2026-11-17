import type { Metadata } from 'next';
import { CompaniesContactsTabs } from '@/components/crm/companies-contacts-tabs';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Companies' };

export default function CompaniesPage() {
  return (
    <>
      <CompaniesContactsTabs active="companies" />
      <RecordList entity="companies" description="Company leads with their employees. Open the contacts count to add or edit a company’s people in place." />
    </>
  );
}
