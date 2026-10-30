import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { ReportsIndex } from './reports-index';

export const metadata: Metadata = { title: 'Reports & Analytics' };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports & Analytics" description="Build reports from your CRM records, pin them to dashboards, and explore relationships, regions and pipeline movement visually. Every figure is counted from your records." />
      <RequirePermission permission="reports:read">
        <ReportsIndex />
      </RequirePermission>
    </>
  );
}
