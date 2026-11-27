import type { Metadata } from 'next';
import { Assessment } from '@/components/learning/assessment';

export const metadata: Metadata = { title: 'Assessment' };

export default async function AssessmentPage({ params }: { params: Promise<{ id: string; attemptId: string }> }) {
  const { id, attemptId } = await params;
  return (
    <div className="max-w-6xl">
      <Assessment moduleId={id} attemptId={attemptId} />
    </div>
  );
}
