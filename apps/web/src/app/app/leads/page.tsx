import type { Metadata } from 'next';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Inbound contacts' };

export default function LeadsPage() {
  return <RecordList entity="leads" description="Capture and qualify inbound contacts, catch duplicates, and convert them into contacts, companies and deals." />;
}
