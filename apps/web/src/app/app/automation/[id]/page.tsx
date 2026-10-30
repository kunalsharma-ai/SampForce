import { Skeleton } from '@dealflow/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { WorkflowWorkspace } from '../workflow-workspace';

export const metadata: Metadata = { title: 'Workflow' };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-5xl">
      <h1 className="sr-only">{id === 'new' ? 'New workflow' : 'Edit workflow'}</h1>
      <RequirePermission permission="automation:manage">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <WorkflowWorkspace id={id === 'new' ? null : id} />
        </Suspense>
      </RequirePermission>
    </div>
  );
}
