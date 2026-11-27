import type { Metadata } from 'next';
import { ManageHome } from '@/components/learning/manage-home';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Learning management' };

export default function LearningManagePage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Learning management" description="Create modules, assign them to your team and follow progress, scores and certificates." />
      <ManageHome />
    </div>
  );
}
