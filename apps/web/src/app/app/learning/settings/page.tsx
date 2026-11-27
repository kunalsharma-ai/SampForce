import type { Metadata } from 'next';
import { LearningSettings } from '@/components/learning/learning-settings';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Learning settings' };

export default function LearningSettingsPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Learning settings" description="Categories, the certificate design, and the defaults for new modules." />
      <LearningSettings />
    </div>
  );
}
