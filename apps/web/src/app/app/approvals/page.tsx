import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ApprovalCenter } from './approval-center';

export const metadata: Metadata = { title: 'Approvals' };

/*
 * Approvals (ADR 0098): requests between workspaces (deletes, record edits, task, target and data changes), the
 * automation and quote approvals that were here before, Deleted items and the Super Workspace's rules.
 */
export default function ApprovalsPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Approvals" />
      <Suspense>
        <ApprovalCenter />
      </Suspense>
    </div>
  );
}
