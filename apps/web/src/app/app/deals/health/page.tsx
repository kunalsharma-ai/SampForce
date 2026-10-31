import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { DealHealthBoard } from './deal-health-board';

export const metadata: Metadata = { title: 'Deal health' };

export default function DealHealthPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Deal health"
        description="Every open deal, scored each hour from its activity, time in stage, tasks, contact and close date. Owners are notified once when a deal turns high risk, and Automation Studio can react to it."
      />
      <RequirePermission permission="deals:read">
        <Suspense>
          <DealHealthBoard />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
