import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Suspense } from 'react';
import { Inbox } from './inbox';

export const metadata: Metadata = { title: 'Email & Communication' };

export default function CommunicationPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Email & Communication"
        description="One inbox for your team: conversations with contacts and leads from every connected mailbox. SampForce stores only messages that involve a known contact or lead, never the rest of your mailbox."
      />
      <Suspense>
        <Inbox />
      </Suspense>
    </div>
  );
}
