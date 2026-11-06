import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { MarketingWorkspace } from './marketing-workspace';

export const metadata: Metadata = { title: 'Marketing' };

export default function MarketingPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Marketing"
        description="Audience segments built from your leads and contacts, and hosted lead-capture forms that record consent. SampForce does not send marketing email yet."
      />
      <RequirePermission permission="marketing:read">
        <MarketingWorkspace />
      </RequirePermission>
    </div>
  );
}
