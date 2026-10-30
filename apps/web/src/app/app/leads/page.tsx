import type { Metadata } from 'next';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  return <RecordList entity="leads" description="Capture and qualify leads, catch duplicates, and convert them into contacts, companies and deals." />;
}
