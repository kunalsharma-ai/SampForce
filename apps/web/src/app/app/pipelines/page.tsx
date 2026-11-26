import type { Metadata } from 'next';
import { PipelineJourneyPage } from './pipeline-journey';

export const metadata: Metadata = { title: 'Pipeline' };

export default function PipelinePage() {
  return <PipelineJourneyPage />;
}
