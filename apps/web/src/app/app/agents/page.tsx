import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { AgentsConsole } from './agents-console';

export const metadata: Metadata = { title: 'AI Agents' };

export default function AgentsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="AI Agents"
        description="What each agent may and may not do, whether it can run right now, and what it has cost this month. Agents propose; people decide."
      />
      <RequirePermission permission="ai:use">
        <AgentsConsole />
      </RequirePermission>
    </div>
  );
}
