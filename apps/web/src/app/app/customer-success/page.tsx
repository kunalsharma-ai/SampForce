import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { SuccessWorkspace } from './success-workspace';

export const metadata: Metadata = { title: 'Customer Success' };

export default function CustomerSuccessPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Customer Success"
        description="Customers are companies with an active contract. Health is a rule-based score from activity, escalations, renewals and overdue tasks, and every point lost is explained."
      />
      <RequirePermission permission="success:read">
        <Suspense>
          <SuccessWorkspace />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
