import type { Metadata } from 'next';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Companies' };

export default function CompaniesPage() {
  return <RecordList entity="companies" description="Organisations, their parent companies, contacts and open deals." />;
}
