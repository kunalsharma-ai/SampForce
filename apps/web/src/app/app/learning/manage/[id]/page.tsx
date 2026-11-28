import type { Metadata } from 'next';
import { ModuleBuilder } from '@/components/learning/module-builder';

export const metadata: Metadata = { title: 'Edit learning module' };

export default async function LearningModuleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="max-w-7xl">
      <ModuleBuilder id={id} />
    </div>
  );
}
