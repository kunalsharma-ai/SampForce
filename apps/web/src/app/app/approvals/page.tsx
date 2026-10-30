import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { ApprovalsInbox } from './approvals-inbox';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Approvals" description="Automation steps waiting for a person. Requests expire after 7 days and the run is canceled." />
      <RequirePermission permission="automation:manage">
        <ApprovalsInbox />
      </RequirePermission>
    </div>
  );
}
