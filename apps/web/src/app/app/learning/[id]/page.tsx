import type { Metadata } from 'next';
import { LearningPlayer } from '@/components/learning/player';

export const metadata: Metadata = { title: 'Learning module' };

export default async function LearningModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-7xl">
      <LearningPlayer moduleId={id} />
    </div>
  );
}
