import type { Metadata } from 'next';
import { TeamStatusBoard } from '@/components/availability/team-status-board';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Team status' };

export default function TeamStatusPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Team status" description="Who is working, on a break, away or checked out right now, with today’s check-in and working time." />
      <TeamStatusBoard />
    </div>
  );
}
