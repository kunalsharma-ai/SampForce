import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { ReplayExplorer } from './replay-explorer';

export const metadata: Metadata = { title: 'Pipeline replay' };

export default function ReplayPage() {
  return (
    <>
      <PageHeader title="Pipeline replay" description="Play back how your pipeline changed, day by day. Each dot is a deal, placed in the stage it was in on that day according to recorded stage changes." />
      <RequirePermission permission="deals:read">
        <RequirePermission permission="pipelines:read">
          <ReplayExplorer />
        </RequirePermission>
      </RequirePermission>
    </>
  );
}
