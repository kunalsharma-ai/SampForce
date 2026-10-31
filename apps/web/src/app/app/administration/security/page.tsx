import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { WorkspaceSecurity } from './workspace-security';

export const metadata: Metadata = { title: 'Workspace security' };

export default function WorkspaceSecurityPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Workspace security" description="Two-step verification policy, single sign-on and SCIM provisioning for this workspace." />
      <WorkspaceSecurity />
    </div>
  );
}
