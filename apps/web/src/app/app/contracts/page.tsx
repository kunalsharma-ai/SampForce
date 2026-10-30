import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { ContractsWorkspace } from './contracts-workspace';

export const metadata: Metadata = { title: 'Contracts' };

export default function ContractsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Contracts"
        description="Your contract register with renewal reminders. Signatures are recorded by your team; no e-signature provider is connected."
      />
      <RequirePermission permission="contracts:read">
        <ContractsWorkspace />
      </RequirePermission>
    </div>
  );
}
