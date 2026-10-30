import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';
import { DashboardsIndex } from './dashboards-index';

export const metadata: Metadata = { title: 'Dashboards' };

export default function DashboardsPage() {
  return (
    <>
      <PageHeader title="Dashboards" description="Pin saved reports side by side. Each widget is computed when the dashboard opens, from the records your role can read." />
      <RequirePermission permission="reports:read">
        <DashboardsIndex />
      </RequirePermission>
    </>
  );
}
