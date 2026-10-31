import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { VisitorsWorkspace } from '@/components/visitors/visitors';

export const metadata: Metadata = { title: 'Website Visitors' };

export default function WebsiteVisitorsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Website Visitors"
        description="Visits to your own website from a consent-aware tracking script: important pages, repeat visits, campaigns and enquiries, linked to your leads and contacts."
      />
      <RequirePermission permission="visitors:read">
        <VisitorsWorkspace />
      </RequirePermission>
    </div>
  );
}
