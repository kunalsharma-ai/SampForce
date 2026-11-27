import type { Metadata } from 'next';
import { MarkingQueue } from '@/components/learning/marking';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Marking' };

export default function LearningMarkingPage() {
  return (
    <div className="max-w-6xl">
      <PageHeader title="Marking" description="Written answers, practical work and uploads waiting for your marks." />
      <MarkingQueue />
    </div>
  );
}
