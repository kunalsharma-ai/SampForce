import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { CampaignsWorkspace } from './campaigns-workspace';

export const metadata: Metadata = { title: 'Campaigns' };

export default function CampaignsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Campaigns"
        description="Track campaigns and the leads, deals and revenue they brought in. Attribution is first touch: a lead counts for the campaign whose form captured it, that it was linked to, or whose UTM value it carries."
      />
      <RequirePermission permission="marketing:read">
        <CampaignsWorkspace />
      </RequirePermission>
    </div>
  );
}
