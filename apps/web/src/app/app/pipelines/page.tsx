import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { PipelinesManager } from './pipelines-manager';

export const metadata: Metadata = { title: 'Pipelines' };

export default function PipelinesPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Pipelines" description="Stages, their win probabilities and the default pipeline for new deals. The number of pipelines depends on your plan." />
      <PipelinesManager />
    </div>
  );
}
