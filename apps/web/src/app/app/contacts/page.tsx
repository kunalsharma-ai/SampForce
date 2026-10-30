import type { Metadata } from 'next';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return <RecordList entity="contacts" description="People you sell to, with their activity timeline and open tasks." />;
}
