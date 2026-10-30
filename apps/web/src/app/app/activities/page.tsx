import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { ActivitiesWorkspace } from './activities-workspace';

export const metadata: Metadata = { title: 'Sales Activities' };

export default function ActivitiesPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Sales Activities" description="Your tasks and the team's latest calls, emails, meetings and notes. Log activities from any lead, contact, company or deal." />
      <ActivitiesWorkspace />
    </div>
  );
}
