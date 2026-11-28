import type { Metadata } from 'next';
import { MarkingSheet } from '@/components/learning/marking';

export const metadata: Metadata = { title: 'Mark an assessment' };

export default async function LearningMarkingSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-5xl">
      <MarkingSheet attemptId={id} />
    </div>
  );
}
