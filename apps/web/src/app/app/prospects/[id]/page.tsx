import type { Metadata } from 'next';
import { ProspectListView } from '@/components/prospects/prospects';
import { RequirePermission } from '@/components/require-permission';

export const metadata: Metadata = { title: 'Prospect list' };

export default async function ProspectListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-6xl">
      <RequirePermission permission="prospects:read">
        <ProspectListView id={id} />
      </RequirePermission>
    </div>
  );
}
