import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { GlobeExplorer } from './globe-explorer';

export const metadata: Metadata = { title: 'Revenue Globe' };

export default function GlobePage() {
  return (
    <>
      <PageHeader title="Revenue Globe" description="Open pipeline, recent wins and accounts by country, placed by each company’s country. Values are in your workspace currency." />
      <RequirePermission permission="companies:read">
        <RequirePermission permission="deals:read">
          <GlobeExplorer />
        </RequirePermission>
      </RequirePermission>
    </>
  );
}
