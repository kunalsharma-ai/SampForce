import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { ApprovalsInbox } from './approvals-inbox';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Approvals" description="Automation steps and quote discounts waiting for a person. You see the requests your role can decide. Requests expire after 7 days." />
      {/* The API lists only requests whose permission the viewer holds (automation:manage or quotes:approve). */}
      <ApprovalsInbox />
    </div>
  );
}
