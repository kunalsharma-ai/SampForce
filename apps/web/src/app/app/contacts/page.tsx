import type { Metadata } from 'next';
import { CompaniesContactsTabs } from '@/components/crm/companies-contacts-tabs';
import { RecordList } from '@/components/crm/record-list';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <>
      <CompaniesContactsTabs active="contacts" />
      <RecordList entity="contacts" description="People you sell to, with their activity timeline and open tasks." />
    </>
  );
}
