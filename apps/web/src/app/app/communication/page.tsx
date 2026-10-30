import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Mailbox } from './mailbox';

export const metadata: Metadata = { title: 'Email & Communication' };

export default function CommunicationPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Email & Communication"
        description="Email with your contacts and leads. DealFlow stores only messages that involve a known contact or lead, never the rest of your mailbox."
      />
      <Mailbox />
    </div>
  );
}
