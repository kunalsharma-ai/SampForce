import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Invitations } from './invitations';
import { MembersTable } from './members-table';

export const metadata: Metadata = { title: 'Team Management' };

export default function TeamPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Team Management"
        description="Members of this workspace, invitations and what each role can do. The Free plan includes 2 users, counting pending invitations."
      />
      <div className="space-y-6">
        <Invitations />
        <MembersTable />
      </div>
    </div>
  );
}
