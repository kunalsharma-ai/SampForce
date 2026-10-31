import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { FinderWorkspace } from './finder-workspace';

export const metadata: Metadata = { title: 'Email Finder' };

export default function FinderPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Email Finder"
        description="Find work addresses for a company, or for one person there. DealFlow reads the company’s public website, works out how its addresses are written, and checks that the domain receives email."
      />
      <RequirePermission permission="leads:read">
        <FinderWorkspace />
      </RequirePermission>
    </div>
  );
}
