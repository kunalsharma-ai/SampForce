import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { ReportEditor } from '../report-editor';

export const metadata: Metadata = { title: 'Report' };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="reports:read">
      <Suspense>
        <ReportEditor id={id} />
      </Suspense>
    </RequirePermission>
  );
}
