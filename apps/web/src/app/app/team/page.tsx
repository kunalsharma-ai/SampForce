import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { MembersTable } from './members-table';

export const metadata: Metadata = { title: 'Team Management' };

export default function TeamPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Team Management"
        description="Members of this workspace and what each role can do. Email invitations arrive with self-service onboarding in Phase 6."
      />
      <MembersTable />
    </div>
  );
}
