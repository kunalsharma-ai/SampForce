import type { Metadata } from 'next';
import { GamificationWorkspace } from '@/components/gamification/gamification';
import { PageHeader } from '@/components/page-header';
import { RequirePermission } from '@/components/require-permission';

export const metadata: Metadata = { title: 'Sales Gamification' };

export default function GamificationPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Sales Gamification"
        description="Points, leaderboards, badges and competitions worked out from your CRM records. Admins and sales managers choose which activities earn points and how badges are earned."
      />
      <RequirePermission permission="gamification:read">
        <GamificationWorkspace />
      </RequirePermission>
    </div>
  );
}
