import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { FollowUpsWorkspace } from './follow-ups-workspace';

export const metadata: Metadata = { title: 'Follow-ups' };

export default function FollowUpsPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Follow-ups" description="Every follow-up with your company leads: due today, upcoming, overdue, rescheduled, completed and cancelled. Managers can see their whole team." />
      <Suspense>
        <FollowUpsWorkspace />
      </Suspense>
    </div>
  );
}
