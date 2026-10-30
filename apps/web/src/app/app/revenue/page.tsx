import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { RevenueWorkspace } from './revenue-workspace';

export const metadata: Metadata = { title: 'Revenue Intelligence' };

export default function RevenuePage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Revenue Intelligence"
        description="What closed this quarter and why, computed directly from your deals, quotes, targets and forecast snapshots. Nothing here is estimated by AI."
      />
      <RequirePermission permission="deals:read">
        <RequirePermission permission="dashboard:read">
          <RevenueWorkspace />
        </RequirePermission>
      </RequirePermission>
    </div>
  );
}
