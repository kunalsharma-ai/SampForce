import type { Metadata } from 'next';
import { LearningHome } from '@/components/learning/learning-home';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Learning & Development' };

export default function LearningPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Learning & Development" description="Your assigned training, open modules to explore, your scores, achievements and certificates." />
      <LearningHome />
    </div>
  );
}
