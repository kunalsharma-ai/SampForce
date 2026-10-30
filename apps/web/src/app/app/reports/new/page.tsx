import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { ReportEditor } from '../report-editor';

export const metadata: Metadata = { title: 'New report' };

export default function NewReportPage() {
  return (
    <RequirePermission permission="reports:write">
      <Suspense>
        <ReportEditor />
      </Suspense>
    </RequirePermission>
  );
}
