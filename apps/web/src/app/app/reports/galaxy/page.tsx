import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { GalaxyExplorer } from './galaxy-explorer';

export const metadata: Metadata = { title: 'Relationship Galaxy' };

export default function GalaxyPage() {
  return (
    <>
      <PageHeader title="Relationship Galaxy" description="Your companies with their people and deals, drawn as a network. Larger companies have more open pipeline. Parent companies are linked to their subsidiaries." />
      <RequirePermission permission="companies:read">
        <GalaxyExplorer />
      </RequirePermission>
    </>
  );
}
