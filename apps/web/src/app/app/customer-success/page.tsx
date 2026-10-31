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
        description="Customers are companies with an active contract. Churn risk comes from a rule-based health score: activity and engagement, escalations and portal requests, renewals, lost deals and overdue tasks. Every point lost is explained."
      />
      <RequirePermission permission="success:read">
        <Suspense>
          <SuccessWorkspace />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
