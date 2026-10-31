import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { ProspectListsWorkspace } from '@/components/prospects/prospects';
import { RequirePermission } from '@/components/require-permission';

export const metadata: Metadata = { title: 'Prospect Lists' };

export default function ProspectListsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Prospect Lists"
        description="People you may want to contact, kept out of the CRM until you add them. Add them by hand, from CSV or Excel files, from the browser extension or from Apollo.io, then send a list to a sequence and track how it does."
      />
      <RequirePermission permission="prospects:read">
        <ProspectListsWorkspace />
      </RequirePermission>
    </div>
  );
}
