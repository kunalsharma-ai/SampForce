import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { PortalWorkspace } from './portal-workspace';

export const metadata: Metadata = { title: 'Client Portal' };

export default async function PortalAdminPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Client Portal" description="A signed-in space where your customers follow their projects, approve proposals, share documents and ask for help. Invite people from a company's page." />
      <RequirePermission permission="companies:read">
        <PortalWorkspace initialRequest={id ?? null} />
      </RequirePermission>
    </div>
  );
}
