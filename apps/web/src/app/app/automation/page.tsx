import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { WorkflowList } from './workflow-list';

export const metadata: Metadata = { title: 'Automation Studio' };

export default function AutomationPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Automation Studio"
        description="Workflows that react to CRM events. Each one acts as the person who last activated or edited it, with that person's permissions. Emails and webhooks always wait for a person to approve them."
      />
      <RequirePermission permission="automation:manage">
        <WorkflowList />
      </RequirePermission>
    </div>
  );
}
