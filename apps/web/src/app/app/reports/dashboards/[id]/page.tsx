import type { Metadata } from 'next';
import { RequirePermission } from '@/components/require-permission';
import { DashboardBoard } from '../dashboard-board';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="reports:read">
      <DashboardBoard id={id} />
    </RequirePermission>
  );
}
