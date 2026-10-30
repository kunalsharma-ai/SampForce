import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { FlowExplorer } from './flow-explorer';

export const metadata: Metadata = { title: 'Pipeline flow' };

export default function FlowPage() {
  return (
    <>
      <PageHeader title="Pipeline flow" description="How deals move between stages: where they sit now, how many moved along each path, and how long they typically stay. Counted from recorded stage changes." />
      <RequirePermission permission="deals:read">
        <RequirePermission permission="pipelines:read">
          <FlowExplorer />
        </RequirePermission>
      </RequirePermission>
    </>
  );
}
