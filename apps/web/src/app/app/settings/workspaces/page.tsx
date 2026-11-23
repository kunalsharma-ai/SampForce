import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { WorkspacesManager } from './workspaces-manager';

export const metadata: Metadata = { title: 'Workspaces' };

export default function WorkspacesPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Workspaces"
        description="Your organisation’s Manager and Executive Workspaces, and the Permission Center: what each workspace may use and do. A workspace never gets more than the one above it."
      />
      <WorkspacesManager />
    </div>
  );
}
