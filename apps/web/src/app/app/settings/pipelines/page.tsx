import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { PipelinesManager } from './pipelines-manager';

export const metadata: Metadata = { title: 'Deal pipelines' };

/** Deal pipeline settings, moved here from the Pipeline page, which now shows the company journey (ADR 0085). */
export default function DealPipelinesPage() {
  return (
    <div className="max-w-4xl">
      <PageHeader title="Deal pipelines" description="Stages, their win probabilities and the default pipeline for new deals. The number of pipelines depends on your plan." />
      <PipelinesManager />
    </div>
  );
}
